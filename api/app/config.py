"""환경 설정.

**환경마다 파일을 나눈다.** 저장소 루트의 `.env`(공통) 위에 `.env.{APP_ENV}` 를 덮어쓴다.
`APP_ENV=pilot` 이면 `.env` → `.env.pilot` 순으로 읽고 뒤가 이긴다.
파일 템플릿은 `.env.example` · `.env.pilot.example`.

**키는 서버에만 둔다.** 비밀 값은 `SecretStr` 이라 `repr`·로그·오류 리포트에 찍히지 않는다.
클라이언트로 나가는 값은 `NEXT_PUBLIC_*` 뿐이고 여기서 읽지 않는다.
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]

AppEnv = Literal["dev", "pilot"]

# 어느 파일을 읽을지부터 환경 변수로 정해진다. 파일 안의 APP_ENV 로는 파일 선택을 못 한다.
_APP_ENV: str = os.getenv("APP_ENV", "dev")

# pilot 에서 비어 있으면 뜨지 않는 키. dev 는 비어 있어도 목 서버가 돈다.
PILOT_REQUIRED = ("anthropic_api_key", "jwt_secret", "image_api_key")


class Settings(BaseSettings):
    """`.env` 의 키 이름과 1:1로 맞춘다 (대소문자 무시)."""

    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", REPO_ROOT / f".env.{_APP_ENV}"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: AppEnv = "dev"

    database_url: str = "postgresql+asyncpg://geulmoheom:geulmoheom@localhost:5433/geulmoheom"
    redis_url: str = "redis://localhost:6381/0"

    anthropic_api_key: SecretStr = SecretStr("")
    evaluator_model: str = "claude-opus-5"
    gm_model: str = "claude-opus-5"

    image_provider: str = ""
    image_api_key: SecretStr = SecretStr("")
    image_model: str = ""

    r2_account_id: str = ""
    r2_access_key_id: SecretStr = SecretStr("")
    r2_secret_access_key: SecretStr = SecretStr("")
    r2_bucket: str = "geulmoheom-artworks"
    r2_public_base_url: str = ""

    jwt_secret: SecretStr = SecretStr("")
    daily_card_cap: int = 5
    daily_cost_alert_usd: float = 20.0

    # 쿠키 vs Authorization 헤더는 미결 11-2. 어느 쪽이든 web:3000 은 크로스 오리진이라
    # 지금부터 오리진을 명시해 둔다 (allow_credentials 와 "*" 는 함께 못 쓴다).
    cors_origins: list[str] = ["http://localhost:3000"]


def missing_pilot_keys(settings: Settings) -> list[str]:
    """pilot 에서 비어 있으면 안 되는 키 중 실제로 빈 것의 **이름**."""
    if settings.app_env != "pilot":
        return []

    return [
        이름 for 이름 in PILOT_REQUIRED if not getattr(settings, 이름).get_secret_value().strip()
    ]


@lru_cache
def get_settings() -> Settings:
    """설정을 읽고, pilot 이면 필수 키를 확인한다.

    이 검사를 **pydantic 검증기로 넣지 않는다.** `ValidationError` 메시지에는 입력 dict 가
    통째로 실려서 이미 채워진 다른 키 값까지 함께 찍힌다. 기동 실패 트레이스백은
    로그·CI 로 나가므로 그대로 유출이다. 그래서 여기서 **이름만** 담아 던진다.
    """
    settings = Settings()

    빈것 = missing_pilot_keys(settings)
    if 빈것:
        raise RuntimeError(f"pilot 환경에 필요한 키가 비어 있다: {', '.join(빈것)}")

    return settings
