from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.security import require_sync_access
from app.services.binance_sync import binance_sync_service

router = APIRouter(prefix="/sync")


@router.post("/trades")
def sync_trades(
    symbol: str = Query(default="BTCUSDT", min_length=3, max_length=20),
    limit: int = Query(default=100, ge=1, le=1000),
    _: None = Depends(require_sync_access),
    db: Session = Depends(get_db),
) -> dict:
    inserted = binance_sync_service.sync_trades(db=db, symbol=symbol.upper(), limit=limit)
    return {"status": "ok", "type": "trades", "symbol": symbol.upper(), "inserted": inserted}


@router.post("/positions")
def sync_positions(
    _: None = Depends(require_sync_access),
    db: Session = Depends(get_db),
) -> dict:
    updated = binance_sync_service.sync_positions(db=db)
    return {"status": "ok", "type": "positions", "updated": updated}


@router.post("/all")
def sync_all(
    symbol: str = Query(default="BTCUSDT", min_length=3, max_length=20),
    limit: int = Query(default=100, ge=1, le=1000),
    _: None = Depends(require_sync_access),
    db: Session = Depends(get_db),
) -> dict:
    inserted = binance_sync_service.sync_trades(db=db, symbol=symbol.upper(), limit=limit)
    updated = binance_sync_service.sync_positions(db=db)
    return {"status": "ok", "symbol": symbol.upper(), "trades_inserted": inserted, "positions_updated": updated}
