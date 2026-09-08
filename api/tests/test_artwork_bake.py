"""삽화를 **비동기로 굽는다** (B-3 ①).

`POST /attempts` 는 `artworks` 행을 `pending` 으로 만들고 바로 응답한다. 굽는 것은
그 뒤에 돈다 — **아이를 6~8초 세워 두지 않는다** (`Stage0.md` 5절 폴링).

여기서 지키는 것은 셋이다.

1. **응답의 `artwork_id` 가 실제 행이다** — 픽스처였을 때는 폴링이 남의 것을 물었다
2. **굽기가 끝나면 그 행이 `pending` 을 벗는다** — 안 벗으면 프론트가 15초를 헛돈다
3. **굽기가 어떻게 실패해도 아이 요청은 안 죽고, 행은 `ready` 로 수렴한다**
   (`Stage0.md` 5절 — `failed` 는 계약에 없다)
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import artwork_store, db
from app.api.v1 import attempts
from app.artwork import 생성결과
from app.evaluator import 평가결과
from app.models import Artwork, CardAttempt, Child
from app.moderation import 검사결과

문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


@pytest.fixture(autouse=True)
def 판정_고정(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade="G2", signals=["adj:은빛"])

    async def _통과(text: str) -> 검사결과:
        return 검사결과(blocked=False)

    async def _안됨(자녀id: str, card_id: str, **_) -> int:
        return 0

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _통과)
    monkeypatch.setattr(attempts, "되묻은횟수", _안됨)


@pytest.fixture
def 안_굽는다(monkeypatch: pytest.MonkeyPatch) -> None:
    """`pending` 상태를 볼 수 있게 굽기를 멈춘다.

    `TestClient` 는 백그라운드 작업을 **응답을 돌려주기 전에** 끝내므로, 안 막으면
    테스트가 보는 것은 언제나 다 구워진 뒤다.
    """

    async def _아무것도(*_, **__) -> None:
        return None

    monkeypatch.setattr(attempts, "굽기", _아무것도)


def _보내기(client: TestClient, **덧붙임) -> dict:
    return client.post("/api/v1/attempts", json={"card_id": "c01", "text": 문장} | 덧붙임).json()


async def _삽화들() -> list[Artwork]:
    async with db.SessionLocal() as session:
        return list(await session.scalars(select(Artwork)))


# ── 행이 생긴다 ──────────────────────────────────────────


async def test_결과에_pending_삽화가_붙는다(client: TestClient, 안_굽는다, 자녀행: Child):
    몸 = _보내기(client)

    (삽화,) = await _삽화들()
    assert 몸["artwork"]["artwork_id"] == str(삽화.id)
    assert 몸["artwork"]["status"] == "pending"
    assert 몸["artwork"]["url"] is None
    assert 삽화.status == "pending"
    # **티어는 이 시도의 티어다.** 다른 값이면 아이가 쓴 것과 받는 그림이 어긋난다.
    assert 삽화.tier == "rare"


async def test_삽화가_그_시도에_달린다(client: TestClient, 안_굽는다, 자녀행: Child):
    """`card_attempt_id` 가 이 아이의 이번 시도를 가리켜야 「내 책」이 페이지를 못 만든다."""
    _보내기(client)

    (삽화,) = await _삽화들()
    async with db.SessionLocal() as session:
        (시도,) = list(await session.scalars(select(CardAttempt)))
    assert 삽화.card_attempt_id == 시도.id


async def test_되묻기와_차단에는_삽화가_안_붙는다(
    client: TestClient, 안_굽는다, monkeypatch: pytest.MonkeyPatch
):
    """카드를 안 썼으면 그림도 없다. **시도 행이 없으니 달 자리도 없다.**"""

    async def _막힘(text: str) -> 검사결과:
        return 검사결과(blocked=True, category="violence")

    monkeypatch.setattr(attempts, "검사하기", _막힘)

    _보내기(client)

    assert await _삽화들() == []


# ── 구워진다 ────────────────────────────────────────────


async def test_구워지면_ready_가_된다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    async def _생성(card_id: str, tier: str) -> 생성결과:
        return 생성결과(image=b"\x89PNG", mime="image/png")

    async def _올리기(artwork_id: str, image: bytes, mime: str) -> str:
        return "artworks/그림.png"

    monkeypatch.setattr(artwork_store, "생성", _생성)
    monkeypatch.setattr(artwork_store, "올리기", _올리기)

    _보내기(client)

    (삽화,) = await _삽화들()
    assert 삽화.status == "ready"
    assert 삽화.r2_key == "artworks/그림.png"
    assert 삽화.fallback is False
    assert 삽화.ready_at is not None


async def test_못_구우면_ready_에_fallback_이다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """**`failed` 는 계약에 없다** (`Stage0.md` 5절). 모든 실패가 `ready` 로 수렴하고,
    그림 자리는 프록시가 기본 에셋으로 메운다."""

    async def _못만듦(card_id: str, tier: str) -> 생성결과:
        return 생성결과(사유="timeout")

    monkeypatch.setattr(artwork_store, "생성", _못만듦)

    _보내기(client)

    (삽화,) = await _삽화들()
    assert 삽화.status == "ready"
    assert 삽화.fallback is True
    assert 삽화.r2_key is None


async def test_저장에_실패해도_fallback_이다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """그림은 만들었는데 R2 가 안 받은 경우. **행을 `pending` 으로 두면 프론트가 15초를
    헛돌고, 그 15초는 아이가 화면 앞에서 기다리는 시간이다.**"""

    async def _생성(card_id: str, tier: str) -> 생성결과:
        return 생성결과(image=b"\x89PNG", mime="image/png")

    async def _못올림(artwork_id: str, image: bytes, mime: str) -> None:
        return None

    monkeypatch.setattr(artwork_store, "생성", _생성)
    monkeypatch.setattr(artwork_store, "올리기", _못올림)

    _보내기(client)

    (삽화,) = await _삽화들()
    assert 삽화.status == "ready"
    assert 삽화.fallback is True


async def test_굽다_터져도_아이_요청은_안_죽는다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """**아이는 이미 응답을 받았다.** 뒤에서 터진 것이 그 응답을 되돌리면 안 되고,
    행이 `pending` 에 갇히지도 않아야 한다."""

    async def _터진다(card_id: str, tier: str) -> 생성결과:
        raise RuntimeError("프로바이더가 죽었다")

    monkeypatch.setattr(artwork_store, "생성", _터진다)

    몸 = _보내기(client)

    assert 몸["outcome"] == "result"
    (삽화,) = await _삽화들()
    assert 삽화.status == "ready"
    assert 삽화.fallback is True


async def test_굽기가_없는_행을_봐도_안_터진다(monkeypatch: pytest.MonkeyPatch):
    """행이 지워진 뒤에 백그라운드가 도는 경우 — 자녀 삭제(E-4)와 겹치면 실제로 난다.

    **생성을 갈아끼운다.** 안 끼우면 이 테스트가 실제로 이미지를 굽는다 — 네트워크를
    타고 돈이 나간다.
    """

    async def _생성(card_id: str, tier: str) -> 생성결과:
        return 생성결과(사유="unconfigured")

    monkeypatch.setattr(artwork_store, "생성", _생성)

    await artwork_store.굽기(uuid.uuid4(), "c01", "rare")
