"""튜토리얼 「나침반 깨우기」 — 백엔드 몫 (A-6 · W7 10번).

**⭐ 카드 T1~T3 는 DB 에 이미 있다**(`89e2396`). **이 항목은 루프 설정 변경이다** —
새 카드도, 새 테이블도 없다.

**⛔ 기본으로 꺼 둔다.** `장면카드_초안.md` 가 **T1~T3 만 대표 미검수**라고 적어 뒀고
주차 계획 「위험」이 **「만들되 기본 켜짐으로 두지 않는다 — 검수가 오면 켠다」**다.
**검수 없이 아이에게 내보내지 않는다.**

**진행 상태를 새로 저장하지 않는다.** **`card_attempts` 행이 곧 진행**이다 —
세 장을 쓰면 통과다(A-6 「3장을 쓰기만 하면 통과」). 다른 곳도 같은 방식이다
(`오늘쓴카드들`·`turns_left`). **행이 곧 셈이면 우회할 카운터가 없다.**

**⛔ 잠금·관문이 없다** (A-6 MUST). **A0-5 일일 제한과 A0-4 앨범을 적용하지 않는다** —
튜토리얼에서 카드를 다 쓰거나 책이 쌓이면 **첫 5~7분이 관문이 된다.**
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import db
from app.api.v1 import attempts as attempts모듈
from app.evaluator import 평가결과
from app.models import BookPage, Child, Event
from app.moderation import 검사결과
from app.tutorial import 튜토리얼카드들

pytestmark = pytest.mark.anyio

다음카드 = "/api/v1/cards/next"
시도 = "/api/v1/attempts"
문장 = "이끼 낀 돌계단을 한 칸씩 올라가며 톱니 소리를 들어본다"


@pytest.fixture
def _켠다(monkeypatch: pytest.MonkeyPatch) -> None:
    """**기본은 꺼짐이다.** 켜는 것은 검수가 온 뒤이고, 검사는 켠 채로 본다."""
    from app import tutorial

    monkeypatch.setattr(tutorial, "켜져있나", lambda: True)


@pytest.fixture(autouse=True)
def _유료호출을_끊는다(monkeypatch: pytest.MonkeyPatch) -> dict:
    센것 = {"등급": "G2"}

    async def _통과(text: str):
        return 검사결과(blocked=False)

    async def _평가(text: str, *, 기록: bool = True):
        return 평가결과(grade=센것["등급"], signals=[], descriptors=[])

    monkeypatch.setattr(attempts모듈, "검사하기", _통과)
    monkeypatch.setattr(attempts모듈, "evaluate", _평가)
    return 센것


def _쓴다(client: TestClient, card_id: str) -> dict:
    응답 = client.post(시도, json={"card_id": card_id, "text": 문장})
    assert 응답.status_code == 200, 응답.text
    return 응답.json()


# ── 기본은 꺼짐 ─────────────────────────────────────────


async def test_기본으로는_튜토리얼이_안_나온다(client: TestClient):
    """**⛔ T1~T3 가 대표 미검수다** (`장면카드_초안.md`). **검수 없이 아이에게
    안 내보낸다** — 켜는 것은 검수가 온 뒤다."""
    from app.tutorial import 켜져있나

    assert 켜져있나() is False

    카드 = client.get(다음카드).json()

    assert 카드["card_id"] not in 튜토리얼카드들()


# ── 켜면 셋이 먼저, 순서대로 ──────────────────────────────


async def test_켜면_신규_아이에게_T1_부터_순서대로_나온다(client: TestClient, _켠다: None):
    """**T1 → T2 → T3.** 순서가 뜻을 진다 (A-6) — T1 은 「쓰면 반응한다」,
    T2 는 「구체적이면 더 좋아진다」, T3 는 「네 방식대로」다. **섞으면 배움이 없다.**"""
    셋 = 튜토리얼카드들()

    본것 = []
    for 차례 in range(3):
        카드 = client.get(다음카드).json()
        본것.append(카드["card_id"])
        assert 카드["card_id"] == 셋[차례], f"{차례}번째가 어긋났다"
        _쓴다(client, 카드["card_id"])

    assert 본것 == list(셋)


async def test_셋을_쓰면_그_뒤로는_모험_카드다(client: TestClient, _켠다: None):
    """**재실행 없음** (A-6 SHOULD). **행이 곧 진행이라** 다시 들어와도 안 되풀이된다."""
    for card_id in 튜토리얼카드들():
        _쓴다(client, card_id)

    카드 = client.get(다음카드).json()

    assert 카드["card_id"] not in 튜토리얼카드들()


# ── ⛔ 잠금·관문이 없다 ──────────────────────────────────


async def test_일일_상한이_차_있어도_튜토리얼은_나온다(
    client: TestClient, 자녀행: Child, _켠다: None
):
    """**A-6: 「A0-5 일일 제한은 적용하지 않음 — 튜토리얼에 잠금·관문 없음」.**

    **첫 5~7분이 관문이 되면 아이는 시작도 못 한다.**
    """
    async with db.SessionLocal() as session:
        갱신 = await session.get(Child, 자녀행.id)
        갱신.daily_cap = 0  # 상한 0 = 이미 다 썼다
        await session.commit()

    응답 = client.get(다음카드)

    assert 응답.status_code == 200
    assert 응답.json()["card_id"] in 튜토리얼카드들()


async def test_튜토리얼은_그날의_턴을_안_먹는다(client: TestClient, 자녀행: Child, _켠다: None):
    """**같은 이유다** (A-6). D-2 가 **연습 카드는 세지만**(PRD A0-5) **튜토리얼은
    「제한 미적용」**이다 — 세면 **첫날 모험이 그만큼 깎인다.**"""
    from app.daily_turns import 오늘턴수

    for card_id in 튜토리얼카드들():
        _쓴다(client, card_id)

    async with db.SessionLocal() as session:
        쓴수, _ = await 오늘턴수(session, 자녀행)

    assert 쓴수 == 0


async def test_튜토리얼은_책에_안_쌓인다(client: TestClient, _켠다: None):
    """**A-6: 「A0-4 앨범은 적용하지 않음」.** 튜토리얼 석 장이 책에 실리면
    **아이 책의 첫 세 장이 연습**이 된다 — 책은 **모험의 기록**이다."""
    for card_id in 튜토리얼카드들():
        _쓴다(client, card_id)

    async with db.SessionLocal() as session:
        장들 = list((await session.execute(select(BookPage))).scalars())

    assert 장들 == []


# ── 재시도 복귀 · 기록 ───────────────────────────────────


async def test_튜토리얼_카드를_id_로_다시_열_수_있다(client: TestClient, _켠다: None):
    """**T2 가 「다시 써보기」를 권유한다** (A-6). 재시도 화면이 카드를 다시 읽으므로
    **`GET /cards/{id}` 가 404 면 그 권유가 막힌다.**"""
    card_id = 튜토리얼카드들()[1]

    응답 = client.get(f"/api/v1/cards/{card_id}")

    assert 응답.status_code == 200
    assert 응답.json()["card_id"] == card_id


async def test_셋째를_쓰면_베이스라인이_한_번_남는다(client: TestClient, _켠다: None):
    """`tutorial_complete` (PRD 5장) — **그 아이의 H2 베이스라인**이다.
    `grades[3]`·`char_lens[3]` 을 싣고 **아이 원문은 안 싣는다** (PRD 1.1b)."""
    for card_id in 튜토리얼카드들():
        _쓴다(client, card_id)

    async with db.SessionLocal() as session:
        건들 = [
            것
            for 것 in (await session.execute(select(Event))).scalars()
            if 것.event == "tutorial_complete"
        ]

    assert len(건들) == 1
    몸 = 건들[0].payload
    assert 몸["grades"] == ["G2", "G2", "G2"]
    assert 몸["char_lens"] == [len(문장)] * 3
    assert 문장 not in str(몸)
