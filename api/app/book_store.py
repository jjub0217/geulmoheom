"""내 책 (A0-4) — **아이의 창작물이 쌓이는 자리.**

**쓰기 엔진은 수단이고 책과 독자가 목적이다** (비전 2장). `card_attempts` 가 「무엇을
썼나」의 이력이라면 여기는 **아이가 다시 열어 보는 결과물**이다.

**자녀 1명 = 책 1권** (Stage 0). **카드별 최고 티어 시도 1건**이 한 페이지이고,
재시도로 티어가 오르면 그 페이지가 교체된다 (`Stage0.md` 6절).

**아이 원문 그대로 옮긴다.** 맞춤법·AI 보정을 하지 않는다 — `card_attempts.text` 를
그대로 복사한다. 그 값은 이미 마스킹된 뒤 문장이고, **그것이 원문이다** (PRD 1.1b).

**등급이 낮아도 똑같이 쌓인다.** 「기본」도 페이지가 된다 — `문구.md` 1.6 이
「이 장면이 네 책에 남아」를 기본 등급 대사에 둔 이유가 그것이다.
"""

import uuid
from typing import Final

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.card_store import 오늘시작
from app.models import Artwork, Book, BookPage, CardAttempt, Child
from app.schemas.stage0 import Tier

# 높을수록 위. **문서의 순서를 코드가 다시 정하지 않는다** — `TIERS` 와 같은 차례다.
_높이: Final[dict[str, int]] = {"basic": 0, "rare": 1, "legendary": 2}


async def 책(session: AsyncSession, 아이: Child) -> Book:
    """이 아이의 책. **없으면 만든다.**

    **처음 들어온 아이가 빈 책에서 500 을 보면 안 된다** — 아직 아무것도 안 썼을 뿐이다.
    제목은 닉네임에서 짓는다 (`Stage0.md` 6절 예시). 아이가 `PATCH /book` 으로 바꾼다.
    """
    있는것 = await session.scalar(select(Book).where(Book.child_id == 아이.id))
    if 있는것 is not None:
        return 있는것

    새책 = Book(child_id=아이.id, title=f"{아이.nickname}의 모험", visibility="private")
    session.add(새책)
    await session.commit()
    return 새책


async def 페이지들(
    session: AsyncSession, book_id: uuid.UUID, *, 오늘만: bool = False
) -> list[BookPage]:
    """페이지 번호 순. `오늘만` 은 세션 종료 화면용이다 (`GET /book/today`)."""
    문 = select(BookPage).where(BookPage.book_id == book_id).order_by(BookPage.page_no)
    if 오늘만:
        문 = 문.where(BookPage.achieved_at >= 오늘시작())
    return list(await session.scalars(문))


async def 삽화주소들(
    session: AsyncSession, 페이지목록: list[BookPage], 주소만들기
) -> dict[uuid.UUID, str]:
    """`{page.id: url}`. **`ready` 인 것만 넣는다.**

    굽는 중인 삽화의 주소를 미리 주면 프론트가 **깨진 이미지**를 그린다 — 폴링이
    끝나기 전에 「내 책」을 열 수 있다.
    """
    아이디들 = [p.artwork_id for p in 페이지목록 if p.artwork_id]
    if not 아이디들:
        return {}

    문 = select(Artwork).where(Artwork.id.in_(아이디들), Artwork.status == "ready")
    준비된 = {행.id: 행 for 행 in await session.scalars(문)}
    return {p.id: 주소만들기(str(p.artwork_id)) for p in 페이지목록 if p.artwork_id in 준비된}


async def 세어보기(session: AsyncSession, book_id: uuid.UUID) -> dict[str, int]:
    """티어별 페이지 수. **셋 다 0 으로 시작한다** — 없는 키를 프론트가 만나지 않게."""
    문 = (
        select(BookPage.tier, func.count())
        .where(BookPage.book_id == book_id)
        .group_by(BookPage.tier)
    )
    센것 = dict((await session.execute(문)).all())
    return {티어: int(센것.get(티어, 0)) for 티어 in _높이}


async def 더_높은가(session: AsyncSession, 아이: Child, card_id: str, tier: Tier) -> bool:
    """이 티어가 **그 카드의 책 페이지를 바꾸나.** 페이지가 아직 없으면 참이다.

    **삽화를 다시 굽는 조건이 이것이다** (`adr/0015` ②). 같은 규칙을 두 군데 적지
    않으려고 여기 둔다 — **책이 바뀌는 자리와 그림을 굽는 자리가 갈리면**, 책에 안
    실릴 그림에 돈을 쓰거나 **책에 실린 문장과 다른 그림**이 남는다.

    **그리고 이것이 비용 천장이다.** 재시도는 일일 상한 밖이라(`attempts.py`) 여기서
    막지 않으면 **아이 한 명의 하루 비용에 천장이 없다.** 카드 하나에 최대 3회
    (첫 장 + `basic→rare` + `rare→legendary`), 하루 5장이니 **15회가 최악**이다.
    """
    그책 = await 책(session, 아이)
    있던것 = await session.scalar(
        select(BookPage).where(
            BookPage.book_id == 그책.id,
            BookPage.source == "card",
            BookPage.source_id == card_id,
        )
    )
    return 있던것 is None or _높이[tier] > _높이[있던것.tier]


async def 페이지올리기(
    session: AsyncSession,
    아이: Child,
    시도: CardAttempt,
    artwork_id: uuid.UUID | None,
) -> None:
    """카드 하나의 페이지를 만들거나 **티어가 올랐을 때만** 교체한다
    (`Stage0.md` 9절 10b · 6절).

    **같은 티어면 그대로 둔다.** 처음 해낸 문장을 지키는 쪽이다 — 다시 써서 페이지가
    바뀌면 아이는 **자기가 좋아하던 문장을 잃는다.** 「최고 티어 1건」이지 「마지막
    1건」이 아니다.

    **자리(`page_no`)는 안 바꾼다.** 교체는 내용이 바뀌는 것이지 책이 다시 엮이는 것이
    아니다 — 아이가 기억하는 순서가 흐트러진다.
    """
    그책 = await 책(session, 아이)

    문 = select(BookPage).where(
        BookPage.book_id == 그책.id,
        BookPage.source == "card",
        BookPage.source_id == 시도.card_id,
    )
    있던것 = await session.scalar(문)

    새티어: Tier = 시도.tier or "basic"
    if 있던것 is not None:
        if _높이[새티어] <= _높이[있던것.tier]:
            return
        있던것.tier = 새티어
        있던것.card_attempt_id = 시도.id
        있던것.artwork_id = artwork_id
        있던것.text = 시도.text
        await session.commit()
        return

    다음번호 = (
        await session.scalar(
            select(func.count()).select_from(BookPage).where(BookPage.book_id == 그책.id)
        )
        or 0
    ) + 1

    session.add(
        BookPage(
            book_id=그책.id,
            source="card",
            source_id=시도.card_id,
            page_no=다음번호,
            card_attempt_id=시도.id,
            artwork_id=artwork_id,
            tier=새티어,
            # **아이 원문 그대로 옮긴다.** 맞춤법·AI 보정 없음 (`Stage0.md` 6절).
            text=시도.text,
        )
    )
    await session.commit()


async def 챕터페이지올리기(
    session: AsyncSession,
    아이: Child,
    챕터id: uuid.UUID,
    *,
    tier: Tier,
    문장들: list[str],
    artwork_id: uuid.UUID | None = None,
) -> int | None:
    """완결한 챕터 하나를 **책 한 장**으로 (A-7 · `Stage1.md` 5절). 돌려주는 값은 장 번호.

    **⛔ 문장은 아이 원문 그대로 이어 붙인다. 요약·다듬기·맞춤법 교정이 없다**
    (비전 2장). **그것이 A-7 의 전부다** — 보정을 넣는 순간 **아이 책이 아이 글이
    아니게 된다.**

    **⛔ 고른 턴은 부르는 쪽에서 걸러 온다.** 그 라벨은 **GM 이 쓴 문장**이고, 실으면
    **아이가 안 쓴 글이 아이 책에 아이 글로 남는다.**

    **⛔ 교체가 없다** — 카드 장은 티어가 오르면 바뀌지만(`페이지올리기`) **챕터는
    하루에 하나 끝나고 다시 쓰지 않는다.** 이미 있으면 그 번호를 그대로 돌려준다:
    **두 번 불려도 책이 두 장이 되지 않는다.**

    **새 책을 만들지 않는다** — `책()` 이 「내 책」(A0-4)을 그대로 준다.
    """
    그책 = await 책(session, 아이)

    있던것 = await session.scalar(
        select(BookPage).where(
            BookPage.book_id == 그책.id,
            BookPage.source == "chapter",
            BookPage.source_id == str(챕터id),
        )
    )
    if 있던것 is not None:
        return 있던것.page_no

    다음번호 = (
        await session.scalar(
            select(func.count()).select_from(BookPage).where(BookPage.book_id == 그책.id)
        )
        or 0
    ) + 1

    session.add(
        BookPage(
            book_id=그책.id,
            source="chapter",
            source_id=str(챕터id),
            page_no=다음번호,
            card_attempt_id=None,  # **챕터 장에는 카드 시도가 없다**
            artwork_id=artwork_id,  # **⏳ 14번(삽화)이 채운다**
            tier=tier,
            text="\n".join(문장들),
        )
    )
    await session.commit()
    return 다음번호


async def 챕터장번호(session: AsyncSession, 아이: Child, 챕터id: uuid.UUID) -> int | None:
    """그 챕터가 책 몇 장인가. 없으면 `None` — 완결 화면이 이 값을 가리킨다(계약 5절)."""
    그책 = await 책(session, 아이)
    return await session.scalar(
        select(BookPage.page_no).where(
            BookPage.book_id == 그책.id,
            BookPage.source == "chapter",
            BookPage.source_id == str(챕터id),
        )
    )
