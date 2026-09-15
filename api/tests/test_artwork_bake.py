"""삽화 행이 **어떻게 확정되는가** (B-3 ① · W5 7번 · `adr/0015`).

**두 번 뒤집혔다.**

1. **2026-09-09** — 신규 생성을 안 하기로 하면서 `POST /attempts` 가 **더는 굽지 않게** 됐다.
   아이 요청에서 나가던 유료 호출이 거기서 끊겼다 (`주차계획/W5.md` 「삽화」)
2. **2026-09-15** — **아이 문장으로 그리기로 하면서 되살아났다** (`adr/0015` ②, 대표 판정).
   **아이 셋이 「내가 쓴 거랑 그림이 좀 다른데?」라고 스스로 말한 것**이 근거다

**그래서 이 파일이 재는 것이 바뀌었다 — 「굽지 않는다」가 아니라 「천장이 있다」다.**

1. **응답의 `artwork_id` 가 실제 행이다** — 픽스처였을 때는 폴링이 남의 것을 물었다
2. **⭐ 카드 하나에 최대 3회다** — 첫 장 1회 + 등급이 오를 때마다 1회(`basic→rare→legendary`).
   **같은 등급으로 다시 쓰면 안 굽는다.** 하루 카드가 5장이니 **아이 한 명 하루 15회 ·
   $0.50 이 천장**이다. **이 천장이 깨지면 W5 가 닫은 그 구멍이 다시 열린다**
3. **가린 문장이 간다** — 원문이 아니다. 안 그러면 **가린 것이 그림으로 되돌아온다**
4. **구운 것은 시도 키에 올라간다** — 조합 키에 덮으면 **한 아이의 그림이 다른 아이에게 나간다**
5. **어떤 길로 끝나든 행은 `ready` 로 수렴한다** — `failed` 는 계약에 없다
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
def 등급(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """**티어를 테스트가 정한다.** 기본은 `G2`(=`rare`) 이고, 등급이 오르는 재시도를
    재는 검사가 이 목록을 바꾼다 — 천장이 거기서 갈린다."""
    지금 = ["G2"]

    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade=지금[0], signals=["adj:은빛"])

    async def _통과(text: str) -> 검사결과:
        return 검사결과(blocked=False)

    async def _안됨(자녀id: str, card_id: str, **_) -> int:
        return 0

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _통과)
    monkeypatch.setattr(attempts, "되묻은횟수", _안됨)
    return 지금


@pytest.fixture(autouse=True)
def _보관함(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """저장소 루트의 `.artworks` 를 안 건드린다. **비어 있는 것이 이 파일의 기본값이다** —
    캐시가 비었을 때 굽지 않는 것이 여기서 재는 것이라서다."""
    monkeypatch.setattr(storage, "로컬보관함", tmp_path / "보관함")


@pytest.fixture(autouse=True)
def 구운것(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, str | None]]:
    """**생성 호출을 갈아끼우고 센다.** 안 갈아끼우면 이 파일의 모든 테스트가 **실제로
    이미지를 굽는다** — 네트워크를 타고 돈이 나가고, **초록으로 지나간다.**

    **종전에는 이 자리가 「불리면 터뜨린다」였다** (2026-09-09~2026-09-15). 이제는
    **불리는 것이 정상이고 「몇 번 불렸나」가 재는 것**이다 — `adr/0015` ② 의 천장이
    바로 그 수다.

    **⚠ 터뜨리는 것으로는 못 센다** (2026-09-10, 축 ⑱). 부르는 쪽 `굽기()` 가
    `except Exception` 으로 **`AssertionError` 까지 삼키고 로그만 남긴다** — 그래서
    **감시가 대상에게 삼켜진다.** 목록은 안 삼켜진다.
    """
    불린것: list[tuple[str, str, str | None]] = []

    async def _센다(card_id: str, tier: str, 아이문장: str | None = None) -> 생성결과:
        불린것.append((card_id, tier, 아이문장))
        return 생성결과(image=b"\x89PNG", mime="image/png")

    monkeypatch.setattr(artwork_store, "생성", _센다)
    return 불린것


def _보내기(client: TestClient, **덧붙임) -> dict:
    return client.post("/api/v1/attempts", json={"card_id": "c01", "text": 문장} | 덧붙임).json()


async def _그대로(키: str) -> str:
    return 키


async def _삽화들() -> list[Artwork]:
    async with db.SessionLocal() as session:
        return list(await session.scalars(select(Artwork)))


# ── 행이 생긴다 ──────────────────────────────────────────


async def test_결과에_ready_삽화가_붙는다(client: TestClient, 자녀행: Child):
    """**아이 문장으로 굽기 때문에 `pending` 으로 나간다** (`adr/0015` ②).
    2026-09-09~09-15 에는 여기가 즉시 `ready` 였다 — 그때는 깔아 둔 파일을 가리키기만 했다.

    **프론트는 이 값을 보고 폴링한다** (3초/2초/15초, `web/src/lib/artwork.ts`).
    `ready` 로 박아 두면 **아직 없는 그림을 한 번 물어보고 끝낸다.**
    """
    몸 = _보내기(client)

    (삽화,) = await _삽화들()
    assert 몸["artwork"]["artwork_id"] == str(삽화.id)
    assert 몸["artwork"]["status"] == "pending"
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


# ── 굽는다 · 그리고 천장이 있다 (`adr/0015` ②) ──────────


async def test_첫_장은_아이_문장으로_굽는다(client: TestClient, 구운것):
    """**이 결정의 전부다.** 프롬프트에 아이 문장이 없어서 그림에 들어가는 것이
    「무엇을 했는가」가 아니라 **「얼마나 잘 썼는가」뿐**이었다 — 아이 셋이 그것을
    스스로 찾아냈다 (`프리테스트_결과_2026-09-14.md` 1장).
    """
    _보내기(client)

    assert 구운것 == [("c01", "rare", 문장)]
    (삽화,) = await _삽화들()
    assert 삽화.r2_key == storage.시도키(삽화.id, "image/png")
    assert 삽화.fallback is False


async def test_가린_문장이_간다(client: TestClient, 구운것):
    """**원문이 아니라 가린 것이다** (`adr/0015` ②). 전화번호·메일·주소·학교명은
    프로바이더로 나가기 전에 가리는데, **이미지 프롬프트에 원문을 넣으면 가린 것이
    그림으로 되돌아온다.**
    """
    번호가든문장 = "010-1234-5678 이라고 적힌 쪽지를 바위 밑에 숨긴다"

    _보내기(client, text=번호가든문장)

    (_, _, 간것) = 구운것[0]
    assert "010-1234-5678" not in 간것
    assert "바위 밑에 숨긴다" in 간것


async def test_같은_등급으로_다시_쓰면_안_굽는다(client: TestClient, 구운것):
    """**⭐ 천장이 여기서 선다** (`adr/0015` ②). 재시도는 **일일 상한 밖**이고
    (`attempts.py` — `retry_of` 가 있으면 상한을 안 본다) **H2 는 재시도율을 올리려
    한다**(합격선 20%). 등급이 같은데도 구우면 **제품이 권하는 행동이 곧 과금 행동**이
    되고, **아이 한 명의 하루 비용에 천장이 없어진다.**

    **책이 같은 규칙이다** — 「최고 티어 1건」이라 같은 등급이면 페이지도 안 바뀐다.
    그림만 바뀌면 **책에 안 실릴 그림에 돈을 쓰는 것**이 된다.
    """
    첫 = _보내기(client)

    _보내기(client, retry_of=첫["attempt_id"])

    assert len(구운것) == 1


async def test_등급이_오르면_다시_굽는다(client: TestClient, 구운것, 등급):
    """**책이 바뀌는 자리와 같다** — 티어가 오르면 페이지가 교체되고, 그 페이지에
    실릴 그림이라 다시 굽는다."""
    등급[0] = "G1"
    첫 = _보내기(client)

    등급[0] = "G3"
    _보내기(client, retry_of=첫["attempt_id"])

    assert [(c, t) for c, t, _ in 구운것] == [("c01", "basic"), ("c01", "legendary")]


async def test_카드_하나에_최대_세_번이다(client: TestClient, 구운것, 등급):
    """**천장의 실제 수** — 첫 장 1회 + `basic→rare` + `rare→legendary`.
    **하루 카드가 5장이니 아이 한 명 하루 15회 · 약 $0.50 이 최악**이다.

    **이 수가 대표 판정의 근거다** (`adr/0015` ②). 규칙이 바뀌어 수가 달라지면
    **판정이 근거를 잃는다** — 그래서 수를 검사에 박아 둔다.
    """
    등급[0] = "G1"
    시도 = _보내기(client)

    for 등급값 in ("G1", "G2", "G2", "G3", "G3"):
        등급[0] = 등급값
        시도 = _보내기(client, retry_of=시도["attempt_id"])

    assert len(구운것) == 3


async def test_이미_있는_조합이어도_아이_문장으로_굽는다(client: TestClient, 구운것):
    """**깔아 둔 파일은 이제 폴백 전용이다** (`adr/0015` ②). 그것을 그대로 주면
    **아이가 쓴 것과 다른 그림**이고, 그게 이 결정이 고치려던 바로 그 어긋남이다.
    """
    키 = storage.조합키("c01", "rare", "image/png")
    await storage.올리기(키, b"\x89PNG", "image/png")

    _보내기(client)

    assert len(구운것) == 1
    (삽화,) = await _삽화들()
    assert 삽화.r2_key != 키


# ── `굽기()` 는 살아 있다 (Stage 1) ──────────────────────


async def _행하나(client: TestClient) -> Artwork:
    """굽기를 직접 걸 행 하나. **아이 요청은 이제 이 행을 굽지 않는다.**"""
    _보내기(client)
    (삽화,) = await _삽화들()
    return 삽화


async def test_구우면_ready_에_키가_박힌다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    삽화 = await _행하나(client)

    async def _생성(card_id: str, tier: str, 아이문장: str | None = None) -> 생성결과:
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

    async def _못만듦(card_id: str, tier: str, 아이문장: str | None = None) -> 생성결과:
        return 생성결과(사유="timeout")

    monkeypatch.setattr(artwork_store, "생성", _못만듦)

    await artwork_store.굽기(삽화.id, "c01", "rare")

    (다시,) = await _삽화들()
    assert 다시.status == "ready"
    assert 다시.fallback is True
    assert 다시.r2_key is None


async def test_저장에_실패해도_fallback_이다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """그림은 만들었는데 저장소가 안 받은 경우. **행을 `pending` 으로 두면 프론트가 15초를
    헛돌고, 그 15초는 아이가 화면 앞에서 기다리는 시간이다.**"""
    삽화 = await _행하나(client)

    async def _생성(card_id: str, tier: str, 아이문장: str | None = None) -> 생성결과:
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

    async def _터진다(card_id: str, tier: str, 아이문장: str | None = None) -> 생성결과:
        raise RuntimeError("프로바이더가 죽었다")

    monkeypatch.setattr(artwork_store, "생성", _터진다)

    await artwork_store.굽기(삽화.id, "c01", "rare")

    (다시,) = await _삽화들()
    assert 다시.status == "ready"
    assert 다시.fallback is True


async def test_구운_것은_시도_키에_올라간다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """**조합 키에 올리면 한 아이의 그림이 다른 아이에게 나간다** (`adr/0015` ②).

    조합 키는 카드+티어 하나에 파일 하나라 **여러 아이가 같이 본다.** 아이 문장으로
    구운 그림을 거기 덮으면 다음 아이가 같은 카드를 썼을 때 **남의 문장으로 그려진
    그림**을 캐시 히트로 받고, **깔아 둔 `legendary` 18장도 덮인다.**
    """
    삽화 = await _행하나(client)
    올린키 = []

    async def _생성(card_id: str, tier: str, 아이문장: str | None = None) -> 생성결과:
        return 생성결과(image=b"\x89PNG", mime="image/png")

    async def _올리기(오브젝트키: str, image: bytes, mime: str) -> str:
        올린키.append(오브젝트키)
        return 오브젝트키

    monkeypatch.setattr(artwork_store, "생성", _생성)
    monkeypatch.setattr(artwork_store, "올리기", _올리기)

    await artwork_store.굽기(삽화.id, "c01", "rare", 문장)

    assert 올린키 == [storage.시도키(삽화.id, "image/png")]
    assert 올린키[0] != storage.조합키("c01", "rare", "image/png")


async def test_굽기가_아이_문장을_생성에_넘긴다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """**여기서 끊기면 프롬프트·생성만 고친 것이 된다** — 행을 만드는 쪽이 문장을
    안 넘기면 아이가 받는 그림은 그대로 어긋난다."""
    삽화 = await _행하나(client)
    받은문장 = []

    async def _생성(card_id: str, tier: str, 아이문장: str | None = None) -> 생성결과:
        받은문장.append(아이문장)
        return 생성결과(image=b"\x89PNG", mime="image/png")

    monkeypatch.setattr(artwork_store, "생성", _생성)
    monkeypatch.setattr(artwork_store, "올리기", lambda 키, i, m: _그대로(키))

    await artwork_store.굽기(삽화.id, "c01", "rare", 문장)

    assert 받은문장 == [문장]


async def test_못_구우면_깔아_둔_조합_파일로_떨어진다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """**기본 에셋보다 조합 파일이 낫다.** 미리 깔아 둔 `legendary` 18장이 있는데
    굽기 실패에서 그것을 안 보면 **아이가 오늘보다 나쁜 그림을 받는다** — 회색 액자
    한 장으로 떨어지는 셈이다.

    **`fallback` 은 `True` 다.** 아이 문장으로 그린 것이 아니라서다 — 아이에게는
    안 알리고 우리 눈금에만 남는다 (`주차계획/W5.md` 「삽화」).
    """
    삽화 = await _행하나(client)
    조합 = storage.조합키("c01", "rare", "image/png")
    await storage.올리기(조합, b"\x89PNG", "image/png")

    async def _못만듦(card_id: str, tier: str, 아이문장: str | None = None) -> 생성결과:
        return 생성결과(사유="timeout")

    monkeypatch.setattr(artwork_store, "생성", _못만듦)

    await artwork_store.굽기(삽화.id, "c01", "rare", 문장)

    (다시,) = await _삽화들()
    assert 다시.status == "ready"
    assert 다시.r2_key == 조합
    assert 다시.fallback is True


async def test_굽기가_없는_행을_봐도_안_터진다(monkeypatch: pytest.MonkeyPatch):
    """행이 지워진 뒤에 백그라운드가 도는 경우 — 자녀 삭제(E-4)와 겹치면 실제로 난다.

    **생성을 갈아끼운다.** 안 끼우면 이 테스트가 실제로 이미지를 굽는다 — 네트워크를
    타고 돈이 나간다.
    """

    async def _생성(card_id: str, tier: str, 아이문장: str | None = None) -> 생성결과:
        return 생성결과(사유="unconfigured")

    monkeypatch.setattr(artwork_store, "생성", _생성)

    await artwork_store.굽기(uuid.uuid4(), "c01", "rare")
