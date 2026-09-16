"""세션 상태 관리 (A-2 · W7 2번 · `docs/api/Stage1.md` 2절 8·9번).

**체인이 둘이고 성격이 다르다** (PRD A-2 · 2026-09-16 사용자 판정).

| | 언제 | 왜 |
|---|---|---|
| **상태 추출기** | **매 턴** | **체력·아이템·위치는 변화를 놓치면 상태가 틀어진다** |
| **요약기** | **3턴마다** | 돈이다. 15턴 기준 **15회 → 5회** |

**⛔ 「3턴마다」를 순진하게 하면 구멍이 난다.** 요약이 `1..N-3` 만 덮으면 갱신이 밀린
사이 **요약에도 없고 원문 3턴에도 없는 턴**이 생기고, **그 턴에 아이가 한 일이 GM
컨텍스트에서 통째로 사라진다.** 그래서 **요약은 갱신 시점까지 전부(`1..M`)를 덮고**
원문 창은 최근 3턴 그대로다 — **겹치는 것은 해가 없고 구멍은 해가 있다.**

**⛔ 아이 원문이 `chapters.state` 에 안 들어간다.** 원문 허용 칸은 **셋**이고
(`card_attempts.text`·`book_pages.text`·`chapter_turns.text`) **`state` 는 그중에
없다.** 최근 3턴 원문은 **`chapter_turns` 에서 읽어 프롬프트에 싣는다** — 저장이
아니라 조립이다.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import chapter_state as 상태기
from app import db
from app.api.v1 import stage1
from app.evaluator import 평가결과
from app.gm import GM출력, 서사결과, 선택지
from app.models import Chapter
from app.moderation import 검사결과

pytestmark = pytest.mark.anyio

챕터 = "/api/v1/chapters"
턴 = "/api/v1/turns"
문장 = "이끼 낀 돌계단을 한 칸씩 올라가며 톱니 소리를 들어본다"


@pytest.fixture(autouse=True)
def _체인을_갈아끼운다(monkeypatch: pytest.MonkeyPatch) -> dict:
    """**네 호출을 다 끊는다** — 검사·평가·GM·요약·상태추출. 센 횟수를 돌려준다."""
    센것: dict = {"요약": 0, "추출": 0, "프롬프트": [], "요약재료": []}

    async def _통과(text: str):
        return 검사결과(blocked=False)

    async def _평가(text: str, *, 기록: bool = True):
        return 평가결과(grade="G2", signals=[], descriptors=[])

    async def _서사(지시: str, 프롬프트: str, *, 턴: int, 허용재시도: int = 1):
        센것["프롬프트"].append(프롬프트)
        return 서사결과(
            출력=GM출력(
                narrative=f"{턴}턴의 서사.",
                choices=[선택지(id="c1", label="깃털을 줍는다")],
                trial_path="care" if 턴 >= 9 else None,
            )
        )

    async def _요약(재료: list[dict]) -> str:
        센것["요약"] += 1
        센것["요약재료"].append(재료)
        return f"{len(재료)}턴까지의 요약이다."

    async def _추출(서사: str, 지금: dict) -> dict:
        센것["추출"] += 1
        영웅 = dict(지금.get("hero", {}))
        영웅["items"] = [*영웅.get("items", []), "깃털"]
        return {**지금, "hero": 영웅, "location": "시계탑 3층"}

    monkeypatch.setattr(stage1, "검사하기", _통과)
    monkeypatch.setattr(stage1, "evaluate", _평가)
    monkeypatch.setattr(stage1, "서사", _서사)
    monkeypatch.setattr(stage1, "요약하기", _요약)
    monkeypatch.setattr(stage1, "상태추출", _추출)
    return 센것


def _턴돌리기(client: TestClient, 판: dict, 번수: int) -> dict:
    몸 = {}
    for _ in range(번수):
        몸 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장}).json()
    return 몸


# ── 요약기는 3턴마다 ─────────────────────────────────────


def test_요약할_턴을_3턴마다_고른다():
    """**돈이다** (2026-09-16 사용자 판정). 15턴 기준 **15회 → 5회.**"""
    assert not 상태기.요약할때인가(1)
    assert not 상태기.요약할때인가(2)
    assert 상태기.요약할때인가(3)
    assert not 상태기.요약할때인가(4)
    assert 상태기.요약할때인가(6)
    assert 상태기.요약할때인가(9)


async def test_요약은_세_턴에_한_번만_불린다(client: TestClient, _체인을_갈아끼운다: dict):
    판 = client.post(챕터).json()

    _턴돌리기(client, 판, 6)

    assert _체인을_갈아끼운다["요약"] == 2  # 3턴·6턴
    assert _체인을_갈아끼운다["추출"] == 6  # **매 턴이다**


async def test_요약이_그_시점까지_전부를_덮는다(client: TestClient, _체인을_갈아끼운다: dict):
    """**⛔ `1..N-3` 만 덮으면 구멍이 난다.** 6턴 갱신은 **1~6턴 전부**를 재료로 받는다 —
    **겹치는 것은 해가 없고, 구멍은 아이가 한 일이 사라지는 것**이다."""
    판 = client.post(챕터).json()

    _턴돌리기(client, 판, 6)

    첫갱신, 둘째갱신 = _체인을_갈아끼운다["요약재료"]
    assert len(첫갱신) == 3
    assert len(둘째갱신) == 6  # 4~6 이 아니라 1~6 이다


async def test_갱신이_밀린_턴에도_구멍이_없다(client: TestClient, _체인을_갈아끼운다: dict):
    """7·8턴은 요약이 `1..6` 에 머문다. 그래도 **원문 창(5·6·7)이 그 뒤를 덮는다.**"""
    판 = client.post(챕터).json()

    _턴돌리기(client, 판, 7)

    마지막프롬프트 = _체인을_갈아끼운다["프롬프트"][-1]
    assert "6턴까지의 요약이다" in 마지막프롬프트
    # **최근 3턴 창 + 이번 턴 입력 = 넷이다.** 처음에 셋으로 썼는데 **검사가 틀렸다** —
    # `[이번 턴 입력]` 칸을 잊었다. **창이 넘치지 않는다는 것**이 재려던 값이다
    assert 마지막프롬프트.count(문장) == 상태기.원문창 + 1


# ── 상태가 누적되고 살아남는다 ────────────────────────────


async def test_상태가_턴마다_누적된다(client: TestClient):
    판 = client.post(챕터).json()

    몸 = _턴돌리기(client, 판, 3)

    assert 몸["state"]["location"] == "시계탑 3층"
    assert 몸["state"]["hero"]["items"].count("깃털") == 3


async def test_서버를_껐다_켜도_이어진다(client: TestClient, _체인을_갈아끼운다: dict):
    """**완료 조건이다.** 상태가 **DB 행**에 있으므로 프로세스가 죽어도 남는다 —
    새 세션으로 읽어도 같은 상태다."""
    판 = client.post(챕터).json()
    _턴돌리기(client, 판, 3)

    async with db.SessionLocal() as session:  # 새 세션 = 새 커넥션
        행 = (await session.execute(select(Chapter))).scalar_one()

    assert 행.state["location"] == "시계탑 3층"
    assert "요약이다" in 행.state["summary"]

    이어 = client.get(f"{챕터}/current").json()
    assert 이어["state"]["location"] == "시계탑 3층"


async def test_아이_원문이_상태에_안_들어간다(client: TestClient):
    """**⛔ `state` 는 원문 허용 칸이 아니다.** 허용은 셋이고
    (`card_attempts.text`·`book_pages.text`·`chapter_turns.text`) **`state` 는 없다.**

    최근 3턴 원문은 **`chapter_turns` 에서 읽어 프롬프트로 조립**한다 — 저장이 아니다.
    """
    판 = client.post(챕터).json()
    _턴돌리기(client, 판, 4)

    async with db.SessionLocal() as session:
        행 = (await session.execute(select(Chapter))).scalar_one()

    적힌것 = str(행.state)
    assert 문장 not in 적힌것
    assert "이끼" not in 적힌것


# ── 체인이 실패해도 아이를 막지 않는다 ────────────────────


async def test_상태추출이_실패하면_이전_상태를_지킨다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """**⛔ 체인이 아이 턴을 죽이면 안 된다.** 서사는 이미 나왔고 **상태는 요약일
    뿐**이다 — 못 뽑았으면 **직전 상태를 그대로 들고 간다.**"""
    판 = client.post(챕터).json()

    async def _터짐(서사: str, 지금: dict) -> dict:
        raise RuntimeError("추출 실패")

    monkeypatch.setattr(stage1, "상태추출", _터짐)

    응답 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장})

    assert 응답.status_code == 200
    assert 응답.json()["state"]["hero"]["hp"] == 10  # 첫 상태 그대로


async def test_요약이_실패하면_직전_요약을_지킨다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """같은 이유다. **요약이 없으면 GM 이 앞 이야기를 덜 알 뿐, 턴은 지나간다.**"""
    판 = client.post(챕터).json()

    async def _터짐(재료: list[dict]) -> str:
        raise RuntimeError("요약 실패")

    monkeypatch.setattr(stage1, "요약하기", _터짐)

    몸 = _턴돌리기(client, 판, 3)

    assert 몸["turn"] == 3
