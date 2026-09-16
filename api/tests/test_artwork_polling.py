"""삽화 폴링이 **실제 DB 상태**를 준다 (B-3 ②).

프론트는 `POST /attempts` 뒤 3초부터 2초 간격으로 여기를 두드린다 (`Stage0.md` 5절).
목이던 동안에는 **무엇을 물어도 `ready`** 였다 — 폴링이 도는지조차 확인할 수 없었다.

여기서 지키는 것은 셋이다.

1. **행이 말하는 그대로 준다** — `status`·`tier`·`fallback`
2. **60초를 넘긴 `pending` 은 `ready` + `fallback` 으로 확정한다** (`Stage0.md` 5절).
   확정하지 않으면 굽기가 죽은 행이 **영영 `pending`** 이고, 그 카드는 「내 책」에도 안 선다.
   **⛔ 종전 15초는 결함이었다** — 프론트 폴링 상한과 생성 호출 상한과 **같은 값**이라
   **확정이 굽기를 앞질렀다.** 2026-09-15 운영에서 `+15.66초` 에 났다 (`W6.md` 27번)
3. **남의 삽화는 404 다** — 403 이면 「그 삽화는 존재한다」가 샌다
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import artwork, artwork_store, db
from app.accounts import 비밀번호해시, 접속코드만들기
from app.models import Artwork, CardAttempt, Child, Parent


async def _삽화를_넣는다(
    child_id: uuid.UUID,
    *,
    status: str = "pending",
    r2_key: str | None = None,
    fallback: bool = False,
    만든때: datetime | None = None,
) -> Artwork:
    async with db.SessionLocal() as session:
        시도 = CardAttempt(
            child_id=child_id,
            card_id="c01",
            attempt=1,
            grade="G2",
            tier="rare",
            char_len=10,
            text="은빛 검을 들었다",
        )
        session.add(시도)
        await session.flush()

        삽화 = Artwork(
            card_attempt_id=시도.id, tier="rare", status=status, r2_key=r2_key, fallback=fallback
        )
        if 만든때 is not None:
            삽화.created_at = 만든때
        session.add(삽화)
        await session.commit()
        await session.refresh(삽화)
        return 삽화


async def _다른아이() -> Child:
    async with db.SessionLocal() as session:
        학부모 = Parent(
            email=f"{uuid.uuid4().hex}@example.test",
            password_hash=비밀번호해시("x"),
            consent_at=datetime.now(UTC),
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


# ── 행이 말하는 그대로 ───────────────────────────────────


async def test_굽는_중이면_pending_이다(client: TestClient, 자녀행: Child):
    삽화 = await _삽화를_넣는다(자녀행.id)

    몸 = client.get(f"/api/v1/artworks/{삽화.id}").json()

    assert 몸["status"] == "pending"
    assert 몸["url"] is None
    assert 몸["tier"] == "rare"
    assert 몸["fallback"] is False


async def test_구워졌으면_ready_다(client: TestClient, 자녀행: Child):
    삽화 = await _삽화를_넣는다(자녀행.id, status="ready", r2_key="artworks/그림.png")

    몸 = client.get(f"/api/v1/artworks/{삽화.id}").json()

    assert 몸["status"] == "ready"
    assert 몸["fallback"] is False


async def test_기본_에셋으로_확정된_것도_ready_다(client: TestClient, 자녀행: Child):
    """**`failed` 는 계약에 없다.** 아이 쪽에서 보면 성공과 겉모양이 같아야 한다."""
    삽화 = await _삽화를_넣는다(자녀행.id, status="ready", fallback=True)

    몸 = client.get(f"/api/v1/artworks/{삽화.id}").json()

    assert 몸["status"] == "ready"
    assert 몸["fallback"] is True


# ── 확정 문턱 60초 ──────────────────────────────────────


def test_확정_문턱은_생성_상한보다_커야_한다():
    """**이것이 2026-09-15 에 깨진 불변식이다** (`W6.md` 27번).

    굽기는 생성 하나가 아니다 — **출력 검사 + 생성(≤`TIMEOUT_SECONDS`) + R2 업로드.**
    문턱이 생성 상한과 **같거나 작으면** 생성이 상한 가까이 걸릴 때 **확정이 이기고**,
    다 구워질 그림을 버리고 `fallback` 으로 굳혀 **책에 기본 에셋이 남는다.**

    **그래서 여기서 재는 것은 「60」이 아니라 「더 크다」다** — 생성 상한을 올리는 날
    이 검사가 빨개져야 한다.
    """
    assert artwork_store.확정문턱초 > artwork.TIMEOUT_SECONDS


async def test_60초를_넘긴_pending_은_ready_로_확정된다(client: TestClient, 자녀행: Child):
    """확정하지 않으면 굽기가 죽은 행이 영영 `pending` 이고, 그 카드는 「내 책」에도
    안 선다. **죽은 것과 아직 안 끝난 것을 가르는 자리다.**"""
    삽화 = await _삽화를_넣는다(자녀행.id, 만든때=datetime.now(UTC) - timedelta(seconds=70))

    몸 = client.get(f"/api/v1/artworks/{삽화.id}").json()

    assert 몸["status"] == "ready"
    assert 몸["fallback"] is True

    # **행에도 남는다** — 다음 폴링이나 「내 책」이 같은 값을 봐야 한다.
    async with db.SessionLocal() as session:
        (남은것,) = list(await session.scalars(select(Artwork)))
    assert 남은것.status == "ready"
    assert 남은것.fallback is True


async def test_아직_60초_안이면_기다린다(client: TestClient, 자녀행: Child):
    """평균이 6.2초다 (`benchmarks/W1-image-bench.md`). 일찍 확정하면 **다 구워진
    그림을 버리고 기본 에셋을 준다.**"""
    삽화 = await _삽화를_넣는다(자녀행.id, 만든때=datetime.now(UTC) - timedelta(seconds=5))

    몸 = client.get(f"/api/v1/artworks/{삽화.id}").json()

    assert 몸["status"] == "pending"


async def test_16초는_아직_기다린다_실제로_났던_자리다(client: TestClient, 자녀행: Child):
    """**2026-09-15 운영에서 `+15.66초` 폴링이 확정을 발동시켰다** (`W6.md` 27번).

    아이가 쓴 문장으로 굽는 중이었고, 확정이 먼저 굳혀 **기본 에셋이 책에 남았다.**
    **프론트는 15초에 폴링을 끊지만 서버는 안 굳힌다** — 아이가 보는 것과 책에 남는
    것은 다를 수 있고, **뒤엣것을 지키는 편이 낫다.**
    """
    삽화 = await _삽화를_넣는다(자녀행.id, 만든때=datetime.now(UTC) - timedelta(seconds=16))

    assert client.get(f"/api/v1/artworks/{삽화.id}").json()["status"] == "pending"


# ── 남의 것 ─────────────────────────────────────────────


async def test_남의_삽화는_404(client: TestClient):
    """**403 이 아니다** — 403 으로 가르면 「그 삽화는 존재한다」가 샌다
    (`Stage0.md` 5절 · `{child_id}` 규칙과 같은 자리)."""
    남 = await _다른아이()
    삽화 = await _삽화를_넣는다(남.id, status="ready", r2_key="artworks/남의그림.png")

    response = client.get(f"/api/v1/artworks/{삽화.id}")

    assert response.status_code == 404


async def test_없는_삽화도_404(client: TestClient):
    response = client.get(f"/api/v1/artworks/{uuid.uuid4()}")

    assert response.status_code == 404


@pytest.mark.parametrize("엉뚱한값", ["a1", "not-a-uuid"])
def test_UUID_가_아니면_404(client: TestClient, 엉뚱한값: str):
    """**500 으로 새지 않는다.** 「ID 는 전부 UUID」가 규약이고(`공통규약.md`),
    모양이 틀린 것은 곧 없는 것이다."""
    response = client.get(f"/api/v1/artworks/{엉뚱한값}")

    assert response.status_code == 404
