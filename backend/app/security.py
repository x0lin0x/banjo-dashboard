import secrets

from fastapi import Header, HTTPException, status

from app.config import settings


def require_sync_access(x_api_token: str | None = Header(default=None)) -> None:
    role = (settings.app_role or "operator").lower().strip()
    if role not in {"operator", "viewer"}:
        role = "operator"

    if role != "operator":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sync disabled: role viewer has read-only permissions.",
        )

    if settings.app_read_only:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sync disabled: application is in read-only mode.",
        )

    required_token = (settings.sync_api_token or "").strip()

    # Minimal hardening for non-dev usage: require a strong sync token.
    app_env = (settings.app_env or "development").lower().strip()
    if app_env != "development" and required_token and len(required_token) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sync disabled: insecure SYNC_API_TOKEN (min 32 chars outside development).",
        )

    if required_token:
        provided = (x_api_token or "").strip()
        if not provided or not secrets.compare_digest(provided, required_token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized: missing or invalid sync token.",
            )
