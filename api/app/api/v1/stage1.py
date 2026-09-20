"""Stage 1 「TRPG」 — 챕터와 턴 (`docs/api/Stage1.md` 1·2절 · W7 3번).

**목이었다** (W7 0번, `ea93af3`). **라우트와 응답 모델은 그대로 남고 본문만 바뀌었다** —
프론트의 `types.gen.ts` 가 안 흔들리는 것이 그 순서의 값이었다.

**⛔ 처리 순서는 계약 2절이 정한다.** `/attempts` 와 같은 뼈대다 —
**입력 검사 → PII → 평가 → G0 되묻기 → GM → GM 출력 검사 → 저장 → 로그.**
`검사하기()` 가 **평가·GM 앞**에 있는 것이 이 파일에서 가장 중요한 순서다:
뒤로 밀면 **차단된 문장이 프로바이더로 나가고 그 위에 서사가 얹힌다.**

**⛔ 아이 원문이 로그·이벤트·턴 기록에 안 남는다** (PRD 1.1b). `chapter_turns` 에는
**칸조차 없다**(`b18c4f27a5d1`). 남는 것은 **등급·경로·길이**뿐이다.

**⏳ 아직 안 붙은 것 셋 — 다른 항목이다**

- **상태 추출기·요약기** (계약 8·9번) → 2번(A-2). 지금 `state` 는 열 때 값이 그대로 간다
- **일일 턴 상한** (계약 3번 · `429 TURN_LIMIT`) → 6번(D-2). **코드와 문구는 섰다**
- **하루 한 챕터** (`409 CHAPTER_DONE_TODAY`) → 5번(D-1). `chapter_store.오늘완결했나()` 가 서 있다
- **삽화 굽기** (계약 10번) → 핵심 씬 자리. `artwork` 는 **없을 수 있는 값**이다(명세 변경)
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request, status
from sqlalchemy import select

from app import chapter_run as 진행기
from app import chapter_skeleton as 뼈대
from app import chapter_store as 저장소
from app.api.v1.deps import Session, require_child
from app.artwork import 내보내도되나, 챕터프롬프트
from app.artwork_store import 챕터굽기, 챕터삽화만들기, 챕터삽화수
from app.book_store import 챕터장번호, 챕터페이지올리기
from app.chapter_state import 상태추출, 요약재료, 요약하기, 요약할때인가, 최근원문
from app.daily_turns import 다썼나
from app.errors import AppError, ErrorCode
from app.evaluator import evaluate, 평가기록
from app.events import 남기기, 이벤트
from app.gm import 도입프롬프트, 서사, 시스템지시, 턴프롬프트
from app.guide_lines import (
    시련대사,
    완결대사,
    완결대사_그림,
    자해대사,
    종료대사,
    차단대사,
    챕터진행대사,
    카드첫말,
    하나,
)
from app.middleware import current_request_id
from app.models import Artwork, Chapter
from app.models import Child as ChildRow
from app.moderation import 검사하기
from app.pii import 가리기, 실명까지가리기
from app.scaffold import 되묻기횟수, 질문
from app.schemas.stage0 import ArtworkRef, Guide
from app.schemas.stage1 import (
    ChapterState,
    ChapterSummary,
    ChapterTurnView,
    ChapterView,
    Choice,
    HeroState,
    TurnRequest,
    TurnResult,
)

logger = logging.getLogger(__name__)

Child = Annotated[ChildRow, Depends(require_child)]

router = APIRouter(prefix="/chapters", tags=["stage1"])
턴라우터 = APIRouter(prefix="/turns", tags=["stage1"])

# **핵심 씬 상한 — 한 챕터에 둘** (뼈대 「핵심 씬」). **그 수가 돈이다.**
핵심씬상한 = 2

# **되묻기는 같은 턴에서 최대 2회** (PRD A-5). 2회 뒤에는 G1 취급으로 진행한다 —
# **아이를 막지 않는다.** `/attempts` 와 같은 값을 쓴다
최대되묻기 = 2


def _오늘끝났다() -> AppError:
    """`409 CHAPTER_DONE_TODAY` (D-1 · `문구.md` 1.20).

    **`guide.line` 을 같이 싣는다** — 화면은 `error.message`(존댓말) 대신 이것만
    보여준다 (`문구.md` 0장). `/attempts` 의 소진(`_소진()`)과 같은 모양이다.

    **⛔ 1.10 을 돌려 쓰지 않는다.** 1.20 이 **「1.10 은 「더 못 한다」이고 이건 「다
    했다」다 — 같은 문장을 돌려 쓰면 끝낸 아이와 막힌 아이가 같은 말을 듣는다」**로
    못 박았다.
    """
    return AppError(
        ErrorCode.CHAPTER_DONE_TODAY,
        detail={"guide": {"expression": "session_end", "line": 하나(완결대사())}},
    )


def _턴을다썼다() -> AppError:
    """`429 TURN_LIMIT` (D-2 · `문구.md` 1.21 → **1.10 을 그대로 쓴다**).

    **새 문구를 만들지 않는다** — 1.21 이 그렇게 정했다. **「15분」이 없는 문장이라야
    한다**(2.1 이 `RATE_LIMITED` 를 고친 이유) — `CHILD_MESSAGE` 의 `TURN_LIMIT` 이
    그 조건을 지킨 문장이고, 가이드 줄은 1.10 다섯 중 하나다.
    """
    return AppError(
        ErrorCode.TURN_LIMIT,
        detail={"guide": {"expression": "session_end", "line": 하나(종료대사())}},
    )


async def _최근챕터삽화(session: Session, chapter_id: uuid.UUID) -> Artwork | None:
    """이 챕터의 마지막 핵심 삽화만 읽는다.

    이어 쓰기와 새로고침에서 직전 삽화가 사라지지 않게 하지만, 다른 챕터의 삽화는
    결코 섞지 않는다. 아직 굽는 행도 그대로 돌려 프론트가 실제 상태를 폴링하게 한다.
    """
    return await session.scalar(
        select(Artwork)
        .where(Artwork.chapter_id == chapter_id)
        .order_by(Artwork.created_at.desc())
        .limit(1)
    )


def _삽화참조(삽화: Artwork | None) -> ArtworkRef | None:
    if 삽화 is None:
        return None
    return ArtworkRef(artwork_id=str(삽화.id), status=삽화.status, url=None)


async def _보기(session: Session, 챕터: Chapter) -> ChapterView:
    """행 → 계약 1절의 응답. **`state` 는 부분집합만 나간다** —
    `summary`·`recent_turns`·`grades` 는 안 실린다 (아이 원문·점수)."""
    return ChapterView(
        chapter_id=str(챕터.id),
        chapter_key=챕터.chapter_key,
        turn=챕터.turn,
        beat=챕터.beat,  # type: ignore[arg-type]
        narrative=챕터.narrative or "",
        choices=[Choice(**것) for 것 in 챕터.choices],
        state=_상태보기(챕터.state),
        turns_left=저장소.남은턴(챕터),
        artwork=_삽화참조(await _최근챕터삽화(session, 챕터.id)),
        guide=Guide(expression="default", line=카드첫말()),
        turns=await _지금까지쓴것(session, 챕터),
    )


async def _지금까지쓴것(session: Session, 챕터: Chapter) -> list[ChapterTurnView]:
    """이 판에서 아이가 쓴 것과 그 턴의 GM 서사 (2026-09-21 명세 변경 · `Stage1.md` 1절).

    **⛔ 아이가 쌓은 것이 화면에 안 보였다.** 몇 턴을 써도 **완결해야 비로소 책에서**
    자기 글을 봤다. **「글이 쌓여 책이 된다」가 약속인데 쌓이는 게 안 보였다.**

    **⭐ 저장할 것을 새로 만들지 않는다** — `text` 도 `gm_narrative` 도 이미 있다.
    **읽어 보내기만 한다.**

    **⛔ 고른 턴은 뺀다** (`input_type == "choice"`). 그 `text` 는 **GM 이 쓴 선택지
    라벨**이라 **아이가 쓴 글이 아니다.** 실으면 **아이 화면에 「내가 쓴 것」으로
    남의 글이 섞인다.** **책이 `input_type` 으로 가르는 것과 같은 규칙**이다
    (`models.py` `ChapterTurn`). **`adr/0017` 뒤로는 안 생기지만 과거 판에 남아 있다.**

    **⛔ 자르지 않는다** — 한 챕터가 10~12턴이라 **상한이 이미 구조에 있다.**

    **⛔ 등급을 안 싣는다** — 내보내면 **화면이 그것을 점수로 그린다**(금지어).
    """
    return [
        ChapterTurnView(turn=것.turn_no, text=것.text, narrative=것.gm_narrative)
        for 것 in await 저장소.턴들(session, 챕터.id)
        if 것.input_type != "choice"
    ]


def _상태보기(상태: dict) -> ChapterState:
    영웅 = 상태.get("hero", {})
    return ChapterState(
        hero=HeroState(hp=영웅.get("hp", 0), items=list(영웅.get("items", []))),
        location=str(상태.get("location", "")),
    )


def _서사확인(결과):
    """GM 결과를 응답으로 옮긴다. **폴백 서사를 만들지 않는다** (계약 2절 7번).

    **⛔ 막힌 자리에 우리가 글을 지어 넣으면 그 글에는 검사가 없다.**
    """
    if 결과.막혔나:
        raise AppError(ErrorCode.GM_UNSAFE)
    if 결과.출력 is None:
        # `timeout` 은 아이에게 「잠깐 느려요」다 — 나머지는 우리 쪽 고장이다
        raise AppError(
            ErrorCode.UPSTREAM_TIMEOUT if 결과.사유 == "timeout" else ErrorCode.INTERNAL_ERROR
        )
    return 결과.출력


@router.post("", status_code=status.HTTP_201_CREATED)
async def open_chapter(아이: Child, session: Session) -> ChapterView:
    """챕터를 연다 (계약 1절). **요청 본문 없음** — 아이 쿠키로 누구인지 안다.

    **⛔ 진행 중인 챕터가 있으면 새로 안 연다 — 그것을 돌려주고 GM 을 안 부른다.**
    **⭐ 아이가 새로고침해도 이야기를 잃지 않는다**, 그리고 **새로고침마다 도입이
    바뀌거나 돈이 나가지 않는다.**

    **⏳ 오늘 완결했으면 `409 CHAPTER_DONE_TODAY` 는 5번(D-1)이 붙인다** —
    코드·문구·`오늘완결했나()` 는 이미 서 있다.
    """
    있는것 = await 저장소.진행중(session, 아이)
    if 있는것 is None:
        # **⛔ 판을 열기 전에 잠금을 본다.** 뒤로 밀면 **잠긴 아이 때문에 GM 호출이
        # 나가고 돈이 쓰인다** — 그리고 그 판은 화면에 안 뜬다
        if await 저장소.오늘완결했나(session, 아이):
            raise _오늘끝났다()
        if await 다썼나(session, 아이):
            # **상한 도달 시 하드 피니시와 동일 화면**이지만 **문구는 1.10 이다** (D-2)
            raise _턴을다썼다()
    if 있는것 is not None:
        # **이어받은 판이다.** `turn_resume` 이 0 보다 크면 **새로고침이 이야기를
        # 안 잃었다**는 뜻이고, 그것이 이 이벤트를 남기는 이유다 (PRD 5장)
        await 남기기(아이.id, 이벤트("chapter_start", {"turn_resume": 있는것.turn}))
        return await _보기(session, 있는것)

    상태 = 진행기.첫상태()
    출력 = _서사확인(await 서사(시스템지시(), 도입프롬프트(상태=상태), 턴=0))
    챕터 = await 저장소.열기(
        session,
        아이,
        서사=출력.narrative,
        선택지=[것.model_dump() for 것 in 출력.choices],
        상태=상태,
    )
    await session.commit()
    await 남기기(아이.id, 이벤트("chapter_start", {"turn_resume": 0}))
    return await _보기(session, 챕터)


@router.get("/current")
async def current_chapter(아이: Child, session: Session) -> ChapterView:
    """지금 상태 (계약 1절). **진행 중인 챕터가 없으면 `404 NO_ACTIVE_CHAPTER`.**"""
    있는것 = await 저장소.진행중(session, 아이)
    if 있는것 is None:
        # **⛔ 「끝냈다」와 「없다」를 가른다** (D-1). 둘 다 `404 NO_ACTIVE_CHAPTER` 로
        # 두면 **끝낸 아이가 「지금 이어갈 이야기가 없어요」를 본다** — 사실은 끝낸
        # 것이고, 화면이 잠금을 그리려면 이 둘이 갈려 있어야 한다
        if await 저장소.오늘완결했나(session, 아이):
            raise _오늘끝났다()
        raise AppError(ErrorCode.NO_ACTIVE_CHAPTER)
    return await _보기(session, 있는것)


@router.get("/{chapter_id}/summary")
async def chapter_summary(chapter_id: str, 아이: Child, session: Session) -> ChapterSummary:
    """완결 화면 (계약 5절 · D-1).

    **⛔ 「이어서 더 하기」를 응답에 넣지 않는다. 없는 것이 결정이다** (페르소나 7.1).

    **⏳ `book_page_no` 는 9번(A-7)이 채운다** — 「완결 = 책 한 장」이 그쪽이다.
    """
    챕터 = await 저장소.내챕터(session, 아이, chapter_id)
    if 챕터 is None:
        raise AppError(ErrorCode.NOT_FOUND)

    진행 = 저장소.진행으로(챕터)
    return ChapterSummary(
        chapter_id=str(챕터.id),
        chapter_key=챕터.chapter_key,
        title=진행기.챕터제목(),
        turns_used=챕터.turn,
        trial_path=챕터.trial_path,  # type: ignore[arg-type]
        tier=진행기.티어(진행) if 진행.완결 else None,
        # **완결 화면이 「네 책에 들어갔어」라고 말한다**(문구 1.20) — **어디에
        # 들어갔는지 가리킬 값**이 이것이다
        book_page_no=await 챕터장번호(session, 아이, 챕터.id),
    )


@턴라우터.post("")
async def create_turn(
    request: Request,
    payload: TurnRequest,
    아이: Child,
    session: Session,
    뒤에서: BackgroundTasks,
) -> TurnResult:
    """아이가 직접 쓴 문장으로 턴 하나를 진행한다 (계약 2절).

    인증 의존성을 통과한 뒤, 챕터 조회·평가·상태 변경 전에 선택지 제출을 막는다.
    `choice_id` 필드는 이전 클라이언트에 422 안내를 돌려주기 위해서만 남긴다.
    """
    if payload.choice_id is not None or payload.text is None or not payload.text.strip():
        raise AppError(ErrorCode.VALIDATION_ERROR, message="어떻게 할지 직접 써 주세요.")

    챕터 = await 저장소.진행중(session, 아이)
    if 챕터 is None:
        raise AppError(ErrorCode.NO_ACTIVE_CHAPTER)
    if str(챕터.id) != payload.chapter_id:
        # **남의 판이거나 이미 끝난 판이다.** 넘어가면 다른 이야기에 글을 쓴다
        raise AppError(ErrorCode.NOT_FOUND)

    # **⛔ 상한을 프로바이더 호출 앞에 둔다** (D-2). 계약 2절은 이것을 3번(검사·PII
    # 뒤)으로 적어 뒀는데, **`/attempts` 는 맨 앞에서 본다** — 계약이 「같은 뼈대」라
    # 부른 그 코드다. **뒤에 두면 잠긴 아이 때문에 검사·평가 호출이 나가고**, 아이는
    # 결과를 못 본다. **PM 에게 알렸다.**
    if await 다썼나(session, 아이):
        raise _턴을다썼다()

    입력, 입력종류 = payload.text, "free"

    # **1~2. 검사·평가 앞에 정규식 마스킹을 세운다** (`/attempts` 와 같은 순서).
    # 저장 직전에 가리면 늦다 — 그 사이에 **검사와 평가가 원문을 프로바이더로 보낸다.**
    검사할것, _ = 가리기(입력)
    검사, 평가, 가림 = await asyncio.gather(
        검사하기(검사할것),
        evaluate(검사할것, 기록=False),
        실명까지가리기(입력, 제외=(아이.nickname, 아이.guide_name or "")),
    )
    문장, 가린종류 = 가림
    if 가린종류:
        # **종류만 남긴다.** 가린 값도, 몇 개였는지도 싣지 않는다 (PRD 1.1b)
        await 남기기(
            아이.id,
            *(이벤트("pii_masked", {"layer": "server", "kind": 종류}) for 종류 in 가린종류),
        )

    if 검사.blocked or 평가.차단됨:
        # **여기서 멈춘다 — GM 을 부르지 않는다** (계약 2절 1번).
        #
        # **⛔ 차단은 오류가 아니라 정상 응답이다** (2026-09-16 계약 정정 `dc975e5`).
        # 종전 `422 UNSAFE_INPUT` 은 **6절(「새 코드는 넷뿐」)과 어긋났고, 어긋난 쪽이
        # 2절이었다** — `Stage0.md` 가 이미 `(c) 차단` 정상 응답으로 정해 뒀다
        # (2026-09-08 대표 판정).
        #
        # **⛔ 그리고 그게 아이에게 중요하다.** `Stage0.md` 148행: **「차단 시 아이가 쓴
        # 문장을 지우지 않는다. 입력창에 그대로 남긴다 — 이유도 모른 채 공들여 쓴 글이
        # 사라지면 그것 자체가 벌로 읽힌다」.** **422 면 화면이 오류 갈래로 가고 그
        # 규칙이 깨진다** (프론트가 짚었다).
        #
        # **차단 기록은 여기서 남기지 않는다** — `moderation_blocked` 를
        # `app/moderation.py` 가 이미 남긴다 (`direction`·`category`·`text_hash`).
        # 두 번 남기면 **안전 이슈 건수가 두 배로 세인다.**
        return _차단(챕터, 현재=저장소.진행으로(챕터), 자해=검사.self_harm)

    평가기록(평가)
    현재 = 저장소.진행으로(챕터)

    진행등급 = 평가.grade
    if 진행기.스캐폴딩할까(평가.grade, 선택지로왔나=False):
        되물음 = await _되묻기(아이, 챕터, 현재)
        if 되물음 is not None:
            return 되물음
        # **되물을 차례가 아니거나 셀 수 없었다 → `G1` 취급으로 진행한다** (PRD A-5
        # 「2회 후에도 G0이면 G1 취급으로 진행 — 아이를 막지 않음」).
        # **⛔ 여기서 안 올리면 아이가 갇힌다** — 되묻기도 안 받고 턴도 안 가는 상태가
        # 된다. **로그·`chapter_turns` 의 `grade` 는 평가가 준 값 그대로** 둔다
        # (`/attempts` 선례): 진행에 쓰는 취급과 **판정이 실제로 무엇이었나**는 다른
        # 값이고, **응답에는 둘 다 안 나간다**(2026-09-16 명세 변경).
        진행등급 = "G1"

    # **6. GM 호출** — 등급·뼈대·상태·요약·최근 원문을 실어. **다음 턴의 비트로 묻는다**
    다음턴 = 현재.턴 + 1
    # **⛔ 최근 3턴 원문은 `chapter_turns` 에서 읽는다** (PRD A-2). `state` 에 복사하지
    # 않는다 — **저장이 아니라 조립이다**(원문 허용 칸에 `state` 가 없다)
    지난턴들 = await 저장소.턴들(session, 챕터.id)
    출력 = _서사확인(
        await 서사(
            시스템지시(),
            턴프롬프트(
                턴=다음턴,
                상태=챕터.state,
                아이입력=문장,
                등급=진행등급,
                # **취급 등급으로 뽑는다** (B-4). 되묻기를 못 받은 G0 은 `G1` 취급이라
                # 보너스도 0 이다 — **-1 을 그대로 주면 되묻기를 못 받은 아이가 벌까지 받는다**
                보너스=진행기.보너스(진행등급),
                요약=str(챕터.state.get("summary") or ""),
                최근=최근원문(지난턴들),
                시련넘었나=현재.시련넘었나,
            ),
            턴=다음턴,
        )
    )

    # **경로 판별은 GM 이 한다** (PRD A-4). 서버가 낱말로 맞히면 **서사와 센 경로가 갈린다**
    진행 = 진행기.다음(현재, 등급=진행등급, 경로=출력.trial_path)
    # **8. 상태 추출기 — 매 턴** (계약 2절 8번). **9. 요약기 — 3턴마다** (사용자 판정).
    # **⛔ 둘 다 실패해도 턴은 지나간다** — 서사는 이미 나왔고 이것들은 그 다음이다.
    새상태 = await _상태갱신(챕터.state, 출력.narrative)
    새상태 = await _요약갱신(
        새상태, 진행.턴, [*지난턴들, _막턴(진행, 평가.grade, 문장, 출력.narrative)]
    )

    await 저장소.굴리기(
        session,
        챕터.id,
        진행,
        등급=평가.grade,
        입력종류=입력종류,
        글자수=len(문장),
        문장=문장,  # **마스킹을 지난 문장이고 책에 실린다** (A-7)
        서사=출력.narrative,
        선택지=[것.model_dump() for 것 in 출력.choices],
        상태=새상태,
    )
    await session.commit()

    # **10. 핵심 씬이면 굽는다** (계약 2절 10번 · W7 14번). **상한은 여기서 쥔다.**
    삽화 = await _핵심씬삽화(session, 챕터, 진행, 출력, 문장, 뒤에서)

    # **11. 턴 로그 — 원문이 없다.** 등급·경로·길이만이다 (계약 2절 11번)
    남길것 = [
        # **Stage 1 은 `turn_idx`, Stage 0 은 `card_id`** — 5장이 그렇게 갈라 뒀다
        이벤트(
            "turn_input",
            {
                "turn_idx": 진행.턴,
                "input_type": 입력종류,
                "char_len": len(문장),
                "grade": 평가.grade,
            },
        )
    ]
    if 진행.비트 == "trial" and 진행.시련경로:
        # **4경로 사용 균형을 이 이벤트로 잰다** (PRD A-4 · 5장)
        남길것.append(이벤트("trial_path", {"path": 진행.시련경로, "passed": 진행.시련넘었나}))
    완결삽화: ArtworkRef | None = None
    if 진행.완결:
        # **완결 = 책 한 장** (A-7). **이벤트보다 먼저 만든다** — `남기기()` 는 실패를
        # 삼키는데(측정이 아이 요청을 죽이면 안 된다) 책이 그 뒤에 있으면
        # **삼킨 실패 다음에 아이 책이 안 생긴다.** `/attempts` 와 같은 순서다
        완결삽화 = await _책한장(session, 아이, 챕터, 진행)
        남길것.append(await _완결이벤트(session, 챕터, 진행))
    await 남기기(아이.id, *남길것)

    시련중 = 진행.비트 == "trial"
    return TurnResult(
        outcome="result",
        turn=진행.턴,
        beat=진행.비트,
        scaffold=None,
        narrative=출력.narrative,
        choices=[Choice(**것.model_dump()) for 것 in 출력.choices],
        state=_상태보기(새상태),
        turns_left=max(0, 진행기.최대턴 - 진행.턴),
        artwork=삽화,
        chapter_done=진행.완결,
        guide=_진행가이드(챕터.id, 진행, 대표삽화=완결삽화),
        trial_path=진행.시련경로 if 시련중 else None,
        trial_progress=진행.시련진행 if 시련중 else None,
    )


def _진행가이드(챕터id: object, 진행: 진행기.진행, *, 대표삽화: ArtworkRef | None = None) -> Guide:
    """진행 사실을 안내한다. 글자 수나 등급으로 표정·대사를 추정하지 않는다."""
    if 진행.완결 and 대표삽화 is not None:
        상태 = "준비됨" if 대표삽화.status == "ready" else "준비 중"
        return Guide(expression="session_end", line=완결대사_그림()[상태])
    if 진행.완결:
        return Guide(expression="session_end", line=하나(완결대사(), 챕터id))
    if 진행.비트 == "trial":
        상황 = "passed" if 진행.시련넘었나 else "progress" if 진행.시련진행 > 0 else "enter"
        return Guide(expression="default", line=시련대사(상황))
    if 진행.턴 == 뼈대.시련턴 - 1:
        # 8→9 제출이 시련의 첫 평가다. 그 입력을 쓰기 전에 중요한 장면을 알린다.
        return Guide(expression="default", line=시련대사("enter"))
    return Guide(expression="default", line=챕터진행대사())


def _차단(챕터: Chapter, *, 현재, 자해: bool) -> TurnResult:
    """입력이 검사에 걸렸을 때 (`Stage1.md` 2절 1번 · `문구.md` 1.11).

    **⛔ 턴을 안 먹는다** — 막힌 것이 아이 몫을 깎으면 **그 자체가 벌**이 된다.
    **⛔ 종류·카테고리를 응답에 안 싣는다** — 아이에게 「나쁜 말」 피드백을 주지 않는다.

    **자해 분기는 겉모양이 같다** (`문구.md` 1.2 · Stage 0 선례). 표정도 `reason` 도
    같고 **달라지는 것은 대사 한 줄**이다 — 전용 표정이나 사유를 만들면 **아이가
    자기 신호가 특별히 취급됐다는 것을 알아챈다.**
    """
    return TurnResult(
        outcome="blocked",
        reason="moderation",
        turn=현재.턴,
        beat=현재.비트,
        scaffold=None,
        narrative=None,
        choices=[Choice(**것) for 것 in 챕터.choices],
        state=_상태보기(챕터.state),
        turns_left=저장소.남은턴(챕터),
        guide=Guide(
            expression="compass_dim",
            line=자해대사() if 자해 else 하나(차단대사()),
        ),
        chapter_done=False,
    )


async def _핵심씬삽화(
    session: Session,
    챕터: Chapter,
    진행,
    출력,
    문장: str,
    뒤에서: BackgroundTasks,
) -> ArtworkRef | None:
    """핵심 씬 삽화 (B-3 재사용 · W7 14번). **핵심 씬이 아니면 `None`.**

    **⛔ 상한을 서버가 쥔다 — 한 챕터에 둘.** 뼈대가 **1턴·9턴**으로 묶은 근거가
    **돈**이다: **매 턴 굽으면 한 챕터에 10회이고 하루 상한($0.50)을 한 아이가 혼자
    넘는다.** **모델이 `is_key_scene: true` 를 줘도 여기서 막힌다** — 1번에서 그 값을
    되찾은 것과 **같은 자리**이고, **돈이 걸린 판단을 프롬프트 준수율에 맡기지 않는다.**

    **⛔ 출력 검사가 굽기 앞에 있다** (E-1 양방향 — 이미지 프롬프트도 검사 대상).
    **GM 이 낸 장면이 그대로 이미지 모델로 가는 자리**다. 막히면 **굽지 않고 기본
    에셋으로 간다** — 아이 화면에는 **빈 액자가 아니라 그림**이 있다(PRD B-3).

    **`None` 이 「없다」가 아니라 「새 그림이 없다」다** — 화면은 액자를 비우지 않고
    **직전 핵심 씬 그림을 그대로 둔다**(프론트 8번 규칙 · 명세 변경 `db327d6`).
    """
    if not 진행.핵심씬:
        return None
    if await 챕터삽화수(session, 챕터.id) >= 핵심씬상한:
        # **뼈대가 셋으로 늘어도 둘에서 멈춘다.** 문서가 늘면 `뼈대.핵심씬턴들()` 이
        # 먼저 터지게 돼 있지만(3개 초과), **여기도 막는다** — 돈은 두 겹으로 막는다
        logger.info(
            "챕터 핵심 씬 상한에 닿아 안 굽는다",
            extra={"request_id": current_request_id(), "turn_idx": 진행.턴},
        )
        return None

    tier = 진행기.티어(진행)
    프롬프트문 = 챕터프롬프트(출력.scene_prompt_hint, tier, 문장)
    굽나 = 프롬프트문 is not None and not (await 내보내도되나(프롬프트문)).blocked
    삽화 = await 챕터삽화만들기(session, 챕터.id, tier, 굽나=굽나)
    if 굽나:
        # **⛔ 가린 문장을 넘긴다** (`adr/0015` ②). 원문을 넘기면 **가린 것이 그림으로
        # 되돌아온다.** `문장` 이 그 마스킹된 값이다
        뒤에서.add_task(챕터굽기, 삽화.id, 출력.scene_prompt_hint, tier, 문장)
    return ArtworkRef(artwork_id=str(삽화.id), status=삽화.status, url=None)


class _막한턴:
    """아직 DB 에 없는 이번 턴을 요약 재료에 넣기 위한 한 줄.

    **⛔ 이번 턴을 빼면 3턴 갱신이 「1..M-1」만 덮어 구멍이 난다** — 그 구멍이
    이 설계가 막으려던 바로 그것이다.

    **⛔ `gm_narrative` 가 2026-09-17 에 붙었고, 여기가 제일 빠지기 쉬운 자리다.**
    요약이 **저장보다 먼저** 돌아서(위 순서), **이번 턴만 합성 객체로 들어간다.**
    여기에 안 실으면 **이번 턴의 GM 서사가 요약에서 빠지고**, 그 턴이 바로
    **제일 최근에 밝혀진 사실**이라 **잃으면 제일 아프다.**
    **검사가 이 자리를 본다** (`test_chapter_state.py`).
    """

    def __init__(self, turn_no: int, beat: str, grade: str, text: str, gm_narrative: str) -> None:
        self.turn_no, self.beat, self.grade, self.text = turn_no, beat, grade, text
        self.gm_narrative = gm_narrative
        self.input_type = "free"


def _막턴(진행, 등급: str, 문장: str, 서사: str) -> _막한턴:
    return _막한턴(진행.턴, 진행.비트, 등급, 문장, 서사)


async def _상태갱신(지금: dict, 서사: str) -> dict:
    """**매 턴 돈다** (계약 2절 8번). 실패하면 **직전 상태를 지킨다.**"""
    try:
        return await 상태추출(서사, 지금)
    except Exception:  # 체인이 아이 턴을 죽이지 않는다 — 로그는 체인 안에서 남긴다
        logger.warning("상태 추출을 건너뛴다", extra={"request_id": current_request_id()})
        return 지금


async def _요약갱신(상태: dict, 턴: int, 턴들: list) -> dict:
    """**3턴마다 돈다** (사용자 판정 · 돈). **요약은 `1..M` 전부를 덮는다.**

    **⛔ 밀린 턴에 구멍이 없는 이유가 이것이다** — 7·8턴은 요약이 `1..6` 에 머물지만
    **원문 창(최근 3턴)이 그 뒤를 덮는다.** 요약이 `1..N-3` 만 덮으면 그 겹침이
    사라지고 **아이가 한 일이 통째로 빠진다.**

    실패하면 **직전 요약을 지킨다** — 요약이 낡으면 GM 이 앞 이야기를 덜 알 뿐이다.
    """
    if not 요약할때인가(턴):
        return 상태
    try:
        새요약 = await 요약하기(요약재료(턴들))
    except Exception:
        logger.warning("요약을 건너뛴다", extra={"request_id": current_request_id()})
        return 상태
    return {**상태, "summary": 새요약} if 새요약 else 상태


async def _책한장(session: Session, 아이: ChildRow, 챕터: Chapter, 진행) -> ArtworkRef | None:
    """완결한 챕터를 책 한 장으로 (A-7 · `Stage1.md` 5절).

    **⛔ 고른 턴을 뺀다.** 그 문장은 **GM 이 쓴 선택지 라벨**이고, 실으면 **아이가 안
    쓴 글이 아이 책에 아이 글로 남는다.** 「아이 원문 그대로」가 거짓이 된다.

    **⛔ 요약·다듬기가 없다** — 쓴 순서대로 이어 붙이기만 한다 (비전 2장).

    **⏳ 삽화가 굽는 중이어도 그 참조를 붙인다.** 책은 같은 삽화를 잠시 확인하다가
    준비되면 그 면에서 바로 보여 준다. 그림이 늦어도 아이 글로 만든 장은 먼저 남는다.
    """
    턴들 = await 저장소.턴들(session, 챕터.id)
    아이가쓴것 = [것.text for 것 in 턴들 if 것.input_type == "free" and 것.text]
    # **그 챕터의 마지막 핵심 씬이 그 장의 그림이다** — **보상의 순간(9턴)**이고
    # `adr/0015` 가 「아이 문장으로 굽는 자리」로 적어 둔 그 턴이다
    삽화 = await _최근챕터삽화(session, 챕터.id)
    await 챕터페이지올리기(
        session,
        아이,
        챕터.id,
        tier=진행기.티어(진행),
        문장들=아이가쓴것,
        artwork_id=삽화.id if 삽화 is not None else None,
    )
    return _삽화참조(삽화)


async def _완결이벤트(session: Session, 챕터: Chapter, 진행) -> 이벤트:
    """`chapter_complete` (PRD 5장). **완결률과 소요 시간이 H1 지표다.**

    **등급 목록을 싣는다 — 원문은 안 싣는다.** `chapter_turns` 에 등급만 남아 있어
    **그 행들을 그대로 세면 된다**(PRD 5장 `grades[]`).
    """
    턴들 = await 저장소.턴들(session, 챕터.id)
    걸린초 = int((datetime.now(UTC) - 챕터.created_at).total_seconds())
    return 이벤트(
        "chapter_complete",
        {
            "turns": 진행.턴,
            "duration_sec": max(0, 걸린초),
            "grades": [것.grade for 것 in 턴들],
        },
    )


async def _되묻기(아이: ChildRow, 챕터: Chapter, 현재) -> TurnResult | None:
    """G0 되묻기 (계약 2절 5번 · PRD 4.4). **턴을 안 먹는다.**

    **⛔ 되묻기가 상한을 깎으면 막힌 아이가 더 빨리 잠긴다** (계약 4절).
    **2회 뒤에는 `None` — G1 취급으로 진행한다. 아이를 막지 않는다** (PRD A-5).

    **횟수 키에 턴을 넣는다** — 카드 자리에 `챕터:턴` 을 넘긴다. 턴이 안 들어가면
    **한 판에서 두 번 되묻고 나면 그 뒤로 영원히 안 되묻는다.**
    """
    키 = f"{챕터.id}:{현재.턴 + 1}"
    횟수 = await 되묻기횟수(str(아이.id), 키)
    if 횟수 is None or 횟수 > 최대되묻기:
        return None

    await 남기기(
        아이.id,
        이벤트("scaffold_triggered", {"turn_idx": 현재.턴 + 1, "attempt": 횟수}),
    )
    return TurnResult(
        outcome="scaffold",
        turn=현재.턴,
        beat=현재.비트,
        scaffold=질문(키, 횟수),
        narrative=None,
        choices=[Choice(**것) for 것 in 챕터.choices],
        state=_상태보기(챕터.state),
        turns_left=저장소.남은턴(챕터),
        guide=Guide(expression="compass_dim", line=질문(키, 횟수)),
        chapter_done=False,
    )


def _uuid인가(값: str) -> bool:
    """**모양이 UUID 가 아닌 것을 여기서 거른다** — `공통규약.md` 「ID 는 전부 UUID」."""
    try:
        uuid.UUID(값)
    except ValueError:
        return False
    return True
