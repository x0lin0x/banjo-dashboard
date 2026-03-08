from datetime import datetime, timedelta, timezone
import time

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.services.binance_sync import binance_sync_service
from app.models.bot_heartbeat import BotHeartbeat
from app.models.position import Position
from app.models.sync_event import SyncEvent
from app.models.trade import Trade
from app.security import require_sync_access

router = APIRouter(prefix="/api/v1", tags=["scan"])


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
    db.commit()


def _log_heartbeat(db: Session, status_value: str = "ok", note: str | None = None) -> None:
    hb = BotHeartbeat(
        source="dashboard-scan",
        status=status_value,
        note=note,
        created_at=datetime.now(timezone.utc),
    )
    db.add(hb)
    db.commit()


@router.post("/sync/scan-all-symbols")
def scan_all_symbols(
    limit: int = Query(default=120, ge=1, le=1000),
    lookback_days: int = Query(default=7, ge=1, le=30),
    max_recent_symbols: int = Query(default=10, ge=1, le=100),
    per_symbol_delay_ms: int = Query(default=350, ge=0, le=3000),
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

        symbols_to_scan = sorted(active_symbols | set(recent_trade_symbols) | manual_symbols)

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

        _log_sync_event(db, "ok", None, int((time.time() - started) * 1000))
        _log_heartbeat(db, status_value="ok")

        return {
            "status": "ok",
            "positions_updated": positions_updated,
            "symbols_scanned": len(symbols_to_scan),
            "symbols_active": len(active_symbols),
            "symbols_recent": len(recent_trade_symbols),
            "symbols_manual": len(manual_symbols),
            "total_trades_inserted": total_inserted,
            "results": results,
        }
    except Exception as exc:
        _log_sync_event(db, "error", str(exc)[:240], int((time.time() - started) * 1000))
        _log_heartbeat(db, status_value="error", note=str(exc)[:240])
        raise
