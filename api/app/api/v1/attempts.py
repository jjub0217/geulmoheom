"""4. 시도 (`docs/api/Stage0.md` 4절) — 핵심 엔드포인트.

응답은 `outcome` 3분기다. **프론트가 이 값으로 화면을 가른다** (api/CLAUDE.md).
`X-Mock-Outcome` 헤더로 셋을 강제할 수 있다 — W3 화면 작업이 쓴다.

**헤더가 없으면 실제 Evaluator 로 간다** (W2 2번). 아직 목인 것은 아래 셋이다.

- `today` 카운트·`can_retry` — 일일 카운트는 A0-5 가 센다
- `artwork` — 이미지 큐(B-3)가 아직 없다. `pending` 고정

**소모 이력은 실제로 저장된다** (A0-1 잔여). `outcome=result` 일 때만 `card_attempts`
행이 하나 생기고, **되묻기·차단은 카드를 안 쓰므로 행을 만들지 않는다**
(`Stage0.md` 4절 (b)·(c)). 저장되는 문장은 **가려진 뒤 문장**이다.

**`outcome=blocked` 는 실제 검사에서 나온다** (E-1 · `adr/0009`). 입력 검사·평가·실명
NER **셋을 동시에 던지고**, 검사가 차단하면 평가 결과를 버린다.

**PII 는 막지 않고 가린 뒤 진행한다** (E-2 · 2026-09-08 대표 판정, 미결 11-5).
그래서 `blocked` 의 `reason` 은 `moderation` 하나다.
"""

import asyncio
import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import (
    MockOutcome,
    Session,
    mock_daily_cap_reached,
    mock_outcome,
    require_child,
)
from app.artwork_store import 굽기
from app.artwork_store import 만들기 as 삽화만들기
from app.card_store import 오늘상태, 오늘쓴카드들
from app.errors import AppError, ErrorCode
from app.evaluator import evaluate, highlights, 평가결과, 평가기록
from app.events import 남기기, 이벤트
from app.guide_lines import 결과한줄, 종료대사, 차단대사, 하나
from app.middleware import current_request_id
from app.models import Artwork, Card, CardAttempt
from app.models import Child as ChildRow
from app.moderation import 검사하기
from app.pii import 가리기, 실명까지가리기
from app.scaffold import MAX_SCAFFOLD, 되묻기횟수, 되묻은횟수, 질문
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
        },
        today=TodayState(cards_done=3, cap=5, locked=False),
        can_retry=True,
    )


def _scaffold(today: TodayState | None = None) -> AttemptScaffold:
    return AttemptScaffold(
        outcome="scaffold",
        attempt_id=fx.ATTEMPT_ID,
        guide=Guide(
            expression="compass_dim",
            line="나침반이 안 움직이네. 그림자를 어떻게 할 건지 조금만 더 말해줄래?",
        ),
        scaffold_count=1,
        today=today or TodayState(cards_done=2, cap=5, locked=False),
    )


# **차단 대사는 `문구.md` 1.11 에서 읽는다** (2026-09-08 확정). 코드에 복사하지 않는다.

# **자해·자살 신호만 문구가 확정돼 있다** (`docs/문구.md` 1.2, 2026-09-07 대표 판정).
# 화면을 봐도 달라질 것이 없어 나머지 대사보다 먼저 닫혔다. **바꾸는 것은 「대표 몫」이다.**
#
# **한 줄만 말하고 이어 말하지 않는다.** 가이드는 상담자가 아니라 게임 마스터이고
# (C-1 「퀘스트 밖 자유 대화 없음」), 캐릭터가 아이의 실제 마음에 개입하면
# 「가상 페르소나 의존」(페르소나 4.4)이 정면으로 발생한다.
_자해대사 = "지금 마음이 많이 힘들면, 옆에 있는 어른한테 꼭 말해줘."


def _소진() -> AppError:
    """**`guide.line` 을 같이 싣는다.** 화면은 `error.message`(존댓말) 대신 이것만
    보여준다 (`문구.md` 0장) — 아이가 빈 화면을 보지 않게.

    문장은 `문구.md` 1.10 에서 읽는다. **다섯 다 「내일」이 들어간다** — 하드 피니시는
    가드레일이지 차단이 아니고, 「그만해」로 읽히면 그 구분이 무너진다.
    """
    return AppError(
        ErrorCode.DAILY_CAP_REACHED,
        detail={"guide": {"expression": "session_end", "line": 하나(종료대사())}},
    )


def _blocked(*, 자해: bool = False, today: TodayState | None = None) -> AttemptBlocked:
    """카테고리·사유는 응답에 넣지 않는다 — 아이에게 "나쁜 말" 피드백을 주지 않는다.

    **자해 분기도 겉모양이 같다.** 표정은 일반 차단과 같은 것을 쓰고 `reason` 도
    `moderation` 그대로다 (`docs/문구.md` 1.2). 이 상황 전용 표정이나 사유를 만들면
    **아이가 자기 신호가 특별히 취급됐다는 것을 알아챈다.** 달라지는 것은 대사 한 줄뿐이다.
    """
    return AttemptBlocked(
        outcome="blocked",
        reason="moderation",
        guide=Guide(expression="compass_dim", line=_자해대사 if 자해 else 하나(차단대사())),
        today=today or TodayState(cards_done=2, cap=5, locked=False),
    )


# 표정만 코드에 있다. **문장은 `문구.md` 1.6 이 SSOT** 이고 그 표에는 표정이 없다 —
# 가이드 에셋 파일명과 짝이라(`docs/캐릭터/표정/`) 문구가 정할 값이 아니다.
_결과표정: dict[Tier, str] = {
    "legendary": "compass_bright",
    "rare": "compass_bright",
    "basic": "default",
}


def _guide(tier: Tier, 시도id: UUID, 하이라이트: list[Highlight]) -> Guide:
    """결과 대사 (`문구.md` 1.6). 티어별 다섯 중 하나를 **시도 id 로 고정해** 고른다.

    **새로고침해도 같은 말이 나와야 한다.** 무작위로 두면 아이가 결과 화면을 다시
    열었을 때 **나침반이 다른 말을 한다** — 하이라이트를 저장한 것과 같은 자리이고,
    여기서는 **열을 늘리지 않고 되풀이할 수 있어** 씨앗으로 고정한다.

    **`{말}` 은 첫 하이라이트로 채운다.** 어느 말이 통했는지를 말하는 자리가 여기뿐이다
    (PRD A0-3 MUST). 하이라이트가 없으면 `{말}` 없는 문장만 고른다.
    """
    말 = 하이라이트[0].text if 하이라이트 else None
    return Guide(expression=_결과표정[tier], line=결과한줄(tier, 시도id, 말))


@router.post("")
async def create_attempt(
    payload: AttemptRequest,
    아이: Child,
    session: Session,
    뒤에서: BackgroundTasks,
    outcome: Annotated[MockOutcome | None, Depends(mock_outcome)],
    소진: Annotated[bool, Depends(mock_daily_cap_reached)],
) -> AttemptResponse:
    """`text` 1~500자. 재시도(`retry_of`)와 되묻기는 일일 카운트를 쓰지 않는다."""
    if outcome is not None:  # 목 강제 (W3 화면 작업)
        return {"result": _result, "scaffold": _scaffold, "blocked": _blocked}[outcome]()

    # **하루 5장에서 멈추는 것이 MVP 필수 가드레일이다** (PRD 하드 피니시). 상한은
    # 자녀 행에서 읽는다 — 학부모가 바꿀 수 있는 값이다.
    #
    # **재시도는 안 걸린다** (`Stage0.md` 4절). 되묻기 뒤 재입력은 `retry_of` 가
    # 비어 있는데(같은 시도의 연장이라 그렇게 정했다), 그건 카드를 아직 안 쓴 상태라
    # 아래 셈에서 자연히 통과한다.
    쓴수, 상한 = await 오늘상태(session, 아이)
    if (소진 or 쓴수 >= 상한) and payload.retry_of is None:
        # **상한 도달률이 H2 지표다** (합격선 40%). 409 로 나가는 길에도 남겨야 센다.
        await 남기기(아이.id, 이벤트("daily_cap_reached", {"cap": 상한}))
        raise _소진()

    # **저장할 수 있는 요청인지 먼저 본다.** 뒤로 미루면 평가·검사 호출이 이미 나간
    # 뒤에 FK 로 터져 500 이 되고, **돈은 나갔는데 아이는 오류를 본다.**
    await _쓸수있는카드인가(session, payload.card_id)
    재시도 = await _재시도확인(session, 아이, payload.retry_of)
    await _오늘_안_푼_카드인가(session, 아이, payload.card_id, 재시도)

    # **3. PII 2차 — 가린 뒤 진행한다. 막지 않는다** (`Stage0.md` 9절 3번,
    # 2026-09-08 대표 판정 · 미결 11-5). 막으면 아이에게 이유를 말해줄 수 없다 —
    # 차단 응답이 종류를 안 싣기 때문이다.
    #
    # **여기가 검사·평가보다 앞이어야 한다.** 저장 직전에 가리면 늦다 — 그 사이에
    # 검사와 평가가 **원문을 프로바이더로 내보낸다.** 아래 `text` 만 쓰는 이유가 그것이고,
    # `payload.text` 를 다시 꺼내 쓰면 그 순간 원문이 새어 나간다.
    #
    # 정규식 층은 동기라 먼저 끝난다. **검사·평가는 이 문장을 본다** — 전화번호·메일·
    # 주소·학교명은 여기서 이미 가려져 프로바이더로 안 나간다.
    검사할것, _ = 가리기(payload.text)

    # **셋을 동시에 던진다** (`adr/0009` 결정 2 와 같은 이유). 실명 NER 을 앞에 세워
    # 기다리면 +875ms 가 그대로 붙어 1.5초 예산을 깬다.
    #
    # **실명이 검사·평가 호출에 실려 나가는 것은 이 구조의 대가가 아니다** — NER 호출
    # 자체가 같은 프로바이더로 그 문장을 보낸다. `adr/0009` 48행이 「원문이 밖으로
    # 나간다는 사실은 순차든 병렬이든 같다」고 적어 둔 자리다. 여기서 막는 것은
    # **우리가 저장하는 것**이고, 아래 `text` 가 그 마스킹된 문자열이다.
    #
    # `기록=False` 다 — 차단이면 이 판정은 버려지고 `eval_result` 도 남기지 않는다
    # (결정 3). 버린 판정이 남으면 **화면에 보여주지도 않은 평가가 등급 분포를 오염시킨다.**
    검사, 평가, 가림 = await asyncio.gather(
        검사하기(검사할것),
        evaluate(검사할것, 기록=False),
        실명까지가리기(payload.text, 제외=(아이.nickname, 아이.guide_name or "")),
    )
    text, 가린종류 = 가림
    if 가린종류:
        # **종류만 남긴다.** 가린 값도, 몇 개였는지도 싣지 않는다 (PRD 1.1b).
        await 남기기(
            아이.id,
            *(이벤트("pii_masked", {"layer": "server", "kind": 종류}) for 종류 in 가린종류),
        )

    # **내장 필터가 막은 것도 차단이다.** 전에는 `evaluate()` 가 그걸 삼켜 G1 폴백으로
    # 넘겼고, 그러면 차단이 「그냥 평범한 문장」으로 기록됐다 (2026-09-07 PM 요청).
    # 우리 검사와 내장 필터는 축이 다르지만(`adr/0009`), **막았다는 사실은 양쪽 다 신호다.**
    if 검사.blocked or 평가.차단됨:
        # 평가 결과를 버린다. 차단 건의 평가 비용은 수용한다 (`adr/0009` 대가).
        return _blocked(자해=검사.self_harm, today=_오늘(쓴수, 상한))

    평가기록(평가)

    if 평가.grade == "G0":
        되물음 = await _되묻기(str(아이.id), payload.card_id, _오늘(쓴수, 상한))
        if 되물음 is not None:
            return 되물음

    하이라이트 = highlights(평가, text)

    # **`char_len` 은 공백 포함 길이다** (PRD 5장). 여기서 「원문」은 PII 마스킹 뒤
    # 텍스트이고, 그것이 `card_attempts.text` 로 저장되는 문자열이라 `len` 그대로가 맞다.
    # 화면의 30자·로그의 `char_len`·책의 문장이 **같은 문자열을 세야 한다.**
    남길것 = [
        이벤트(
            "turn_input",
            {
                "card_id": payload.card_id,
                "input_type": "free",
                "char_len": len(text),
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
    # **여기서 카드가 소모된다** (`Stage0.md` 9절 10번). 되묻기·차단은 위에서 돌아갔으므로
    # 이 줄에 닿는 것은 **카드를 실제로 쓴 입력**뿐이다.
    #
    # **이벤트보다 먼저 저장한다.** `남기기()` 는 실패를 삼키는데(측정이 아이 요청을
    # 죽이면 안 된다), 저장이 그 뒤에 있으면 **삼킨 실패 다음에 아이 문장이 날아간다.**
    시도 = await _이력남기기(
        session, 아이, payload, text=text, 평가=평가, 재시도=재시도, 하이라이트=하이라이트
    )

    # **행만 만들고 응답한다** (B-3 ①). 굽는 데 평균 6.2초가 드는데
    # (`benchmarks/W1-image-bench.md`) 그동안 아이를 세워 두지 않는다 — 프론트가
    # 3초 뒤부터 폴링한다 (`Stage0.md` 5절).
    삽화 = await 삽화만들기(session, 시도.id, 평가.tier)
    뒤에서.add_task(굽기, 삽화.id, payload.card_id, 평가.tier)

    await 남기기(아이.id, *남길것)

    # **등급은 여기서 끝난다.** 응답에 담기는 것은 티어뿐이다 (`Stage0.md` 4절).
    return AttemptResult(
        outcome="result",
        attempt_id=str(시도.id),
        tier=평가.tier,
        highlights=하이라이트,
        guide=_guide(평가.tier, 시도.id, 하이라이트),
        artwork={
            "artwork_id": str(삽화.id),
            "status": "pending",
            "url": None,
        },
        today=_오늘(쓴수 + 1, 상한),
        can_retry=True,
    )


async def _쓸수있는카드인가(session: AsyncSession, card_id: str) -> None:
    """모르는 카드면 404. **FK 에 맡기지 않는다.**

    맡기면 저장 시점에 터져 500 이 되는데, 그때는 평가·검사 호출이 이미 나간 뒤다 —
    **돈은 나갔고 아이는 「잠깐 문제가 생겼어요」를 본다.**

    **튜토리얼도 여기서는 통과시킨다.** 노출 경로가 열리면(Stage 1 A-6) 그 카드에도
    입력이 오고, 막는 자리는 `/cards/{id}` 조회 쪽이다.
    """
    if await session.scalar(select(Card.id).where(Card.id == card_id)) is None:
        raise AppError(ErrorCode.NOT_FOUND)


async def _재시도확인(session: AsyncSession, 아이: ChildRow, retry_of: str | None) -> UUID | None:
    """`retry_of` 가 **이 아이의** 시도인지 본다. 아니면 422.

    **404 로 가르지 않는다** — 남의 시도 id 를 넣었을 때 404 와 422 가 갈리면
    「그 시도는 존재한다」가 샌다. `{child_id}` 규칙과 같은 자리다 (`Stage0.md` 5절).

    **모양이 UUID 가 아닌 것도 여기서 걸러진다.** 계약은 `retry_of` 를 문자열로 두지만
    「ID 는 전부 UUID」가 `공통규약.md` 규약이다. 안 거르면 SQL 층까지 내려가 500 이 된다 —
    **잘못된 요청이 서버 오류로 보이면 프론트가 자기 잘못을 못 찾는다.**
    """
    if retry_of is None:
        return None

    try:
        아이디 = UUID(retry_of)
    except ValueError as 오류:
        raise AppError(ErrorCode.VALIDATION_ERROR, detail={"fields": ["retry_of"]}) from 오류

    문 = select(CardAttempt.id).where(CardAttempt.id == 아이디, CardAttempt.child_id == 아이.id)
    if await session.scalar(문) is None:
        raise AppError(ErrorCode.VALIDATION_ERROR, detail={"fields": ["retry_of"]})
    return 아이디


async def _오늘_안_푼_카드인가(
    session: AsyncSession, 아이: ChildRow, card_id: str, 재시도: UUID | None
) -> None:
    """오늘 이미 푼 카드면 409 `CARD_ALREADY_DONE_TODAY` (`공통규약.md` 오류 표).

    **`/cards/next` 가 안 줘도 클라이언트는 직접 부를 수 있다.** 주지 않는 것과 받지
    않는 것은 다른 자리라 둘 다 막는다.

    **재시도는 통과시킨다** — 「재시도는 별도 경로」가 그 표에 적힌 그대로다. 막으면
    결과 연출(A0-3)의 「다시 써보기」가 통째로 안 돌고, **H2 재시도율이 재는 것이
    그 동작**이다.

    **되묻기는 애초에 안 걸린다.** 행을 안 만들기 때문이다 — 되묻기 뒤 고쳐 보낸 것이
    여기서 막히면 아이가 그 카드에 갇힌다.
    """
    if 재시도 is not None:
        return
    if card_id in await 오늘쓴카드들(session, 아이.id):
        raise AppError(ErrorCode.CARD_ALREADY_DONE_TODAY)


async def _이력남기기(
    session: AsyncSession,
    아이: ChildRow,
    payload: AttemptRequest,
    *,
    text: str,
    평가: 평가결과,
    재시도: UUID | None,
    하이라이트: list[Highlight],
) -> CardAttempt:
    """`card_attempts` 행 하나. **아이 원문이 들어가는 유일한 자리다** (PRD 1.1b).

    **`text` 는 가려진 뒤 문장이다.** `payload.text` 를 여기서 다시 꺼내면 그 순간
    원문 그대로가 책 콘텐츠로 굳는다 — 위 마스킹 단계가 통째로 무의미해진다.

    `attempt` 는 **이 아이가 이 카드에 넣은 몇 번째 입력**인가다. 되묻기는 세지 않는다 —
    행을 만들지 않으므로 자연히 빠진다.
    """
    회차 = await session.scalar(
        select(func.count())
        .select_from(CardAttempt)
        .where(CardAttempt.child_id == 아이.id, CardAttempt.card_id == payload.card_id)
    )

    시도 = CardAttempt(
        child_id=아이.id,
        card_id=payload.card_id,
        attempt=(회차 or 0) + 1,
        retry_of=재시도,
        prompted=payload.prompted,
        grade=평가.grade,
        tier=평가.tier,
        signals=평가.signals,
        # **화면에 실제로 덧칠된 것을 그대로 남긴다.** `signals` 에서 다시 만들면
        # 줄어들고(원형 vs 활용형), 첫 하이라이트에서 나오는 **가이드 대사까지 바뀐다.**
        highlights=[h.model_dump() for h in 하이라이트],
        scaffold_count=await 되묻은횟수(str(아이.id), payload.card_id),
        char_len=len(text),
        text=text,
    )
    session.add(시도)
    await session.commit()
    return 시도


def _오늘(쓴수: int, 상한: int) -> TodayState:
    return TodayState(cards_done=쓴수, cap=상한, locked=쓴수 >= 상한)


async def _되묻기(자녀id: str, card_id: str, today: TodayState) -> AttemptScaffold | None:
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
        today=today,
    )


@router.get("/{attempt_id}")
async def get_attempt(
    attempt_id: str, 아이: Child, session: Session, request: Request
) -> AttemptResult:
    """새로고침 복구용. **저장된 그 시도를** 정상(result) 형식으로 돌려준다.

    **픽스처였을 때는 버그였다** — `attempt_id` 가 진짜가 된 뒤로 아이가 결과 화면에서
    새로고침하면 **자기 것이 아닌 결과**를 봤다. 프리테스트에서 아이가 실제로 하는
    동작이다.

    **남의 시도는 404 다.** 403 으로 가르면 「그 시도는 존재한다」가 샌다.

    **되묻기·차단은 복구할 것이 없다** — 행을 안 만들기 때문이다 (`Stage0.md` 4절).
    그래서 이 경로는 `result` 하나만 돌려준다.
    """
    시도 = await _내시도읽기(session, attempt_id, 아이)
    if 시도 is None:
        raise AppError(ErrorCode.NOT_FOUND)

    # **저장한 것을 그대로 돌려준다** (`Stage0.md` 10절, 2026-09-08). 다시 만들면
    # 줄어든다 — `signals` 는 말을 원형으로 주는데(「캄캄한」) 문장에는 활용형이
    # 있어(「캄캄했지만」) 원문 대조에서 걸러지고, **첫 하이라이트에서 나오는 가이드
    # 대사까지 바뀐다.**
    #
    # **줄어드는 것이 문제다.** 프리테스트 관찰 신호 7번이 「자기 문장이 하이라이트된
    # 것을 알아보는가」이고, 아이가 새로고침하면 그 관찰이 오염된다 — **원인이 제품인지
    # 복구 결함인지 우리가 못 가른다.**
    하이라이트 = [Highlight.model_validate(h) for h in 시도.highlights]
    티어: Tier = 시도.tier or "basic"

    return AttemptResult(
        outcome="result",
        attempt_id=str(시도.id),
        tier=티어,
        highlights=하이라이트,
        guide=_guide(티어, 시도.id, 하이라이트),
        artwork=await _삽화참조(session, 시도.id, request),
        today=TodayState(cards_done=3, cap=5, locked=False),
        can_retry=True,
    )


async def _내시도읽기(session: AsyncSession, attempt_id: str, 아이: ChildRow) -> CardAttempt | None:
    """**이 아이의** 시도만. 모양이 UUID 가 아니면 없는 것이다."""
    try:
        아이디 = UUID(attempt_id)
    except ValueError:
        return None

    문 = select(CardAttempt).where(CardAttempt.id == 아이디, CardAttempt.child_id == 아이.id)
    return await session.scalar(문)


async def _삽화참조(session: AsyncSession, card_attempt_id: UUID, request: Request) -> dict:
    """그 시도에 달린 삽화. **없으면 `pending` 으로 준다.**

    **다른 삽화 id 를 주면 안 된다** — 아이가 새로고침한 순간 폴링이 남의 행을 물고,
    자기 그림을 영영 못 받는다.
    """
    문 = select(Artwork).where(Artwork.card_attempt_id == card_attempt_id)
    삽화 = await session.scalar(문)
    if 삽화 is None:
        return {"artwork_id": fx.ARTWORK_ID, "status": "pending", "url": None}

    return {
        "artwork_id": str(삽화.id),
        "status": 삽화.status,
        "url": str(request.url_for("get_artwork_image", artwork_id=str(삽화.id)))
        if 삽화.status == "ready"
        else None,
    }
