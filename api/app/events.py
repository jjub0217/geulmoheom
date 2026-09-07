"""KPI 이벤트 기록 (F-1).

지표는 `검증가설_성공지표.md` 2.0, 필드는 `MVP_PRD.md` 5장이 원본이다.

**이벤트마다 실을 수 있는 필드를 여기서 못 박는다.** `events.payload` 는 자유 JSON 이라
무엇이든 들어가고, 「길이만 남기려다 문장을 담는」 자리가 정확히 여기다.
목록 밖의 키는 조용히 버리지 않고 **죽인다** — 버리면 지표가 안 잡힌 것을 집계 때나 안다.

`app/logging_config.py` 의 `SAFE_EXTRA_KEYS` 와 같은 방식이고, 같은 이유다.
"""

import logging
from datetime import UTC, datetime
from typing import Any, NamedTuple
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.middleware import current_request_id
from app.models import Event

logger = logging.getLogger(__name__)

# `MVP_PRD.md` 5장 표. **Stage 1 전용 이벤트는 아직 넣지 않는다** —
# `tutorial_complete`·`chapter_start`·`chapter_complete`·`trial_path` 는 W6 이다.
EVENT_FIELDS: dict[str, frozenset[str]] = {
    "session_start": frozenset({"locked"}),
    "card_shown": frozenset({"card_id"}),
    "card_retry": frozenset({"card_id", "prev_grade", "attempt", "prompted"}),
    "turn_input": frozenset({"card_id", "input_type", "char_len", "grade"}),
    "eval_result": frozenset({"grade", "signal_count", "latency_ms"}),
    "scaffold_triggered": frozenset({"card_id", "attempt", "followed_by_free", "next_char_len"}),
    "daily_cap_reached": frozenset({"cap"}),
    # **PRD 5장은 이 필드를 `hash` 라고 부른다.** 코드는 `text_hash` 로 서 있고
    # (`app/moderation.py` `_차단기록`) 이미 로그와 테스트가 그 이름을 쓴다.
    # **한쪽으로 맞춰야 하는데 여기서 고르지 않는다** — 이름이 갈린 것을 PM 에게 올렸다.
    "moderation_blocked": frozenset({"direction", "category", "text_hash"}),
    "pii_masked": frozenset({"layer", "kind"}),
}


class 이벤트(NamedTuple):
    """`남기기` 에 넘기는 한 건.

    `로그=False` 는 **이미 자기 모듈에서 더 자세히 로그를 남기는** 이벤트용이다.
    `ts` 는 클라이언트가 준 시각이 있을 때만 — 없으면 기록 시점이다.
    """

    event: str
    필드: dict[str, Any]
    로그: bool = True
    ts: datetime | None = None


async def 기록(
    session: AsyncSession,
    child_id: UUID | None,
    event: str,
    *,
    로그: bool = True,
    ts: datetime | None = None,
    **필드: Any,
) -> None:
    """`events` 에 한 줄 남긴다. **커밋하지 않는다** — 부르는 쪽 트랜잭션에 얹힌다.

    `로그=False` 는 **이미 자기 모듈에서 더 자세히 로그를 남기는** 이벤트용이다
    (`eval_result` → `app/evaluator.py`, `moderation_blocked` → `app/moderation.py`).
    같은 줄을 두 번 내보내면 집계에서 두 배로 세인다.
    """
    허용 = EVENT_FIELDS.get(event)
    if 허용 is None:
        raise ValueError(f"모르는 이벤트: {event}")

    if 남는것 := set(필드) - 허용:
        raise ValueError(f"{event} 에 없는 필드: {', '.join(sorted(남는것))}")

    담을것 = {키: 값 for 키, 값 in 필드.items() if 값 is not None}

    session.add(
        Event(
            child_id=child_id,
            event=event,
            ts=ts or datetime.now(UTC),
            payload=담을것,
        )
    )

    if 로그:
        logger.info(event, extra={"request_id": current_request_id(), **담을것})


async def 남기기(child_id: UUID | None, *이벤트들: 이벤트) -> None:
    """엔드포인트가 쓰는 입구. **자기 세션을 열고 커밋한다.**

    요청 세션에 얹지 않는 이유는 하나다 — **측정이 아이 요청을 죽이면 안 된다.**
    같은 트랜잭션에 얹으면 이벤트 한 줄이 실패할 때 아이가 쓴 것까지 함께 되돌아가고,
    반대로 실패를 삼키면 `card_attempts` 저장(W4)이 들어온 뒤 **아이 문장을 조용히
    버리는 코드**가 된다. 트랜잭션을 나누면 둘 다 안 생긴다.

    기록이 실패해도 예외를 밖으로 내지 않는다. **판정 데이터를 잃는 것보다 아이를
    막는 쪽이 나쁘다** — 대신 실패했다는 사실을 로그에 남긴다.
    """
    try:
        async with db.SessionLocal() as session:
            for 건 in 이벤트들:
                await 기록(session, child_id, 건.event, 로그=건.로그, ts=건.ts, **건.필드)
            await session.commit()
    except SQLAlchemyError as 오류:
        # **원문이 실릴 자리가 없다** — 이벤트 이름과 예외 종류만 남긴다.
        logger.warning(
            "event_write_failed",
            extra={
                "request_id": current_request_id(),
                "exc_type": type(오류).__name__,
                "event_names": "+".join(건.event for 건 in 이벤트들),
            },
        )
