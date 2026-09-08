"""일일 카드 제한 — 서버 몫 (A0-5).

**하드 피니시가 MVP 필수 가드레일이다** (PRD). 하루 5장에서 멈추는 것이 「도파민
중독」에 대한 제품의 답이고, **그것이 지켜지는지를 여기서 본다.**

`today` 는 지금까지 픽스처였다 — `cards_done=3, cap=5` 고정. **소모 이력이 생겼으니
진짜로 센다** (A0-1 이 선행이었다).

지키는 것 넷.

1. **오늘 실제로 쓴 카드 수를 센다** — 되묻기·차단은 안 세인다 (행을 안 만든다)
2. **재시도는 카운트를 안 쓴다** — 같은 카드라 distinct 에 안 늘어난다
3. **상한은 자녀 행에서 읽는다** — 학부모가 바꿀 수 있는 값이다 (`children.daily_cap`)
4. **소진 응답에 `guide.line` 이 있다** — 아이가 빈 화면을 보지 않게
"""

import pytest
from fastapi.testclient import TestClient

from app import db
from app.api.v1 import attempts
from app.evaluator import 평가결과
from app.models import Child
from app.moderation import 검사결과

문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


@pytest.fixture(autouse=True)
def 판정_고정(monkeypatch: pytest.MonkeyPatch) -> dict:
    상태 = {"grade": "G2", "막힘": False}

    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade=상태["grade"], signals=["adj:은빛"], descriptors=["은빛"])

    async def _검사(text: str) -> 검사결과:
        return 검사결과(blocked=상태["막힘"], category="violence" if 상태["막힘"] else None)

    async def _안됨(자녀id: str, card_id: str, **_) -> int:
        return 0

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _검사)
    monkeypatch.setattr(attempts, "되묻은횟수", _안됨)
    return 상태


def _풀기(client: TestClient, card_id: str):
    return client.post("/api/v1/attempts", json={"card_id": card_id, "text": 문장})


def _다섯장(client: TestClient) -> None:
    for 번호 in range(1, 6):
        assert _풀기(client, f"c0{번호}").status_code == 200


async def _상한을(자녀행: Child, 값: int) -> None:
    async with db.SessionLocal() as session:
        아이 = await session.get(Child, 자녀행.id)
        아이.daily_cap = 값
        await session.commit()


# ── 진짜로 센다 ─────────────────────────────────────────


def test_오늘_쓴_수가_응답에_실린다(client: TestClient):
    """픽스처였을 때는 **무엇을 해도 3** 이었다."""
    첫장 = _풀기(client, "c01").json()
    둘째장 = _풀기(client, "c02").json()

    assert 첫장["today"]["cards_done"] == 1
    assert 둘째장["today"]["cards_done"] == 2
    assert 둘째장["today"]["cap"] == 5
    assert 둘째장["today"]["locked"] is False


def test_다_쓰면_잠긴다(client: TestClient):
    _다섯장(client)

    마지막 = _풀기(client, "c05")  # 이미 쓴 카드라 409 지만 today 를 보려는 게 아니다
    assert 마지막.status_code == 409

    몸 = client.get("/api/v1/cards/next")
    assert 몸.status_code == 409


def test_소진_응답에_가이드_대사가_있다(client: TestClient):
    """**화면에는 `guide.line` 만 뜬다** — `error.message`(존댓말)와 나란히 뜨지
    않는다 (`문구.md` 0장). 아이가 빈 화면을 보지 않게 한 줄은 있어야 한다."""
    _다섯장(client)

    몸 = _풀기(client, "c06").json()

    assert 몸["error"]["code"] == "DAILY_CAP_REACHED"
    assert 몸["error"]["detail"]["guide"]["line"]
    assert 몸["error"]["detail"]["guide"]["expression"] == "session_end"


# ── 무엇이 안 세이나 ────────────────────────────────────


def test_재시도는_카운트를_안_쓴다(client: TestClient):
    """`Stage0.md` 4절 — **재시도는 일일 카운트 미소모.** 같은 카드라 자연히 안 는다."""
    _다섯장(client)
    첫장 = client.get("/api/v1/cards/c01")  # 화면 복귀는 막지 않는다
    assert 첫장.status_code == 200

    처음 = client.post("/api/v1/attempts", json={"card_id": "c01", "text": 문장, "retry_of": None})
    assert 처음.status_code == 409  # 상한에 걸린다 (재시도가 아니다)


def test_차단은_카운트를_안_쓴다(client: TestClient, 판정_고정: dict):
    """**카드 미소모**다 (`Stage0.md` 4절 (c)). 행을 안 만드니 자연히 안 세인다."""
    _풀기(client, "c01")

    판정_고정["막힘"] = True
    막힌것 = _풀기(client, "c02").json()

    assert 막힌것["outcome"] == "blocked"
    assert 막힌것["today"]["cards_done"] == 1


def test_되묻기는_카운트를_안_쓴다(
    client: TestClient, 판정_고정: dict, monkeypatch: pytest.MonkeyPatch
):
    """**카드 미소모**다 (`Stage0.md` 4절 (b))."""
    _풀기(client, "c01")

    판정_고정["grade"] = "G0"

    async def _한번더(자녀id: str, card_id: str, **_) -> int:
        return 1

    monkeypatch.setattr(attempts, "되묻기횟수", _한번더)
    되물음 = _풀기(client, "c02").json()

    assert 되물음["outcome"] == "scaffold"
    assert 되물음["today"]["cards_done"] == 1


# ── 상한은 자녀 행에서 온다 ──────────────────────────────


async def test_자녀별_상한을_읽는다(client: TestClient, 자녀행: Child):
    """**학부모가 바꿀 수 있는 값이다** (`PATCH /parents/children/{id}` 의 `daily_cap`).
    코드에 5 를 박아 두면 그 화면이 아무것도 안 바꾼다."""
    await _상한을(자녀행, 2)

    assert _풀기(client, "c01").status_code == 200
    둘째 = _풀기(client, "c02").json()
    assert 둘째["today"]["cap"] == 2
    assert 둘째["today"]["locked"] is True

    assert _풀기(client, "c03").status_code == 409
