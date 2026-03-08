from collections import defaultdict
from datetime import datetime, timedelta, timezone
import csv
import hashlib
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.position import Position
from app.models.sync_event import SyncEvent
from app.models.trade import Trade
from app.services.binance_sync import binance_sync_service

router = APIRouter(prefix="/api/v1", tags=["data"])


def _parse_window(window: str) -> timedelta:
    mapping = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
    return mapping.get(window, timedelta(days=30))


def _aggregate_trade_fills(trades: list[Trade]) -> list[dict]:
    grouped: dict[str, dict] = {}

    for t in trades:
        group_key = f"order:{t.order_id}" if t.order_id else f"trade:{t.binance_trade_id}"
        qty = float(t.qty or 0)
        price = float(t.price or 0)
        quote = float(t.quote_qty or 0)

        if group_key not in grouped:
            grouped[group_key] = {
                "id": group_key,
                "binance_trade_id": t.binance_trade_id,
                "order_id": t.order_id,
                "symbol": t.symbol,
                "side": t.side,
                "qty": 0.0,
                "quote_qty": 0.0,
                "commission": 0.0,
                "realized_pnl": 0.0,
                "price_weighted_sum": 0.0,
                "executed_at": t.executed_at,
                "signal_id": getattr(t, "signal_id", None),
                "decision_id": getattr(t, "decision_id", None),
                "fills_count": 0,
            }

        row = grouped[group_key]
        row["qty"] += qty
        row["quote_qty"] += quote
        row["commission"] += float(t.commission or 0)
        row["realized_pnl"] += float(t.realized_pnl or 0)
        row["price_weighted_sum"] += price * qty
        row["fills_count"] += 1

        if t.executed_at and t.executed_at < row["executed_at"]:
            row["executed_at"] = t.executed_at

    out = []
    for row in grouped.values():
        qty = row["qty"]
        avg_price = (row["price_weighted_sum"] / qty) if qty > 0 else 0.0
        out.append(
            {
                "id": row["id"],
                "binance_trade_id": row["binance_trade_id"],
                "order_id": row["order_id"],
                "symbol": row["symbol"],
                "side": row["side"],
                "price": avg_price,
                "qty": row["qty"],
                "quote_qty": row["quote_qty"],
                "realized_pnl": row["realized_pnl"],
                "commission": row["commission"],
                "executed_at": row["executed_at"],
                "signal_id": row["signal_id"],
                "decision_id": row["decision_id"],
                "fills_count": row["fills_count"],
            }
        )

    return out


def _extract_closed_positions(orders: list[dict]) -> list[dict]:
    # Approximation from window-local flow:
    # each time net qty crosses back through zero, we consider one closed position.
    state: dict[str, dict] = defaultdict(lambda: {"net": 0.0, "cycle_pnl": 0.0})
    closed: list[dict] = []

    for o in sorted(orders, key=lambda x: x["executed_at"]):
        symbol = o["symbol"]
        qty = float(o.get("qty") or 0)
        pnl = float(o.get("realized_pnl") or 0)
        side = str(o.get("side") or "BUY").upper()
        signed = qty if side == "BUY" else -qty

        st = state[symbol]
        prev = st["net"]
        new = prev + signed
        st["cycle_pnl"] += pnl

        crossed_zero = (prev > 0 and new <= 0) or (prev < 0 and new >= 0)
        if prev != 0 and crossed_zero:
            closed.append(
                {
                    "symbol": symbol,
                    "closed_at": o["executed_at"],
                    "realized_pnl": st["cycle_pnl"],
                }
            )
            st["cycle_pnl"] = 0.0

        st["net"] = new

    return closed


@router.get("/stats/overview")
def get_stats_overview(
    window: str = Query(default="30d", pattern="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
):
    all_positions = db.query(Position).all()
    active_positions = [p for p in all_positions if abs(float(p.position_amt) * float(p.mark_price)) > 0]
    total_positions = len(active_positions)
    total_unrealized_pnl = float(sum(float(p.unrealized_pnl or 0) for p in active_positions))

    margin_used_positions = 0.0
    for p in active_positions:
        notional = abs(float(p.position_amt) * float(p.mark_price))
        lev = max(int(p.leverage or 1), 1)
        margin_used_positions += (notional / lev)

    account_balance_wallet = None
    account_balance_total = None
    try:
        bal = binance_sync_service.fetch_account_balance(asset="USDT")
        if bal is not None:
            account_balance_wallet = float(bal)
            account_balance_total = account_balance_wallet + margin_used_positions
    except Exception:
        account_balance_wallet = None
        account_balance_total = None

    now_utc = datetime.now(timezone.utc)
    since = now_utc - _parse_window(window)

    all_trades = (
        db.query(Trade)
        .filter(Trade.executed_at <= now_utc)
        .order_by(Trade.executed_at.asc())
        .all()
    )

    window_trades = [t for t in all_trades if t.executed_at >= since]

    # Window-aware metrics/counters
    total_realized_pnl = float(sum(float(t.realized_pnl or 0) for t in window_trades))
    aggregated_orders_all = _aggregate_trade_fills(all_trades)
    aggregated_orders_window = [o for o in aggregated_orders_all if o["executed_at"] >= since]
    total_trades = len(aggregated_orders_window)

    closed_positions_all = _extract_closed_positions(aggregated_orders_all)
    closed_positions = [cp for cp in closed_positions_all if cp["closed_at"] >= since]
    total_closed_trades = len(closed_positions)
    equity = total_realized_pnl + total_unrealized_pnl

    # Reconstruct full wallet path from current wallet and total realized history.
    current_wallet = float(account_balance_wallet or 0.0)
    total_realized_all = float(sum(float(t.realized_pnl or 0) for t in all_trades))
    start_wallet_est_all = current_wallet - total_realized_all

    # Drawdown + ATH on WINDOW using reconstructed full path as baseline.
    running_wallet = start_wallet_est_all
    peak_wallet = running_wallet
    ath_wallet = running_wallet
    ath_ts = since
    max_drawdown_pct = 0.0

    close_wallet_by_ts: dict[datetime, float] = {}
    for t in all_trades:
        running_wallet += float(t.realized_pnl or 0)
        ts = t.executed_at
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        close_wallet_by_ts[ts] = running_wallet

        if ts >= since:
            if running_wallet > peak_wallet:
                peak_wallet = running_wallet
            if running_wallet > ath_wallet:
                ath_wallet = running_wallet
                ath_ts = ts

            if peak_wallet > 0:
                dd = ((peak_wallet - running_wallet) / peak_wallet) * 100
                if dd > max_drawdown_pct:
                    max_drawdown_pct = dd

    if ath_ts.tzinfo is None:
        ath_ts = ath_ts.replace(tzinfo=timezone.utc)
    max_drawdown_pct = max(0.0, min(max_drawdown_pct, 100.0))

    # Average R by CLOSED LOSING POSITION at close time (window filtered, history-based bankroll).
    losing_rs_pct: list[float] = []
    losing_pnls_usd: list[float] = []
    for cp in closed_positions:
        pnl = float(cp["realized_pnl"])
        if pnl >= 0:
            continue
        cts = cp["closed_at"]
        if cts.tzinfo is None:
            cts = cts.replace(tzinfo=timezone.utc)
        wallet_at_close = float(close_wallet_by_ts.get(cts, current_wallet))
        denom = max(abs(wallet_at_close), 1e-9)
        losing_rs_pct.append(abs(pnl) / denom * 100)
        losing_pnls_usd.append(abs(pnl))

    avg_r_loss_pct = (sum(losing_rs_pct) / len(losing_rs_pct)) if losing_rs_pct else 0.0
    avg_r_loss_usd = (sum(losing_pnls_usd) / len(losing_pnls_usd)) if losing_pnls_usd else 0.0

    current_balance_ref = float(account_balance_total or account_balance_wallet or 0.0)
    avg_r_loss_pct_current_balance = (avg_r_loss_usd / current_balance_ref * 100) if current_balance_ref > 0 else 0.0

    # Display ATH on same basis as BALANCE card (incl. current margin proxy).
    ath_balance_display = max(ath_wallet + margin_used_positions, float(account_balance_total or 0.0))

    now = datetime.now(timezone.utc)
    hours_since_ath = max(0.0, (now - ath_ts).total_seconds() / 3600)

    return {
        "total_trades": total_trades,
        "total_closed_trades": total_closed_trades,
        "total_positions": total_positions,
        "total_realized_pnl": total_realized_pnl,
        "total_unrealized_pnl": total_unrealized_pnl,
        "equity": equity,
        "account_balance": account_balance_total,
        "account_balance_wallet": account_balance_wallet,
        "margin_used_positions": round(margin_used_positions, 8),
        "max_drawdown_pct": round(max_drawdown_pct, 2),
        "last_ath_balance": round(ath_balance_display, 8),
        "hours_since_last_ath": round(hours_since_ath, 2),
        "avg_r_loss_pct": round(avg_r_loss_pct, 4),
        "avg_r_loss_pct_current_balance": round(avg_r_loss_pct_current_balance, 4),
        "avg_r_loss_usd": round(avg_r_loss_usd, 8),
        "losing_closed_positions": len(losing_rs_pct),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/stats/equity")
def get_equity_timeseries(
    window: str = Query(default="30d", pattern="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
):
    since = datetime.now(timezone.utc) - _parse_window(window)
    trades = (
        db.query(Trade)
        .filter(Trade.executed_at >= since)
        .order_by(Trade.executed_at.asc())
        .all()
    )

    # 24h -> hourly points for better visibility.
    # 7d/30d -> daily points.
    by_bucket: dict[str, float] = defaultdict(float)
    for t in trades:
        dt = t.executed_at.astimezone(timezone.utc)
        if window == "24h":
            key = dt.replace(minute=0, second=0, microsecond=0).isoformat()
        else:
            key = dt.date().isoformat()
        by_bucket[key] += float(t.realized_pnl or 0)

    cumulative = 0.0
    series = []
    for key in sorted(by_bucket.keys()):
        cumulative += by_bucket[key]
        series.append({"ts": key, "equity": round(cumulative, 4), "pnl_realized": round(by_bucket[key], 4)})

    return {"window": window, "points": series}


@router.get("/risk/exposure")
def get_risk_exposure(db: Session = Depends(get_db)):
    positions = db.query(Position).all()

    gross_long_usd = 0.0
    gross_short_usd = 0.0
    total_abs_exposure = 0.0
    leverage_weighted_sum = 0.0
    per_symbol_abs: dict[str, float] = defaultdict(float)

    for p in positions:
        amt = float(p.position_amt)
        mark = float(p.mark_price)
        notional = amt * mark
        abs_notional = abs(notional)

        if notional >= 0:
            gross_long_usd += abs_notional
        else:
            gross_short_usd += abs_notional

        total_abs_exposure += abs_notional
        leverage_weighted_sum += abs_notional * float(p.leverage)
        per_symbol_abs[p.symbol] += abs_notional

    net_usd = gross_long_usd - gross_short_usd
    top_symbol_abs = max(per_symbol_abs.values()) if per_symbol_abs else 0.0
    top_symbol_share_pct = (top_symbol_abs / total_abs_exposure * 100) if total_abs_exposure > 0 else 0.0
    leverage_weighted = (leverage_weighted_sum / total_abs_exposure) if total_abs_exposure > 0 else 0.0

    return {
        "gross_long_usd": round(gross_long_usd, 4),
        "gross_short_usd": round(gross_short_usd, 4),
        "net_usd": round(net_usd, 4),
        "top_symbol_share_pct": round(top_symbol_share_pct, 2),
        "leverage_weighted": round(leverage_weighted, 2),
        "caps": {"max_gross_usd": 30000, "max_symbol_share_pct": 35},
    }


@router.get("/trades")
def get_trades(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    symbol: str | None = Query(default=None, min_length=3, max_length=20),
    window: str | None = Query(default=None, pattern="^(24h|7d|30d)$"),
    sort_by: str = Query(default="executed_at", pattern="^(executed_at|symbol|realized_pnl)$"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
):
    q = db.query(Trade)
    if symbol:
        q = q.filter(Trade.symbol == symbol.upper())
    if window:
        since = datetime.now(timezone.utc) - _parse_window(window)
        q = q.filter(Trade.executed_at >= since)

    raw = q.order_by(Trade.executed_at.asc()).all()
    aggregated = _aggregate_trade_fills(raw)

    if sort_by == "symbol":
        aggregated.sort(key=lambda x: x["symbol"], reverse=(sort_dir == "desc"))
    elif sort_by == "realized_pnl":
        aggregated.sort(key=lambda x: float(x["realized_pnl"]), reverse=(sort_dir == "desc"))
    else:
        aggregated.sort(key=lambda x: x["executed_at"], reverse=(sort_dir == "desc"))

    total = len(aggregated)
    page = aggregated[offset: offset + limit]

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "trades": [
            {
                "id": t["id"],
                "binance_trade_id": t["binance_trade_id"],
                "order_id": t["order_id"],
                "symbol": t["symbol"],
                "side": t["side"],
                "price": float(t["price"]),
                "qty": float(t["qty"]),
                "realized_pnl": float(t["realized_pnl"]),
                "commission": float(t["commission"]),
                "fills_count": int(t["fills_count"]),
                "executed_at": t["executed_at"].isoformat(),
                "signal_id": t.get("signal_id"),
                "decision_id": t.get("decision_id"),
            }
            for t in page
        ]
    }


@router.get("/positions")
def get_positions(
    include_zero: bool = Query(default=False, description="Include zero-notional positions"),
    db: Session = Depends(get_db),
):
    positions = db.query(Position).order_by(Position.symbol.asc()).all()

    rows = []
    for p in positions:
        notional_usd = round(abs(float(p.position_amt) * float(p.mark_price)), 4)
        if (not include_zero) and notional_usd == 0:
            continue

        rows.append(
            {
                "id": p.id,
                "symbol": p.symbol,
                "side": "LONG" if float(p.position_amt) >= 0 else "SHORT",
                "position_amt": float(p.position_amt),
                "entry_price": float(p.entry_price),
                "mark_price": float(p.mark_price),
                "notional_usd": notional_usd,
                "unrealized_pnl": float(p.unrealized_pnl),
                "leverage": p.leverage,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            }
        )

    return {"positions": rows}


def _sync_events_query(db: Session, endpoint: str | None, status_value: str | None):
    q = db.query(SyncEvent)
    if endpoint:
        q = q.filter(SyncEvent.endpoint == endpoint)
    if status_value:
        q = q.filter(SyncEvent.status == status_value)
    return q


@router.get("/sync/events")
def sync_events(
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    endpoint: str | None = Query(default=None),
    status_value: str | None = Query(default=None, alias="status", pattern="^(ok|error)$"),
    db: Session = Depends(get_db),
):
    q = _sync_events_query(db, endpoint, status_value)
    total = q.count()
    rows = q.order_by(SyncEvent.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "events": [
            {
                "id": e.id,
                "endpoint": e.endpoint,
                "status": e.status,
                "detail": e.detail,
                "actor": e.actor,
                "symbol": e.symbol,
                "duration_ms": e.duration_ms,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in rows
        ]
    }


@router.get("/sync/events.csv")
def sync_events_csv(
    endpoint: str | None = Query(default=None),
    status_value: str | None = Query(default=None, alias="status", pattern="^(ok|error)$"),
    db: Session = Depends(get_db),
):
    rows = _sync_events_query(db, endpoint, status_value).order_by(SyncEvent.created_at.desc()).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id", "created_at", "endpoint", "status", "actor", "symbol", "duration_ms", "detail"])
    for e in rows:
        writer.writerow([
            e.id,
            e.created_at.isoformat() if e.created_at else "",
            e.endpoint,
            e.status,
            e.actor or "",
            e.symbol or "",
            e.duration_ms if e.duration_ms is not None else "",
            e.detail or "",
        ])

    filename = "sync_events.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/diagnostics/connectors")
def diagnostics_connectors(db: Session = Depends(get_db)):
    db_status = "ok"
    db_error = None
    db_latency_ms = None
    started = datetime.now(timezone.utc)
    try:
        db.execute(text("SELECT 1"))
        db_latency_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    except Exception as exc:
        db_status = "error"
        db_error = str(exc)

    last_trade_ts = db.query(func.max(Trade.executed_at)).scalar()
    last_position_ts = db.query(func.max(Position.updated_at)).scalar()

    candidates = [ts for ts in [last_trade_ts, last_position_ts] if ts is not None]
    last_sync_at = max(candidates).isoformat() if candidates else None

    role = (settings.app_role or "operator").lower().strip()
    if role not in {"operator", "viewer"}:
        role = "operator"

    can_sync = (role == "operator") and (not settings.app_read_only)
    if settings.app_read_only:
        can_sync_reason = "app_read_only"
    elif role != "operator":
        can_sync_reason = "role_viewer"
    else:
        can_sync_reason = "ok"

    return {
        "binance": {
            "status": "configured" if (settings.binance_api_key and settings.binance_api_secret) else "mock-mode",
            "base_url": settings.binance_base_url,
        },
        "db": {
            "status": db_status,
            "error": db_error,
            "latency_ms": db_latency_ms,
        },
        "sync": {
            "last_sync_at": last_sync_at,
            "server_time": datetime.now(timezone.utc).isoformat(),
            "read_only": settings.app_read_only,
            "role": role,
            "can_sync": can_sync,
            "can_sync_reason": can_sync_reason,
            "token_required": bool(settings.sync_api_token),
            "min_interval_seconds": settings.sync_min_interval_seconds,
        },
    }


def _audit_query(window: str, db: Session):
    since = datetime.now(timezone.utc) - _parse_window(window)
    return (
        db.query(Trade)
        .filter(Trade.executed_at >= since)
        .order_by(Trade.executed_at.asc())
    )


@router.get("/audit/summary")
def audit_summary(
    window: str = Query(default="30d", pattern="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
):
    trades = _audit_query(window, db).all()

    payload = "\n".join(
        [
            f"{t.binance_trade_id}|{t.symbol}|{t.side}|{float(t.qty)}|{float(t.price)}|{float(t.realized_pnl or 0)}|{t.executed_at.isoformat()}"
            for t in trades
        ]
    )
    checksum = hashlib.sha256(payload.encode("utf-8")).hexdigest()

    total_realized = sum(float(t.realized_pnl or 0) for t in trades)
    total_fees = sum(float(t.commission or 0) for t in trades)

    return {
        "window": window,
        "trades_count": len(trades),
        "total_realized_pnl": round(total_realized, 8),
        "total_fees": round(total_fees, 8),
        "checksum_sha256": checksum,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/audit/trades")
def audit_trades(
    window: str = Query(default="30d", pattern="^(24h|7d|30d)$"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    q = _audit_query(window, db)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()

    payload = "\n".join(
        [
            f"{t.binance_trade_id}|{t.symbol}|{t.side}|{float(t.qty)}|{float(t.price)}|{float(t.realized_pnl or 0)}|{t.executed_at.isoformat()}"
            for t in rows
        ]
    )
    checksum = hashlib.sha256(payload.encode("utf-8")).hexdigest()

    return {
        "window": window,
        "total": total,
        "limit": limit,
        "offset": offset,
        "page_checksum_sha256": checksum,
        "trades": [
            {
                "id": t.id,
                "binance_trade_id": t.binance_trade_id,
                "symbol": t.symbol,
                "side": t.side,
                "price": float(t.price),
                "qty": float(t.qty),
                "commission": float(t.commission or 0),
                "realized_pnl": float(t.realized_pnl or 0),
                "signal_id": t.signal_id,
                "decision_id": t.decision_id,
                "executed_at": t.executed_at.isoformat(),
            }
            for t in rows
        ],
    }


@router.get("/audit/trades.csv")
def audit_trades_csv(
    window: str = Query(default="30d", pattern="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
):
    rows = _audit_query(window, db).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "id",
        "binance_trade_id",
        "symbol",
        "side",
        "price",
        "qty",
        "commission",
        "realized_pnl",
        "signal_id",
        "decision_id",
        "executed_at",
    ])

    for t in rows:
        writer.writerow([
            t.id,
            t.binance_trade_id,
            t.symbol,
            t.side,
            float(t.price),
            float(t.qty),
            float(t.commission or 0),
            float(t.realized_pnl or 0),
            t.signal_id or "",
            t.decision_id or "",
            t.executed_at.isoformat(),
        ])

    csv_data = buffer.getvalue()
    filename = f"audit_trades_{window}.csv"
    return StreamingResponse(
        iter([csv_data]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
