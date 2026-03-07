from datetime import datetime, timezone
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
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
    db.commit()


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
        _enforce_rate_limit(endpoint, actor)
        inserted = binance_sync_service.sync_trades(db=db, symbol=symbol.upper(), limit=limit)
        _log_sync_event(db, endpoint, actor, "ok", None, symbol.upper(), int((time.time() - started) * 1000))
        return {"status": "ok", "type": "trades", "symbol": symbol.upper(), "inserted": inserted}
    except Exception as exc:
        _log_sync_event(db, endpoint, actor, "error", str(exc)[:240], symbol.upper(), int((time.time() - started) * 1000))
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
        _enforce_rate_limit(endpoint, actor)
        updated = binance_sync_service.sync_positions(db=db)
        _log_sync_event(db, endpoint, actor, "ok", None, None, int((time.time() - started) * 1000))
        return {"status": "ok", "type": "positions", "updated": updated}
    except Exception as exc:
        _log_sync_event(db, endpoint, actor, "error", str(exc)[:240], None, int((time.time() - started) * 1000))
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
        _enforce_rate_limit(endpoint, actor)
        inserted = binance_sync_service.sync_trades(db=db, symbol=symbol.upper(), limit=limit)
        updated = binance_sync_service.sync_positions(db=db)
        _log_sync_event(db, endpoint, actor, "ok", None, symbol.upper(), int((time.time() - started) * 1000))
        return {"status": "ok", "symbol": symbol.upper(), "trades_inserted": inserted, "positions_updated": updated}
    except Exception as exc:
        _log_sync_event(db, endpoint, actor, "error", str(exc)[:240], symbol.upper(), int((time.time() - started) * 1000))
        raise
