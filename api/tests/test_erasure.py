"""자녀 계정 삭제 — **즉시 파기** (E-4, PRD E-4 MUST · 1.1b).

**「CASCADE 라고 적혀 있다」와 「실제로 지워진다」는 다르다.** 선언만 보고 넘어가면
FK 하나에 `ondelete` 가 빠져 있을 때 **삭제가 통째로 실패**한다 — 그리고 그건
학부모가 지워 달라고 한 데이터가 남아 있다는 뜻이다.

그래서 여기서는 **실제로 행을 만들고 지운 뒤 남은 것을 센다.**
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select

from app import db
from app.models import Artwork, Book, BookPage, Card, CardAttempt, Child, Event
from app.scaffold import _아이키


async def _자녀데이터를_채운다(child_id: uuid.UUID) -> None:
    """책 한 장까지 만든다 — **`book_pages` 가 `card_attempts` 를 FK 로 물고 있어서**
    거기가 캐스케이드가 끊기기 가장 쉬운 자리다.
    """
    async with db.SessionLocal() as session:
        session.add(
            Card(
                id="c01",
                type="crisis",
                situation_text="장면",
                prompt_label="어떻게 할까?",
                noun_tags=["문"],
                sketch_r2_key="cards/c01.png",
                display_order=1,
            )
        )
        await session.flush()

        시도 = CardAttempt(
            child_id=child_id,
            card_id="c01",
            attempt=1,
            grade="G2",
            tier="rare",
            char_len=12,
            text="은빛 검을 들고 달려갔다",
        )
        session.add(시도)
        await session.flush()

        삽화 = Artwork(card_attempt_id=시도.id, tier="rare", status="ready")
        책 = Book(child_id=child_id, title="내 책")
        session.add_all([삽화, 책])
        await session.flush()

        session.add(
            BookPage(
                book_id=책.id,
                source="card",
                source_id="c01",
                page_no=1,
                card_attempt_id=시도.id,
                artwork_id=삽화.id,
                text="은빛 검을 들고 달려갔다",
                tier="rare",
                achieved_at=datetime.now(UTC),
            )
        )
        session.add(
            Event(
                child_id=child_id,
                event="turn_input",
                ts=datetime.now(UTC),
                payload={"char_len": 12},
            )
        )
        await session.commit()


async def _남은수(child_id: uuid.UUID) -> dict[str, int]:
    async with db.SessionLocal() as session:
        시도 = (
            await session.execute(
                select(func.count())
                .select_from(CardAttempt)
                .where(CardAttempt.child_id == child_id)
            )
        ).scalar_one()
        책 = (
            await session.execute(
                select(func.count()).select_from(Book).where(Book.child_id == child_id)
            )
        ).scalar_one()
        쪽 = (await session.execute(select(func.count()).select_from(BookPage))).scalar_one()
        삽화 = (await session.execute(select(func.count()).select_from(Artwork))).scalar_one()
        이벤트 = (
            await session.execute(
                select(func.count()).select_from(Event).where(Event.child_id == child_id)
            )
        ).scalar_one()
    return {"시도": 시도, "책": 책, "쪽": 쪽, "삽화": 삽화, "이벤트": 이벤트}


async def test_자녀를_지우면_책과_시도와_이벤트가_함께_간다(client, 자녀행: Child):
    await _자녀데이터를_채운다(자녀행.id)
    assert _남은수 and (await _남은수(자녀행.id))["쪽"] == 1  # 채워졌는지 먼저 본다

    응답 = client.delete(f"/api/v1/parents/children/{자녀행.id}")

    assert 응답.status_code == 204
    assert await _남은수(자녀행.id) == {"시도": 0, "책": 0, "쪽": 0, "삽화": 0, "이벤트": 0}


class 가짜Redis:
    """`scan_iter` 와 `delete` 만 있으면 된다. **진짜 Redis 를 쓰지 않는 이유**는
    `TestClient` 가 요청마다 이벤트 루프를 새로 만들어, 모듈 수준 클라이언트가
    다른 루프에 붙잡히기 때문이다 (conftest 가 엔진에 대해 적어 둔 것과 같은 성질).
    """

    def __init__(self, 값: dict[str, str]) -> None:
        self.값 = dict(값)

    async def scan_iter(self, match: str):
        앞 = match.rstrip("*")
        for 키 in list(self.값):
            if 키.startswith(앞):
                yield 키

    async def delete(self, 키: str) -> None:
        self.값.pop(키, None)


async def test_자녀를_지우면_되묻기_카운터도_지운다(client, 자녀행: Child, monkeypatch):
    """**Redis 잔여 파기** — `delete_child` 주석이 「E-4 다」로 남겨 둔 자리다.

    아이 원문은 없지만 **어느 카드에서 몇 번 되물었는지**가 남는다. 24시간 뒤에
    사라지긴 해도, 「즉시 파기」라고 해 놓고 하루를 남기는 것은 그 말과 다르다.
    """
    내키 = f"scaffold:{_아이키(str(자녀행.id))}:c01"
    남의키 = f"scaffold:{_아이키('다른-아이')}:c01"
    가짜 = 가짜Redis({내키: "2", 남의키: "1"})
    monkeypatch.setattr(db, "redis_client", 가짜)

    client.delete(f"/api/v1/parents/children/{자녀행.id}")

    # **남의 카운터는 안 건드린다.** 접두어가 해시라 실수로 넓히면 남의 것까지 지운다.
    assert 내키 not in 가짜.값
    assert 남의키 in 가짜.값


async def test_redis_가_죽어도_삭제는_끝난다(client, 자녀행: Child, monkeypatch):
    """뒷정리가 본체를 죽이지 않는다. **DB 에서는 이미 지워졌는데 500 이 나가면
    학부모는 「안 지워졌다」고 읽는다.**
    """

    class 죽은Redis:
        def scan_iter(self, match: str):
            raise ConnectionError("redis 없음")

    monkeypatch.setattr(db, "redis_client", 죽은Redis())

    응답 = client.delete(f"/api/v1/parents/children/{자녀행.id}")

    assert 응답.status_code == 204
