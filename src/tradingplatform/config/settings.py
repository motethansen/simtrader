"""Runtime settings.

Pydantic-settings loads from env vars and `.env`. Keep this module dependency-free
beyond pydantic — every other module imports it.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

Mode = Literal["paper", "backtest", "live"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="",  # explicit prefix per field below
        extra="ignore",
    )

    mode: Mode = Field("paper", alias="TP_MODE")
    log_level: str = Field("INFO", alias="TP_LOG_LEVEL")

    db_url: str = Field(
        "postgresql+psycopg://tp:tp@localhost:5432/tradingplatform", alias="TP_DB_URL"
    )
    redis_url: str = Field("redis://localhost:6379/0", alias="TP_REDIS_URL")

    # Saxo
    saxo_base_url: str = Field("https://gateway.saxobank.com/sim/openapi", alias="SAXO_BASE_URL")
    saxo_token: str = Field("", alias="SAXO_TOKEN")
    saxo_app_key: str = Field("", alias="SAXO_APP_KEY")
    saxo_app_secret: str = Field("", alias="SAXO_APP_SECRET")

    # IBKR
    ibkr_host: str = Field("127.0.0.1", alias="IBKR_HOST")
    ibkr_port: int = Field(7497, alias="IBKR_PORT")
    ibkr_client_id: int = Field(42, alias="IBKR_CLIENT_ID")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
