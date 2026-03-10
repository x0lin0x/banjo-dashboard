from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SyncEvent(Base):
    __tablename__ = "sync_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    endpoint: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    symbol: Mapped[str | None] = mapped_column(String(20), index=True)
    status: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    detail: Mapped[str | None] = mapped_column(String(255))
    actor: Mapped[str | None] = mapped_column(String(64), index=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
