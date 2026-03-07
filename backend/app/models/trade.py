from datetime import datetime
from decimal import Decimal
from sqlalchemy import DateTime, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class Trade(Base):
    __tablename__ = "trades"
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    binance_trade_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    symbol: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    order_id: Mapped[str | None] = mapped_column(String(64), index=True)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    quote_qty: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    commission: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    commission_asset: Mapped[str | None] = mapped_column(String(20))
    realized_pnl: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    executed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
