"""`/child/auth` 속도 제한 (E-3 후속 · W4 6번 · `공통규약.md` 「`/child/auth` 속도 제한」).

**여기서 지키려는 것 셋** — ① 같은 기기 5회 실패 → 15분 잠금 ② 같은 IP 는 병행해서
느슨하게 ③ 학부모당 살아 있는 코드는 자녀 수만큼.

**가짜 Redis 를 물린다.** CI 에 Redis 가 없어서(`.github/workflows/ci.yml` — postgres 만
띄운다) 진짜를 쓰면 **전부 「열어 주기」로 떨어져 아무것도 안 재게 된다.** 초록인데
아무것도 검사하지 않는 그 모양이 여기서 가장 위험하다 — 이 파일이 막는 것이
**아이 계정을 찍어 보는 공격**이기 때문이다.
"""

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from starlette.requests import Request

from app import db
from app.auth import DEVICE_COOKIE
from app.child_auth_limit import (
    DEVICE_LOCK_SECONDS,
    DEVICE_MAX_FAILURES,
    IP_MAX_FAILURES,
    클라이언트IP,
    막을까,
    실패기록,
)
from app.config import PILOT_REQUIRED
from app.models import Child, Parent

AUTH = "/api/v1/child/auth"


class 가짜Redis:
    """세는 것만 한다. TTL 은 「몇 초로 걸었나」만 기억한다."""

    def __init__(self) -> None:
        self.값: dict[str, int] = {}
        self.만료: dict[str, int] = {}

    async def get(self, 키: str) -> int | None:
        return self.값.get(키)

    async def incr(self, 키: str) -> int:
        self.값[키] = self.값.get(키, 0) + 1
        return self.값[키]

    async def expire(self, 키: str, 초: int) -> None:
        self.만료[키] = 초

    async def delete(self, 키: str) -> None:
        self.값.pop(키, None)
        self.만료.pop(키, None)


class 죽은Redis:
    async def get(self, 키: str) -> int | None:
        raise ConnectionError("redis 없음")

    async def incr(self, 키: str) -> int:  # pragma: no cover
        raise ConnectionError("redis 없음")

    async def expire(self, 키: str, 초: int) -> None:  # pragma: no cover
        raise ConnectionError("redis 없음")

    async def delete(self, 키: str) -> None:  # pragma: no cover
        raise ConnectionError("redis 없음")


@pytest.fixture
def 카운터(monkeypatch: pytest.MonkeyPatch) -> 가짜Redis:
    가짜 = 가짜Redis()
    monkeypatch.setattr(db, "redis_client", 가짜)
    return 가짜


def _틀린코드(n: int) -> dict[str, str]:
    """**매번 다른 코드를 넣는다.** 찍는 쪽이 실제로 하는 짓이고, 코드마다 세는 구현은
    바로 여기서 통과해 버린다 (`공통규약.md` 함정 절)."""
    return {"access_code": f"{n:06d}"}


# ── ① 같은 기기 5회 실패 → 15분 잠금 ─────────────────────


def test_같은_기기에서_다섯_번_틀리면_잠긴다(익명: TestClient, 카운터: 가짜Redis):
    """**세는 단위는 「요청자」다.** 코드가 매번 다른데도 카운터가 찬다 —
    코드별로 세는 구현이면 각 코드가 1에서 멈춰 영원히 안 잠긴다."""
    for i in range(DEVICE_MAX_FAILURES):
        assert 익명.post(AUTH, json=_틀린코드(i)).status_code == 401

    막힘 = 익명.post(AUTH, json=_틀린코드(99))

    assert 막힘.status_code == 429
    assert 막힘.json()["error"]["code"] == "RATE_LIMITED"


def test_잠긴_뒤에는_맞는_코드도_안_받는다(익명: TestClient, 접속코드: str, 카운터: 가짜Redis):
    """**코드를 대조하기 전에 막는다.** 뒤에 두면 잠긴 상태에서 찍어도 맞은 코드는
    소진돼, 잠금이 아이에게서 코드를 빼앗는 장치가 된다."""
    for i in range(DEVICE_MAX_FAILURES):
        익명.post(AUTH, json=_틀린코드(i))

    assert 익명.post(AUTH, json={"access_code": 접속코드}).status_code == 429


def test_잠금은_다섯_번째_실패_시각부터_15분이다(익명: TestClient, 카운터: 가짜Redis):
    """첫 실패로부터 재면 마지막 실패 뒤에 남는 시간이 들쭉날쭉해진다."""
    for i in range(DEVICE_MAX_FAILURES):
        익명.post(AUTH, json=_틀린코드(i))

    잠긴키 = [키 for 키 in 카운터.값 if 키.startswith("childauth:dev:")]
    assert 카운터.만료[잠긴키[0]] == DEVICE_LOCK_SECONDS


def test_잠긴_동안_더_눌러도_잠금이_안_늘어난다(익명: TestClient, 카운터: 가짜Redis):
    """**아이는 반드시 눌러 본다.** 재시도가 잠금을 연장하면 15분이 영원이 된다."""
    for i in range(DEVICE_MAX_FAILURES):
        익명.post(AUTH, json=_틀린코드(i))
    기기키 = next(키 for 키 in 카운터.값 if 키.startswith("childauth:dev:"))

    익명.post(AUTH, json=_틀린코드(100))
    익명.post(AUTH, json=_틀린코드(101))

    assert 카운터.값[기기키] == DEVICE_MAX_FAILURES


def test_기기가_다르면_서로_안_막는다(익명: TestClient, 카운터: 가짜Redis):
    """가족 태블릿과 아이 기기가 서로를 잠그면 안 된다."""
    for i in range(DEVICE_MAX_FAILURES):
        익명.post(AUTH, json=_틀린코드(i))

    익명.cookies.delete(DEVICE_COOKIE)  # 다른 기기가 들어온 것과 같다

    assert 익명.post(AUTH, json=_틀린코드(50)).status_code == 401


def test_맞는_코드가_들어오면_기기_카운터를_지운다(
    익명: TestClient, 접속코드: str, 카운터: 가짜Redis
):
    """**형제자매가 한 기기에서 차례로 들어오는 것이 정상 사용이다.** 앞의 아이가
    두어 번 틀린 것이 남으면 아무도 공격하지 않았는데 가족이 잠긴다."""
    for i in range(DEVICE_MAX_FAILURES - 1):
        익명.post(AUTH, json=_틀린코드(i))

    assert 익명.post(AUTH, json={"access_code": 접속코드}).status_code == 200
    assert not [키 for 키 in 카운터.값 if 키.startswith("childauth:dev:")]


# ── 기기 표식 ────────────────────────────────────────────


def test_기기_표식은_실패_응답에도_나간다(익명: TestClient, 카운터: 가짜Redis):
    """**여기가 이 기능의 급소다.** 표식이 401 에서 안 나가면 클라이언트는 매번
    표식 없이 와서 **매번 새 기기로 보이고**, 카운터가 5에 못 가 ①이 통째로 죽는다.
    FastAPI 가 주입한 `Response` 는 예외로 끝나면 버려지므로 미들웨어가 붙인다
    (`app/middleware.py` 「PendingCookieMiddleware」)."""
    응답 = 익명.post(AUTH, json=_틀린코드(1))

    assert 응답.status_code == 401
    assert DEVICE_COOKIE in 응답.cookies


def test_표식이_있으면_다시_굽지_않는다(익명: TestClient, 카운터: 가짜Redis):
    """매 응답마다 다시 구우면 수명이 무한정 밀린다 — 하루로 끊은 이유가 사라진다."""
    익명.post(AUTH, json=_틀린코드(1))

    assert DEVICE_COOKIE not in 익명.post(AUTH, json=_틀린코드(2)).cookies


def test_표식이_아무_문자열이면_안_받는다(익명: TestClient, 카운터: 가짜Redis):
    """쿠키 값은 클라이언트가 바꿔 보낼 수 있다. 그대로 받으면 요청마다 다른 값을
    넣어 **Redis 에 키를 무한히 만드는 손잡이**가 된다."""
    익명.cookies.set(DEVICE_COOKIE, "a" * 4000)

    assert DEVICE_COOKIE in 익명.post(AUTH, json=_틀린코드(1)).cookies


# ── ② 같은 IP 는 병행해서 느슨하게 ───────────────────────


def test_기기를_바꿔도_같은_IP_면_결국_막힌다():
    """①만 있으면 표식을 지우는 것으로 통째로 비껴간다. ②가 그 뒤를 받는다."""
    가짜 = 가짜Redis()

    for _ in range(IP_MAX_FAILURES):
        asyncio.run(실패기록(uuid.uuid4().hex, "203.0.113.9", client=가짜))

    assert asyncio.run(막을까(uuid.uuid4().hex, "203.0.113.9", client=가짜)) is True


def test_IP_는_기기보다_훨씬_느슨하다():
    """학교·가정은 여러 아이가 같은 인터넷을 쓴다. 여기서 조이면 **아무 잘못 없는
    아이가 막힌다.**"""
    가짜 = 가짜Redis()

    for _ in range(DEVICE_MAX_FAILURES):
        asyncio.run(실패기록(uuid.uuid4().hex, "203.0.113.9", client=가짜))

    assert asyncio.run(막을까(uuid.uuid4().hex, "203.0.113.9", client=가짜)) is False


def test_맞는_코드는_IP_카운터를_안_지운다(익명: TestClient, 접속코드: str, 카운터: 가짜Redis):
    """공유 IP 라 남의 실패를 내 성공으로 지워 줄 수 없다. 지우면 유효한 코드 하나를
    든 쪽이 ②를 마음대로 되돌린다."""
    익명.post(AUTH, json=_틀린코드(1))
    익명.post(AUTH, json={"access_code": 접속코드})

    assert [키 for 키 in 카운터.값 if 키.startswith("childauth:ip:")]


def _요청(헤더: dict[str, str] | None = None, 소켓: str = "10.0.0.7") -> Request:
    return Request(
        {
            "type": "http",
            "headers": [(k.lower().encode(), v.encode()) for k, v in (헤더 or {}).items()],
            "client": (소켓, 12345),
        }
    )


def test_X_Forwarded_For_로는_IP_를_못_바꾼다():
    """**그 헤더는 클라이언트가 직접 채워 보낼 수 있다.** 맨 앞 값을 믿으면 요청마다
    다른 값을 넣어 ②를 통째로 비껴간다. 설정이 지정한 헤더만 본다."""
    assert 클라이언트IP(_요청({"X-Forwarded-For": "1.2.3.4"})) == "10.0.0.7"


def test_앞단_IP_헤더는_설정이_정한다(monkeypatch: pytest.MonkeyPatch):
    from app import child_auth_limit

    class _설정:
        client_ip_header = "CF-Connecting-IP"

    monkeypatch.setattr(child_auth_limit, "get_settings", lambda: _설정())

    assert 클라이언트IP(_요청({"CF-Connecting-IP": "198.51.100.4"})) == "198.51.100.4"


def test_앞단_헤더_이름은_파일럿_필수다():
    """비어 있으면 **모든 요청이 앞단 IP 하나로 뭉쳐** 시간당 30회가 전체에 걸린다 —
    파일럿 중에 아이들이 한꺼번에 막히고 나서야 보인다."""
    assert "client_ip_header" in PILOT_REQUIRED


# ── Redis 가 죽었을 때 ───────────────────────────────────


def test_redis_가_죽어도_아이는_들어온다(
    익명: TestClient, 접속코드: str, monkeypatch: pytest.MonkeyPatch
):
    """못 세는 것과 **아무도 못 들어오는 것** 중 뒤가 훨씬 나쁘다
    (`app/scaffold.py`·`app/cost.py` 와 같은 태도)."""
    monkeypatch.setattr(db, "redis_client", 죽은Redis())

    assert 익명.post(AUTH, json={"access_code": 접속코드}).status_code == 200


def test_redis_가_죽으면_경고를_남긴다(익명: TestClient, monkeypatch: pytest.MonkeyPatch, caplog):
    """열어 주기로 한 이상, **열려 있었다는 사실이 어딘가에 남아야 한다.**"""
    monkeypatch.setattr(db, "redis_client", 죽은Redis())

    with caplog.at_level("WARNING"):
        익명.post(AUTH, json=_틀린코드(1))

    assert "속도 제한" in caplog.text


def test_속도_제한_로그에_코드도_기기도_안_남는다(
    익명: TestClient, 카운터: 가짜Redis, caplog: pytest.LogCaptureFixture
):
    """기기 표식도 IP 도 아이를 가리키는 값이다."""
    with caplog.at_level("DEBUG"):
        for i in range(DEVICE_MAX_FAILURES + 1):
            익명.post(AUTH, json=_틀린코드(i))

    표식 = 익명.cookies.get(DEVICE_COOKIE)
    assert 표식 and 표식 not in caplog.text
    assert "000001" not in caplog.text


# ── ③ 학부모당 살아 있는 코드는 자녀 수만큼 ──────────────
#
# **여기 셀 코드가 없다.** 살아 있는 코드는 `children.access_code_hash` 한 열이라
# 자녀 하나에 하나뿐이고, 재발급이 이전 해시를 덮어쓴다. 그래서 스키마가 지키는
# 성질이고 — **열을 리스트로 바꾸거나 이력 테이블을 만들면 그 순간 조용히 깨진다.**
# 코드가 아니라 이 검사로 남긴다.


def test_재발급을_반복해도_이전_코드는_다_죽는다(
    client: TestClient, 익명: TestClient, 자녀행: Child, 카운터: 가짜Redis
):
    """살아 있는 코드가 재발급 횟수만큼 쌓이면 **찍는 쪽이 걸릴 표적이 그만큼 는다.**"""
    코드들 = [
        client.post(f"/api/v1/parents/children/{자녀행.id}/access-code").json()["access_code"]
        for _ in range(3)
    ]

    for 옛것 in 코드들[:-1]:
        assert 익명.post(AUTH, json={"access_code": 옛것}).status_code == 401
    assert 익명.post(AUTH, json={"access_code": 코드들[-1]}).status_code == 200


async def test_학부모의_살아_있는_코드는_자녀_수를_넘지_않는다(
    client: TestClient, 학부모행: Parent, 카운터: 가짜Redis
):
    """**막는 것은 「걸릴 표적 수」다** — 노리는 쪽은 특정 아이를 고를 필요가 없다.

    자녀를 만들고 재발급을 섞어도 살아 있는 코드가 자녀 수를 못 넘는다.
    """
    for i in range(3):
        만든것 = client.post(
            "/api/v1/parents/children", json={"nickname": f"탐험가{i}", "age_band": 11}
        ).json()
        client.post(f"/api/v1/parents/children/{만든것['child_id']}/access-code")

    async with db.SessionLocal() as session:
        자녀수 = await session.scalar(
            select(func.count()).select_from(Child).where(Child.parent_id == 학부모행.id)
        )
        살아있는코드 = await session.scalar(
            select(func.count())
            .select_from(Child)
            .where(Child.parent_id == 학부모행.id, Child.access_code_hash.is_not(None))
        )

    assert 자녀수 == 4  # 픽스처 하나 + 만든 셋
    assert 살아있는코드 <= 자녀수
