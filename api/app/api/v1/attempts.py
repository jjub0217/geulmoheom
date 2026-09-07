"""4. 시도 (`docs/api/Stage0.md` 4절) — 핵심 엔드포인트.

응답은 `outcome` 3분기다. **프론트가 이 값으로 화면을 가른다** (api/CLAUDE.md).
`X-Mock-Outcome` 헤더로 셋을 강제할 수 있다 — W3 화면 작업이 쓴다.

**헤더가 없으면 실제 Evaluator 로 간다** (W2 2번). 아직 목인 것은 아래 셋이다.

- `today` 카운트·`can_retry` — 일일 카운트는 DB 가 들어와야 센다
- `artwork` — 이미지 큐(B-3)가 아직 없다. `pending` 고정
- `today` 카운트가 목이라 **차단이 카드를 안 쓰는 것이 응답으로는 안 보인다** — DB 가
  들어오면 드러난다

**`outcome=blocked` 는 이제 실제 검사에서 나온다** (E-1 · `adr/0009`). 입력 검사와 평가를
**동시에 던지고**, 검사가 차단하면 평가 결과를 버린다. PII 서버 2차(E-2)는 아직이다.
"""

import asyncio
import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import MockOutcome, mock_daily_cap_reached, mock_outcome, require_child
from app.errors import AppError, ErrorCode
from app.evaluator import evaluate, highlights, 평가기록
from app.events import 남기기, 이벤트
from app.middleware import current_request_id
from app.models import Child as ChildRow
from app.moderation import 검사하기
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

# 일일 상한. **A0-5(W4)가 진짜 값을 자녀 행에서 읽어 온다** — 지금은 응답 픽스처와
# 같은 수를 이벤트에도 실어, 둘이 갈린 채로 지표가 잡히는 것을 막는다.
_CAP = 5

# `require_child` 는 검증된 `children` 행을 준다 (E-3). 예전에는 토큰 문자열이었다.
Child = Annotated[ChildRow, Depends(require_child)]


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
            "placeholder_url": fx.SKETCH_URL,
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


# 차단 대사 둘. **일반 차단 문구는 아직 확정본이 아니다** — 결과 연출(A0-3)과 같이
# W4 에서 만든다 (`docs/문구.md` 1.3). 지금 것은 `안전_어휘_기준.md` 1장이 적어 둔 문장이다.
_차단대사 = "나침반이 그 말은 못 알아듣네. 다르게 말해줄래?"

# **자해·자살 신호만 문구가 확정돼 있다** (`docs/문구.md` 1.2, 2026-09-07 대표 판정).
# 화면을 봐도 달라질 것이 없어 나머지 대사보다 먼저 닫혔다. **바꾸는 것은 「대표 몫」이다.**
#
# **한 줄만 말하고 이어 말하지 않는다.** 가이드는 상담자가 아니라 게임 마스터이고
# (C-1 「퀘스트 밖 자유 대화 없음」), 캐릭터가 아이의 실제 마음에 개입하면
# 「가상 페르소나 의존」(페르소나 4.4)이 정면으로 발생한다.
_자해대사 = "지금 마음이 많이 힘들면, 옆에 있는 어른한테 꼭 말해줘."


def _blocked(*, 자해: bool = False) -> AttemptBlocked:
    """카테고리·사유는 응답에 넣지 않는다 — 아이에게 "나쁜 말" 피드백을 주지 않는다.

    **자해 분기도 겉모양이 같다.** 표정은 일반 차단과 같은 것을 쓰고 `reason` 도
    `moderation` 그대로다 (`docs/문구.md` 1.2). 이 상황 전용 표정이나 사유를 만들면
    **아이가 자기 신호가 특별히 취급됐다는 것을 알아챈다.** 달라지는 것은 대사 한 줄뿐이다.
    """
    return AttemptBlocked(
        outcome="blocked",
        reason="moderation",
        guide=Guide(expression="compass_dim", line=_자해대사 if 자해 else _차단대사),
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
        # **상한 도달률이 H2 지표다** (합격선 40%). 409 로 나가는 길에도 남겨야 센다.
        await 남기기(아이.id, 이벤트("daily_cap_reached", {"cap": _CAP}))
        raise AppError(ErrorCode.DAILY_CAP_REACHED)

    if outcome is not None:  # 목 강제 (W3 화면 작업)
        return {"result": _result, "scaffold": _scaffold, "blocked": _blocked}[outcome]()

    # **검사와 평가를 동시에 던진다** (`adr/0009` 결정 2). 검사 결과가 평가의 입력이
    # 아니라 순서를 강제할 이유가 없고, 순차로 두면 +875ms 라 1.5초 예산을 깬다.
    # 병렬이면 늘어나는 것은 「검사 호출 시간」이 아니라 둘 중 느린 쪽과의 차이(+13ms)다.
    #
    # `기록=False` 다 — 차단이면 이 판정은 버려지고 `eval_result` 도 남기지 않는다
    # (결정 3). 버린 판정이 남으면 **화면에 보여주지도 않은 평가가 등급 분포를 오염시킨다.**
    검사, 평가 = await asyncio.gather(검사하기(payload.text), evaluate(payload.text, 기록=False))

    # **내장 필터가 막은 것도 차단이다.** 전에는 `evaluate()` 가 그걸 삼켜 G1 폴백으로
    # 넘겼고, 그러면 차단이 「그냥 평범한 문장」으로 기록됐다 (2026-09-07 PM 요청).
    # 우리 검사와 내장 필터는 축이 다르지만(`adr/0009`), **막았다는 사실은 양쪽 다 신호다.**
    if 검사.blocked or 평가.차단됨:
        # 평가 결과를 버린다. 차단 건의 평가 비용은 수용한다 (`adr/0009` 대가).
        return _blocked(자해=검사.self_harm)

    평가기록(평가)

    if 평가.grade == "G0":
        되물음 = await _되묻기(str(아이.id), payload.card_id)
        if 되물음 is not None:
            return 되물음

    하이라이트 = highlights(평가, payload.text)

    # **`char_len` 은 공백 포함 길이다** (PRD 5장). 여기서 「원문」은 PII 마스킹 뒤
    # 텍스트이고, 그것이 `card_attempts.text` 로 저장되는 문자열이라 `len` 그대로가 맞다.
    # 화면의 30자·로그의 `char_len`·책의 문장이 **같은 문자열을 세야 한다.**
    남길것 = [
        이벤트(
            "turn_input",
            {
                "card_id": payload.card_id,
                "input_type": "free",
                "char_len": len(payload.text),
                "grade": 평가.grade,
            },
        ),
        # 로그는 `평가기록()` 이 더 자세히 남긴다(`eval_fallback`·`prompt_chars`).
        이벤트(
            "eval_result",
            {
                "grade": 평가.grade,
                "signal_count": len(평가.signals),
                "latency_ms": round(평가.latency_ms),
            },
            로그=False,
        ),
    ]
    if payload.retry_of is not None:
        # H2 재시도율(합격선 20%) — **보상이 동기로 작동한다는 직접 신호**다.
        남길것.append(이벤트("card_retry", {"card_id": payload.card_id, "prompted": False}))
    await 남기기(아이.id, *남길것)

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
            "placeholder_url": fx.sketch_url(payload.card_id),
        },
        today=TodayState(cards_done=3, cap=5, locked=False),
        can_retry=True,
    )


async def _되묻기(자녀id: str, card_id: str) -> AttemptScaffold | None:
    """G0 되묻기 (`Stage0.md` 9절 6번). 되묻지 않을 상황이면 `None` — 결과로 진행한다.

    **카드를 소모하지 않는다.** 프론트는 입력창과 쓰던 글을 그대로 둔다.
    """
    횟수 = await 되묻기횟수(자녀id, card_id)

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
    # 로그 줄은 위에 이미 나갔다. 행만 더한다 — 두 번 내보내면 발동률이 두 배로 세인다.
    await 남기기(
        UUID(자녀id),
        이벤트("scaffold_triggered", {"card_id": card_id, "attempt": 횟수}, 로그=False),
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
