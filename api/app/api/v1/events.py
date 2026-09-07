"""7. 이벤트 (`docs/api/Stage0.md` 7절).

클라이언트만 아는 이벤트를 배치로 받는다. **원문 필드 없음** — 스키마가 막는다.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.v1.deps import require_child
from app.events import EVENT_FIELDS, 남기기, 이벤트
from app.middleware import current_request_id
from app.models import Child as ChildRow
from app.schemas.stage0 import ClientEvent, EventBatch

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])

# **클라이언트만 아는 이벤트** (`Stage0.md` 7절). 나머지는 서버가 판정과 함께 남긴다.
# 여기 없는 것을 받아 주면 **H2 가 통째로 위조된다** — 글자 수와 등급이 곧 합격선이다.
# 프론트를 믿지 않는 이유는 E-2 서버 2차와 같다: 클라이언트는 우회된다.
CLIENT_EVENTS = frozenset({"session_start", "card_shown", "pii_masked"})

# `require_child` 는 검증된 `children` 행을 준다 (E-3). 예전에는 토큰 문자열이었다.
Child = Annotated[ChildRow, Depends(require_child)]


def _필드(건: ClientEvent) -> dict:
    """`event`·`ts` 를 뺀 나머지 중 채워진 것만. **스키마에 원문 필드가 없다.**"""
    필드 = {키: 값 for 키, 값 in 건.model_dump(exclude={"event", "ts"}).items() if 값 is not None}
    # **`layer` 는 어느 층이 잡았는지를 가르는 값이다.** 클라이언트 말로 정하지 않는다 —
    # 이 경로로 들어온 것은 정의상 클라이언트가 잡은 것이다.
    if "layer" in 필드:
        필드["layer"] = "client"
    return 필드


def _받는다(건: ClientEvent) -> bool:
    """**남의 입력이라 죽지 않고 버린다.**

    `app/events.py` 의 검증기는 목록 밖의 필드를 만나면 예외를 던진다 — 서버 코드에서는
    그게 맞다(개발자 실수를 조용히 버리면 집계 때나 안다). 하지만 그 규칙을 그대로
    여기 두면 **클라이언트가 필드 하나로 500 을 만든다.** 죽는 자리와 버리는 자리를 가른다.
    """
    return 건.event in CLIENT_EVENTS and not (set(_필드(건)) - EVENT_FIELDS[건.event])


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def collect(payload: EventBatch, 아이: Child) -> None:
    """최대 50건. `ts` 는 클라이언트가 준 시각을 그대로 쓴다 — 오프라인 뒤 몰아서 올 수 있다."""
    받을것 = [건 for 건 in payload.events if _받는다(건)]

    if 버린것 := [건.event for 건 in payload.events if not _받는다(건)]:
        # **배치 전체를 물리지 않는다.** 나머지는 정상 이벤트고, 한 건 때문에 되돌리면
        # 화면이 재전송을 반복한다. 이름만 남긴다 — 값이 실리면 그게 원문 경로다.
        logger.warning(
            "client_event_rejected",
            extra={"request_id": current_request_id(), "event_names": "+".join(버린것)},
        )

    await 남기기(아이.id, *(이벤트(건.event, _필드(건), ts=건.ts) for 건 in 받을것))
