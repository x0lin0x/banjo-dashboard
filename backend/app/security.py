from fastapi import Header, HTTPException, status

from app.config import settings


def require_sync_access(x_api_token: str | None = Header(default=None)) -> None:
    if settings.app_read_only:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sync disabled: application is in read-only mode.",
        )

    if settings.sync_api_token:
        if not x_api_token or x_api_token != settings.sync_api_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized: missing or invalid sync token.",
            )
