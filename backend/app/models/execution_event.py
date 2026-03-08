from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ExecutionEvent(Base):
    __tablename__ = "execution_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    source: Mapped[str] = mapped_column(String(64), index=True, nullable=False, default="dashboard")
    symbol: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    signal_id: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    decision_id: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    event_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(16), index=True, nullable=False, default="ok")
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
