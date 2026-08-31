"""비동기 DB 연결. 연결 문자열은 `.env` 의 `DATABASE_URL` (`app/config.py`)."""

from collections.abc import AsyncGenerator

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    """모든 모델의 부모. Alembic autogenerate 가 이 metadata 를 본다."""


_settings = get_settings()

engine = create_async_engine(
    _settings.database_url,
    # echo 를 켜면 SQL 파라미터에 아이 원문(card_attempts.text)이 로그로 나간다.
    # 어떤 환경에서도 켜지 않는다 (PRD 1.1b).
    echo=False,
    pool_pre_ping=True,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession]:
    """FastAPI 의존성."""
    async with SessionLocal() as session:
        yield session


redis_client: Redis = Redis.from_url(_settings.redis_url, decode_responses=True)
