"""장면 카드가 **DB 에서 온다** (A0-1 잔여).

문서(`docs/장면카드_초안.md`)는 여전히 정본이지만, **런타임에 읽는 것은 DB** 다.
그 둘을 잇는 것이 `씨뿌리기()` 하나뿐이라, 여기서 지키는 것은 셋이다.

1. **문서의 스물셋이 그대로 들어간다** — 20장 + 튜토리얼 3장
2. **여러 번 뿌려도 늘지 않고, 문서가 바뀌면 따라온다** — 배포마다 도는 자리다
3. **안 뿌린 채로 서면 `/readyz` 가 먼저 안다** — 아이가 빈 화면을 보기 전에
"""

from sqlalchemy import delete, update

from app import db
from app.card_store import 모험카드들, 씨뿌리기, 카드수
from app.models import Card
from app.scene_cards import 카드 as 문서카드
from app.scene_cards import 카드들


async def test_문서의_스물셋이_그대로_들어간다():
    """20장 + 튜토리얼 3장. **튜토리얼도 넣는다** — 미검수라 프리테스트에 안 쓸 뿐이다."""
    async with db.SessionLocal() as session:
        assert await 카드수(session) == len(카드들()) == 23


async def test_두_번_뿌려도_안_늘어난다():
    """배포마다 돈다. 늘어나면 같은 카드가 두 번 나온다."""
    async with db.SessionLocal() as session:
        await 씨뿌리기(session)
        await 씨뿌리기(session)

        assert await 카드수(session) == 23


async def test_문서가_바뀌면_다시_뿌릴_때_따라온다():
    """대표 검수가 문서를 고치는 자리다 (`cacda91` 에서 6장이 바뀌었다).

    덮어쓰지 않으면 **DB 가 옛말을 하고, 그 옛말이 아이에게 나간다.**
    """
    async with db.SessionLocal() as session:
        await session.execute(update(Card).where(Card.id == "c01").values(situation_text="옛말"))
        await session.commit()

        await 씨뿌리기(session)

        행 = await session.get(Card, "c01")
        assert 행 is not None
        assert 행.situation_text == 문서카드("c01").상황문


async def test_모험카드는_스무_장이고_튜토리얼이_안_섞인다():
    """튜토리얼 노출 경로는 따로다 (Stage 1 A-6). **`next` 후보가 아니다.**"""
    async with db.SessionLocal() as session:
        카드들행 = await 모험카드들(session)

    assert len(카드들행) == 20
    assert not {행.id for 행 in 카드들행} & {"t1", "t2", "t3"}


async def test_문서_순서가_보존된다():
    """`display_order` 가 없으면 매번 뒤섞인 순서로 나온다 — 「오늘 안 한 카드」를
    고르는 자리(A0-5)가 그 순서를 본다."""
    async with db.SessionLocal() as session:
        카드들행 = await 모험카드들(session)

    문서순서 = [c.card_id for c in 카드들().values() if c.유형코드]
    assert [행.id for 행 in 카드들행] == 문서순서


async def test_안_뿌렸으면_카드수가_0_이다():
    """`/readyz` 가 이 값을 본다."""
    async with db.SessionLocal() as session:
        await session.execute(delete(Card))
        await session.commit()

        assert await 카드수(session) == 0
