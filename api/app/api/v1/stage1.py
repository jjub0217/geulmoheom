"""Stage 1 「TRPG」 — **지금은 목이다** (`docs/api/Stage1.md` · W7 0번).

**⛔ 왜 목이 먼저인가.** 프론트가 코드에서 쓰는 것은 계약 문서가 아니라
**`web/src/api/types.gen.ts`** 이고 그건 **`/openapi.json` 에서 생성된다.**
**손으로 타입을 적는 것은 `web/CLAUDE.md` 「절대 하지 않는 것」 첫 줄**이라,
이 스텁이 뜨기 전까지 프론트는 화면을 세울 수 없다.

**GM 엔진(A-1)은 L 이다.** 목을 그 뒤에 두면 **프론트가 L 하나를 통째로 기다린다** —
**사흘 중 하루가 여기서 갈린다** (`주차계획/W7.md` 0번).

**⛔ 실제 구현이 들어올 때 이 파일을 지우는 것이 아니다** — 라우트와 응답 모델은
그대로 남고 **본문만 바뀐다.** 고정값은 `_고정_*` 에 모아 뒀다.

**⛔ 아직 아이에게 켜지 않는다.** `Stage1.md` 2절이 요구하는 **11단계가 하나도 안
돈다** — 특히 **입력 Moderation · PII 마스킹 · GM 출력 검사**가 없다. 켜는 것은
1번(A-1)이 서고 그 검사가 붙은 뒤다. **인증은 지금도 진짜다**(아이 쿠키) — 목이라고
그 문을 열어 두면 **목이 사라질 때 그 자리가 안 닫힌다.**
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.v1.deps import Session, require_child
from app.errors import AppError, ErrorCode
from app.models import Child as ChildRow
from app.schemas.stage0 import ArtworkRef
from app.schemas.stage1 import (
    ChapterState,
    ChapterSummary,
    ChapterView,
    Choice,
    HeroState,
    TurnRequest,
    TurnResult,
)

# **다른 v1 모듈과 같은 모양이다** — `deps.Child` 는 **SQLAlchemy 모델**이고
# 의존 별칭은 각 모듈이 만든다 (`artworks.py`·`cards.py`…).
Child = Annotated[ChildRow, Depends(require_child)]

router = APIRouter(prefix="/chapters", tags=["stage1"])
턴라우터 = APIRouter(prefix="/turns", tags=["stage1"])

# **고정값이다.** 뼈대 본문은 `docs/챕터뼈대_초안.md` 가 SSOT 이고, 여기 있는 것은
# **모양을 보여주는 한 덩이**다 — **문구가 아니다.** 아이 화면에 나가는 문장은
# `문구.md` 가 SSOT 라, 이 스텁의 서사는 **켜기 전에 GM 이 만든 것으로 바뀐다.**
_챕터키 = "ch01"
_한챕터턴수 = 12


def _고정_상태() -> ChapterState:
    return ChapterState(hero=HeroState(hp=3, items=[]), location="시계탑 앞")


def _고정_선택지() -> list[Choice]:
    """**⛔ 네 경로를 나열하지 않는다** (`Stage1.md` 3절 · 뼈대 「하면 안 되는 것」 ②).

    「① 싸운다 ② 말을 건다 ③ 살펴본다 ④ 달랜다」가 되면 **쓰기가 고르기로 바뀐다.**
    그래서 여기 둘도 **경로가 섞이게** 두었다 — 목이라도 그 모양을 보여야 프론트가
    화면을 그때 그 모양으로 만든다.
    """
    return [
        Choice(id="c1", label="탑 문틈으로 안을 살펴본다"),
        Choice(id="c2", label="종소리에 맞춰 발을 뗀다"),
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def open_chapter(아이: Child, session: Session) -> ChapterView:
    """챕터를 연다 (`Stage1.md` 1절). **요청 본문 없음** — 아이 쿠키로 누구인지 안다.

    **⛔ 진행 중인 챕터가 있으면 새로 안 연다 — 그것을 돌려준다.**
    **⭐ 아이가 새로고침해도 이야기를 잃지 않는다.**

    **⏳ 목이라 아직 안 지키는 것 둘** — ① 오늘 완결했으면 `409 CHAPTER_DONE_TODAY`
    (D-1 하드 피니시) ② 진행 중인 챕터 돌려주기. **둘 다 상태(2번)가 선 뒤다.**
    """
    return ChapterView(
        chapter_id=str(uuid.uuid4()),
        chapter_key=_챕터키,
        turn=0,
        beat="intro",
        narrative="시계탑의 종이 거꾸로 울린다. 마을 사람들은 어제로 걸어가고 있다.",
        choices=_고정_선택지(),
        state=_고정_상태(),
        turns_left=_한챕터턴수,
        artwork=ArtworkRef(artwork_id=str(uuid.uuid4()), status="pending", url=None),
    )


@router.get("/current")
async def current_chapter(아이: Child, session: Session) -> ChapterView:
    """지금 상태 (`Stage1.md` 1절). **진행 중인 챕터가 없으면 `404 NO_ACTIVE_CHAPTER`.**

    **⏳ 목은 언제나 챕터가 있는 것처럼 답한다.** 실제 판정은 상태(2번) 뒤다 —
    **`NO_ACTIVE_CHAPTER` 갈래를 프론트가 그려야 하므로 코드는 지금 세워 둔다**
    (`app/errors.py`).
    """
    return await open_chapter(아이, session)


@router.get("/{chapter_id}/summary")
async def chapter_summary(chapter_id: str, 아이: Child, session: Session) -> ChapterSummary:
    """완결 화면 (`Stage1.md` 5절 · D-1).

    **⛔ 「이어서 더 하기」를 응답에 넣지 않는다. 없는 것이 결정이다** (페르소나 7.1).
    """
    if not _uuid인가(chapter_id):
        raise AppError(ErrorCode.NOT_FOUND)
    return ChapterSummary(
        chapter_id=chapter_id,
        chapter_key=_챕터키,
        title="거꾸로 도는 마을",
        turns_used=10,
        trial_path="observe",
        tier="rare",
        book_page_no=1,
    )


@턴라우터.post("")
async def create_turn(payload: TurnRequest, 아이: Child, session: Session) -> TurnResult:
    """턴 하나 (`Stage1.md` 2절). **선택지든 자유 묘사든 한 자리로 받는다.**

    **⛔ `choice_id` 와 `text` 중 정확히 하나다** — 둘 다 오거나 둘 다 없으면 422.
    **이 검사는 목에서도 진짜로 돈다**: 프론트가 한 입력창으로 두 갈래를 보내는데,
    **목이 아무거나 받아 주면 프론트가 틀린 모양으로 화면을 만들고** 실제 구현이
    들어오는 날 422 를 처음 본다.

    **⏳ 목이라 아직 안 도는 것** — `Stage1.md` 2절의 11단계 전부(Moderation ·
    PII · 상한 · Evaluator · GM · 상태 추출 · 요약 · 삽화 · 턴 로그).
    **등급은 `G2` 고정이다** — 목이 등급을 흉내내면 프론트가 그 값으로 화면을 가른다.
    """
    하나만 = (payload.choice_id is None) != (payload.text is None)
    if not 하나만:
        raise AppError(ErrorCode.VALIDATION_ERROR)

    return TurnResult(
        turn=1,
        beat="explore",
        grade="G2",
        bonus=1,
        scaffold=None,
        narrative="문틈으로 들여다보니 톱니 사이에 깃털 하나가 끼여 있다.",
        choices=_고정_선택지(),
        state=_고정_상태(),
        turns_left=_한챕터턴수 - 1,
        artwork=None,
        chapter_done=False,
    )


def _uuid인가(값: str) -> bool:
    """**모양이 UUID 가 아닌 것을 여기서 거른다** — `공통규약.md` 「ID 는 전부 UUID」.

    안 거르면 SQL 층까지 내려가 500 이 된다 (`attempts._재시도확인` 과 같은 자리).
    """
    try:
        uuid.UUID(값)
    except ValueError:
        return False
    return True
