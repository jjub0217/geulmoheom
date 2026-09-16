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
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app import chapter_run as 진행기
from app import chapter_store as 저장소
from app.api.v1.deps import Session, require_child
from app.errors import AppError, ErrorCode
from app.evaluator import evaluate, 평가기록
from app.events import 남기기, 이벤트
from app.gm import 도입프롬프트, 서사, 시스템지시, 턴프롬프트
from app.guide_lines import 자해대사, 차단대사, 하나
from app.models import Chapter
from app.models import Child as ChildRow
from app.moderation import 검사하기
from app.pii import 가리기, 실명까지가리기
from app.scaffold import 되묻기횟수, 질문
from app.schemas.stage0 import Guide
from app.schemas.stage1 import (
    ChapterState,
    ChapterSummary,
    ChapterView,
    Choice,
    HeroState,
    TurnRequest,
    TurnResult,
)

Child = Annotated[ChildRow, Depends(require_child)]

router = APIRouter(prefix="/chapters", tags=["stage1"])
턴라우터 = APIRouter(prefix="/turns", tags=["stage1"])

# **되묻기는 같은 턴에서 최대 2회** (PRD A-5). 2회 뒤에는 G1 취급으로 진행한다 —
# **아이를 막지 않는다.** `/attempts` 와 같은 값을 쓴다
최대되묻기 = 2


def _보기(챕터: Chapter) -> ChapterView:
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
        artwork=None,
    )


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
    if 있는것 is not None:
        # **이어받은 판이다.** `turn_resume` 이 0 보다 크면 **새로고침이 이야기를
        # 안 잃었다**는 뜻이고, 그것이 이 이벤트를 남기는 이유다 (PRD 5장)
        await 남기기(아이.id, 이벤트("chapter_start", {"turn_resume": 있는것.turn}))
        return _보기(있는것)

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
    return _보기(챕터)


@router.get("/current")
async def current_chapter(아이: Child, session: Session) -> ChapterView:
    """지금 상태 (계약 1절). **진행 중인 챕터가 없으면 `404 NO_ACTIVE_CHAPTER`.**"""
    있는것 = await 저장소.진행중(session, 아이)
    if 있는것 is None:
        raise AppError(ErrorCode.NO_ACTIVE_CHAPTER)
    return _보기(있는것)


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
        book_page_no=None,
    )


@턴라우터.post("")
async def create_turn(
    request: Request, payload: TurnRequest, 아이: Child, session: Session
) -> TurnResult:
    """턴 하나 (계약 2절). **선택지든 자유 묘사든 한 자리로 받는다.**

    **⛔ `choice_id` 와 `text` 중 정확히 하나다** — 둘 다 오거나 둘 다 없으면 422.
    **⚠ `choice_id` 로 온 턴도 등급이 매겨진다** — 선택지 라벨을 그 아이의 입력으로
    평가한다. **그래야 「고르기만 해도 된다」가 안 된다**(비전 1장). 다만 **G0
    스캐폴딩은 안 띄운다** — 고른 것을 되물으면 뜻이 없다.
    """
    if (payload.choice_id is None) == (payload.text is None):
        raise AppError(ErrorCode.VALIDATION_ERROR)

    챕터 = await 저장소.진행중(session, 아이)
    if 챕터 is None:
        raise AppError(ErrorCode.NO_ACTIVE_CHAPTER)
    if str(챕터.id) != payload.chapter_id:
        # **남의 판이거나 이미 끝난 판이다.** 넘어가면 다른 이야기에 글을 쓴다
        raise AppError(ErrorCode.NOT_FOUND)

    입력, 입력종류 = _입력고르기(payload, 챕터)

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
    if 진행기.스캐폴딩할까(평가.grade, 선택지로왔나=입력종류 == "choice"):
        되물음 = await _되묻기(아이, 챕터, 현재)
        if 되물음 is not None:
            return 되물음
        # **되물을 차례가 아니거나 셀 수 없었다 → `G1` 취급으로 진행한다** (PRD A-5
        # 「2회 후에도 G0이면 G1 취급으로 진행 — 아이를 막지 않음」).
        # **⛔ 여기서 안 올리면 아이가 갇힌다** — 되묻기도 안 받고 턴도 안 가는 상태가
        # 된다. 응답·로그의 `grade` 는 **평가가 준 값 그대로** 둔다(`/attempts` 선례):
        # 진행에 쓰는 취급과 **판정이 실제로 무엇이었나**는 다른 값이다.
        진행등급 = "G1"

    # **6. GM 호출** — 등급·뼈대·상태를 실어. **다음 턴의 비트로 묻는다**
    다음턴 = 현재.턴 + 1
    출력 = _서사확인(
        await 서사(
            시스템지시(),
            턴프롬프트(
                턴=다음턴,
                상태=챕터.state,
                아이입력=문장,
                등급=진행등급,
                보너스=0,  # **4번(B-4)이 채운다.** 지금은 등급만 프롬프트로 간다
                시련넘었나=현재.시련넘었나,
            ),
            턴=다음턴,
        )
    )

    # **경로 판별은 GM 이 한다** (PRD A-4). 서버가 낱말로 맞히면 **서사와 센 경로가 갈린다**
    진행 = 진행기.다음(현재, 등급=진행등급, 경로=출력.trial_path)
    await 저장소.굴리기(
        session,
        챕터.id,
        진행,
        등급=평가.grade,
        입력종류=입력종류,
        글자수=len(문장),
        서사=출력.narrative,
        선택지=[것.model_dump() for 것 in 출력.choices],
        상태=챕터.state,  # **⏳ 상태 추출기는 2번(A-2)이다**
    )
    await session.commit()

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
    if 진행.완결:
        남길것.append(await _완결이벤트(session, 챕터, 진행))
    await 남기기(아이.id, *남길것)

    시련중 = 진행.비트 == "trial"
    return TurnResult(
        outcome="result",
        turn=진행.턴,
        beat=진행.비트,
        grade=평가.grade,  # type: ignore[arg-type]
        bonus=0,
        scaffold=None,
        narrative=출력.narrative,
        choices=[Choice(**것.model_dump()) for 것 in 출력.choices],
        state=_상태보기(챕터.state),
        turns_left=max(0, 진행기.최대턴 - 진행.턴),
        artwork=None,
        chapter_done=진행.완결,
        trial_path=진행.시련경로 if 시련중 else None,
        trial_progress=진행.시련진행 if 시련중 else None,
    )


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
        grade=None,  # **평가값을 버린다** — 보여주지도 않은 평가가 분포를 오염시킨다
        bonus=0,
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


def _입력고르기(payload: TurnRequest, 챕터: Chapter) -> tuple[str, str]:
    """선택지면 **그 라벨이 아이의 입력**이다 (계약 2절).

    **없는 선택지는 평가할 것이 없다** — 422. 라벨을 지어내면 **아이가 고르지 않은
    문장이 평가되고 서사에 반영된다.**
    """
    if payload.choice_id is not None:
        라벨 = next((것["label"] for 것 in 챕터.choices if 것.get("id") == payload.choice_id), None)
        if not 라벨:
            raise AppError(ErrorCode.VALIDATION_ERROR)
        return 라벨, "choice"
    return payload.text or "", "free"


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
        grade="G0",
        bonus=0,
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
