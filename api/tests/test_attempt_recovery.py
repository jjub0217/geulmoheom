"""새로고침 복구 — `GET /attempts/{attempt_id}` 가 **그 시도를** 돌려준다.

**지금까지는 픽스처였다.** `attempt_id` 가 진짜가 된 뒤로는 그게 그냥 목이 아니라
**버그**다 — 아이가 결과 화면에서 새로고침하면 **자기 것이 아닌 결과**를 본다.
프리테스트에서 아이가 실제로 하는 동작이다.

지키는 것 셋.

1. **저장된 시도가 그대로 나온다** — 티어·가이드 대사·삽화가 그 시도의 것
2. **남의 시도는 404** — 403 이면 「그 시도는 존재한다」가 샌다
3. **등급 문자는 안 나간다** (`Stage0.md` 4절). 응답에 담기는 것은 티어뿐이다
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app import db
from app.accounts import 비밀번호해시, 접속코드만들기
from app.api.v1 import attempts
from app.evaluator import 평가결과
from app.models import Child, Parent
from app.moderation import 검사결과

# **활용형이 들어 있다.** `signals` 는 「캄캄한」을 원형으로 주는데 문장에는
# 「캄캄했지만」이 있어, **다시 만들면 이 하이라이트가 사라진다.** 저장하지 않으면
# 새로고침 한 번에 아이의 덧칠이 둘에서 하나로 준다 — 그 자리를 여기서 잡는다.
문장 = "캄캄했지만 살금살금 걸어 들어갔다"


@pytest.fixture(autouse=True)
def 판정_고정(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(
            grade="G3",
            signals=["adj:캄캄한", "adv:살금살금"],
            descriptors=["캄캄했지만", "살금살금"],
        )

    async def _통과(text: str) -> 검사결과:
        return 검사결과(blocked=False)

    async def _안됨(자녀id: str, card_id: str, **_) -> int:
        return 0

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _통과)
    monkeypatch.setattr(attempts, "되묻은횟수", _안됨)


def _풀기(client: TestClient, card_id: str = "c01") -> dict:
    return client.post("/api/v1/attempts", json={"card_id": card_id, "text": 문장}).json()


async def _다른아이의쿠키(client: TestClient) -> Child:
    async with db.SessionLocal() as session:
        학부모 = Parent(
            email=f"{uuid.uuid4().hex}@example.test",
            password_hash=비밀번호해시("x"),
            consent_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
            consent_version="test",
        )
        session.add(학부모)
        await session.flush()

        _, 해시, 만료 = 접속코드만들기()
        아이 = Child(
            parent_id=학부모.id,
            nickname="다른탐험가",
            age_band=11,
            access_code_hash=해시,
            access_code_expires_at=만료,
        )
        session.add(아이)
        await session.commit()
        await session.refresh(아이)
        return 아이


# ── 그 시도가 나온다 ─────────────────────────────────────


def test_새로고침하면_그_시도가_나온다(client: TestClient):
    처음 = _풀기(client)

    다시 = client.get(f"/api/v1/attempts/{처음['attempt_id']}").json()

    assert 다시["attempt_id"] == 처음["attempt_id"]
    assert 다시["outcome"] == "result"
    assert 다시["tier"] == 처음["tier"] == "legendary"
    assert 다시["guide"] == 처음["guide"]


def test_삽화도_그_시도의_것이다(client: TestClient):
    """**폴링을 이어서 해야 한다.** 다른 삽화 id 를 주면 아이가 새로고침한 순간
    자기 그림을 영영 못 받는다."""
    처음 = _풀기(client)

    다시 = client.get(f"/api/v1/attempts/{처음['attempt_id']}").json()

    assert 다시["artwork"]["artwork_id"] == 처음["artwork"]["artwork_id"]


def test_등급_문자는_안_나간다(client: TestClient):
    """`G0~G3` 는 로그 전용이다 (`Stage0.md` 4절). 응답에 담기는 것은 티어뿐이다."""
    처음 = _풀기(client)

    몸 = client.get(f"/api/v1/attempts/{처음['attempt_id']}").text

    assert "G3" not in 몸


def test_되묻기를_거쳤어도_결과로_나온다(client: TestClient):
    """`GET` 은 **정상(result) 형식으로만** 돌려준다 — 되묻기는 행을 안 만들므로
    복구할 것이 애초에 없다."""
    처음 = _풀기(client)

    response = client.get(f"/api/v1/attempts/{처음['attempt_id']}")

    assert response.status_code == 200
    assert response.json()["outcome"] == "result"


# ── 남의 것은 없는 것이다 ────────────────────────────────


async def test_남의_시도는_404(client: TestClient, 자녀행: Child):
    """**403 이 아니다.** 오늘 다섯 번째로 같은 규칙이다."""
    남 = await _다른아이의쿠키(client)
    async with db.SessionLocal() as session:
        from app.models import CardAttempt

        시도 = CardAttempt(
            child_id=남.id,
            card_id="c01",
            attempt=1,
            grade="G2",
            tier="rare",
            char_len=10,
            text="남의 문장",
        )
        session.add(시도)
        await session.commit()
        await session.refresh(시도)

    response = client.get(f"/api/v1/attempts/{시도.id}")

    assert response.status_code == 404


def test_없는_시도는_404(client: TestClient):
    response = client.get(f"/api/v1/attempts/{uuid.uuid4()}")

    assert response.status_code == 404


def test_UUID_가_아니면_404(client: TestClient):
    """**500 으로 새지 않는다.** 「ID 는 전부 UUID」가 규약이다 (`공통규약.md`)."""
    response = client.get("/api/v1/attempts/a1")

    assert response.status_code == 404


def test_하이라이트가_처음과_같다(client: TestClient):
    """**저장한 것을 그대로 돌려준다** (2026-09-08, `Stage0.md` 10절).

    다시 만들면 줄어든다 — `signals` 는 말을 원형으로 주는데(「캄캄한」) 문장에는
    활용형이 있어(「캄캄했지만」) 원문 대조에서 걸러진다.

    **줄어드는 것이 문제다.** 프리테스트 관찰 신호 7번이 **「자기 문장이 하이라이트된
    것을 알아보는가」**인데, 아이가 새로고침하면 그 관찰이 오염되고 **원인이 제품인지
    복구 결함인지 우리가 못 가른다.** 아이 원문은 문서로 안 옮기므로 되짚을 수도 없다.
    """
    처음 = _풀기(client)
    assert len(처음["highlights"]) == 2, "이 테스트가 서려면 처음에 둘이 있어야 한다"

    다시 = client.get(f"/api/v1/attempts/{처음['attempt_id']}").json()

    assert 다시["highlights"] == 처음["highlights"]
