"""하루를 가르는 가드레일 둘 (D-1 하드 피니시 · D-2 일일 턴 상한 · W7 5·6번).

**⛔ MVP 필수 가드레일 넷 중 둘이다** (PRD 「MVP 필수 가드레일」). 늦게 붙일수록
**그것 없이 도는 판이 는다.**

**두 자리는 아이에게 다른 말을 한다** — `문구.md` 1.20 이 못 박았다:
**「1.10 은 「더 못 한다」이고 1.20 은 「다 했다」다 — 같은 문장을 돌려 쓰면 끝낸
아이와 막힌 아이가 같은 말을 듣는다.」**

| | 언제 | 코드 | 문구 |
|---|---|---|---|
| **D-1** | 오늘 챕터를 **끝냈다** | `409 CHAPTER_DONE_TODAY` | **1.20** |
| **D-2** | 오늘 턴을 **다 썼다** | `429 TURN_LIMIT` | **1.10** (1.21 이 그대로 쓰라 했다) |

**⛔ 카운터를 공유한다** — PRD A0-5: 「Stage 1에서는 D-2 일일 턴 상한과 **카운터를
공유** — 연습 모드 카드도 그날의 턴을 소모」.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import chapter_store as 저장소
from app import db
from app.api.v1 import stage1
from app.evaluator import 평가결과
from app.gm import GM출력, 서사결과, 선택지
from app.models import Card, CardAttempt, Child
from app.moderation import 검사결과

pytestmark = pytest.mark.anyio

챕터 = "/api/v1/chapters"
턴 = "/api/v1/turns"
문장 = "이끼 낀 돌계단을 한 칸씩 올라가며 톱니 소리를 들어본다"


@pytest.fixture(autouse=True)
def _유료호출을_끊는다(monkeypatch: pytest.MonkeyPatch) -> dict:
    센것 = {"등급": "G2", "되묻기횟수": 1}

    async def _통과(text: str):
        return 검사결과(blocked=False)

    async def _평가(text: str, *, 기록: bool = True):
        return 평가결과(grade=센것["등급"], signals=[], descriptors=[])

    async def _서사(지시: str, 프롬프트: str, *, 턴: int, 허용재시도: int = 1):
        return 서사결과(
            출력=GM출력(
                narrative=f"{턴}턴의 서사.",
                choices=[선택지(id="c1", label="깃털을 줍는다")],
                trial_path="observe" if 턴 >= 9 else None,
            )
        )

    async def _되묻기횟수(자녀id: str, 키: str, **_):
        return 센것["되묻기횟수"]

    monkeypatch.setattr(stage1, "검사하기", _통과)
    monkeypatch.setattr(stage1, "evaluate", _평가)
    monkeypatch.setattr(stage1, "서사", _서사)
    monkeypatch.setattr(stage1, "되묻기횟수", _되묻기횟수)
    return 센것


async def _한판끝내기(client: TestClient) -> str:
    """12턴 안에 완결까지 간다 — 9턴 `G2` 면 한 턴에 넘고 10턴이 완결이다."""
    판 = client.post(챕터).json()
    for _ in range(10):
        client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장})
    return 판["chapter_id"]


async def _카드시도쌓기(아이: Child, 개수: int) -> None:
    """**Stage 0 연습 카드도 그날의 턴을 먹는다** (PRD A0-5). 실제 행으로 쌓는다."""
    async with db.SessionLocal() as session:
        카드id = (await session.execute(select(Card).limit(1))).scalars().first().id
        for _ in range(개수):
            session.add(
                CardAttempt(
                    child_id=아이.id,
                    card_id=카드id,
                    grade="G2",
                    char_len=40,
                    text="쌓아 두는 행이다",
                )
            )
        await session.commit()


# ── D-1 하드 피니시 ─────────────────────────────────────


async def test_오늘_끝냈으면_새_판을_못_연다(client: TestClient):
    """**당일 새 챕터 시작 불가** (PRD D-1). **자정 기준 해제.**"""
    await _한판끝내기(client)

    응답 = client.post(챕터)

    assert 응답.status_code == 409
    assert 응답.json()["error"]["code"] == "CHAPTER_DONE_TODAY"


async def test_끝낸_아이와_막힌_아이가_다른_말을_듣는다(client: TestClient):
    """**⛔ `문구.md` 1.20 이 못 박은 자리다.** 완결은 **1.20**(「다 했다」)이고
    턴 상한은 **1.10**(「더 못 한다」)이다 — 돌려 쓰면 **끝낸 아이가 막힌 말을 듣는다.**
    """
    from app.guide_lines import 완결대사, 종료대사

    await _한판끝내기(client)

    가이드 = client.post(챕터).json()["error"]["detail"]["guide"]

    assert 가이드["line"] in 완결대사()
    assert 가이드["line"] not in 종료대사()
    assert 가이드["expression"] == "session_end"


async def test_끝낸_뒤_이어하기를_열면_잠금이_보인다(client: TestClient):
    """**⛔ `404 NO_ACTIVE_CHAPTER` 로 두면 아이가 「지금 이어갈 이야기가 없어요」를
    본다** — 사실은 **끝낸 것**이다. 화면이 잠금을 그리려면 **그 둘이 갈려야** 한다.
    """
    await _한판끝내기(client)

    응답 = client.get(f"{챕터}/current")

    assert 응답.status_code == 409
    assert 응답.json()["error"]["code"] == "CHAPTER_DONE_TODAY"


async def test_중도_이탈은_이어하기가_된다(client: TestClient):
    """**같은 날 1챕터 완결까지는 허용** (PRD D-1 마지막 MUST). 끝내기 전에는
    **잠기지 않는다** — 잠그면 **새로고침이 판을 뺏는다.**"""
    판 = client.post(챕터).json()
    client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장})

    이어 = client.get(f"{챕터}/current")

    assert 이어.status_code == 200
    assert 이어.json()["chapter_id"] == 판["chapter_id"]
    assert 이어.json()["turn"] == 1


# ── D-2 일일 턴 상한 ─────────────────────────────────────


async def test_하루_턴을_다_쓰면_잠긴다(client: TestClient, 자녀행: Child):
    """**기본 15턴/일** (PRD D-2 — 「1챕터 12턴 + 스캐폴딩 여유」)."""
    from app.daily_turns import 일일턴상한

    # **판을 먼저 열고 그 뒤에 상한에 닿는다** — 아이가 실제로 밟는 순서다
    판 = client.post(챕터).json()
    await _카드시도쌓기(자녀행, 일일턴상한)

    응답 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장})

    assert 응답.status_code == 429
    assert 응답.json()["error"]["code"] == "TURN_LIMIT"


async def test_턴을_다_쓴_아이에게는_판을_열지_않는다(client: TestClient, 자녀행: Child):
    """**⛔ GM 호출 앞에서 막는다.** 뒤로 밀면 **잠긴 아이 때문에 도입 서사가 생성되고
    돈이 쓰이는데 그 판은 화면에 안 뜬다.**

    **문구는 1.10 이다** — 「상한 도달 시 하드 피니시와 동일 화면」이지만(PRD D-2)
    **말은 「다 했다」가 아니라 「더 못 한다」**다.
    """
    from app.daily_turns import 일일턴상한

    await _카드시도쌓기(자녀행, 일일턴상한)

    응답 = client.post(챕터)

    assert 응답.status_code == 429
    assert 응답.json()["error"]["code"] == "TURN_LIMIT"


async def test_턴_상한_문구는_1_10_이다(client: TestClient, 자녀행: Child):
    """**1.21 이 「새 문구를 만들지 않는다 — 1.10 을 그대로 쓴다」로 정했다.**"""
    from app.daily_turns import 일일턴상한
    from app.guide_lines import 완결대사, 종료대사

    판 = client.post(챕터).json()
    await _카드시도쌓기(자녀행, 일일턴상한)

    가이드 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장}).json()["error"][
        "detail"
    ]["guide"]

    assert 가이드["line"] in 종료대사()
    assert 가이드["line"] not in 완결대사()
    assert 가이드["expression"] == "session_end"


async def test_연습_카드도_그날의_턴을_먹는다(client: TestClient, 자녀행: Child):
    """**⛔ PRD A0-5: 「카운터를 공유 — 연습 모드 카드도 그날의 턴을 소모」.**

    **갈라 두면 아이가 두 배로 논다** — 카드 5장과 턴 15개를 따로 세면
    하루 상한이 사실상 20 이 된다.
    """
    from app.daily_turns import 오늘턴수, 일일턴상한

    await _카드시도쌓기(자녀행, 4)
    판 = client.post(챕터).json()
    client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장})

    async with db.SessionLocal() as session:
        쓴수, 상한 = await 오늘턴수(session, 자녀행)

    assert 쓴수 == 5  # 카드 4 + 턴 1
    assert 상한 == 일일턴상한


async def test_되묻기는_그날의_턴을_안_먹는다(
    client: TestClient, 자녀행: Child, _유료호출을_끊는다: dict
):
    """**되묻기가 상한을 깎으면 막힌 아이가 더 빨리 잠긴다** (계약 4절).

    **행을 안 만들어서 자연히 지켜진다** — Stage 0 이 재시도를 그렇게 처리한 것과
    같은 자리다(`card_store.오늘상태`).
    """
    from app.daily_turns import 오늘턴수

    판 = client.post(챕터).json()
    _유료호출을_끊는다["등급"] = "G0"
    for _ in range(3):
        client.post(턴, json={"chapter_id": 판["chapter_id"], "text": "공격"})

    async with db.SessionLocal() as session:
        쓴수, _ = await 오늘턴수(session, 자녀행)

    assert 쓴수 == 0


async def test_상한에_닿은_뒤_다시_보내도_안_열린다(client: TestClient, 자녀행: Child):
    """**⛔ 재시도로 우회되지 않는다** (계약 4절). Stage 0 에서 `retry_of` 가 상한을
    안 보던 구멍이 열려 있던 자리다 — **여기서는 셈이 `chapter_turns` 행에서 나오므로
    우회할 별도 카운터가 없다.** 그 사실을 검사로 못 박는다."""
    from app.daily_turns import 일일턴상한

    판 = client.post(챕터).json()
    await _카드시도쌓기(자녀행, 일일턴상한)

    첫번 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장})
    두번 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장})

    assert 첫번.status_code == 429
    assert 두번.status_code == 429

    async with db.SessionLocal() as session:
        assert await 저장소.턴들(session, 판["chapter_id"]) == []
