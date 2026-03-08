import os
from pathlib import Path

from fastapi import FastAPI
from sqlalchemy import inspect, text

from app.config import settings
from app.database import Base, engine
from app.routers.sync import router as sync_router
from app.models import AccountSnapshot, BotHeartbeat, ExecutionEvent, Position, SyncEvent, Trade  # noqa: F401

app = FastAPI(title=settings.app_name, debug=settings.debug)


def _ensure_trade_traceability_columns() -> None:
    """Lightweight runtime migration for signal_id / decision_id / exit_reason.

    Keeps local SQLite and existing Postgres dev databases compatible
    without introducing Alembic yet.
    """
    insp = inspect(engine)
    if "trades" not in insp.get_table_names():
        return

    existing_cols = {c["name"] for c in insp.get_columns("trades")}
    dialect = engine.dialect.name

    ddl = []
    if "signal_id" not in existing_cols:
        ddl.append("ALTER TABLE trades ADD COLUMN signal_id VARCHAR(128)")
    if "decision_id" not in existing_cols:
        ddl.append("ALTER TABLE trades ADD COLUMN decision_id VARCHAR(128)")
    if "exit_reason" not in existing_cols:
        ddl.append("ALTER TABLE trades ADD COLUMN exit_reason VARCHAR(32)")

    if not ddl:
        return

    with engine.begin() as conn:
        for stmt in ddl:
            conn.execute(text(stmt))

        # best-effort indexes (safe if fails)
        try:
            if dialect == "sqlite":
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_trades_signal_id ON trades (signal_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_trades_decision_id ON trades (decision_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_trades_exit_reason ON trades (exit_reason)"))
            else:
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_trades_signal_id ON trades (signal_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_trades_decision_id ON trades (decision_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_trades_exit_reason ON trades (exit_reason)"))
        except Exception:
            pass


def _check_db_writable() -> None:
    # Explicit startup warning for readonly sqlite scenarios.
    db_url = str(settings.database_url or "")
    if not db_url.startswith("sqlite:///"):
        return

    db_path = db_url.replace("sqlite:///", "", 1)
    p = Path(db_path)
    if not p.is_absolute():
        p = (Path.cwd() / p).resolve()

    parent = p.parent
    file_w = (not p.exists()) or os.access(p, os.W_OK)
    dir_w = os.access(parent, os.W_OK)
    if not (file_w and dir_w):
        print(f"[startup][warn] Database may be readonly: path={p} file_writable={file_w} dir_writable={dir_w}")


@app.on_event("startup")
def on_startup() -> None:
    _check_db_writable()
    Base.metadata.create_all(bind=engine)
    _ensure_trade_traceability_columns()


@app.get("/health", tags=["health"])
def healthcheck() -> dict:
    return {"status": "ok", "service": settings.app_name}


app.include_router(sync_router, prefix="/api/v1", tags=["sync"])

from app.routers.data import router as data_router
app.include_router(data_router)

from app.routers.scan import router as scan_router
app.include_router(scan_router)

# CORS middleware
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
