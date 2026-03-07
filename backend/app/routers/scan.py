from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.services.binance_sync import binance_sync_service
from app.models.position import Position
from app.models.trade import Trade
from app.security import require_sync_access

router = APIRouter(prefix="/api/v1", tags=["scan"])

@router.post("/sync/scan-all-symbols")
def scan_all_symbols(
    limit: int = Query(default=200, ge=1, le=1000),
    lookback_days: int = Query(default=7, ge=1, le=30),
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
    positions_updated = binance_sync_service.sync_positions(db=db)

    raw_positions = db.query(Position).all()
    active_symbols = {p.symbol for p in raw_positions if abs(float(p.position_amt or 0)) > 0}

    since = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    recent_trade_symbols = {
        row[0]
        for row in db.query(Trade.symbol).filter(Trade.executed_at >= since).distinct().all()
        if row and row[0]
    }

    manual_symbols = set()
    if symbols:
        manual_symbols = {s.strip().upper() for s in symbols.split(",") if s.strip()}

    symbols_to_scan = sorted(active_symbols | recent_trade_symbols | manual_symbols)

    total_inserted = 0
    results = []

    for symbol in symbols_to_scan:
        try:
            inserted = binance_sync_service.sync_trades(db=db, symbol=symbol, limit=limit)
            total_inserted += inserted
            results.append({"symbol": symbol, "inserted": inserted})
        except Exception as e:
            results.append({"symbol": symbol, "error": str(e)})

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
