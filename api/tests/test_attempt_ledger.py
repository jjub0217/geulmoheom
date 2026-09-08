"""소모 이력 — `POST /attempts` 가 `card_attempts` 행을 쓴다 (A0-1 잔여).

**여기가 아이 원문이 들어가는 유일한 자리다** (PRD 1.1b). 그래서 지키는 것이 셋이다.

1. **카드를 실제로 쓴 입력만 행이 된다** — 되묻기·차단은 카드를 안 쓴다 (`Stage0.md` 4절)
2. **저장되는 문장은 가려진 뒤 문장이다** — 원문 그대로가 아니라 마스킹 결과가 책이 된다
3. **응답의 `attempt_id` 가 그 행이다** — 픽스처였을 때는 새로고침 복구가 남의 것을 가리켰다
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import db
from app.api.v1 import attempts
from app.evaluator import 평가결과
from app.models import CardAttempt, Child
from app.moderation import 검사결과

문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


@pytest.fixture(autouse=True)
def 판정_고정(monkeypatch: pytest.MonkeyPatch) -> dict:
    """네트워크를 안 탄다. 여기서 보는 것은 **무엇이 저장되는가**이지 판정 품질이 아니다.

    등급을 바꾸고 싶은 테스트는 **돌려받은 딕셔너리를 고친다.** `monkeypatch.undo()` 로
    되돌리지 않는다 — 그건 이 픽스처가 끼운 것까지 함께 벗겨서 **진짜 Gemini 호출이
    나간다.** 한 번 실제로 나갔다.
    """
    상태 = {"grade": "G2"}

    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade=상태["grade"], signals=["adj:은빛", "adv:살금살금"])

    async def _통과(text: str) -> 검사결과:
        return 검사결과(blocked=False)

    async def _안됨(자녀id: str, card_id: str, **_) -> int:
        """Redis 는 테스트 루프에서 안 돈다. 세는 자리는 `test_scaffold.py` 몫이다."""
        return 0

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _통과)
    monkeypatch.setattr(attempts, "되묻은횟수", _안됨)
    return 상태


async def _이력(child_id: uuid.UUID) -> list[CardAttempt]:
    async with db.SessionLocal() as session:
        문 = (
            select(CardAttempt)
            .where(CardAttempt.child_id == child_id)
            .order_by(CardAttempt.attempt)
        )
        return list(await session.scalars(문))


def _보내기(client: TestClient, **덧붙임) -> dict:
    본문 = {"card_id": "c01", "text": 문장} | 덧붙임
    return client.post("/api/v1/attempts", json=본문).json()


# ── 카드를 쓴 입력만 행이 된다 ─────────────────────────────


async def test_결과를_받으면_행이_하나_남는다(client: TestClient, 자녀행: Child):
    몸 = _보내기(client)

    (행,) = await _이력(자녀행.id)
    assert 몸["outcome"] == "result"
    assert 행.card_id == "c01"
    assert 행.attempt == 1
    assert 행.grade == "G2"
    assert 행.tier == "rare"
    assert 행.text == 문장
    # **공백 포함이다** (PRD 5장). 화면의 「30자」·로그의 `char_len`·책의 문장이
    # 같은 문자열을 세야 한다.
    assert 행.char_len == len(문장)


async def test_응답의_attempt_id_가_그_행이다(client: TestClient, 자녀행: Child):
    """픽스처였을 때는 **모든 아이의 모든 시도가 같은 id** 였다 — 새로고침 복구가
    남의 것을 가리킨다."""
    몸 = _보내기(client)

    (행,) = await _이력(자녀행.id)
    assert 몸["attempt_id"] == str(행.id)


async def test_되묻기는_행을_안_만든다(
    client: TestClient, 자녀행: Child, 판정_고정: dict, monkeypatch: pytest.MonkeyPatch
):
    """**카드 미소모**다 (`Stage0.md` 4절 (b)). 되묻기는 시도가 끝난 것이 아니라
    같은 시도의 연장이다."""
    판정_고정["grade"] = "G0"

    async def _한번더(자녀id: str, card_id: str, **_) -> int:
        return 1

    monkeypatch.setattr(attempts, "되묻기횟수", _한번더)

    몸 = _보내기(client)

    assert 몸["outcome"] == "scaffold"
    assert await _이력(자녀행.id) == []


async def test_차단은_행을_안_만든다(
    client: TestClient, 자녀행: Child, monkeypatch: pytest.MonkeyPatch
):
    """**카드 미소모**다 (`Stage0.md` 4절 (c)). 막힌 문장은 책에 안 들어간다."""

    async def _막힘(text: str) -> 검사결과:
        return 검사결과(blocked=True, category="violence")

    monkeypatch.setattr(attempts, "검사하기", _막힘)

    몸 = _보내기(client)

    assert 몸["outcome"] == "blocked"
    assert await _이력(자녀행.id) == []


# ── 회차 ────────────────────────────────────────────────


async def test_같은_카드를_다시_풀면_회차가_오른다(client: TestClient, 자녀행: Child):
    """`retry_of` 는 **결과를 받은 뒤 같은 카드를 다시 풀 때만** 채운다
    (`Stage0.md` 4절). 그것이 `card_retry` 가 재는 재시도율이다."""
    첫번째 = _보내기(client)

    _보내기(client, retry_of=첫번째["attempt_id"])

    하나, 둘 = await _이력(자녀행.id)
    assert (하나.attempt, 둘.attempt) == (1, 2)
    assert 둘.retry_of == 하나.id


async def test_남의_시도를_재시도로_주면_거절한다(client: TestClient, 자녀행: Child):
    """FK 로 500 을 내지 않는다. **404 도 아니다** — 「그 시도는 있다」가 새기 때문이다."""
    몸 = client.post(
        "/api/v1/attempts",
        json={"card_id": "c01", "text": 문장, "retry_of": str(uuid.uuid4())},
    )

    assert 몸.status_code == 422
    assert await _이력(자녀행.id) == []


# ── 저장되는 것은 가려진 문장이다 ───────────────────────────


async def test_가려진_문장이_저장된다(
    client: TestClient, 자녀행: Child, monkeypatch: pytest.MonkeyPatch
):
    """**책에 들어가는 것은 마스킹 결과다** (`Stage0.md` 9절 3번, 미결 11-5).
    `payload.text` 를 다시 꺼내 쓰면 그 순간 원문이 그대로 남는다."""

    async def _가림(text: str, **_) -> tuple[str, list[str]]:
        return "○○○ 와 함께 걸었다", ["name"]

    monkeypatch.setattr(attempts, "실명까지가리기", _가림)

    _보내기(client)

    (행,) = await _이력(자녀행.id)
    assert 행.text == "○○○ 와 함께 걸었다"
    assert 행.char_len == len("○○○ 와 함께 걸었다")


async def test_되묻기를_거친_횟수가_남는다(
    client: TestClient, 자녀행: Child, monkeypatch: pytest.MonkeyPatch
):
    """되묻기 뒤 통과한 입력에는 **몇 번 되물었는지**가 붙는다 — 그게 안 남으면
    「되묻기가 실제로 아이를 더 쓰게 했나」를 나중에 못 센다 (H2)."""

    async def _한번_되물었다(자녀id: str, card_id: str, **_) -> int:
        return 1

    monkeypatch.setattr(attempts, "되묻은횟수", _한번_되물었다)

    _보내기(client)

    (행,) = await _이력(자녀행.id)
    assert 행.scaffold_count == 1
