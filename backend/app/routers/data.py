from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.position import Position
from app.models.trade import Trade

router = APIRouter(prefix="/api/v1", tags=["data"])


def _parse_window(window: str) -> timedelta:
    mapping = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
    return mapping.get(window, timedelta(days=30))


@router.get("/stats/overview")
def get_stats_overview(
    window: str = Query(default="30d", pattern="^(24h|7d|30d)$"),
    db: Session = Depends(get_db),
):
    total_trades = db.query(func.count(Trade.id)).scalar()
    total_positions = db.query(func.count(Position.id)).scalar()
    total_realized_pnl = float(db.query(func.sum(Trade.realized_pnl)).scalar() or 0)
    total_unrealized_pnl = float(db.query(func.sum(Position.unrealized_pnl)).scalar() or 0)

    equity = total_realized_pnl + total_unrealized_pnl

    since = datetime.now(timezone.utc) - _parse_window(window)
    window_trades = (
        db.query(Trade)
        .filter(Trade.executed_at >= since)
        .order_by(Trade.executed_at.asc())
        .all()
    )

    rolling = 0.0
    peak = 0.0
    max_drawdown_pct = 0.0
    for t in window_trades:
        rolling += float(t.realized_pnl or 0)
        if rolling > peak:
            peak = rolling
        if peak > 0:
            dd = ((peak - rolling) / peak) * 100
            if dd > max_drawdown_pct:
                max_drawdown_pct = dd

    return {
        "total_trades": total_trades,
        "total_positions": total_positions,
        "total_realized_pnl": total_realized_pnl,
        "total_unrealized_pnl": total_unrealized_pnl,
        "equity": equity,
        "max_drawdown_pct": round(max_drawdown_pct, 2),
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

    by_day: dict[str, float] = defaultdict(float)
    for t in trades:
        key = t.executed_at.astimezone(timezone.utc).date().isoformat()
        by_day[key] += float(t.realized_pnl or 0)

    cumulative = 0.0
    series = []
    for day in sorted(by_day.keys()):
        cumulative += by_day[day]
        series.append({"ts": day, "equity": round(cumulative, 4), "pnl_realized": round(by_day[day], 4)})

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
    symbol: str | None = Query(default=None, min_length=3, max_length=20),
    db: Session = Depends(get_db),
):
    q = db.query(Trade)
    if symbol:
        q = q.filter(Trade.symbol == symbol.upper())

    trades = q.order_by(Trade.executed_at.desc()).limit(limit).all()
    return {
        "trades": [
            {
                "id": t.id,
                "binance_trade_id": t.binance_trade_id,
                "symbol": t.symbol,
                "side": t.side,
                "price": float(t.price),
                "qty": float(t.qty),
                "realized_pnl": float(t.realized_pnl or 0),
                "commission": float(t.commission or 0),
                "executed_at": t.executed_at.isoformat(),
            }
            for t in trades
        ]
    }


@router.get("/positions")
def get_positions(db: Session = Depends(get_db)):
    positions = db.query(Position).order_by(Position.symbol.asc()).all()
    return {
        "positions": [
            {
                "id": p.id,
                "symbol": p.symbol,
                "side": "LONG" if float(p.position_amt) >= 0 else "SHORT",
                "position_amt": float(p.position_amt),
                "entry_price": float(p.entry_price),
                "mark_price": float(p.mark_price),
                "notional_usd": round(abs(float(p.position_amt) * float(p.mark_price)), 4),
                "unrealized_pnl": float(p.unrealized_pnl),
                "leverage": p.leverage,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            }
            for p in positions
        ]
    }


@router.get("/diagnostics/connectors")
def diagnostics_connectors(db: Session = Depends(get_db)):
    db_status = "ok"
    db_error = None
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db_status = "error"
        db_error = str(exc)

    return {
        "binance": {
            "status": "configured" if (settings.binance_api_key and settings.binance_api_secret) else "mock-mode",
            "base_url": settings.binance_base_url,
        },
        "db": {
            "status": db_status,
            "error": db_error,
        },
    }
