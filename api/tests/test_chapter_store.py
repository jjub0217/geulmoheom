"""챕터 한 판을 저장하고 되읽는다 (A-4 · W7 3번 ② · `docs/api/Stage1.md` 1절).

**여기서 지키는 것 넷**

1. **진행 중인 챕터는 아이당 하나 — DB 가 지킨다.** 코드로만 막으면 **새로고침 두
   번에 두 판이 열리고** 아이가 쓴 이야기가 갈라진다
2. **완결하면 새로 열 수 있다** — 하드 피니시는 5번(D-1)이 날짜로 막고, 여기서는
   **테이블이 두 번째 판을 받을 수 있어야** 한다
3. **⛔ 턴 기록에 아이 원문 칸이 없다** — 계약 11번(「등급·경로·소요만」)이자
   `api/CLAUDE.md` 의 첫 줄이다. **검사로 박는다** — 없는 칸은 실수로 안 채워지지만,
   **누가 칸을 만들면 그때 이 검사가 막는다**
4. **저장했다 읽으면 엔진 상태가 같다** — 그래야 새로고침이 이야기를 안 잃는다
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app import chapter_run as 진행기
from app import chapter_store as 저장소
from app import db
from app.models import Chapter, ChapterTurn, Child

_상태 = {"hero": {"hp": 3, "items": []}, "location": "시계탑 앞"}
_선택지 = [{"id": "c1", "label": "탑 문틈으로 안을 살펴본다"}]


async def _열기(아이: Child) -> Chapter:
    async with db.SessionLocal() as session:
        챕터 = await 저장소.열기(
            session, 아이, 서사="시계탑의 종이 거꾸로 울린다.", 선택지=_선택지, 상태=_상태
        )
        await session.commit()
        return 챕터


# ── 진행 중인 챕터는 하나 ────────────────────────────────


async def test_진행중인_챕터가_하나면_그것을_돌려준다(자녀행: Child):
    챕터 = await _열기(자녀행)

    async with db.SessionLocal() as session:
        찾은것 = await 저장소.진행중(session, 자녀행)

    assert 찾은것 is not None
    assert 찾은것.id == 챕터.id
    assert 찾은것.turn == 0
    assert 찾은것.beat == "intro"


async def test_두_판이_동시에_열리면_DB_가_막는다(자녀행: Child):
    """**⛔ 코드가 아니라 DB 가 지킨다.** 새로고침 두 번이 겹치면 코드 검사 둘이
    나란히 통과하고, **그때 아이의 이야기가 두 갈래로 갈라진다.**"""
    await _열기(자녀행)

    with pytest.raises(IntegrityError):
        await _열기(자녀행)


async def test_완결하면_새로_열_수_있다(자녀행: Child):
    """**하드 피니시(5번)는 날짜로 막는다** — 테이블은 두 번째 판을 받을 수 있어야 한다."""
    챕터 = await _열기(자녀행)

    async with db.SessionLocal() as session:
        await 저장소.완결찍기(session, 챕터.id, 끝난때=datetime.now(UTC))
        await session.commit()

    둘째 = await _열기(자녀행)
    assert 둘째.id != 챕터.id

    async with db.SessionLocal() as session:
        assert (await 저장소.진행중(session, 자녀행)).id == 둘째.id
        assert await 저장소.오늘완결했나(session, 자녀행)


# ── ⛔ 아이 원문 칸이 없다 ────────────────────────────────


def test_턴_기록은_길이를_남기고_원문_칸은_아직_없다():
    """**⛔ 규칙이 2026-09-16 에 바뀌었다** — 사용자가 `api/CLAUDE.md` 에
    **`chapter_turns.text` 를 더했다**(종전 「`card_attempts.text` 단 하나」).
    **Stage 1 턴 문장도 책 콘텐츠**이고, 그 칸이 없으면 **A-7 이 「챕터 완결 = 책 한
    장 · 문장은 아이 원문 그대로」를 못 지킨다.**

    **그래서 이 검사는 「만들지 않는다」가 아니라 「아직 안 만들었다」를 잰다.**
    **칸은 9번(A-7)에서 생기고 그때 이 검사를 뒤집는다** — 지금 3번 범위에서
    **쓰지도 않을 칸을 먼저 만들지 않는다.**

    **⛔ 바뀌지 않은 것 — 로그는 그대로 금지다.** `logger`·APM·예외 메시지·이벤트
    payload 에는 원문이 못 간다. 가르는 선은 **「로그냐 책 콘텐츠냐」**다.
    """
    칸 = set(ChapterTurn.__table__.columns.keys())

    assert "text" not in 칸
    assert "input" not in 칸
    assert not [이름 for 이름 in 칸 if "text" in 이름 or "원문" in 이름]
    # 길이는 남는다 — H2 지표(회당 150자)가 그것을 센다
    assert "char_len" in 칸


def test_챕터에도_아이_원문_칸이_없다():
    """`narrative` 는 **GM 이 낸 글**이라 원문이 아니다. 그 둘을 헷갈리지 않게 적어 둔다."""
    칸 = Chapter.__table__.columns

    assert "narrative" in 칸
    assert "아이 원문이 아니다" in (칸["narrative"].comment or "")


# ── 굴린 것이 그대로 되읽힌다 ────────────────────────────


async def test_턴을_굴리면_챕터와_턴_기록이_같이_남는다(자녀행: Child):
    챕터 = await _열기(자녀행)
    진행 = 진행기.다음(진행기.진행(), 등급="G2")

    async with db.SessionLocal() as session:
        await 저장소.굴리기(
            session,
            챕터.id,
            진행,
            등급="G2",
            입력종류="free",
            글자수=42,
            서사="문틈으로 들여다보니 톱니 사이에 깃털 하나가 끼여 있다.",
            선택지=_선택지,
            상태=_상태,
        )
        await session.commit()

    async with db.SessionLocal() as session:
        다시 = await 저장소.진행중(session, 자녀행)
        턴들 = await 저장소.턴들(session, 챕터.id)

    assert 다시.turn == 1
    assert 다시.beat == "intro"
    assert len(턴들) == 1
    assert (턴들[0].grade, 턴들[0].input_type, 턴들[0].char_len) == ("G2", "free", 42)


async def test_저장했다_읽으면_엔진_상태가_같다(자녀행: Child):
    """**새로고침이 이야기를 안 잃는 근거가 이 왕복이다** (계약 1절).

    시련을 반만 넘긴 판(`G1` 한 번)이 가장 잘 깨지는 자리라 그것으로 잰다 —
    **진행도가 0 으로 되읽히면 아이가 시련을 처음부터 다시 넘어야 한다.**
    """
    챕터 = await _열기(자녀행)
    진행 = 진행기.진행()
    for _ in range(8):
        진행 = 진행기.다음(진행, 등급="G2")
    진행 = 진행기.다음(진행, 등급="G1", 경로="care")

    async with db.SessionLocal() as session:
        await 저장소.굴리기(
            session,
            챕터.id,
            진행,
            등급="G1",
            입력종류="free",
            글자수=88,
            서사="새가 떨고 있다.",
            선택지=_선택지,
            상태=_상태,
        )
        await session.commit()

    async with db.SessionLocal() as session:
        다시 = 저장소.진행으로(await 저장소.진행중(session, 자녀행))

    assert 다시 == 진행
    assert 다시.비트 == "trial"
    assert not 다시.시련넘었나
    assert 다시.시련경로 == "care"
