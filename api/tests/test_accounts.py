"""E-3 익명 가입 — 계정이 실제로 서고, 아이가 실제 토큰으로 들어온다.

`tests/test_stage0_mock.py` 는 **응답 모양**이 계약과 맞는지를 본다. 이 파일은
**그 뒤에 실제로 무엇이 남고 무엇이 막히는지**를 본다 — 난수 ID · 접속 코드 1회용 ·
`token_version` 폐기 · 닉네임 PII · 쿠키 슬라이딩.
"""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import db, tokens
from app.api.v1 import parents as parents_router
from app.auth import CHILD_COOKIE, MAX_AGE_SECONDS, PARENT_COOKIE
from app.models import Child, Parent

# ── 아이에게 아무것도 묻지 않는다 ─────────────────────────


def test_자녀_생성은_닉네임과_연령대만_받는다(client: TestClient):
    """**계약에 실명·이메일·학교를 담을 자리가 없다** (PRD E-3).

    필드를 보내도 무시되는 것으로는 부족하다 — 스키마에 없어야 프론트가 화면에
    그 입력칸을 만들지 않는다.
    """
    스키마 = client.get("/openapi.json").json()["components"]["schemas"]["CreateChildRequest"]

    assert set(스키마["properties"]) == {"nickname", "age_band"}


def test_자녀_ID_는_난수다(client: TestClient):
    """순번이면 남의 아이 ID 를 세어서 알아낼 수 있다."""
    만들기 = lambda: client.post(  # noqa: E731
        "/api/v1/parents/children", json={"nickname": "샛별탐험가", "age_band": 11}
    ).json()["child_id"]

    첫째, 둘째 = uuid.UUID(만들기()), uuid.UUID(만들기())

    assert 첫째.version == 4
    assert 첫째 != 둘째


def test_자녀_토큰에는_닉네임이_안_담긴다(client: TestClient, 접속코드: str):
    """JWT 는 서명일 뿐 암호화가 아니라 payload 가 평문으로 읽힌다.

    **닉네임은 아이가 실명을 적을 수 있는 자리다** (PRD 1.1b·E-2). 담기는 것은
    난수 ID 와 정수뿐이어야 한다.
    """
    client.cookies.clear()
    client.post("/api/v1/child/auth", json={"access_code": 접속코드})

    실린것 = jwt.decode(client.cookies[CHILD_COOKIE], options={"verify_signature": False})

    assert set(실린것) == {"sub", "role", "tv", "iat", "exp"}
    assert "불꽃탐험가" not in str(실린것)


# ── 접속 코드 ────────────────────────────────────────────


async def test_접속_코드는_평문으로_저장되지_않는다(client: TestClient):
    응답 = client.post(
        "/api/v1/parents/children", json={"nickname": "샛별탐험가", "age_band": 11}
    ).json()

    async with db.SessionLocal() as session:
        아이 = await session.get(Child, uuid.UUID(응답["child_id"]))

    assert 아이 is not None
    assert 아이.access_code_hash != 응답["access_code"]
    assert 응답["access_code"] not in (아이.access_code_hash or "")


async def test_같은_코드가_두_아이에게_붙지_않는다(client: TestClient, 자녀행: Child):
    """**겹치면 조회가 아무 쪽이나 골라 다른 아이의 계정으로 들어가진다.**

    확률은 낮지만(6자리) 값이 회복 불가라 DB 유니크로 막았다. 여기서 보는 것은
    그 방어선이 실제로 서 있는가다 — 손으로 같은 해시를 넣어 본다.
    """
    async with db.SessionLocal() as session:
        내아이 = await session.get(Child, 자녀행.id)
        assert 내아이 is not None
        겹치는해시 = 내아이.access_code_hash

        쌍둥이 = Child(
            parent_id=내아이.parent_id,
            nickname="쌍둥이탐험가",
            age_band=11,
            access_code_hash=겹치는해시,
            access_code_expires_at=내아이.access_code_expires_at,
        )
        session.add(쌍둥이)
        with pytest.raises(IntegrityError):
            await session.commit()


def test_접속_코드는_한_번만_쓴다(익명: TestClient, 접속코드: str):
    """1회용이라 두 번째는 401 이다 (`Stage0.md` 2절)."""
    assert 익명.post("/api/v1/child/auth", json={"access_code": 접속코드}).status_code == 200

    익명.cookies.clear()

    assert 익명.post("/api/v1/child/auth", json={"access_code": 접속코드}).status_code == 401


async def test_만료된_코드는_통과하지_않는다(익명: TestClient, 자녀와코드: tuple[Child, str]):
    아이, 코드 = 자녀와코드
    async with db.SessionLocal() as session:
        행 = await session.get(Child, 아이.id)
        assert 행 is not None
        행.access_code_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()

    assert 익명.post("/api/v1/child/auth", json={"access_code": 코드}).status_code == 401


def test_없는_코드와_쓴_코드가_같은_401_이다(익명: TestClient, 접속코드: str):
    """구분하면 코드를 찍어 보는 쪽에 「이 번호는 존재한다」가 새어 나간다."""
    없는것 = 익명.post("/api/v1/child/auth", json={"access_code": "000000"})

    익명.post("/api/v1/child/auth", json={"access_code": 접속코드})
    익명.cookies.clear()
    쓴것 = 익명.post("/api/v1/child/auth", json={"access_code": 접속코드})

    assert 없는것.status_code == 쓴것.status_code == 401
    assert 없는것.json() == 쓴것.json()


def test_접속_코드가_로그에_안_남는다(
    익명: TestClient, 접속코드: str, caplog: pytest.LogCaptureFixture
):
    """6자리라 실패 로그만 모아도 코드북이 된다."""
    with caplog.at_level("DEBUG"):
        익명.post("/api/v1/child/auth", json={"access_code": "123456"})

    assert "123456" not in caplog.text


# ── 폐기 (`token_version`) ───────────────────────────────


def test_재발급하면_이전_기기가_끊긴다(client: TestClient, 자녀행: Child, 접속코드: str):
    """`공통규약.md` 「폐기」 — **그 한 번으로 모든 기기가 끊긴다.**

    코드만 바꾸고 `token_version` 을 두면, 코드를 잃어버려 다시 받는 상황(= 남이 그
    코드를 봤을 수 있는 상황)에서 이미 들어와 있는 기기가 그대로 남는다.
    """
    client.cookies.set(CHILD_COOKIE, "")
    client.post("/api/v1/child/auth", json={"access_code": 접속코드})
    assert client.get("/api/v1/child/me").status_code == 200

    client.post(f"/api/v1/parents/children/{자녀행.id}/access-code")

    assert client.get("/api/v1/child/me").status_code == 401


def test_자녀_로그아웃은_다른_기기를_끊지_않는다(client: TestClient, 자녀행: Child):
    """로그아웃은 이 기기에서 내려오는 것이다. 다른 기기를 끊는 것은 학부모 몫이다."""
    다른기기 = tokens.issue(자녀행.id, "child", token_version=자녀행.token_version)

    client.post("/api/v1/child/logout")

    client.cookies.set(CHILD_COOKIE, 다른기기)
    assert client.get("/api/v1/child/me").status_code == 200


def test_세대_번호가_없는_자녀_토큰은_통과하지_않는다(client: TestClient, 자녀행: Child):
    """옛 토큰이 남아 있어도 통과시키지 않는다 — 통과시키면 폐기에 구멍이 생긴다."""
    세대없음 = tokens.issue(자녀행.id, "child")

    client.cookies.set(CHILD_COOKIE, 세대없음)

    assert client.get("/api/v1/child/me").status_code == 401


# ── 서명·역할 ────────────────────────────────────────────


def test_남의_서명으로_만든_토큰은_401(client: TestClient, 자녀행: Child):
    가짜 = jwt.encode(
        {
            "sub": str(자녀행.id),
            "role": "child",
            "tv": 자녀행.token_version,
            "iat": datetime.now(UTC),
            "exp": datetime.now(UTC) + timedelta(days=30),
        },
        "남의-비밀키",
        algorithm="HS256",
    )

    client.cookies.set(CHILD_COOKIE, 가짜)

    assert client.get("/api/v1/child/me").status_code == 401


def test_alg_none_토큰은_401(client: TestClient, 자녀행: Child):
    """헤더의 `alg` 를 읽지 않는다 — 읽으면 서명 없이 통과시킬 수 있다."""
    무서명 = jwt.encode(
        {"sub": str(자녀행.id), "role": "child", "tv": 1, "iat": 0, "exp": 9999999999},
        key="",
        algorithm="none",
    )

    client.cookies.set(CHILD_COOKIE, 무서명)

    assert client.get("/api/v1/child/me").status_code == 401


def test_자녀_토큰을_학부모_쿠키_자리에_넣어도_안_통한다(client: TestClient, 자녀행: Child):
    """역할을 `verify()` 안에서 본다 — 호출부에 맡기면 깜빡한 한 곳이 생긴다."""
    client.cookies.set(PARENT_COOKIE, tokens.issue(자녀행.id, "child", token_version=1))

    assert client.get("/api/v1/parents/me").status_code == 401


async def test_계정이_지워지면_서명이_맞아도_401(client: TestClient, 자녀행: Child):
    async with db.SessionLocal() as session:
        행 = await session.get(Child, 자녀행.id)
        assert 행 is not None
        await session.delete(행)
        await session.commit()

    assert client.get("/api/v1/child/me").status_code == 401


# ── 쿠키 슬라이딩 (`공통규약.md` 「수명」) ─────────────────


def test_방금_구운_쿠키는_다시_굽지_않는다(client: TestClient):
    """12시간에 최대 1회다. 매 요청 `Set-Cookie` 를 붙이면 응답만 커진다."""
    응답 = client.get("/api/v1/child/me")

    assert "set-cookie" not in 응답.headers


def test_열두_시간이_지나면_남은_수명으로_다시_굽는다(client: TestClient, 자녀행: Child):
    """**JWT `exp` 는 안 늘린다.** 늘리는 것은 쿠키 `Max-Age` 뿐이다.

    다시 굽지 않으면 Safari 16.4+ 가 7일로 깎은 쿠키가 그대로 만료된다.
    """
    옛날 = datetime.now(UTC) - timedelta(days=20)
    묵은토큰 = jwt.encode(
        {
            "sub": str(자녀행.id),
            "role": "child",
            "tv": 자녀행.token_version,
            "iat": 옛날,
            "exp": 옛날 + tokens.MAX_AGE,
        },
        _비밀키(),
        algorithm="HS256",
    )
    client.cookies.set(CHILD_COOKIE, 묵은토큰)

    구운것 = client.get("/api/v1/child/me").headers["set-cookie"]

    남은날 = int(_맥스에이지(구운것)) / 86400
    assert 9 < 남은날 < 11  # 30일 중 20일이 지났다
    assert _맥스에이지(구운것) != str(MAX_AGE_SECONDS)  # 절대 만료가 밀리지 않았다
    assert 묵은토큰 in 구운것  # 같은 토큰을 다시 굽는다. 새로 발급하지 않는다


def test_만료_직전에는_다시_굽지_않는다(client: TestClient, 자녀행: Child):
    """`Max-Age` 가 0 이하면 브라우저가 삭제로 읽어, 요청 하나가 아이를 로그아웃시킨다."""
    옛날 = datetime.now(UTC) - tokens.MAX_AGE + timedelta(seconds=1)
    거의만료 = jwt.encode(
        {
            "sub": str(자녀행.id),
            "role": "child",
            "tv": 자녀행.token_version,
            "iat": 옛날,
            "exp": 옛날 + tokens.MAX_AGE,
        },
        _비밀키(),
        algorithm="HS256",
    )
    client.cookies.set(CHILD_COOKIE, 거의만료)

    응답 = client.get("/api/v1/child/me")

    assert 응답.status_code == 200
    assert "set-cookie" not in 응답.headers


# ── 닉네임 PII ───────────────────────────────────────────


@pytest.mark.parametrize(
    "닉네임",
    ["민준 010-1234-5678", "minjun@example.com", "은하초등학교 이민준", "행복동 101동 202호"],
)
def test_닉네임에_PII_가_있으면_422(client: TestClient, 닉네임: str):
    응답 = client.post("/api/v1/parents/children", json={"nickname": 닉네임, "age_band": 11})

    assert 응답.status_code == 422
    assert 응답.json()["error"]["detail"]["reason"] == "PII_DETECTED"


@pytest.mark.parametrize("닉네임", ["불꽃탐험가", "마법약초", "은하시 별빛동", "달빛기사단"])
def test_아이가_지을_법한_이름은_통과한다(client: TestClient, 닉네임: str):
    """**여기서 오탐이 나면 「검을 휘두른다」가 막히는 것과 같은 급이다.**

    판타지 낱말이 계정 만드는 자리에서 걸리면, 아이가 쓰고 싶은 이름을 포기한다.
    """
    응답 = client.post("/api/v1/parents/children", json={"nickname": 닉네임, "age_band": 11})

    assert 응답.status_code == 201


def test_걸린_닉네임이_응답에_되담기지_않는다(client: TestClient):
    """감지된 값 자체를 돌려주면 그게 곧 유출 경로다 (PRD 1.1b)."""
    응답 = client.post(
        "/api/v1/parents/children", json={"nickname": "민준 010-1234-5678", "age_band": 11}
    )

    assert "010-1234-5678" not in 응답.text


# ── 남의 자녀 ────────────────────────────────────────────


async def test_남의_자녀는_404_다(client: TestClient, 자녀행: Child):
    """403 으로 가르면 「그 ID 는 존재한다」가 새어 나간다."""
    async with db.SessionLocal() as session:
        남 = Parent(email=f"{uuid.uuid4().hex}@example.test", password_hash="x")
        session.add(남)
        await session.commit()
        남의아이 = Child(parent_id=남.id, nickname="남의아이", age_band=10)
        session.add(남의아이)
        await session.commit()
        남의아이_id = 남의아이.id

    응답 = client.patch(f"/api/v1/parents/children/{남의아이_id}", json={"daily_cap": 12})

    assert 응답.status_code == 404


# ── 학부모 가입·로그인 ───────────────────────────────────


def test_동의하지_않으면_가입되지_않는다(익명: TestClient):
    응답 = 익명.post(
        "/api/v1/parents/signup",
        json={"email": f"{uuid.uuid4().hex}@example.test", "password": "x", "consent": False},
    )

    assert 응답.status_code == 422


async def test_라벨링_동의는_별개로_기록된다(익명: TestClient):
    """**하나로 묶어 받지 않는다** (PRD 1.1b). 거부해도 서비스는 이용 가능하다."""
    이메일 = f"{uuid.uuid4().hex}@example.test"
    응답 = 익명.post(
        "/api/v1/parents/signup",
        json={"email": 이메일, "password": "x", "consent": True, "labeling_consent": False},
    )

    assert 응답.status_code == 201
    async with db.SessionLocal() as session:
        학부모 = await session.scalar(select(Parent).where(Parent.email == 이메일))

    assert 학부모 is not None
    assert 학부모.consent_at is not None  # 보호자 동의는 받았고
    assert 학부모.labeling_consent is False  # 라벨링은 거부했다


async def test_토큰_발급이_실패하면_계정이_안_남는다(익명: TestClient, monkeypatch):
    """**가입이 반만 성공하지 않는다** (2026-09-12, 운영에서 겪었다).

    종전은 `commit()` → `issue()` 순서였다. `issue()` 가 터지면 **500 인데 계정은
    저장돼** 학부모가 **못 들어가는데 다시 가입하면 「이미 가입된 이메일」로 막혔다** —
    자기가 만든 계정에 영영 못 들어간다. 화면에는 「잠깐 문제가 생겼어요」뿐이라
    **그 상태를 아무도 못 본다.**

    그때 원인은 `JWT_SECRET` 이 비어 있던 것이지만 **무엇이 터지든 같은 일**이라
    순서로 막는다. 여기서는 원인을 흉내 내지 않고 **발급 자체를 터뜨린다.**
    """
    이메일 = f"{uuid.uuid4().hex}@example.test"

    def _터진다(*_, **__):
        raise RuntimeError("토큰을 못 만들었다")

    monkeypatch.setattr(parents_router, "issue", _터진다)

    응답 = 익명.post(
        "/api/v1/parents/signup",
        json={"email": 이메일, "password": "x", "consent": True},
    )

    assert 응답.status_code == 500
    async with db.SessionLocal() as session:
        assert await session.scalar(select(Parent).where(Parent.email == 이메일)) is None

    # **그리고 다시 가입할 수 있어야 한다** — 막히는 자리가 여기였다.
    monkeypatch.undo()
    assert (
        익명.post(
            "/api/v1/parents/signup",
            json={"email": 이메일, "password": "x", "consent": True},
        ).status_code
        == 201
    )


async def test_비밀번호가_평문으로_저장되지_않는다(익명: TestClient):
    이메일 = f"{uuid.uuid4().hex}@example.test"
    익명.post(
        "/api/v1/parents/signup",
        json={"email": 이메일, "password": "정말비밀", "consent": True},
    )

    async with db.SessionLocal() as session:
        학부모 = await session.scalar(select(Parent).where(Parent.email == 이메일))

    assert 학부모 is not None
    assert "정말비밀" not in 학부모.password_hash
    assert 학부모.password_hash.startswith("$argon2")


def test_없는_이메일과_틀린_비밀번호가_같은_401_이다(
    익명: TestClient, 학부모행: Parent, 비밀번호: str
):
    """구분하면 로그인 화면이 「이 이메일이 있는지」를 묻는 도구가 된다."""
    없는것 = 익명.post(
        "/api/v1/parents/login",
        json={"email": f"{uuid.uuid4().hex}@example.test", "password": 비밀번호},
    )
    틀린것 = 익명.post(
        "/api/v1/parents/login", json={"email": 학부모행.email, "password": "틀린값"}
    )

    assert 없는것.status_code == 틀린것.status_code == 401
    assert 없는것.json() == 틀린것.json()


def _비밀키() -> str:
    from app.config import get_settings

    return get_settings().jwt_secret.get_secret_value()


def _맥스에이지(set_cookie: str) -> str:
    for 조각 in set_cookie.split(";"):
        if 조각.strip().lower().startswith("max-age="):
            return 조각.split("=", 1)[1].strip()
    raise AssertionError("Max-Age 가 없다")
