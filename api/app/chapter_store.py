"""챕터 한 판을 저장하고 되읽는다 (A-4 · W7 3번 · `docs/api/Stage1.md` 1절).

**⛔ 진행 규칙이 여기 없다.** 그것은 `chapter_run.py` 다 — 저장소가 규칙을 알면
**한 판을 끝까지 굴리는 검사가 DB 를 타게 되고**, 그러면 네 경로를 각각 굴리는
완료 조건이 **DB 검사 넷**이 된다. 여기는 **행을 쓰고 읽기만** 한다.

**⛔ 아이 원문이 여기 없다.** `chapter_turns` 에 그 칸이 아예 없고(마이그레이션
`b18c4f27a5d1`), `narrative` 는 **GM 이 낸 글**이다. 원문이 가도 되는 곳은
**`card_attempts.text` 하나**이고 (PRD 1.1b · `api/CLAUDE.md`), **책에 실릴 문장을
어디에 둘지는 9번(A-7)에서 정한다.**

**⭐ 진행 중인 챕터는 아이당 하나 — DB 가 지킨다** (`ux_chapters_active_child`).
코드로만 막으면 **새로고침 두 번에 두 판이 열린다.**
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import chapter_skeleton as 뼈대
from app.chapter_run import 진행
from app.models import Chapter, ChapterTurn, Child

# **뼈대 하나뿐이다** (A-1 「판타지 1종·챕터 1개」). `docs/챕터뼈대_초안.md` 의 것이다.
챕터키 = "ch01"


async def 진행중(session: AsyncSession, 아이: Child) -> Chapter | None:
    """완결하지 않은 챕터. **없으면 `None`** — 엔드포인트가 `404 NO_ACTIVE_CHAPTER` 로 옮긴다."""
    찾기 = select(Chapter).where(Chapter.child_id == 아이.id, Chapter.done_at.is_(None))
    return (await session.execute(찾기)).scalar_one_or_none()


async def 오늘완결했나(session: AsyncSession, 아이: Child) -> bool:
    """**하루에 한 챕터다** (D-1 하드 피니시 · 계약 1절).

    **날짜로 센다 — 24시간이 아니다.** 「오늘」이 아이가 아는 단위이고, 24시간으로
    두면 **어제 저녁에 끝낸 아이가 오늘 저녁까지 못 들어온다.**
    """
    찾기 = select(func.count()).where(
        Chapter.child_id == 아이.id,
        Chapter.done_at.is_not(None),
        func.date(Chapter.done_at) == func.current_date(),
    )
    return bool((await session.execute(찾기)).scalar_one())


async def 열기(
    session: AsyncSession,
    아이: Child,
    *,
    서사: str,
    선택지: list[dict],
    상태: dict,
) -> Chapter:
    """새 판을 연다. **턴 0 · `intro`** (계약 1절의 응답 예와 같은 모양).

    **⛔ 여기서 「이미 있나」를 안 본다.** 부르는 쪽이 `진행중()` 으로 먼저 보고,
    그래도 겹치면 **DB 가 막는다**(`IntegrityError`). 두 군데서 같은 것을 보면
    **한쪽만 고쳐지는 날이 온다.**
    """
    챕터 = Chapter(
        child_id=아이.id,
        chapter_key=챕터키,
        turn=0,
        beat="intro",
        trial_progress=0,
        state=상태,
        narrative=서사,
        choices=선택지,
    )
    session.add(챕터)
    await session.flush()
    return 챕터


async def 굴리기(
    session: AsyncSession,
    챕터id: uuid.UUID,
    진행값: 진행,
    *,
    등급: str,
    입력종류: str,
    글자수: int,
    문장: str,
    서사: str,
    선택지: list[dict],
    상태: dict,
) -> ChapterTurn:
    """턴 하나를 기록하고 챕터를 그 진행으로 옮긴다.

    **⛔ 비트를 여기서 다시 계산하지 않는다** — `진행값.비트` 를 그대로 쓴다.
    다시 계산하면 **시련을 못 넘은 아이가 10턴에 `resolution` 을 받는다.**

    **완결이면 `done_at` 을 같은 자리에서 찍는다.** 따로 두면 **완결한 판이 진행
    중으로 남고**, 그 아이는 다음 날 새 판을 못 연다.

    **⛔ `문장` 은 마스킹을 지난 것이어야 한다.** 부르는 쪽이 지나 준다 — 여기서 다시
    가리지 않는다(두 군데서 가리면 한쪽만 바뀌는 날이 온다). **이 값이 책에 실린다.**
    """
    기록 = ChapterTurn(
        chapter_id=챕터id,
        turn_no=진행값.턴,
        beat=진행값.비트,
        grade=등급,
        input_type=입력종류,
        trial_path=진행값.시련경로,
        char_len=글자수,
        # **책 콘텐츠다** (PRD 1.1b · 2026-09-16 규칙 개정). 자유 묘사면 아이 원문이고
        # **A-7 이 이 값으로 책 한 장을 만든다.** 고른 턴이면 GM 라벨이라 책에서 걸러진다
        text=문장,
        # **⛔ 위와 성격이 다르다** (2026-09-17). **AI 가 쓴 글**이라 책에 안 실리고
        # 「책 콘텐츠 예외」와 무관하다. **이미 인자로 들어오던 값**이라 새로 만든 게
        # 아니다 — 종전에는 `chapters.narrative`(마지막 하나)로만 갔다.
        gm_narrative=서사,
    )
    session.add(기록)

    await session.execute(
        update(Chapter)
        .where(Chapter.id == 챕터id)
        .values(
            turn=진행값.턴,
            beat=진행값.비트,
            trial_progress=진행값.시련진행,
            trial_path=진행값.시련경로,
            trial_best_grade=진행값.시련최고등급,
            state=상태,
            narrative=서사,
            choices=선택지,
            done_at=datetime.now(UTC) if 진행값.완결 else None,
        )
    )
    await session.flush()
    return 기록


async def 완결찍기(session: AsyncSession, 챕터id: uuid.UUID, *, 끝난때: datetime) -> None:
    """**턴 없이 끝내는 자리** — 5번(D-1)이 쓴다. 보통은 `굴리기()` 가 같이 찍는다."""
    await session.execute(update(Chapter).where(Chapter.id == 챕터id).values(done_at=끝난때))


async def 내챕터(session: AsyncSession, 아이: Child, 챕터id: str) -> Chapter | None:
    """**내 것인지까지 본다.** id 만 맞으면 **남의 완결 화면이 열린다.**

    **모양이 UUID 가 아니면 `None`** — SQL 층까지 내려가면 500 이 된다
    (`attempts._재시도확인` 과 같은 자리).
    """
    try:
        골라낸것 = uuid.UUID(챕터id)
    except ValueError:
        return None
    찾기 = select(Chapter).where(Chapter.id == 골라낸것, Chapter.child_id == 아이.id)
    return (await session.execute(찾기)).scalar_one_or_none()


async def 턴들(session: AsyncSession, 챕터id: uuid.UUID) -> list[ChapterTurn]:
    찾기 = select(ChapterTurn).where(ChapterTurn.chapter_id == 챕터id).order_by(ChapterTurn.turn_no)
    return list((await session.execute(찾기)).scalars())


def 진행으로(챕터: Chapter) -> 진행:
    """행을 엔진 상태로. **이 왕복이 새로고침이 이야기를 안 잃는 근거다** (계약 1절).

    **⛔ 비트를 턴에서 다시 만들지 않는다** — 저장된 값을 쓴다. 다시 만들면
    **시련을 반만 넘긴 판이 되읽힐 때 비트가 틀어진다.**
    """
    return 진행(
        턴=챕터.turn,
        비트=챕터.beat,  # type: ignore[arg-type]
        시련진행=챕터.trial_progress,
        시련경로=챕터.trial_path,  # type: ignore[arg-type]
        시련최고등급=챕터.trial_best_grade,
    )


def 남은턴(챕터: Chapter) -> int:
    """`turns_left` (계약 4절). **12턴에서 센다** — 뼈대가 최대턴을 정한다."""
    return max(0, 뼈대.최대턴 - 챕터.turn)
