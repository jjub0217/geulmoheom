"""챕터·턴 엔드포인트가 **실물로** 돈다 (A-4 · W7 3번 ② · `docs/api/Stage1.md` 1·2절).

**목 검사는 `test_stage1_mock.py` 가 따로 본다** — 거기는 계약 모양(`/openapi.json` ·
둘 중 하나 · 인증)이고, **여기는 한 판이 실제로 굴러가는지**다.

**⛔ 유료 호출을 안 한다.** GM·평가·검사는 이 파일에서 다 갈아끼운다 — 그래야
**한 판을 끝까지 굴리는 검사가 돈이 안 든다.**

**여기서 지키는 것**

1. **새로고침이 이야기를 안 잃는다** — 두 번 열어도 같은 판, `current` 가 그 판
2. **되묻기는 턴을 안 먹는다** (계약 4절) · **선택지로 온 G0 은 안 되묻는다** (2절)
3. **⛔ 차단된 입력은 GM 까지 안 간다** — 검사가 먼저다 (2절 처리 순서 1번)
4. **⛔ 아이 원문이 이벤트에 안 남는다** (PRD 1.1b)
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import chapter_skeleton as 뼈대
from app import chapter_store as 저장소
from app import db
from app.api.v1 import stage1
from app.evaluator import 평가결과
from app.gm import GM출력, 서사결과, 선택지
from app.models import Chapter, Child, Event
from app.moderation import 검사결과

pytestmark = pytest.mark.anyio

챕터 = "/api/v1/chapters"
턴 = "/api/v1/turns"
문장 = "이끼 낀 돌계단을 한 칸씩 올라가며 톱니 소리를 들어본다"


@pytest.fixture(autouse=True)
def _유료호출을_끊는다(monkeypatch: pytest.MonkeyPatch) -> dict:
    """**GM·평가·검사를 다 갈아끼운다.** 센 횟수를 돌려준다 — 「GM 을 안 불렀다」를
    검사하려면 **부른 횟수**가 필요하다."""
    센것 = {"gm": 0, "등급": "G2", "되묻기횟수": 1}

    async def _통과(text: str):
        return 검사결과(blocked=False)

    async def _평가(text: str, *, 기록: bool = True):
        return 평가결과(grade=센것["등급"], signals=[], descriptors=[])

    async def _서사(지시: str, 프롬프트: str, *, 턴: int, 허용재시도: int = 1):
        센것["gm"] += 1
        return 서사결과(
            출력=GM출력(
                narrative=f"{턴}턴의 서사. 톱니가 삐걱 돌아간다.",
                choices=[선택지(id="c1", label="깃털을 줍는다")],
                # **경로 판별은 GM 몫이다** (PRD A-4) — 목도 그렇게 답해야
                # **서버가 낱말로 맞히는 길로 새지 않는다**
                trial_path="observe" if 턴 >= 뼈대.시련턴 else None,
            )
        )

    async def _되묻기횟수(자녀id: str, 키: str, **_):
        """**Redis 를 타지 않는다.** `TestClient` 는 앱을 다른 루프에서 돌려서
        이 자리의 실제 Redis 호출이 `RuntimeError` 로 죽는다 — `/attempts` 검사들도
        같은 이유로 이 함수를 갈아끼운다. **셀 수 없을 때의 갈래는 따로 잰다.**"""
        return 센것["되묻기횟수"]

    monkeypatch.setattr(stage1, "검사하기", _통과)
    monkeypatch.setattr(stage1, "evaluate", _평가)
    monkeypatch.setattr(stage1, "서사", _서사)
    monkeypatch.setattr(stage1, "되묻기횟수", _되묻기횟수)
    return 센것


async def _열기(client: TestClient) -> dict:
    응답 = client.post(챕터)
    assert 응답.status_code == 201, 응답.text
    return 응답.json()


# ── 새로고침이 이야기를 안 잃는다 ─────────────────────────


async def test_챕터를_열면_GM_도입이_실린다(client: TestClient, _유료호출을_끊는다: dict):
    몸 = await _열기(client)

    assert 몸["turn"] == 0
    assert 몸["beat"] == "intro"
    assert 몸["narrative"]
    assert 몸["choices"]
    assert 몸["turns_left"] == 12
    assert _유료호출을_끊는다["gm"] == 1


async def test_두_번_열면_같은_판이다(client: TestClient, _유료호출을_끊는다: dict):
    """**⭐ 계약 1절이 「진행 중인 챕터가 있으면 새로 안 연다」다.**

    **GM 을 다시 부르지 않는 것이 요점이다** — 다시 부르면 **새로고침마다 도입이
    바뀌고 돈이 나간다.**
    """
    첫판 = await _열기(client)
    둘째 = await _열기(client)

    assert 둘째["chapter_id"] == 첫판["chapter_id"]
    assert 둘째["narrative"] == 첫판["narrative"]
    assert _유료호출을_끊는다["gm"] == 1

    async with db.SessionLocal() as session:
        판수 = len(list((await session.execute(select(Chapter))).scalars()))
    assert 판수 == 1


async def test_current_가_그_판을_돌려준다(client: TestClient):
    첫판 = await _열기(client)

    몸 = client.get(f"{챕터}/current").json()

    assert 몸["chapter_id"] == 첫판["chapter_id"]
    assert 몸["narrative"] == 첫판["narrative"]


async def test_진행중인_판이_없으면_찾을_수_없다(client: TestClient):
    """**⏳ 계약은 `404 NO_ACTIVE_CHAPTER` 다.** 그 코드의 아이 문구가 `문구.md` 2.1 에
    아직 없어서 **지금은 `NOT_FOUND`(404) 로 나간다** — 상태 코드는 계약대로이고
    **문장은 승인된 것**이다. 문구가 내려오면 코드만 바꾼다."""
    응답 = client.get(f"{챕터}/current")

    assert 응답.status_code == 404


# ── 턴 ──────────────────────────────────────────────────


async def test_자유_묘사가_턴을_하나_올린다(client: TestClient):
    판 = await _열기(client)

    몸 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장}).json()

    assert 몸["turn"] == 1
    # **`grade` 는 응답에 없다** (2026-09-16 명세 변경) — 등급은 서사가 말한다
    assert "grade" not in 몸
    assert 몸["narrative"]
    assert 몸["scaffold"] is None
    assert 몸["turns_left"] == 11
    assert 몸["chapter_done"] is False


async def test_G0_은_되묻고_턴을_안_먹는다(client: TestClient, _유료호출을_끊는다: dict):
    """**되묻기가 상한을 깎으면 막힌 아이가 더 빨리 잠긴다** (계약 4절).

    **GM 도 안 부른다** — 되묻는 턴에는 서사가 없다.
    """
    판 = await _열기(client)
    _유료호출을_끊는다["등급"] = "G0"

    몸 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": "공격"}).json()

    assert 몸["scaffold"]
    assert 몸["narrative"] is None
    assert 몸["turn"] == 0
    assert 몸["turns_left"] == 12
    assert _유료호출을_끊는다["gm"] == 1  # 도입 한 번뿐이다


async def test_되묻기를_못_세면_턴이_지나간다(client: TestClient, _유료호출을_끊는다: dict):
    """**⛔ 되묻기가 실패한 날을 위한 검사다** (2026-09-16에 실제로 밟았다).

    Redis 를 못 세면 `되묻기횟수()` 가 `None` 이고, **되묻지도 않고 턴도 안 가면
    아이가 갇힌다.** PRD A-5 가 **「2회 후에도 G0이면 G1 취급으로 진행 — 아이를
    막지 않음」**으로 정해 둔 자리다.
    """
    판 = await _열기(client)
    _유료호출을_끊는다["등급"] = "G0"
    _유료호출을_끊는다["되묻기횟수"] = None

    몸 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": "공격"}).json()

    assert 몸["scaffold"] is None
    assert 몸["turn"] == 1


async def test_선택지로_온_G0_은_되묻지_않고_턴을_먹는다(
    client: TestClient, _유료호출을_끊는다: dict
):
    """**고른 것을 되물으면 뜻이 없다** (계약 2절). 그래도 턴은 지나간다."""
    판 = await _열기(client)
    _유료호출을_끊는다["등급"] = "G0"
    고른것 = 판["choices"][0]["id"]

    몸 = client.post(턴, json={"chapter_id": 판["chapter_id"], "choice_id": 고른것}).json()

    assert 몸["scaffold"] is None
    assert 몸["turn"] == 1
    assert 몸["turns_left"] == 11


async def test_없는_선택지를_고르면_422(client: TestClient):
    """**라벨을 평가에 태우므로** 없는 선택지는 평가할 것이 없다."""
    판 = await _열기(client)

    응답 = client.post(턴, json={"chapter_id": 판["chapter_id"], "choice_id": "없는것"})

    assert 응답.status_code == 422


async def test_남의_챕터로는_턴을_못_넘긴다(client: TestClient, 자녀행: Child):
    """`chapter_id` 가 남의 것이면 404. **넘어가면 다른 아이 이야기에 글을 쓴다.**"""
    await _열기(client)

    응답 = client.post(턴, json={"chapter_id": str(자녀행.id), "text": 문장})

    assert 응답.status_code == 404


# ── ⛔ 안전 ──────────────────────────────────────────────


async def test_차단된_입력은_GM_까지_안_간다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, _유료호출을_끊는다: dict
):
    """**계약 2절 처리 순서 1번이다** — 차단이면 **평가·GM 호출 안 함.**

    **GM 을 부르면 차단된 문장이 프로바이더로 나가고**, 그 위에 서사가 얹힌다.
    """
    판 = await _열기(client)

    async def _막힘(text: str):
        return 검사결과(blocked=True, category="violence")

    monkeypatch.setattr(stage1, "검사하기", _막힘)
    부른수 = _유료호출을_끊는다["gm"]

    응답 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": "칼로 찌른다"})

    assert 응답.status_code == 200
    assert _유료호출을_끊는다["gm"] == 부른수


async def test_차단은_오류가_아니라_정상_응답이다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """**⛔ 2026-09-16 계약 정정** (`dc975e5`). 종전 `422 UNSAFE_INPUT` 은 **틀렸고
    어긋난 쪽이 계약 2절이었다** — `Stage0.md` 가 이미 **`(c) 차단` 정상 응답**으로
    정해 뒀다(2026-09-08 대표 판정).

    **⛔ 그리고 그게 아이에게 중요하다.** `Stage0.md` 148행이 **「차단 시 아이가 쓴
    문장을 지우지 않는다. 입력창에 그대로 남긴다 — 이유도 모른 채 공들여 쓴 글이
    사라지면 그것 자체가 벌로 읽힌다」**다. **422 로 내면 화면이 오류 갈래로 가고
    그 규칙이 깨진다** (프론트가 짚었다).
    """
    from app.guide_lines import 차단대사

    판 = await _열기(client)

    async def _막힘(text: str):
        return 검사결과(blocked=True, category="violence")

    monkeypatch.setattr(stage1, "검사하기", _막힘)

    몸 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": "칼로 찌른다"}).json()

    # **프론트가 이 값으로 화면을 가른다** (`api/CLAUDE.md` — `outcome` 3분기)
    assert 몸["outcome"] == "blocked"
    assert 몸["reason"] == "moderation"
    assert 몸["narrative"] is None and 몸["scaffold"] is None
    # **문구는 1.11 이다** — 종류·카테고리를 아이에게 말하지 않는다
    assert 몸["guide"]["line"] in 차단대사()
    assert 몸["guide"]["expression"] == "compass_dim"
    # **평가를 안 했다** — 차단 건의 평가값은 버린다. 응답에 등급 자리가 아예 없다
    assert "grade" not in 몸
    # **턴을 안 먹는다** — 막힌 것이 아이 몫을 깎지 않는다
    assert 몸["turn"] == 0 and 몸["turns_left"] == 12


async def test_자해_신호는_대사만_다르고_겉모양이_같다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """**`문구.md` 1.2 · Stage 0 선례 그대로.** 표정도 `reason` 도 같다 —
    **이 상황 전용 표정이나 사유를 만들면 아이가 자기 신호가 특별히 취급됐다는
    것을 알아챈다.** 달라지는 것은 **대사 한 줄**뿐이다."""
    from app.guide_lines import 자해대사, 차단대사

    판 = await _열기(client)

    async def _자해(text: str):
        return 검사결과(blocked=True, category="self_harm", self_harm=True)

    monkeypatch.setattr(stage1, "검사하기", _자해)

    몸 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": "..."}).json()

    assert 몸["guide"]["line"] == 자해대사()
    assert 몸["guide"]["line"] not in 차단대사()
    assert 몸["reason"] == "moderation"
    assert 몸["guide"]["expression"] == "compass_dim"


async def test_세_갈래가_전부_outcome_을_명시한다(client: TestClient, _유료호출을_끊는다: dict):
    """**`api/CLAUDE.md`: 「`outcome` 3분기를 항상 명시적으로 반환한다 — 프론트가 이
    값으로 화면을 가른다」.** `/attempts` 가 그렇게 서 있고 `/turns` 도 같다.

    **⛔ 추론으로 가르게 두지 않는다** (프론트가 짚었다). `narrative == null &&
    scaffold == null` 로 차단을 알아내려면 **되묻기와 모양이 겹치고**, GM 이 다른
    이유로 서사를 안 준 날 **아무 잘못 없는 아이가 차단 문구를 본다.**
    """
    판 = await _열기(client)
    결과 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장}).json()

    _유료호출을_끊는다["등급"] = "G0"
    되물음 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": "공격"}).json()

    assert 결과["outcome"] == "result"
    assert 되물음["outcome"] == "scaffold"


async def test_아이_원문이_이벤트에_안_남는다(client: TestClient):
    """**PRD 1.1b.** 원문이 가도 되는 곳은 `card_attempts.text` 하나이고,
    **`chapter_turns` 에는 칸조차 없다.**"""
    판 = await _열기(client)
    client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장})

    async with db.SessionLocal() as session:
        이벤트들 = list((await session.execute(select(Event))).scalars())
        턴들 = await 저장소.턴들(session, 판["chapter_id"])

    assert 턴들, "턴이 남아야 한다"
    쌓인글 = " ".join(str(것.payload) for 것 in 이벤트들)
    assert 문장 not in 쌓인글
    assert "이끼" not in 쌓인글


# ── 완결 ────────────────────────────────────────────────


async def test_시련을_넘으면_다음_턴이_완결이다(client: TestClient):
    """**한 판을 끝까지 굴린다** (주차 계획 완료 조건). 9턴에 `G2` 면 한 턴에 넘고,
    10턴이 `resolution` 이며 그 턴에 `chapter_done` 이다."""
    판 = await _열기(client)
    몸 = {}
    for _ in range(10):
        몸 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장}).json()

    assert 몸["turn"] == 10
    assert 몸["beat"] == "resolution"
    assert 몸["chapter_done"] is True

    async with db.SessionLocal() as session:
        행 = (await session.execute(select(Chapter))).scalar_one()
    assert 행.done_at is not None
    assert 행.trial_path is not None


async def test_완결_응답에_이어서_더_하기가_없다(client: TestClient):
    """**하드 피니시다** (D-1 · 페르소나 7.1). **없는 것이 결정이다** —
    필드로 한 번 생기면 **화면이 그것을 버튼으로 그린다.**

    **⛔ 목에서 옮겨 온 검사다** (`test_stage1_mock.py`). 목일 때는 아무 UUID 로도
    200 이 떴지만 **이제는 내 판이어야 열린다** — 그 사실까지 같이 잰다.
    """
    판 = await _열기(client)
    for _ in range(10):
        client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장})

    몸 = client.get(f"{챕터}/{판['chapter_id']}/summary").json()

    assert 몸["turns_used"] == 10
    assert 몸["title"] == "거꾸로 도는 마을"
    assert 몸["tier"] == "rare"
    assert not {"continue", "next_chapter", "resume", "more"} & set(몸)


async def test_남의_완결_화면은_안_열린다(client: TestClient, 자녀행: Child):
    """`id` 만 맞으면 **남의 완결 화면이 열린다.** 내 것인지까지 본다."""
    응답 = client.get(f"{챕터}/{자녀행.id}/summary")

    assert 응답.status_code == 404
