"""환경 설정. 값은 저장소 루트 `.env` 에서 읽는다 (`.env.example` 참조)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """.env 의 키 이름과 1:1로 맞춘다 (대소문자 무시).

    **이 객체를 통째로 로그·오류 리포트에 넣지 않는다.** 키가 그대로 찍힌다.
    """

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["dev", "pilot"] = "dev"

    database_url: str = "postgresql+asyncpg://geulmoheom:geulmoheom@localhost:5433/geulmoheom"
    redis_url: str = "redis://localhost:6381/0"

    anthropic_api_key: str = ""
    evaluator_model: str = "claude-opus-5"
    gm_model: str = "claude-opus-5"

    jwt_secret: str = ""
    daily_card_cap: int = 5
    daily_cost_alert_usd: float = 20.0

    # 쿠키 vs Authorization 헤더는 미결 11-2. 어느 쪽이든 web:3000 은 크로스 오리진이라
    # 지금부터 오리진을 명시해 둔다 (allow_credentials 와 "*" 는 함께 못 쓴다).
    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
