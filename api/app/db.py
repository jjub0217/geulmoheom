"""비동기 DB 연결. 연결 문자열은 `.env` 의 `DATABASE_URL` (`app/config.py`)."""

from collections.abc import AsyncGenerator

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    """모든 모델의 부모. Alembic autogenerate 가 이 metadata 를 본다."""


_settings = get_settings()


def 엔진만들기(url: str, **덧붙임: object) -> AsyncEngine:
    """엔진을 만드는 **유일한 자리**.

    `echo` 를 켜면 SQL 파라미터에 아이 원문(`card_attempts.text`)이 로그로 나간다.
    어떤 환경에서도 켜지 않는다 (PRD 1.1b).

    **테스트도 이 함수를 쓴다.** 테스트가 엔진을 따로 만들면 이 한 줄을 비껴가고,
    그 순간 「원문이 로그로 안 샌다」를 지키는 장치가 테스트 경로에만 없어진다 —
    2026-09-07 에 실제로 그랬다.
    """
    return create_async_engine(url, echo=False, pool_pre_ping=True, **덧붙임)  # type: ignore[arg-type]


engine = 엔진만들기(_settings.database_url)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession]:
    """FastAPI 의존성."""
    async with SessionLocal() as session:
        yield session


redis_client: Redis = Redis.from_url(_settings.redis_url, decode_responses=True)
