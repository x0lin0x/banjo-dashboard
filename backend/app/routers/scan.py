from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.services.binance_sync import binance_sync_service
from app.models.bot_heartbeat import BotHeartbeat
from app.models.execution_event import ExecutionEvent
from app.models.position import Position
from app.models.sync_event import SyncEvent
from app.models.trade import Trade
from app.security import require_sync_access

router = APIRouter(prefix="/api/v1", tags=["scan"])


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
    status_value: str,
    detail: str | None,
    duration_ms: int,
) -> None:
    evt = SyncEvent(
        endpoint="sync/scan-all-symbols",
        actor="scan-router",
        status=status_value,
        detail=detail,
        symbol=None,
        duration_ms=duration_ms,
        created_at=datetime.now(timezone.utc),
    )
    db.add(evt)
    _safe_commit(db)


def _log_heartbeat(db: Session, status_value: str = "ok", note: str | None = None) -> None:
    hb = BotHeartbeat(
        source="dashboard-scan",
        status=status_value,
        note=note,
        created_at=datetime.now(timezone.utc),
    )
    db.add(hb)
    _safe_commit(db)


def _log_execution_event(
    db: Session,
    status_value: str,
    latency_ms: int,
    error_message: str | None = None,
) -> None:
    evt = ExecutionEvent(
        source="dashboard-scan",
        event_type="sync/scan-all-symbols",
        status=status_value,
        latency_ms=latency_ms,
        error_message=error_message,
        created_at=datetime.now(timezone.utc),
    )
    db.add(evt)
    _safe_commit(db)


@router.post("/sync/scan-all-symbols")
def scan_all_symbols(
    limit: int = Query(default=120, ge=1, le=1000),
    lookback_days: int = Query(default=7, ge=1, le=90),
    max_recent_symbols: int = Query(default=10, ge=1, le=200),
    per_symbol_delay_ms: int = Query(default=350, ge=0, le=3000),
    include_income_discovery: bool = Query(default=True, description="Discover traded symbols via Binance income endpoint"),
    max_income_pages: int = Query(default=10, ge=1, le=100),
    symbols: str | None = Query(default=None, description="Optional CSV symbols to force scan, ex: ETHUSDT,SOLUSDT"),
    _: None = Depends(require_sync_access),
    db: Session = Depends(get_db),
):
    """Context-aware sync:
    1) refresh positions
    2) sync trades for a bounded symbol universe:
       - active position symbols
       - symbols already present in local trades over lookback window
       - optional CSV symbols parameter
    """
    started = time.time()
    try:
        _ensure_db_writable_or_503()
        positions_updated = binance_sync_service.sync_positions(db=db)

        raw_positions = db.query(Position).all()
        active_symbols = {p.symbol for p in raw_positions if abs(float(p.position_amt or 0)) > 0}

        since = datetime.now(timezone.utc) - timedelta(days=lookback_days)
        recent_rows = (
            db.query(Trade.symbol, Trade.executed_at)
            .filter(Trade.executed_at >= since)
            .order_by(Trade.executed_at.desc())
            .all()
        )
        recent_trade_symbols = []
        seen = set()
        for symbol, _ in recent_rows:
            if not symbol or symbol in seen:
                continue
            recent_trade_symbols.append(symbol)
            seen.add(symbol)
            if len(recent_trade_symbols) >= max_recent_symbols:
                break

        manual_symbols = set()
        if symbols:
            manual_symbols = {s.strip().upper() for s in symbols.split(",") if s.strip()}

        discovered_symbols = set()
        if include_income_discovery:
            try:
                start_ms = int(since.timestamp() * 1000)
                end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
                discovered_symbols = set(
                    binance_sync_service.fetch_recent_traded_symbols(
                        start_time_ms=start_ms,
                        end_time_ms=end_ms,
                        max_pages=max_income_pages,
                    )
                )
            except Exception:
                discovered_symbols = set()

        symbols_to_scan = sorted(active_symbols | set(recent_trade_symbols) | manual_symbols | discovered_symbols)

        total_inserted = 0
        results = []

        for idx, symbol in enumerate(symbols_to_scan):
            if idx > 0 and per_symbol_delay_ms > 0:
                time.sleep(per_symbol_delay_ms / 1000)

            try:
                inserted = binance_sync_service.sync_trades(db=db, symbol=symbol, limit=limit)
                total_inserted += inserted
                results.append({"symbol": symbol, "inserted": inserted})
            except Exception as e:
                results.append({"symbol": symbol, "error": str(e)})

        duration = int((time.time() - started) * 1000)
        _log_sync_event(db, "ok", None, duration)
        _log_execution_event(db, "ok", duration)
        _log_heartbeat(db, status_value="ok")

        return {
            "status": "ok",
            "positions_updated": positions_updated,
            "symbols_scanned": len(symbols_to_scan),
            "symbols_active": len(active_symbols),
            "symbols_recent": len(recent_trade_symbols),
            "symbols_manual": len(manual_symbols),
            "symbols_discovered_income": len(discovered_symbols),
            "total_trades_inserted": total_inserted,
            "results": results,
        }
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        duration = int((time.time() - started) * 1000)
        _log_sync_event(db, "error", str(exc)[:240], duration)
        _log_execution_event(db, "error", duration, error_message=str(exc)[:240])
        _log_heartbeat(db, status_value="error", note=str(exc)[:240])
        raise
