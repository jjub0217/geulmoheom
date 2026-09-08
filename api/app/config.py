"""환경 설정.

**환경마다 파일을 나눈다.** 저장소 루트의 `.env`(공통) 위에 `.env.{APP_ENV}` 를 덮어쓴다.
`APP_ENV=pilot` 이면 `.env` → `.env.pilot` 순으로 읽고 뒤가 이긴다.
파일 템플릿은 `.env.example` · `.env.pilot.example`.

**키는 서버에만 둔다.** 비밀 값은 `SecretStr` 이라 `repr`·로그·오류 리포트에 찍히지 않는다.
클라이언트로 나가는 값은 `NEXT_PUBLIC_*` 뿐이고 여기서 읽지 않는다.

LLM 프로바이더는 Google Gemini (`docs/adr/0005`). **모델명 기본값을 두지 않는다** —
ADR 결정 2번이 "구체 모델명은 지금 정하지 않는다"이고, 코드에 임시값을 박으면
그게 사실상의 결정이 되어 W2 벤치 전에 굳는다.
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

# pilot 에서 비어 있으면 뜨지 않는 설정. dev 는 비어 있어도 목 서버가 돈다.
# 모델명도 넣는다 — 미정인 채로 파일럿이 뜨면 첫 호출에서 터진다.
#
# `image_api_key` 를 뺐다 (2026-09-07). `adr/0006` 이 이미지 생성을 Gemini 네이티브로
# 통합해 **LLM 과 같은 키**를 쓴다. 따로 두면 늘 `gemini_api_key` 와 같은 값이 되고,
# 필수 목록에 둘 다 있는 것이 「둘이 다를 수 있다」는 오해를 만든다.
# R2 넷이 2026-09-08 에 들어왔다. **파일럿에 반드시 필요한데 검사에 없었다** —
# 비어 있어도 서버가 아무 소리 없이 떴고, 그래서 안 채워진 것을 아무도 몰랐다.
# 로컬 디스크 폴백(`app/storage.py`)은 **개발·프리테스트용**이다. 파일럿에서 그리로
# 떨어지면 삽화가 그 컨테이너와 함께 사라진다.
PILOT_REQUIRED = (
    "gemini_api_key",
    "jwt_secret",
    "evaluator_model",
    "image_model",
    "r2_account_id",
    "r2_access_key_id",
    "r2_secret_access_key",
    # 앞단이 덮어쓰는 클라이언트 IP 헤더 이름 (2026-09-08, `/child/auth` 속도 제한 ②).
    # **비어 있으면 소켓 주소를 쓰는데, 파일럿에서는 그게 앞단 IP 하나다** — 시간당
    # 30회가 전체 사용자에게 걸려 **아무 잘못 없는 아이가 막힌다.** 안 채운 것을
    # 기동에서 잡지 않으면 그 사고가 파일럿 중에 처음 보인다.
    "client_ip_header",
)


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

    # 유료 티어 키다. 무료 티어는 입력이 제품 개선에 활용되어 아이 원문
    # 라벨링 동의 게이트(PRD 1.1b)를 깬다 (adr/0005 근거 5번).
    gemini_api_key: SecretStr = SecretStr("")
    # 코드에 기본값을 두지 않는다. 값이 박히면 `.env` 를 안 채워도 도는 것처럼 보이고,
    # 그 임시값이 사실상의 결정이 된다 (adr/0005 결정 2번). 확정된 이름은 `.env.example` 에 있다.
    #
    # W2 벤치로 `gemini-3.1-flash-lite` 확정 (`benchmarks/W2-evaluator-bench.md`).
    evaluator_model: str = ""
    # Stage 1 GM. 아직 미정이라 PILOT_REQUIRED 에 넣지 않는다 — Stage 0 은 GM 을 안 쓴다.
    gm_model: str = ""
    # W1 벤치로 `gemini-3.1-flash-lite-image` 확정 (`adr/0006`).
    # 프로바이더·키는 따로 두지 않는다. Gemini 네이티브라 `gemini_api_key` 하나를 쓴다.
    image_model: str = ""

    r2_account_id: str = ""
    r2_access_key_id: SecretStr = SecretStr("")
    r2_secret_access_key: SecretStr = SecretStr("")
    r2_bucket: str = "geulmoheom-artworks"
    # **공개 base URL 을 두지 않는다.** 2026-09-08 대표 판정으로 **버킷은 공개하지 않고
    # api 가 프록시한다** (미결 11-7 · `Stage0.md` 5절). 프록시는 S3 API 로 서버에서
    # 읽으므로 공개 주소가 아예 필요 없다 — **이름을 바꾸는 대신 없앴다.**
    # 남겨 두면 다음 사람이 그 이름을 보고 **공개 버킷을 다시 만든다.**
    # 서명 URL 로 옮길 때(파일럿 후)도 이 값이 아니라 S3 클라이언트가 발급한다.

    # 앞단(Cloudflare `CF-Connecting-IP` · Fly `Fly-Client-IP`)이 **덮어쓰는** 헤더 이름.
    # **`X-Forwarded-For` 를 적지 않는다** — 클라이언트가 직접 채워 보낼 수 있어서
    # 속도 제한을 요청마다 다른 값으로 비껴갈 수 있다 (`app/child_auth_limit.py`).
    client_ip_header: str = ""

    jwt_secret: SecretStr = SecretStr("")
    daily_card_cap: int = 5
    daily_cost_alert_usd: float = 20.0

    # 미결 11-2 는 HttpOnly 쿠키로 확정됐다 (`공통규약.md` 「인증 쿠키」). web 은
    # same-site 이되 cross-origin 이라 오리진을 **정확히** 적는다. `"*"` 를 쓰지 않는다 —
    # Starlette 는 `allow_credentials=True` 와 함께 써도 에러를 내지 않고 요청 오리진을
    # 그대로 반사한다. CORS 오류가 안 나서 정상으로 보이지만, 실제로는 임의의 사이트가
    # 아이 세션으로 API 를 호출할 수 있는 상태다.
    #
    # 개발도 https + `.test` 다 (`make certs`). `http://localhost:3000` 을 되살리지 않는다 —
    # `__Host-` 쿠키는 Secure 를 강제하고, Secure 쿠키가 http://localhost 에 붙는지가
    # 브라우저마다 갈린다. 파일럿이 태블릿이라 Safari 를 건너뛸 수 없다.
    # **포트도 오리진의 일부다** — `:3000` 을 빼면 preflight 가 통과하지 않는다.
    cors_origins: list[str] = ["https://app.geulmoheom.test:3000"]


def missing_pilot_keys(settings: Settings) -> list[str]:
    """pilot 에서 비어 있으면 안 되는 키 중 실제로 빈 것의 **이름**."""
    if settings.app_env != "pilot":
        return []

    빈것: list[str] = []
    for 이름 in PILOT_REQUIRED:
        값 = getattr(settings, 이름)
        # 비밀 키(SecretStr)와 평문(모델명)을 함께 본다.
        원문 = 값.get_secret_value() if isinstance(값, SecretStr) else str(값)
        if not 원문.strip():
            빈것.append(이름)
    return 빈것


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
