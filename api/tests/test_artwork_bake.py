"""삽화 행이 **어떻게 확정되는가** (B-3 ① · W5 7번).

**2026-09-09 에 뒤집혔다.** 신규 생성을 하지 않기로 확정되면서
(`주차계획/W5.md` 「삽화 — 기존 것 재사용 + 티어 폴백」) **`POST /attempts` 가
더는 굽지 않는다.** 아이 요청에서 나가던 유료 호출이 여기서 끊긴다.

여기서 지키는 것은 넷이다.

1. **응답의 `artwork_id` 가 실제 행이다** — 픽스처였을 때는 폴링이 남의 것을 물었다
2. **아이 요청은 무슨 일이 있어도 굽지 않는다.** 캐시가 비어도 **`ready` + `fallback`**
   이지, `pending` 을 만들고 뒤에서 굽지 않는다 — **파일럿 중에 아이 손에서 유료
   호출이 나가는 자리가 거기였다**
3. **`pending` 이 안 나온다** (`Stage0.md` 5절, 2026-09-09 계약 주석)
4. **`굽기()` 자체는 살아 있고 여전히 `ready` 로 수렴한다** — Stage 1 에서 되살아난다.
   **지금은 아무 데서도 안 불린다**
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import artwork_store, db, storage
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


@pytest.fixture(autouse=True)
def _보관함(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """저장소 루트의 `.artworks` 를 안 건드린다. **비어 있는 것이 이 파일의 기본값이다** —
    캐시가 비었을 때 굽지 않는 것이 여기서 재는 것이라서다."""
    monkeypatch.setattr(storage, "로컬보관함", tmp_path / "보관함")


@pytest.fixture(autouse=True)
def 구우면_터진다(monkeypatch: pytest.MonkeyPatch) -> None:
    """**아이 요청 경로에서 생성이 불리면 그 자리에서 실패시킨다.**

    이것을 픽스처로 둔 이유가 있다 — 안 두면 이 파일의 모든 테스트가 **실제로
    이미지를 굽는다.** 네트워크를 타고 돈이 나가고, **초록으로 지나간다.**
    굽기 자체를 보는 테스트는 이 위에 자기 것을 덧끼운다.
    """

    async def _굽지마라(card_id: str, tier: str) -> 생성결과:
        raise AssertionError("아이 요청에서 삽화를 구웠다")

    monkeypatch.setattr(artwork_store, "생성", _굽지마라)


def _보내기(client: TestClient, **덧붙임) -> dict:
    return client.post("/api/v1/attempts", json={"card_id": "c01", "text": 문장} | 덧붙임).json()


async def _삽화들() -> list[Artwork]:
    async with db.SessionLocal() as session:
        return list(await session.scalars(select(Artwork)))


# ── 행이 생긴다 ──────────────────────────────────────────


async def test_결과에_ready_삽화가_붙는다(client: TestClient, 자녀행: Child):
    """**캐시가 비어도 즉시 `ready` 다.** 종전에는 여기가 `pending` 이었고, 그
    `pending` 이 곧 백그라운드 생성이었다."""
    몸 = _보내기(client)

    (삽화,) = await _삽화들()
    assert 몸["artwork"]["artwork_id"] == str(삽화.id)
    assert 몸["artwork"]["status"] == "ready"
    assert 삽화.status == "ready"
    # **티어는 이 시도의 티어다.** 다른 값이면 아이가 쓴 것과 받는 그림이 어긋난다.
    assert 삽화.tier == "rare"


async def test_삽화가_그_시도에_달린다(client: TestClient, 자녀행: Child):
    """`card_attempt_id` 가 이 아이의 이번 시도를 가리켜야 「내 책」이 페이지를 만든다."""
    _보내기(client)

    (삽화,) = await _삽화들()
    async with db.SessionLocal() as session:
        (시도,) = list(await session.scalars(select(CardAttempt)))
    assert 삽화.card_attempt_id == 시도.id


async def test_되묻기와_차단에는_삽화가_안_붙는다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """카드를 안 썼으면 그림도 없다. **시도 행이 없으니 달 자리도 없다.**"""

    async def _막힘(text: str) -> 검사결과:
        return 검사결과(blocked=True, category="violence")

    monkeypatch.setattr(attempts, "검사하기", _막힘)

    _보내기(client)

    assert await _삽화들() == []


# ── 안 굽는다 ────────────────────────────────────────────


async def test_캐시가_비면_굽지_않고_기본_에셋으로_간다(client: TestClient):
    """**이것이 이 항목의 전부다** (W5 7번 ②).

    종전에는 캐시 미스에서 행을 `pending` 으로 만들고 **서버가 그 자리에서 구웠다.**
    파일럿에는 `basic`·`rare` 파일이 아예 없어서, 그대로 두면 **아이가 카드를 쓸
    때마다 유료 호출이 나간다.** 위 `구우면_터진다` 가 그것을 잡는다.
    """
    몸 = _보내기(client)

    assert 몸["artwork"]["status"] == "ready"
    (삽화,) = await _삽화들()
    assert 삽화.status == "ready"
    assert 삽화.r2_key is None
    assert 삽화.fallback is True
    assert 삽화.ready_at is not None


async def test_이미_있는_조합이면_그것을_가리킨다(client: TestClient):
    """캐시 히트는 **폴백이 아니다** — 요청한 티어 그대로다."""
    키 = storage.조합키("c01", "rare", "image/png")
    assert 키 is not None
    await storage.올리기(키, b"\x89PNG", "image/png")

    _보내기(client)

    (삽화,) = await _삽화들()
    assert 삽화.r2_key == 키
    assert 삽화.fallback is False


# ── `굽기()` 는 살아 있다 (Stage 1) ──────────────────────


async def _행하나(client: TestClient) -> Artwork:
    """굽기를 직접 걸 행 하나. **아이 요청은 이제 이 행을 굽지 않는다.**"""
    _보내기(client)
    (삽화,) = await _삽화들()
    return 삽화


async def test_구우면_ready_에_키가_박힌다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    삽화 = await _행하나(client)

    async def _생성(card_id: str, tier: str) -> 생성결과:
        return 생성결과(image=b"\x89PNG", mime="image/png")

    async def _올리기(오브젝트키: str, image: bytes, mime: str) -> str:
        return "artworks/그림.png"

    monkeypatch.setattr(artwork_store, "생성", _생성)
    monkeypatch.setattr(artwork_store, "올리기", _올리기)

    await artwork_store.굽기(삽화.id, "c01", "rare")

    (다시,) = await _삽화들()
    assert 다시.status == "ready"
    assert 다시.r2_key == "artworks/그림.png"
    assert 다시.fallback is False
    assert 다시.ready_at is not None


async def test_못_구우면_ready_에_fallback_이다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """**`failed` 는 계약에 없다** (`Stage0.md` 5절). 모든 실패가 `ready` 로 수렴하고,
    그림 자리는 프록시가 기본 에셋으로 메운다."""
    삽화 = await _행하나(client)

    async def _못만듦(card_id: str, tier: str) -> 생성결과:
        return 생성결과(사유="timeout")

    monkeypatch.setattr(artwork_store, "생성", _못만듦)

    await artwork_store.굽기(삽화.id, "c01", "rare")

    (다시,) = await _삽화들()
    assert 다시.status == "ready"
    assert 다시.fallback is True
    assert 다시.r2_key is None


async def test_저장에_실패해도_fallback_이다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """그림은 만들었는데 R2 가 안 받은 경우. **행을 `pending` 으로 두면 프론트가 15초를
    헛돌고, 그 15초는 아이가 화면 앞에서 기다리는 시간이다.**"""
    삽화 = await _행하나(client)

    async def _생성(card_id: str, tier: str) -> 생성결과:
        return 생성결과(image=b"\x89PNG", mime="image/png")

    async def _못올림(오브젝트키: str, image: bytes, mime: str) -> None:
        return None

    monkeypatch.setattr(artwork_store, "생성", _생성)
    monkeypatch.setattr(artwork_store, "올리기", _못올림)

    await artwork_store.굽기(삽화.id, "c01", "rare")

    (다시,) = await _삽화들()
    assert 다시.status == "ready"
    assert 다시.fallback is True


async def test_굽다_터져도_행은_ready_로_수렴한다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """**행이 `pending` 에 갇히지 않는다.** Stage 1 에서 이 경로가 되살아날 때
    그대로 서 있어야 하는 성질이다."""
    삽화 = await _행하나(client)

    async def _터진다(card_id: str, tier: str) -> 생성결과:
        raise RuntimeError("프로바이더가 죽었다")

    monkeypatch.setattr(artwork_store, "생성", _터진다)

    await artwork_store.굽기(삽화.id, "c01", "rare")

    (다시,) = await _삽화들()
    assert 다시.status == "ready"
    assert 다시.fallback is True


async def test_굽기가_없는_행을_봐도_안_터진다(monkeypatch: pytest.MonkeyPatch):
    """행이 지워진 뒤에 백그라운드가 도는 경우 — 자녀 삭제(E-4)와 겹치면 실제로 난다.

    **생성을 갈아끼운다.** 안 끼우면 이 테스트가 실제로 이미지를 굽는다 — 네트워크를
    타고 돈이 나간다.
    """

    async def _생성(card_id: str, tier: str) -> 생성결과:
        return 생성결과(사유="unconfigured")

    monkeypatch.setattr(artwork_store, "생성", _생성)

    await artwork_store.굽기(uuid.uuid4(), "c01", "rare")
