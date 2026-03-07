from fastapi import FastAPI
from app.config import settings
from app.database import Base, engine
from app.routers.sync import router as sync_router
from app.models import position, trade  # noqa: F401

app = FastAPI(title=settings.app_name, debug=settings.debug)

@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)

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
