"""일일 턴 상한 (D-2 · W7 6번). **A0-5 의 확장이고 새 장치를 만들지 않는다.**

**기본 15턴/일** — PRD D-2 가 **「1챕터 12턴 + 스캐폴딩 여유」**로 적어 뒀다.

**⛔ 카운터를 A0-5 와 공유한다.** PRD A0-5: **「Stage 1에서는 D-2 일일 턴 상한과
카운터를 공유 — 연습 모드 카드도 그날의 턴을 소모」.** **갈라 두면 아이가 두 배로
논다** — 카드 5장과 턴 15개를 따로 세면 하루 상한이 사실상 20 이 된다.

**⛔ 셈을 행에서 한다. 별도 카운터를 두지 않는다.** Stage 0 에서 `retry_of` 가 상한을
안 보던 구멍(`attempts.py`)이 **카운터가 따로 있어서** 생긴 자리다 — 여기서는
**`chapter_turns`·`card_attempts` 행이 곧 셈**이라 **우회할 카운터가 없다.**

**⛔ 되묻기는 안 세인다** — 행을 안 만들기 때문이다. **되묻기가 상한을 깎으면 막힌
아이가 더 빨리 잠긴다**(`Stage1.md` 4절)는 규칙이 **별도 장치 없이 지켜진다.**

**⚠ 날짜는 서버 날짜다.** 자정 해제 기준을 아이 기기 시간으로 볼지는 **미결 11-4**
(`children.timezone` 이 열로는 있다). **여기서 임의로 정하지 않는다** — `card_store`
의 오늘 셈과 **같은 기준**을 쓰는 것이 지금 할 수 있는 최선이고, 갈리면 그쪽이 먼저다.
"""

from typing import Final

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CardAttempt, Chapter, ChapterTurn, Child
from app.tutorial import 튜토리얼카드들

# **PRD D-2 「기본 15턴/일」.** SHOULD 로 **학부모 설정 10~20턴**이 있는데 그 화면이
# 아직 없다 — **열이 생기는 것은 그 화면이 설 때**다. 그때까지 코드 기본값이고,
# `children.daily_cap`(카드 5장)과 **다른 값**이라 그 열을 돌려 쓰지 않는다.
일일턴상한: Final = 15


async def 오늘턴수(session: AsyncSession, 아이: Child) -> tuple[int, int]:
    """`(오늘 쓴 턴 수, 상한)`. **Stage 1 턴 + Stage 0 카드 시도를 함께 센다.**"""
    턴셈 = (
        select(func.count())
        .select_from(ChapterTurn)
        .join(Chapter)
        .where(
            Chapter.child_id == 아이.id,
            func.date(ChapterTurn.created_at) == func.current_date(),
        )
    )
    카드셈 = (
        select(func.count())
        .select_from(CardAttempt)
        .where(
            CardAttempt.child_id == 아이.id,
            func.date(CardAttempt.created_at) == func.current_date(),
            # **⛔ 튜토리얼은 빠진다** (A-6 「일일 제한 미적용」 · W7 10번).
            # PRD A0-5 가 **「연습 모드 카드도 그날의 턴을 소모」**라고 한 것은
            # **연습 모드**이고 **튜토리얼은 「제한 미적용」**이다 — 세면
            # **첫날 모험이 그만큼 깎인다.**
            CardAttempt.card_id.not_in(튜토리얼카드들()),
        )
    )
    턴 = (await session.execute(턴셈)).scalar_one()
    카드 = (await session.execute(카드셈)).scalar_one()
    return 턴 + 카드, 일일턴상한


async def 다썼나(session: AsyncSession, 아이: Child) -> bool:
    쓴수, 상한 = await 오늘턴수(session, 아이)
    return 쓴수 >= 상한
