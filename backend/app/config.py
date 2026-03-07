from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_name: str = "Trading Dashboard API"
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    debug: bool = True
    app_read_only: bool = False
    sync_api_token: str = ""
    sync_min_interval_seconds: int = 5
    database_url: str = "sqlite:///./trading.db"
    binance_api_key: str = ""
    binance_api_secret: str = ""
    binance_base_url: str = "https://fapi.binance.com"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

settings = Settings()
