from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
from pathlib import Path
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.account_snapshot import AccountSnapshot
from app.models.bot_heartbeat import BotHeartbeat
from app.models.execution_event import ExecutionEvent
from app.models.position import Position
from app.models.sync_event import SyncEvent
from app.security import require_sync_access
from app.services.binance_sync import binance_sync_service

router = APIRouter(prefix="/sync")

_RATE_STATE: dict[str, float] = {}


def _rate_key(endpoint: str, actor: str) -> str:
    return f"{endpoint}:{actor}"


def _enforce_rate_limit(endpoint: str, actor: str) -> None:
    now = time.time()
    key = _rate_key(endpoint, actor)
    min_interval = max(int(settings.sync_min_interval_seconds), 0)
    if min_interval <= 0:
        return

    last = _RATE_STATE.get(key)
    if last is not None and (now - last) < min_interval:
        remaining = round(min_interval - (now - last), 2)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit: wait {remaining}s before next sync on {endpoint}.",
        )

    _RATE_STATE[key] = now


def _actor_from_request(request: Request) -> str:
    token = request.headers.get("x-api-token")
    if token:
        return f"token:{hash(token) % 100000}"
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"


def _ensure_db_writable_or_503() -> None:
    db_url = str(settings.database_url or "")
    if not db_url.startswith("sqlite:///"):
        return

    db_path = db_url.replace("sqlite:///", "", 1)
    p = Path(db_path)
    if not p.is_absolute():
        p = (Path.cwd() / p).resolve()

    file_w = (not p.exists()) or os.access(p, os.W_OK)
    dir_w = os.access(p.parent, os.W_OK)
    if not (file_w and dir_w):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database is readonly (path={p}, file_writable={file_w}, dir_writable={dir_w}).",
        )


def _safe_commit(db: Session) -> bool:
    try:
        db.commit()
        return True
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return False


def _log_sync_event(
    db: Session,
    endpoint: str,
    actor: str,
    status_value: str,
    detail: str | None,
    symbol: str | None,
    duration_ms: int,
) -> None:
    evt = SyncEvent(
        endpoint=endpoint,
        actor=actor,
        status=status_value,
        detail=detail,
        symbol=symbol,
        duration_ms=duration_ms,
        created_at=datetime.now(timezone.utc),
    )
    db.add(evt)
    _safe_commit(db)


def _log_heartbeat(db: Session, status_value: str = "ok", note: str | None = None) -> None:
    hb = BotHeartbeat(
        source="dashboard-sync",
        status=status_value,
        note=note,
        created_at=datetime.now(timezone.utc),
    )
    db.add(hb)
    _safe_commit(db)


def _log_execution_event(
    db: Session,
    event_type: str,
    status_value: str,
    latency_ms: int | None,
    symbol: str | None = None,
    error_message: str | None = None,
) -> None:
    evt = ExecutionEvent(
        source="dashboard-sync",
        symbol=symbol,
        event_type=event_type,
        status=status_value,
        latency_ms=latency_ms,
        error_message=error_message,
        created_at=datetime.now(timezone.utc),
    )
    db.add(evt)
    _safe_commit(db)


def _snapshot_account_state(db: Session) -> None:
    wallet = binance_sync_service.fetch_account_balance(asset="USDT")

    active_positions = [p for p in db.query(Position).all() if abs(float(p.position_amt or 0)) > 0]
    margin_used = 0.0
    for p in active_positions:
        notional = abs(float(p.position_amt) * float(p.mark_price))
        lev = max(int(p.leverage or 1), 1)
        margin_used += (notional / lev)

    wallet_f = float(wallet) if wallet is not None else None
    equity_total = (wallet_f + margin_used) if wallet_f is not None else None

    snap = AccountSnapshot(
        wallet_balance=Decimal(str(wallet_f)) if wallet_f is not None else None,
        margin_used=Decimal(str(margin_used)),
        equity_total=Decimal(str(equity_total)) if equity_total is not None else None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(snap)
    if not _safe_commit(db):
        raise RuntimeError("snapshot_commit_failed")


@router.post("/trades")
def sync_trades(
    request: Request,
    symbol: str = Query(default="BTCUSDT", min_length=3, max_length=20),
    limit: int = Query(default=100, ge=1, le=1000),
    _: None = Depends(require_sync_access),
    db: Session = Depends(get_db),
) -> dict:
    started = time.time()
    actor = _actor_from_request(request)
    endpoint = "sync/trades"

    try:
        _ensure_db_writable_or_503()
        _enforce_rate_limit(endpoint, actor)
        inserted = binance_sync_service.sync_trades(db=db, symbol=symbol.upper(), limit=limit)
        try:
            _snapshot_account_state(db)
        except Exception:
            pass
        duration = int((time.time() - started) * 1000)
        _log_sync_event(db, endpoint, actor, "ok", None, symbol.upper(), duration)
        _log_execution_event(db, event_type=endpoint, status_value="ok", latency_ms=duration, symbol=symbol.upper())
        _log_heartbeat(db, status_value="ok")
        return {"status": "ok", "type": "trades", "symbol": symbol.upper(), "inserted": inserted}
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        duration = int((time.time() - started) * 1000)
        _log_sync_event(db, endpoint, actor, "error", str(exc)[:240], symbol.upper(), duration)
        _log_execution_event(db, event_type=endpoint, status_value="error", latency_ms=duration, symbol=symbol.upper(), error_message=str(exc)[:240])
        _log_heartbeat(db, status_value="error", note=str(exc)[:240])
        raise


@router.post("/positions")
def sync_positions(
    request: Request,
    _: None = Depends(require_sync_access),
    db: Session = Depends(get_db),
) -> dict:
    started = time.time()
    actor = _actor_from_request(request)
    endpoint = "sync/positions"

    try:
        _ensure_db_writable_or_503()
        _enforce_rate_limit(endpoint, actor)
        updated = binance_sync_service.sync_positions(db=db)
        try:
            _snapshot_account_state(db)
        except Exception:
            pass
        duration = int((time.time() - started) * 1000)
        _log_sync_event(db, endpoint, actor, "ok", None, None, duration)
        _log_execution_event(db, event_type=endpoint, status_value="ok", latency_ms=duration)
        _log_heartbeat(db, status_value="ok")
        return {"status": "ok", "type": "positions", "updated": updated}
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        duration = int((time.time() - started) * 1000)
        _log_sync_event(db, endpoint, actor, "error", str(exc)[:240], None, duration)
        _log_execution_event(db, event_type=endpoint, status_value="error", latency_ms=duration, error_message=str(exc)[:240])
        _log_heartbeat(db, status_value="error", note=str(exc)[:240])
        raise


@router.post("/all")
def sync_all(
    request: Request,
    symbol: str = Query(default="BTCUSDT", min_length=3, max_length=20),
    limit: int = Query(default=100, ge=1, le=1000),
    _: None = Depends(require_sync_access),
    db: Session = Depends(get_db),
) -> dict:
    started = time.time()
    actor = _actor_from_request(request)
    endpoint = "sync/all"

    try:
        _ensure_db_writable_or_503()
        _enforce_rate_limit(endpoint, actor)
        inserted = binance_sync_service.sync_trades(db=db, symbol=symbol.upper(), limit=limit)
        updated = binance_sync_service.sync_positions(db=db)
        try:
            _snapshot_account_state(db)
        except Exception:
            pass
        duration = int((time.time() - started) * 1000)
        _log_sync_event(db, endpoint, actor, "ok", None, symbol.upper(), duration)
        _log_execution_event(db, event_type=endpoint, status_value="ok", latency_ms=duration, symbol=symbol.upper())
        _log_heartbeat(db, status_value="ok")
        return {"status": "ok", "symbol": symbol.upper(), "trades_inserted": inserted, "positions_updated": updated}
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        duration = int((time.time() - started) * 1000)
        _log_sync_event(db, endpoint, actor, "error", str(exc)[:240], symbol.upper(), duration)
        _log_execution_event(db, event_type=endpoint, status_value="error", latency_ms=duration, symbol=symbol.upper(), error_message=str(exc)[:240])
        _log_heartbeat(db, status_value="error", note=str(exc)[:240])
        raise


@router.post("/backfill-trades")
def backfill_trades(
    request: Request,
    symbols: str = Query(..., description="CSV symbols, ex: BTCUSDT,ETHUSDT,SOLUSDT"),
    days: int = Query(default=60, ge=1, le=365),
    limit: int = Query(default=1000, ge=1, le=1000),
    max_pages_per_symbol: int = Query(default=120, ge=1, le=500),
    _: None = Depends(require_sync_access),
    db: Session = Depends(get_db),
) -> dict:
    started = time.time()
    actor = _actor_from_request(request)
    endpoint = "sync/backfill-trades"

    try:
        _ensure_db_writable_or_503()
        _enforce_rate_limit(endpoint, actor)

        symbol_list = sorted({s.strip().upper() for s in symbols.split(",") if s.strip()})
        if not symbol_list:
            raise HTTPException(status_code=400, detail="No symbols provided")

        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=days)
        start_ms = int(start_dt.timestamp() * 1000)
        end_ms = int(end_dt.timestamp() * 1000)

        results: list[dict] = []
        total_inserted = 0
        total_seen = 0

        for sym in symbol_list:
            res = binance_sync_service.sync_trades_historical(
                db=db,
                symbol=sym,
                start_time_ms=start_ms,
                end_time_ms=end_ms,
                limit=limit,
                max_pages=max_pages_per_symbol,
            )
            total_inserted += int(res.get("inserted", 0) or 0)
            total_seen += int(res.get("seen", 0) or 0)
            results.append(res)

        try:
            _snapshot_account_state(db)
        except Exception:
            pass

        duration = int((time.time() - started) * 1000)
        _log_sync_event(db, endpoint, actor, "ok", f"symbols={len(symbol_list)} inserted={total_inserted}", None, duration)
        _log_execution_event(db, event_type=endpoint, status_value="ok", latency_ms=duration)
        _log_heartbeat(db, status_value="ok")

        return {
            "status": "ok",
            "endpoint": endpoint,
            "days": days,
            "symbols": symbol_list,
            "symbols_count": len(symbol_list),
            "total_seen": total_seen,
            "total_inserted": total_inserted,
            "start_time": start_dt.isoformat(),
            "end_time": end_dt.isoformat(),
            "results": results,
        }
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        duration = int((time.time() - started) * 1000)
        _log_sync_event(db, endpoint, actor, "error", str(exc)[:240], None, duration)
        _log_execution_event(db, event_type=endpoint, status_value="error", latency_ms=duration, error_message=str(exc)[:240])
        _log_heartbeat(db, status_value="error", note=str(exc)[:240])
        raise
