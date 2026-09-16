"""튜토리얼 「나침반 깨우기」 — 루프 설정 (A-6 · W7 10번).

**⭐ 새 카드도 새 테이블도 없다.** 카드 T1~T3 는 **DB 에 이미 있고**(`89e2396`)
진행 상태는 **`card_attempts` 행이 곧 그것**이다 — **세 장을 쓰면 통과**다
(A-6 「3장을 쓰기만 하면 통과」). **행이 곧 셈이면 우회할 카운터가 없다**
(`daily_turns` 와 같은 태도).

**⛔ 기본으로 꺼져 있다.** `장면카드_초안.md` 가 **T1~T3 만 대표 미검수**라 적어 뒀고
주차 계획 「위험」이 **「만들되 기본 켜짐으로 두지 않는다 — 검수가 오면 켠다」**다.
**검수 없이 아이에게 내보내지 않는다.**

**⛔ 잠금·관문이 없다** (A-6 MUST). **A0-5 일일 제한**도 **A0-4 앨범**도 적용하지
않는다 — 튜토리얼에서 카드를 다 쓰거나 책이 쌓이면 **첫 5~7분이 관문이 된다.**
**D-2 일일 턴 상한도 안 먹는다**: PRD A0-5 가 **「연습 모드 카드도 그날의 턴을
소모」**라고 한 것은 **연습 모드**이고 **튜토리얼은 「제한 미적용」**이다.

**순서가 뜻을 진다** (A-6) — T1 「쓰면 반응한다」 · T2 「구체적이면 더 좋아진다」 ·
T3 「네 방식대로」. **섞으면 배움이 없다.**
"""

import uuid
from typing import Final

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import CardAttempt

# **문서의 `T1`~`T3` 이 `card_id` 로 `t1`~`t3` 이다** (`scene_cards.카드id`).
# **여기 박아 두는 것은 순서뿐**이고 카드 내용은 DB(=문서)가 들고 있다.
_순서: Final[tuple[str, ...]] = ("t1", "t2", "t3")


def 튜토리얼카드들() -> tuple[str, ...]:
    """T1~T3 를 **뜻이 있는 순서**로."""
    return _순서


def 켜져있나() -> bool:
    """스위치 하나 (`config.tutorial_enabled`).

    **✅ 2026-09-16 — T1~T3 대표 검수가 통과했다. 관문이 풀렸다.**
    **운영은 `TUTORIAL_ENABLED=true` 로 켠다**(⏳ 2026-09-16 밤 기준 **아직 안 들어갔다**).
    **여기 기본값도 `False` 다** —
    켜면 새 계정이 `/cards/next` 에서 T1~T3 부터 받아 **프론트 실서버 e2e 가 바뀐다.**
    갈린 사정과 닫는 조건은 `app/config.py` 의 그 줄에 적어 뒀다.

    **⭐ 이 함수가 하나뿐인 스위치인 것이 그래서 값을 한다** — 설정을 여러 곳에서 읽으면
    **반만 켜진 상태**가 생기고, 지금처럼 **기본값과 운영값이 갈린 동안**에는 그 반쪽이
    어디인지 아무도 못 짚는다.
    """
    return get_settings().tutorial_enabled


async def 남은카드(session: AsyncSession, child_id: uuid.UUID) -> str | None:
    """이 아이가 다음에 볼 튜토리얼 카드. **다 썼거나 꺼져 있으면 `None`.**

    **`card_attempts` 를 센다 — 오늘이 아니라 통째로다.** A-6 이 **「재접속 시
    재실행 없음」**이라 **어제 튜토리얼을 한 아이에게 오늘 다시 주면 안 된다.**
    """
    if not 켜져있나():
        return None
    쓴것 = await 쓴튜토리얼(session, child_id)
    for card_id in _순서:
        if card_id not in 쓴것:
            return card_id
    return None


async def 쓴튜토리얼(session: AsyncSession, child_id: uuid.UUID) -> set[str]:
    """이 아이가 지금까지 쓴 튜토리얼 카드들."""
    문 = (
        select(CardAttempt.card_id)
        .where(CardAttempt.child_id == child_id, CardAttempt.card_id.in_(_순서))
        .distinct()
    )
    return set(await session.scalars(문))


def 튜토리얼카드인가(card_id: str) -> bool:
    """**셈에서 빼는 자리들이 이 함수를 본다** — 일일 상한(A0-5)·턴 상한(D-2)·책(A0-4).

    **`type` 을 다시 조회하지 않는다** — 그 한 번이 매 응답에 붙고, **id 만으로
    갈린다**(문서가 `T1`~`T3` 로 셋을 못 박았다).
    """
    return card_id in _순서


async def 방금끝냈나(session: AsyncSession, child_id: uuid.UUID) -> bool:
    """이번 시도로 셋이 다 찼나. **`tutorial_complete` 를 한 번만 남기는 자리다.**"""
    return await 쓴튜토리얼(session, child_id) >= set(_순서)


async def 베이스라인(session: AsyncSession, child_id: uuid.UUID) -> dict[str, list]:
    """`tutorial_complete` 의 payload (PRD 5장) — **그 아이의 H2 베이스라인**.

    **⛔ 아이 원문을 안 싣는다** (PRD 1.1b). **등급과 길이만**이고, 길이는
    `card_attempts.char_len` 그대로라 **화면·로그·책이 같은 수를 센다.**

    **⏳ `t3_path` 는 안 싣는다.** PRD 5장이 그 필드를 적어 뒀지만 **T3 답이 어느
    경로인지 판별하는 것이 아직 없다** — Stage 1 시련은 GM 이 판별하고(`trial_path`)
    Stage 0 시도에는 그 자리가 없다. **지어내지 않고 PM 에게 올린다.**
    """
    문 = (
        select(CardAttempt.card_id, CardAttempt.grade, CardAttempt.char_len)
        .where(CardAttempt.child_id == child_id, CardAttempt.card_id.in_(_순서))
        .order_by(CardAttempt.created_at)
    )
    행들 = list(await session.execute(문))
    첫판 = {}
    for card_id, 등급, 길이 in 행들:
        첫판.setdefault(card_id, (등급, 길이))  # 재시도가 있으면 **처음 쓴 것**이 기준이다
    고른것 = [첫판[card_id] for card_id in _순서 if card_id in 첫판]
    return {
        "grades": [등급 for 등급, _ in 고른것],
        "char_lens": [길이 for _, 길이 in 고른것],
    }


def 카드가맞나(card_id: str, 다음것: str | None) -> bool:
    """튜토리얼 중에 **순서를 건너뛰지 못하게** 한다. 프론트가 어긋나면 여기서 걸린다."""
    return 다음것 is None or card_id == 다음것 or not 튜토리얼카드인가(card_id)
