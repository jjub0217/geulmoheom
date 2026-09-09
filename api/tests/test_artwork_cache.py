"""**어느 파일을 가리키나** — 조합 캐시와 티어 폴백 (W5 7번 ①·② · `주차계획/W5.md`).

**조합은 20 카드 x 3 티어 = 60가지로 유한하다** — Stage 0 삽화에 아이 입력이 안
들어가기 때문이다(PRD B-5). 그래서 카드+티어 하나에 파일 하나로 정해 두고 **찾아
가리킬 수 있다.**

**2026-09-09 에 이 파일이 재는 것이 바뀌었다.** 종전에는 「같은 조합을 두 번 굽지
않는다」였는데, **신규 생성을 아예 안 하기로 확정되면서** 「**찾은 것을 가리키고,
못 찾으면 같은 카드의 `legendary` 로 떨어지고, 그것도 없으면 기본 에셋으로 간다**」가
됐다. **굽는 갈래가 사라졌다** — 굽지 않는 것 자체는 `test_artwork_bake.py` 가 잰다.
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
    """**`찾기` 가 캐시 히트를 가른다.** 미리 넣어 둔 파일도 이 길로 걸린다 —
    DB 행 없이 파일만 있어도 찾아야 한다."""
    assert await storage.조합찾기("c01", "basic") is None

    키 = storage.조합키("c01", "basic", "image/png")
    await storage.올리기(키, b"\x89PNG", "image/png")

    찾은 = await storage.조합찾기("c01", "basic")
    assert 찾은 is not None
    assert 찾은.키 == 키
    # **요청한 티어 그대로다** — 폴백이 아니다.
    assert 찾은.티어폴백 is False


# ── 티어 폴백 (W5 7번 ①) ─────────────────────────────────
#
# **`basic`·`rare` 는 한 장도 없다.** 갖고 있는 것은 `legendary` 18장뿐이고
# (`docs/삽화_legendary_선정.md`) **신규 생성을 하지 않는다.** 그래서 요청 티어가
# 비면 **같은 카드의 `legendary`** 로 떨어진다 — 티어가 바꾸는 것은 접미어(밀도)뿐이라
# 장면은 같다.


async def _legendary를_넣는다(card_id: str) -> str:
    키 = storage.조합키(card_id, "legendary", "image/jpeg")
    assert 키 is not None
    await storage.올리기(키, b"\xff\xd8\xff", "image/jpeg")
    return 키


async def test_요청한_티어가_없으면_같은_카드의_legendary_로_떨어진다():
    """**키가 `_조각(card_id, tier)` 라 티어마다 다르다.** `basic` 키를 못 찾았다고
    해서 `legendary` 파일이 저절로 걸리지 않는다 — 키를 새로 계산해야 한다."""
    키 = await _legendary를_넣는다("c01")

    찾은 = await storage.조합찾기("c01", "basic")

    assert 찾은 is not None
    assert 찾은.키 == 키


async def test_legendary_로_떨어진_것은_폴백으로_표시된다():
    """**계약이 그렇게 못 박혔다** — 티어 폴백도 `fallback = true` 다
    (`주차계획/W5.md` 「삽화」). 아이에게는 안 알리고 **우리 눈금으로만** 남는다."""
    await _legendary를_넣는다("c01")

    찾은 = await storage.조합찾기("c01", "rare")

    assert 찾은 is not None
    assert 찾은.티어폴백 is True


async def test_다른_카드의_legendary_로는_안_떨어진다():
    """**장면이 달라진다.** 아이가 쓴 카드와 다른 그림이 나오면 그건 폴백이 아니라
    엉뚱한 그림이다."""
    await _legendary를_넣는다("c01")

    assert await storage.조합찾기("c02", "basic") is None


async def test_legendary_요청은_폴백할_곳이_없다():
    """자기 자신으로 두 번 찾지 않는다 — 없으면 없는 것이고, 기본 에셋으로 간다."""
    assert await storage.조합찾기("c01", "legendary") is None


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


async def test_티어가_비면_legendary_를_주고_fallback_이_참이다(
    client: TestClient, 판정_고정, monkeypatch: pytest.MonkeyPatch
):
    """**아이 화면은 안 갈린다** — 주소도 `/artworks/{id}/image` 하나 그대로고
    `status` 도 `ready` 다. 갈리는 것은 `fallback` 뿐이고 그건 아이에게 안 나간다."""
    키 = storage.조합키("c01", "legendary", "image/jpeg")
    assert 키 is not None
    await storage.올리기(키, b"\xff\xd8\xff", "image/jpeg")

    몸 = client.post("/api/v1/attempts", json={"card_id": "c01", "text": 문장}).json()

    assert 몸["artwork"]["status"] == "ready"
    (삽화,) = await _삽화들()
    # 이 시도의 티어는 `rare` 인데 파일은 `legendary` 다.
    assert 삽화.tier == "rare"
    assert 삽화.r2_key == 키
    assert 삽화.fallback is True


async def test_c10_c12_처럼_아무_파일도_없으면_기본_에셋이다(
    client: TestClient, 판정_고정, monkeypatch: pytest.MonkeyPatch
):
    """**두 카드가 실제로 이 자리다** — `c10`·`c12` 는 쓸 수 있는 판이 없어
    `legendary` 도 없다(`docs/삽화_legendary_선정.md`). **그 6조합은 파일럿 내내
    기본 에셋으로 나간다.** 그래도 `status` 는 `ready` 이고 아이 화면은 안 멈춘다.
    """
    불렸다: list[str] = []

    async def _생성(card_id: str, tier: str):
        불렸다.append(card_id)
        raise AssertionError("파일이 없다고 구웠다")

    monkeypatch.setattr(artwork_store, "생성", _생성)

    몸 = client.post("/api/v1/attempts", json={"card_id": "c10", "text": 문장}).json()

    assert 몸["artwork"]["status"] == "ready"
    (삽화,) = await _삽화들()
    assert 삽화.r2_key is None
    assert 삽화.fallback is True
    assert not 불렸다
