"""4. 시도 (`docs/api/Stage0.md` 4절) — 핵심 엔드포인트. 목 응답.

응답은 `outcome` 3분기다. **프론트가 이 값으로 화면을 가른다** (api/CLAUDE.md).
목 서버에서는 `X-Mock-Outcome` 헤더로 셋을 강제할 수 있다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import MockOutcome, mock_daily_cap_reached, mock_outcome, require_child
from app.errors import AppError, ErrorCode
from app.schemas.stage0 import (
    AttemptBlocked,
    AttemptRequest,
    AttemptResponse,
    AttemptResult,
    AttemptScaffold,
    Guide,
    Highlight,
    TodayState,
)

router = APIRouter(prefix="/attempts", tags=["attempts"])

Child = Annotated[str, Depends(require_child)]


def _result() -> AttemptResult:
    return AttemptResult(
        outcome="result",
        attempt_id=fx.ATTEMPT_ID,
        tier="rare",
        highlights=[
            Highlight(text="은빛", kind="adj"),
            Highlight(text="살금살금", kind="adv"),
        ],
        guide=Guide(expression="compass_bright", line="'살금살금'이 나침반을 움직였어!"),
        artwork={
            "artwork_id": fx.ARTWORK_ID,
            "status": "pending",
            "url": None,
            "placeholder_url": fx.CARD["sketch_url"],
        },
        today=TodayState(cards_done=3, cap=5, locked=False),
        can_retry=True,
    )


def _scaffold() -> AttemptScaffold:
    return AttemptScaffold(
        outcome="scaffold",
        attempt_id=fx.ATTEMPT_ID,
        guide=Guide(
            expression="compass_dim",
            line="나침반이 안 움직이네. 그림자를 어떻게 할 건지 조금만 더 말해줄래?",
        ),
        scaffold_count=1,
        today=TodayState(cards_done=2, cap=5, locked=False),
    )


def _blocked() -> AttemptBlocked:
    """카테고리·사유는 응답에 넣지 않는다 — 아이에게 "나쁜 말" 피드백을 주지 않는다."""
    return AttemptBlocked(
        outcome="blocked",
        reason="moderation",
        guide=Guide(
            expression="compass_dim", line="나침반이 그 말은 못 알아듣네. 다르게 말해줄래?"
        ),
        today=TodayState(cards_done=2, cap=5, locked=False),
    )


@router.post("")
async def create_attempt(
    payload: AttemptRequest,
    _: Child,
    outcome: Annotated[MockOutcome, Depends(mock_outcome)],
    소진: Annotated[bool, Depends(mock_daily_cap_reached)],
) -> AttemptResponse:
    """`text` 1~500자. 재시도(`retry_of`)와 되묻기는 일일 카운트를 쓰지 않는다."""
    if 소진 and payload.retry_of is None:
        raise AppError(ErrorCode.DAILY_CAP_REACHED)

    return {"result": _result, "scaffold": _scaffold, "blocked": _blocked}[outcome]()


@router.get("/{attempt_id}")
async def get_attempt(attempt_id: str, _: Child) -> AttemptResult:
    """새로고침 복구용. 정상(result) 형식으로만 돌려준다."""
    return _result()
