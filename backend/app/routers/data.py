from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.trade import Trade
from app.models.position import Position

router = APIRouter(prefix="/api/v1", tags=["data"])

@router.get("/stats/overview")
def get_stats_overview(db: Session = Depends(get_db)):
    total_trades = db.query(func.count(Trade.id)).scalar()
    total_positions = db.query(func.count(Position.id)).scalar()
    total_realized_pnl = db.query(func.sum(Trade.realized_pnl)).scalar() or 0
    total_unrealized_pnl = db.query(func.sum(Position.unrealized_pnl)).scalar() or 0
    return {
        "total_trades": total_trades,
        "total_positions": total_positions,
        "total_realized_pnl": str(total_realized_pnl),
        "total_unrealized_pnl": str(total_unrealized_pnl),
    }
