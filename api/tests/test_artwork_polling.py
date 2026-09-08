"""삽화 폴링이 **실제 DB 상태**를 준다 (B-3 ②).

프론트는 `POST /attempts` 뒤 3초부터 2초 간격으로 여기를 두드린다 (`Stage0.md` 5절).
목이던 동안에는 **무엇을 물어도 `ready`** 였다 — 폴링이 도는지조차 확인할 수 없었다.

여기서 지키는 것은 셋이다.

1. **행이 말하는 그대로 준다** — `status`·`tier`·`fallback`
2. **15초를 넘긴 `pending` 은 `ready` + `fallback` 으로 확정한다** (`Stage0.md` 5절).
   확정하지 않으면 굽기가 죽은 행이 **영영 `pending`** 이고, 그 카드는 「내 책」에도 안 선다
3. **남의 삽화는 404 다** — 403 이면 「그 삽화는 존재한다」가 샌다
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import db
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


# ── 15초 ────────────────────────────────────────────────


async def test_15초를_넘긴_pending_은_ready_로_확정된다(client: TestClient, 자녀행: Child):
    """프론트도 15초에 폴링을 끊는다 (`Stage0.md` 5절). **서버가 같은 자리에서 확정하지
    않으면** 굽기가 죽은 행이 영영 `pending` 이고, 그 카드는 「내 책」에도 안 선다."""
    삽화 = await _삽화를_넣는다(자녀행.id, 만든때=datetime.now(UTC) - timedelta(seconds=20))

    몸 = client.get(f"/api/v1/artworks/{삽화.id}").json()

    assert 몸["status"] == "ready"
    assert 몸["fallback"] is True

    # **행에도 남는다** — 다음 폴링이나 「내 책」이 같은 값을 봐야 한다.
    async with db.SessionLocal() as session:
        (남은것,) = list(await session.scalars(select(Artwork)))
    assert 남은것.status == "ready"
    assert 남은것.fallback is True


async def test_아직_15초_안이면_기다린다(client: TestClient, 자녀행: Child):
    """평균이 6.2초다 (`benchmarks/W1-image-bench.md`). 일찍 확정하면 **다 구워진
    그림을 버리고 기본 에셋을 준다.**"""
    삽화 = await _삽화를_넣는다(자녀행.id, 만든때=datetime.now(UTC) - timedelta(seconds=5))

    몸 = client.get(f"/api/v1/artworks/{삽화.id}").json()

    assert 몸["status"] == "pending"


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
