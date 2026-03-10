from datetime import datetime
from decimal import Decimal
from sqlalchemy import DateTime, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class Position(Base):
    __tablename__ = "positions"
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    symbol: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    position_amt: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False, default=0)
    entry_price: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False, default=0)
    mark_price: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False, default=0)
    unrealized_pnl: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False, default=0)
    leverage: Mapped[int] = mapped_column(nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
