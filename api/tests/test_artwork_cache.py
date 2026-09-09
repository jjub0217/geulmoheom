"""같은 조합은 한 번만 굽는다 (W5 7번 ① · `주차계획/W5.md`).

**조합은 20 카드 x 3 티어 = 60가지로 유한하다** — Stage 0 삽화에 아이 입력이 안
들어가기 때문이다(PRD B-5). 지금은 **시도마다 새로 굽고**, 그러면 아이 50명이 9일
쓰면 약 6만 원이다. 조합당 한 번이면 **약 2,800원**이다.

**저장 계층이 먼저다** — 미리 60장을 뽑든 처음 나올 때 굽든, **가리킬 자리**가 있어야
둘 다 성립한다.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import artwork_store, db, storage
from app.api.v1 import attempts
from app.evaluator import 평가결과
from app.models import Artwork
from app.moderation import 검사결과


@pytest.fixture(autouse=True)
def _보관함(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """저장소 루트의 `.artworks` 를 안 건드린다."""
    monkeypatch.setattr(storage, "로컬보관함", tmp_path / "보관함")


async def test_같은_조합은_같은_키다():
    """**결정론적이어야 캐시가 성립한다.** 난수가 들어가면 매번 못 찾는다."""
    첫 = storage.조합키("c01", "basic", "image/png")

    assert 첫 == storage.조합키("c01", "basic", "image/png")


async def test_카드나_티어가_다르면_다른_키다():
    키들 = {
        storage.조합키("c01", "basic", "image/png"),
        storage.조합키("c01", "rare", "image/png"),
        storage.조합키("c02", "basic", "image/png"),
    }

    assert len(키들) == 3


async def test_조합_키는_추측할_수_없다():
    """**`artwork_id` 에 난수를 붙이던 이유가 그대로 산다** (`storage.py` 옛 `키()`).
    카드 id 와 티어는 사실상 공개값이라, 그것만으로 키가 되면 **조합을 아는 사람이 곧
    그림을 볼 수 있는 사람**이 된다. 지금은 비공개 버킷 + 프록시라 닿지 않지만,
    **정책이 정해질 때까지의 기본값은 닫는 쪽이다.**
    """
    키 = storage.조합키("c01", "basic", "image/png")

    assert 키 is not None
    assert "c01_basic.png" not in 키


async def test_모르는_형식은_키를_안_만든다():
    assert storage.조합키("c01", "basic", "image/heic") is None


async def test_올린_뒤에는_조합으로_찾는다():
    """**`찾기` 가 캐시 히트를 가른다.** 미리 뽑아 둔 60장도 이 길로 걸린다 —
    DB 행 없이 파일만 있어도 찾아야 한다."""
    assert await storage.조합찾기("c01", "basic") is None

    키 = storage.조합키("c01", "basic", "image/png")
    await storage.올리기(키, b"\x89PNG", "image/png")

    assert await storage.조합찾기("c01", "basic") == 키
    assert await storage.조합찾기("c01", "rare") is None


# ── 라우트까지 — 이미 있으면 안 굽는다 ──────────────────

문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


@pytest.fixture
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


async def _삽화들() -> list[Artwork]:
    async with db.SessionLocal() as session:
        return list(await session.scalars(select(Artwork)))


async def test_이미_구워진_조합이면_즉시_ready_이고_안_굽는다(
    client: TestClient, 판정_고정, monkeypatch: pytest.MonkeyPatch
):
    """**이것이 이 항목의 전부다.** 지금은 시도마다 새로 굽고, 그래서 같은 조합을
    100명이 만나면 100번 생성된다 — 아이 50명 x 9일이면 약 6만 원이다."""
    키 = storage.조합키("c01", "rare", "image/png")
    await storage.올리기(키, b"\x89PNG", "image/png")

    불렸다: list[str] = []

    async def _생성(card_id: str, tier: str):
        불렸다.append(card_id)
        raise AssertionError("이미 있는 조합인데 구웠다")

    monkeypatch.setattr(artwork_store, "생성", _생성)

    몸 = client.post("/api/v1/attempts", json={"card_id": "c01", "text": 문장}).json()

    assert 몸["artwork"]["status"] == "ready"
    (삽화,) = await _삽화들()
    assert 삽화.status == "ready"
    assert 삽화.r2_key == 키
    assert 삽화.fallback is False
    assert not 불렸다


async def test_없는_조합이면_지금처럼_pending_이다(
    client: TestClient, 판정_고정, monkeypatch: pytest.MonkeyPatch
):
    """**계약은 안 바뀐다.** 캐시가 비었을 때의 길이 오늘과 같아야 한다."""

    async def _아무것도(*_, **__) -> None:
        return None

    monkeypatch.setattr(attempts, "굽기", _아무것도)

    몸 = client.post("/api/v1/attempts", json={"card_id": "c01", "text": 문장}).json()

    assert 몸["artwork"]["status"] == "pending"
