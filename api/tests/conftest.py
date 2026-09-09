"""테스트 DB 와 인증 픽스처.

**진짜 Postgres 를 쓴다.** SQLite 로 갈아끼울 수 없다 — 모델이 `JSONB`·`ARRAY` 를
쓰고, 무엇보다 **여기서 잡고 싶은 것이 「마이그레이션대로 만든 스키마 위에서
도는가」**다. 스키마를 `create_all` 로 따로 만들면 마이그레이션이 깨져도 초록이 뜬다.

`make db-up` 이 띄운 것과 **같은 서버의 다른 데이터베이스**(`geulmoheom_test`)를 쓴다.
개발 DB 를 그대로 쓰면 테스트가 손으로 만든 자녀를 지운다.

**이 파일이 `app` 을 import 하기 전에 환경 변수를 세운다.** `app/db.py` 가 import
시점에 엔진을 만들고 `get_settings()` 가 `lru_cache` 라, 늦게 세우면 개발 DB 를 문 채
굳는다.
"""

import os
import subprocess
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]

# 개발 DB 이름 뒤에 `_test` 를 붙인다. `.env` 를 안 고치고, CI 에서는 CI 가 준 값을 쓴다.
_기본 = "postgresql+asyncpg://geulmoheom:geulmoheom@localhost:5433/geulmoheom"


def _개발용주소() -> str:
    """붙을 서버. **환경 변수가 `.env` 를 이긴다** — CI 에는 `.env` 가 없고 워크플로가
    환경 변수로 준다. 둘 다 없으면 compose 기본값이다.
    """
    if 환경 := os.environ.get("DATABASE_URL"):
        return 환경
    env = API_ROOT.parent / ".env"
    if env.exists():
        for 줄 in env.read_text().splitlines():
            if 줄.startswith("DATABASE_URL="):
                return 줄.split("=", 1)[1].strip()
    return _기본


TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or f"{_개발용주소()}_test"

os.environ["DATABASE_URL"] = TEST_DATABASE_URL
# 서명 없이는 토큰을 못 만든다 (`app/tokens.py`). **테스트 전용 값이고 운영과 무관하다.**
os.environ.setdefault("JWT_SECRET", "test-secret-not-used-anywhere-else")
os.environ.setdefault("APP_ENV", "dev")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app import artwork_store, db  # noqa: E402
from app.accounts import 비밀번호해시, 접속코드만들기  # noqa: E402
from app.artwork import 생성결과  # noqa: E402
from app.auth import CHILD_COOKIE, PARENT_COOKIE  # noqa: E402
from app.card_store import 씨뿌리기  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Child, Parent  # noqa: E402
from app.tokens import issue  # noqa: E402

# **커넥션을 풀에 남기지 않는다.** `TestClient` 는 요청마다 이벤트 루프를 새로 만드는데,
# 풀에 앉아 있던 커넥션이 다음 루프로 넘어가면 asyncpg 가
# `got Future attached to a different loop` 로 죽는다. 운영은 uvicorn 루프 하나라
# 풀이 맞고, **이건 테스트 하네스의 성질이지 앱의 성질이 아니다.**
#
# `app.db` 의 이름을 갈아끼운다 — 그래서 이 값을 쓰는 쪽은 전부 모듈로 참조해야 한다
# (`app/api/system.py` 가 그 이유로 늦은 바인딩이다).
# **`db.엔진만들기` 를 쓴다.** 직접 `create_async_engine` 을 부르면 `echo=False`
# 같은 안전 기본값을 비껴가고, 그러면 테스트 경로에서만 아이 원문이 SQL 로그로 샌다.
db.engine = db.엔진만들기(TEST_DATABASE_URL, poolclass=NullPool)
db.SessionLocal = async_sessionmaker(db.engine, expire_on_commit=False)


@pytest.fixture(scope="session", autouse=True)
def _스키마() -> Iterator[None]:
    """테스트 DB 를 만들고 **마이그레이션을 실제로 돌린다.**

    `Base.metadata.create_all` 을 쓰지 않는다 — 그러면 마이그레이션이 모델과 갈라져도
    테스트가 통과한다. 2026-09-07 에 실제로 갈라진 자리가 있었다 (`char_len` 주석).
    """
    _데이터베이스만들기()
    결과 = subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=API_ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, "DATABASE_URL": TEST_DATABASE_URL},
    )
    if 결과.returncode != 0:
        # `check=True` 로 두면 실패 이유가 예외 문자열에 안 실려, CI 에서
        # "마이그레이션이 죽었다"는 것만 알고 왜인지는 못 본다.
        raise RuntimeError(f"마이그레이션 실패\n{결과.stdout}\n{결과.stderr}")
    yield


@pytest.fixture(autouse=True)
async def _비우기() -> None:
    """테스트마다 데이터를 비운다. **스키마는 그대로 둔다** — 매번 마이그레이션을
    다시 돌리면 느리고, 우리가 보려는 것은 스키마가 아니라 행이다.

    `alembic_version` 은 남긴다. 지우면 다음 테스트에서 마이그레이션이 다시 돈다.
    """
    async with db.engine.begin() as conn:
        표 = (
            await conn.execute(
                text(
                    "select tablename from pg_tables "
                    "where schemaname = 'public' and tablename <> 'alembic_version'"
                )
            )
        ).scalars()
        이름들 = ", ".join(f'"{t}"' for t in 표)
        if 이름들:
            await conn.execute(text(f"truncate {이름들} restart identity cascade"))


@pytest.fixture(autouse=True)
async def _속도제한비우기() -> None:
    """`/child/auth` 속도 제한 카운터를 테스트마다 비운다.

    **키가 「기기 + IP」인데 테스트는 전부 같은 IP(`testclient`)에서 온다.** 안 비우면
    인증 실패를 내는 테스트들의 실패가 한 세션 안에서 합산돼, **어느 시점부터 관계없는
    테스트가 429 로 죽는다.** 실행 순서에 따라 달라져서 재현도 잘 안 된다.

    **Redis 가 없어도 그냥 지나간다** — CI 에는 안 뜬다
    (`.github/workflows/ci.yml` 은 postgres 만 띄운다).
    """
    try:
        async for 키 in db.redis_client.scan_iter(match="childauth:*"):
            await db.redis_client.delete(키)
    except Exception:
        pass


@pytest.fixture(autouse=True)
async def _카드시드(_비우기: None) -> None:
    """장면 카드를 매번 다시 뿌린다. **`_비우기` 가 `cards` 까지 지우기 때문이다.**

    운영에서 이 자리를 맡는 것은 배포다 (`scripts/seed_cards.py` · `make seed`).
    테스트가 그 단계를 대신할 뿐이고, **뿌리는 코드는 같은 함수 하나**다 —
    갈라지면 테스트에서만 도는 카드가 생긴다.
    """
    async with db.SessionLocal() as session:
        await 씨뿌리기(session)


@pytest.fixture(autouse=True)
def _삽화는_안_굽는다(monkeypatch: pytest.MonkeyPatch) -> None:
    """**어떤 테스트도 실제로 이미지를 굽지 않는다.**

    `POST /attempts` 가 백그라운드로 굽기 시작하면서(B-3 ①) **시도를 보내는 모든
    테스트가 이미지 API 를 부를 수 있게 됐다.** 장당 $0.0336 이고, 무엇보다
    **조용하다** — 느려질 뿐 빨간불이 안 뜬다. 실제로 구워 보는 것은
    `scripts/bench_image.py` 몫이다.

    **`생성` 만 갈아끼운다.** 행을 만들고 `ready` 로 굳히는 길은 그대로 돌아야
    그 자리를 테스트가 볼 수 있다. 굽기 자체를 보는 테스트는 이 위에 덧끼운다.
    """

    async def _안만듦(card_id: str, tier: str) -> 생성결과:
        return 생성결과(사유="unconfigured")

    monkeypatch.setattr(artwork_store, "생성", _안만듦)


def _데이터베이스만들기() -> None:
    """**지우고 새로 만든다.** `asyncpg` 주소를 관리용으로 바꿔 `postgres` 에 붙는다."""
    import asyncio

    import asyncpg

    주소 = TEST_DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    이름 = 주소.rsplit("/", 1)[1]
    관리 = 주소.rsplit("/", 1)[0] + "/postgres"

    async def _만들기() -> None:
        conn = await asyncpg.connect(관리)
        try:
            # **매번 지우고 다시 만든다.** 남겨 두면 옛 스키마 위에서 테스트가 도는데,
            # `alembic_version` 은 이미 최신이라 마이그레이션이 아무것도 안 한다 —
            # **초록불인데 실제로는 옛 DDL** 이다. 2026-09-07 에 실제로 밟았다
            # (유니크로 바꾼 인덱스가 테스트 DB 에서만 유니크가 아니었다).
            # 마이그레이션 셋을 다시 도는 비용이 그 위험보다 싸다.
            await conn.execute(
                "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1",
                이름,
            )
            await conn.execute(f'drop database if exists "{이름}"')
            await conn.execute(f'create database "{이름}"')
        finally:
            await conn.close()

    asyncio.run(_만들기())


# ── 인증된 클라이언트 ─────────────────────────────────────


def _client() -> TestClient:
    """`base_url` 이 https 여야 한다 — `__Host-` 는 `Secure` 를 강제한다.

    http 로 두면 서버가 구운 쿠키가 되돌아 나가지 않아 **실제로는 통과할 흐름이
    테스트에서만 401** 이 된다.
    """
    return TestClient(create_app(), base_url="https://testserver", raise_server_exceptions=False)


@pytest.fixture
def 익명() -> TestClient:
    """**아무 쿠키도 없다.** 인증 자체를 보는 테스트만 이걸 쓴다."""
    return _client()


PASSWORD = "test-password"


@pytest.fixture
def 비밀번호() -> str:
    """`학부모행` 이 쓴 평문. 로그인 테스트가 같은 값을 써야 한다."""
    return PASSWORD


@pytest.fixture
async def 학부모행() -> Parent:
    async with db.SessionLocal() as session:
        학부모 = Parent(
            email=f"{uuid.uuid4().hex}@example.test",
            password_hash=비밀번호해시(PASSWORD),
            consent_at=datetime.now(UTC),
            consent_version="test",
        )
        session.add(학부모)
        await session.commit()
        await session.refresh(학부모)
        return 학부모


@pytest.fixture
async def 자녀와코드(학부모행: Parent) -> tuple[Child, str]:
    """자녀 행과 **평문 접속 코드**.

    평문은 서버가 저장하지 않으므로(`app/accounts.py`) 코드를 써야 하는 테스트는
    만든 쪽에서 받아 두는 수밖에 없다. 실제 흐름에서도 학부모 화면이 그렇다 —
    발급 응답 한 번에만 실린다.
    """
    코드, 해시, 만료 = 접속코드만들기()
    async with db.SessionLocal() as session:
        아이 = Child(
            parent_id=학부모행.id,
            nickname="불꽃탐험가",
            age_band=11,
            guide_name="나침이",
            access_code_hash=해시,
            access_code_expires_at=만료,
        )
        session.add(아이)
        await session.commit()
        await session.refresh(아이)
        return 아이, 코드


@pytest.fixture
def 자녀행(자녀와코드: tuple[Child, str]) -> Child:
    return 자녀와코드[0]


@pytest.fixture
def 접속코드(자녀와코드: tuple[Child, str]) -> str:
    return 자녀와코드[1]


@pytest.fixture
async def client(학부모행: Parent, 자녀행: Child) -> TestClient:
    """학부모·자녀 쿠키가 **둘 다** 앉아 있는 클라이언트.

    가족 태블릿이 그렇다 — 학부모가 가입하고 같은 기기를 아이가 쓴다. 쿠키 이름을
    나눈 이유가 이것이라, 기본값을 이 상태로 둬야 덮어쓰기 사고가 여기서 걸린다.

    **쿠키에 진짜 토큰이 들어간다** (E-3). 예전에는 `"mock"` 문자열이었다.
    """
    c = _client()
    c.cookies.set(PARENT_COOKIE, issue(학부모행.id, "parent"))
    c.cookies.set(CHILD_COOKIE, issue(자녀행.id, "child", token_version=자녀행.token_version))
    return c


@pytest.fixture
def _NER_켠다(monkeypatch: pytest.MonkeyPatch):
    """실명(NER)을 켠다. **운영 기본값은 꺼짐이다** (2026-09-09 대표 판정).

    **코드 경로가 따로 있는 게 아니라 같은 자리가 켜지는 것**이라, 이 픽스처를 쓴
    검사들은 **되살릴 때 그 코드가 여전히 도는지**를 보장한다 (`app/pii.py`).
    """
    from app.config import get_settings

    monkeypatch.setenv("PII_NER_ENABLED", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
