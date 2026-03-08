from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AccountSnapshot(Base):
    __tablename__ = "account_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    wallet_balance: Mapped[Decimal | None] = mapped_column(Numeric(20, 8), nullable=True)
    margin_used: Mapped[Decimal | None] = mapped_column(Numeric(20, 8), nullable=True)
    equity_total: Mapped[Decimal | None] = mapped_column(Numeric(20, 8), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
