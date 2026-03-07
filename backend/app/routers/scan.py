from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.services.binance_sync import binance_sync_service
from app.models.position import Position
from app.security import require_sync_access

router = APIRouter(prefix="/api/v1", tags=["scan"])

@router.post("/sync/scan-all-symbols")
def scan_all_symbols(limit: int = 1000, _: None = Depends(require_sync_access), db: Session = Depends(get_db)):
    """Scan all symbols with positions and sync trades."""
    # Get all unique symbols from positions
    positions = db.query(Position.symbol).distinct().all()
    symbols = [p[0] for p in positions]
    
    total_inserted = 0
    results = []
    
    for symbol in symbols:
        try:
            inserted = binance_sync_service.sync_trades(db=db, symbol=symbol, limit=limit)
            total_inserted += inserted
            results.append({"symbol": symbol, "inserted": inserted})
        except Exception as e:
            results.append({"symbol": symbol, "error": str(e)})
    
    return {
        "status": "ok",
        "symbols_scanned": len(symbols),
        "total_trades_inserted": total_inserted,
        "results": results
    }
