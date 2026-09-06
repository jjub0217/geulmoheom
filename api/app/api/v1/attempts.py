"""4. 시도 (`docs/api/Stage0.md` 4절) — 핵심 엔드포인트.

응답은 `outcome` 3분기다. **프론트가 이 값으로 화면을 가른다** (api/CLAUDE.md).
`X-Mock-Outcome` 헤더로 셋을 강제할 수 있다 — W3 화면 작업이 쓴다.

**헤더가 없으면 실제 Evaluator 로 간다** (W2 2번). 아직 목인 것은 아래 셋이다.

- `today` 카운트·`can_retry` — 일일 카운트는 DB 가 들어와야 센다
- `artwork` — 이미지 큐(B-3)가 아직 없다. `pending` 고정
- **`outcome=blocked`** — PII·Moderation 은 `Stage0.md` 9절 3·4번이고 아직이다
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import MockOutcome, mock_daily_cap_reached, mock_outcome, require_child
from app.errors import AppError, ErrorCode
from app.evaluator import evaluate, highlights
from app.middleware import current_request_id
from app.scaffold import MAX_SCAFFOLD, 되묻기횟수, 질문
from app.schemas.stage0 import (
    AttemptBlocked,
    AttemptRequest,
    AttemptResponse,
    AttemptResult,
    AttemptScaffold,
    Guide,
    Highlight,
    Tier,
    TodayState,
)

logger = logging.getLogger(__name__)

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


# 결과 연출 대사 (PRD 4.0 — Stage 0 은 LLM 을 Evaluator 에만 쓰고 대사는 템플릿이다).
# **부정어 금지** (PRD 4.4). 아이가 쓴 말은 조사 문제를 피해 「~에」로 받는다.
_결과대사: dict[Tier, tuple[str, str]] = {
    "legendary": ("compass_bright", "'{말}'에 나침반이 확 돌았어!"),
    "rare": ("compass_bright", "'{말}'에 나침반이 움직였어!"),
    "basic": ("default", "나침반이 움직였어. 다음 장면으로 가볼까?"),
}
_묘사어없을때: dict[Tier, str] = {
    "legendary": "나침반이 환하게 돌았어!",
    "rare": "나침반이 움직였어!",
    "basic": "나침반이 움직였어. 다음 장면으로 가볼까?",
}


def _guide(tier: Tier, 하이라이트: list[Highlight]) -> Guide:
    표정, 틀 = _결과대사[tier]
    말 = 하이라이트[0].text if 하이라이트 else None
    return Guide(
        expression=표정,
        line=틀.format(말=말) if 말 else _묘사어없을때[tier],
    )


@router.post("")
async def create_attempt(
    payload: AttemptRequest,
    아이: Child,
    outcome: Annotated[MockOutcome | None, Depends(mock_outcome)],
    소진: Annotated[bool, Depends(mock_daily_cap_reached)],
) -> AttemptResponse:
    """`text` 1~500자. 재시도(`retry_of`)와 되묻기는 일일 카운트를 쓰지 않는다."""
    if 소진 and payload.retry_of is None:
        raise AppError(ErrorCode.DAILY_CAP_REACHED)

    if outcome is not None:  # 목 강제 (W3 화면 작업)
        return {"result": _result, "scaffold": _scaffold, "blocked": _blocked}[outcome]()

    평가 = await evaluate(payload.text)

    if 평가.grade == "G0":
        되물음 = await _되묻기(아이, payload.card_id)
        if 되물음 is not None:
            return 되물음

    하이라이트 = highlights(평가, payload.text)

    # **등급은 여기서 끝난다.** 응답에 담기는 것은 티어뿐이다 (`Stage0.md` 4절).
    return AttemptResult(
        outcome="result",
        attempt_id=fx.ATTEMPT_ID,
        tier=평가.tier,
        highlights=하이라이트,
        guide=_guide(평가.tier, 하이라이트),
        artwork={
            "artwork_id": fx.ARTWORK_ID,
            "status": "pending",
            "url": None,
            "placeholder_url": fx.CARD["sketch_url"],
        },
        today=TodayState(cards_done=3, cap=5, locked=False),
        can_retry=True,
    )


async def _되묻기(아이: str, card_id: str) -> AttemptScaffold | None:
    """G0 되묻기 (`Stage0.md` 9절 6번). 되묻지 않을 상황이면 `None` — 결과로 진행한다.

    **카드를 소모하지 않는다.** 프론트는 입력창과 쓰던 글을 그대로 둔다.
    """
    횟수 = await 되묻기횟수(아이, card_id)

    # 못 셌으면 되묻지 않는다. 같은 카드에서 무한히 되물어 아이를 가두는 쪽이 더 나쁘다.
    if 횟수 is None or 횟수 > MAX_SCAFFOLD:
        logger.info(
            "scaffold_skipped",  # 2회를 채웠거나(=G1 취급) 셀 수 없었다
            extra={
                "request_id": current_request_id(),
                "card_id": card_id,
                "attempt": 횟수 if 횟수 is not None else -1,
                "grade": "G1",  # 여기서부터 G1 취급으로 진행한다
            },
        )
        return None

    logger.info(
        "scaffold_triggered",  # PRD 5장. 발동률·재입력률이 H2 지표다
        extra={"request_id": current_request_id(), "card_id": card_id, "attempt": 횟수},
    )
    return AttemptScaffold(
        outcome="scaffold",
        attempt_id=fx.ATTEMPT_ID,
        guide=Guide(expression="compass_dim", line=질문(card_id, 횟수)),
        scaffold_count=횟수,
        today=TodayState(cards_done=2, cap=5, locked=False),
    )


@router.get("/{attempt_id}")
async def get_attempt(attempt_id: str, _: Child) -> AttemptResult:
    """새로고침 복구용. 정상(result) 형식으로만 돌려준다."""
    return _result()
