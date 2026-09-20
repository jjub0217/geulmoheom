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

import uuid

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


async def test_요약_재료에_GM_서사가_들어간다(client: TestClient, _체인을_갈아끼운다: dict):
    """**⛔ 2026-09-17 — 없던 칸이다. GM 이 말한 것이 어디에도 저장되지 않았다.**

    09-17 한 판에서 **4턴이 밝힌 사건의 원인(수정 구슬 지팡이)이 그 뒤 한 번도 안 나온
    채 완결**했다. 원인은 **요약기가 나빠서가 아니라 재료에 GM 글이 없어서**였다 —
    **없는 것을 요약할 수는 없다.** `chapters.narrative` 는 **마지막 하나**뿐이라
    새로고침 복구용이지 기억이 아니다.

    **⛔ 이 검사가 빨개지면 이야기가 다시 앞뒤가 안 맞기 시작한다.** 그리고 그건
    **한 판을 끝까지 돌려 사람이 읽어야** 드러나서, **여기서 안 잡으면 늦게 잡힌다.**
    """
    판 = client.post(챕터).json()

    _턴돌리기(client, 판, 3)

    (첫갱신,) = _체인을_갈아끼운다["요약재료"]
    assert all("gm" in 한턴 for 한턴 in 첫갱신), "GM 서사가 재료에 없다"
    assert all(한턴["gm"] for 한턴 in 첫갱신)


async def test_아이_글과_GM_글이_재료에서_갈려_있다(client: TestClient, _체인을_갈아끼운다: dict):
    """**⛔ 두 칸은 성격이 다르다** — `input` 은 **아이가 쓴 글**이라 책 콘텐츠이고
    (`api/CLAUDE.md` 8~9행), `gm` 은 **AI 가 쓴 글**이라 책에 안 실린다.

    **한 칸에 합치면 그 갈림이 사라지고**, 다음 사람이 **아이 원문 규칙을 GM 글에
    적용하거나 그 반대를 한다.** 재료에서부터 갈라 둔다.
    """
    판 = client.post(챕터).json()

    _턴돌리기(client, 판, 3)

    (첫갱신,) = _체인을_갈아끼운다["요약재료"]
    한턴 = 첫갱신[0]
    assert 한턴["input"] != 한턴["gm"]
    assert 문장 in 한턴["input"]


async def test_요약_지시가_GM_이_밝힌_것을_남기라고_말한다(
    client: TestClient, _체인을_갈아끼운다: dict
):
    """**⛔ 재료만 넣고 지시를 안 고치면 모델이 그것을 버린다.**

    종전 지시는 **「아이가 한 일과 그 결과만 남겨라」**였다. 재료에 `gm` 을 넣어 놓고
    그대로 두면 **줄일 것이 두 배가 됐는데 남길 것은 그대로**라, 모델이 **GM 이 밝힌
    사실을 먼저 버린다** — **칸을 만든 이유가 통째로 사라진다.**
    """
    from app import chapter_state

    지시들: list[str] = []

    async def _받아적기(모델, 지시, 프롬프트):
        지시들.append(지시)
        return None

    import pytest

    with pytest.MonkeyPatch.context() as 잠깐:
        잠깐.setattr(chapter_state, "_한덩이", _받아적기)
        await chapter_state.요약하기([{"turn": 1, "gm": "무언가 있었다"}])

    (지시,) = 지시들
    assert "gm" in 지시
    assert "이어야" in 지시 or "남겨라" in 지시


async def test_갱신이_밀린_턴에도_구멍이_없다(client: TestClient, _체인을_갈아끼운다: dict):
    """7·8턴은 요약이 `1..6` 에 머문다. 그래도 **원문 창(5·6·7)이 그 뒤를 덮는다.**"""
    판 = client.post(챕터).json()

    _턴돌리기(client, 판, 7)

    마지막프롬프트 = _체인을_갈아끼운다["프롬프트"][-1]
    assert "6턴까지의 요약이다" in 마지막프롬프트
    # **최근 3턴 창 + 이번 턴 입력 = 넷이다.** 처음에 셋으로 썼는데 **검사가 틀렸다** —
    # `[이번 턴 입력]` 칸을 잊었다. **창이 넘치지 않는다는 것**이 재려던 값이다
    assert 마지막프롬프트.count(문장) == 상태기.원문창 + 1


# ── 이어하기에 「지금까지 쓴 것」이 실린다 ────────────────


async def test_이어하기가_지금까지_쓴_것을_돌려준다(client: TestClient):
    """**⛔ 2026-09-21 명세 변경** (`Stage1.md` 1절 · 사용자 판정).

    **아이가 쌓은 것이 화면에 안 보였다** — 몇 턴을 써도 **완결해야 비로소 책에서**
    자기 글을 봤다. **「글이 쌓여 책이 된다」가 약속인데 쌓이는 게 안 보였다.**

    **⭐ 저장할 것을 새로 만들지 않았다** — `text` 도 `gm_narrative` 도 이미 있었다.
    """
    판 = client.post(챕터).json()
    _턴돌리기(client, 판, 3)

    쓴것 = client.get(f"{챕터}/current").json()["turns"]

    assert [것["turn"] for 것 in 쓴것] == [1, 2, 3], "오름차순 전부여야 한다"
    assert all(문장 in 것["text"] for 것 in 쓴것)
    assert all(것["narrative"] for 것 in 쓴것), "그 턴의 GM 서사가 같이 와야 한다"


async def test_이어하기의_턴에_등급이_안_실린다(client: TestClient):
    """**⛔ 내보내면 화면이 그것을 점수로 그린다** (`용어사전.md` 8장 금지어).

    같은 절이 `state` 에서 `grades` 를 막아 둔 이유 그대로다. **새 자리가 생겼다고
    그 규칙이 안 따라오면 막아 둔 값이 옆문으로 나간다.**
    """
    판 = client.post(챕터).json()
    _턴돌리기(client, 판, 1)

    (한턴,) = client.get(f"{챕터}/current").json()["turns"]

    assert set(한턴) == {"turn", "text", "narrative"}


async def test_고른_턴은_아이_글로_안_실린다(client: TestClient):
    """**⛔ 고른 턴의 `text` 는 GM 이 쓴 선택지 라벨이다** — 아이가 쓴 글이 아니다.

    실으면 **아이 화면의 「내가 쓴 것」에 남의 글이 섞인다.** **책이 `input_type`
    으로 가르는 것과 같은 규칙**이다(`models.py` `ChapterTurn`).

    **`adr/0017` 뒤로는 안 생기지만 과거 판에 남아 있다** — 그래서 막아 둔다.
    """
    from app.models import ChapterTurn

    판 = client.post(챕터).json()
    _턴돌리기(client, 판, 1)

    async with db.SessionLocal() as 세션:
        세션.add(
            ChapterTurn(
                chapter_id=uuid.UUID(판["chapter_id"]),
                turn_no=2,
                beat="explore",
                grade="G2",
                input_type="choice",
                char_len=10,
                text="난간을 붙잡고 올라간다",
                gm_narrative="그 선택으로 이야기가 이어졌다",
            )
        )
        await 세션.commit()

    쓴것 = client.get(f"{챕터}/current").json()["turns"]

    assert [것["turn"] for 것 in 쓴것] == [1]
    assert all("난간을 붙잡고" not in 것["text"] for 것 in 쓴것)


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
