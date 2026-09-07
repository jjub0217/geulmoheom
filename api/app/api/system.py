"""운영용 엔드포인트. 아이 화면과 무관하고 `/api/v1` 밖에 둔다.

- `/healthz` — 프로세스가 살아 있는가. 의존성을 보지 않는다
- `/readyz` — 요청을 받을 준비가 됐는가. Postgres·Redis 를 실제로 두드린다

**실패 사유에 예외 메시지를 싣지 않는다.** asyncpg·redis 예외 문자열에는 호스트·계정이
그대로 들어 있다. 남기는 것은 예외 타입뿐이다.

**엔진을 `from app.db import engine` 으로 들여오지 않는다.** 그러면 이 모듈이 import
시점의 객체를 붙잡아, 나중에 `app.db.engine` 을 갈아끼우는 쪽(테스트)과 여기가
**서로 다른 엔진을 보게 된다.** 모듈로 참조해 늦게 읽는다.
"""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app import db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["system"])


async def _check_postgres() -> str:
    try:
        async with db.engine.connect() as connection:
            await connection.execute(text("select 1"))
    except Exception as exc:
        logger.warning("postgres 확인 실패", extra={"exc_type": type(exc).__name__})
        return "down"
    return "up"


async def _check_redis() -> str:
    try:
        await db.redis_client.ping()
    except Exception as exc:
        logger.warning("redis 확인 실패", extra={"exc_type": type(exc).__name__})
        return "down"
    return "up"


@router.get("/healthz", summary="프로세스 생존 확인")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", summary="의존성 포함 준비 확인")
async def readyz() -> JSONResponse:
    checks = {"postgres": await _check_postgres(), "redis": await _check_redis()}
    ready = all(state == "up" for state in checks.values())

    # 아이가 보는 화면이 아니라 공통 오류 형식(`공통규약.md`)을 쓰지 않는다.
    # 로드밸런서·운영자가 읽는 응답이다.
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "degraded", "checks": checks},
    )
