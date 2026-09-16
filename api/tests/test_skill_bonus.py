"""스킬 보너스 (B-4 · W7 4번 · `MVP_PRD.md` B-4).

**⛔ Evaluator 를 새로 만들지 않는다.** G0~G3 가 그대로 들어온다 — 이 항목이 하는 일은
**그 등급을 행동 결과로 옮기는 것**뿐이다.

**숫자는 PRD 가 정했다** — **G3 +2 · G2 +1 · G1 0 · G0 -1.** 지어낸 값이 없다.

**⛔ 「행동」은 전투가 아니다.** PRD B-4 가 **「전투뿐 아니라 설득·관찰·돌봄·회피 모두」**
로 못 박았다 — **경로가 보너스를 바꾸면 페르소나 2원형 중 하나가 불리해진다.**

**⛔ 「점수」를 쓰지 않는다** (`용어사전.md` 8장 금지어). **등급이 서사에 반영되는
것이고 숫자가 뜨는 게 아니다** — 프롬프트에도 그 낱말을 안 넣는다.

**⛔ 실패해도 게임오버가 없다** (PRD B-4). **체력 감소·우회 서사로 진행한다** —
그 지시가 프롬프트에 있어야 **G0 이 「아무 일도 안 일어남」으로 끝나지 않는다.**
"""

import pytest
from fastapi.testclient import TestClient

from app import chapter_run as 진행기
from app.api.v1 import stage1
from app.evaluator import 평가결과
from app.gm import GM출력, 서사결과, 선택지, 턴프롬프트
from app.moderation import 검사결과

pytestmark = pytest.mark.anyio

챕터 = "/api/v1/chapters"
턴 = "/api/v1/turns"
문장 = "이끼 낀 돌계단을 한 칸씩 올라가며 톱니 소리를 들어본다"
상태 = {"hero": {"hp": 10, "max_hp": 10, "items": []}, "location": "마을 광장"}


def _프롬프트(등급: str, 턴번호: int = 4) -> str:
    return 턴프롬프트(
        턴=턴번호,
        상태=상태,
        아이입력=문장,
        등급=등급,
        보너스=진행기.보너스(등급),
    )


# ── 숫자는 PRD 것이다 ────────────────────────────────────


def test_보너스_표가_PRD_그대로다():
    """**G3 +2 · G2 +1 · G1 0 · G0 -1** (PRD B-4). **코드가 숫자를 지어내지 않는다.**"""
    assert 진행기.보너스("G3") == 2
    assert 진행기.보너스("G2") == 1
    assert 진행기.보너스("G1") == 0
    assert 진행기.보너스("G0") == -1


def test_시련_걸음과_보너스는_다른_표다():
    """**둘을 같은 표로 묶지 않는다.** 시련 통과는 **G2 이상 1턴 · G1 2턴**(걸음 2/1/0)
    이고 보너스는 **+2/+1/0/-1** 이다 — **G0 만 봐도 갈린다**(걸음 0 · 보너스 -1).
    묶으면 **한쪽을 고칠 때 다른 쪽이 조용히 따라 바뀐다.**"""
    assert 진행기.보너스("G0") != 0
    assert 진행기.다음(진행기.진행(턴=8), 등급="G0", 경로="force").시련진행 == 0


# ── 등급이 행동 결과로 간다 ───────────────────────────────


def test_G0_과_G3_의_프롬프트가_다르다():
    """**완료 조건의 무료 대응이다.** 「같은 행동을 G0 과 G3 로 넣으면 결과 서사가
    다르다」는 **나온 글을 봐야** 하고 그건 유료다 — **여기서는 GM 에게 가는 것이
    다른지**를 잰다. 프롬프트가 같으면 **서사가 다를 이유가 없다.**"""
    낮음, 높음 = _프롬프트("G0"), _프롬프트("G3")

    assert 낮음 != 높음
    assert "[등급] G0 / [보너스] -1" in 낮음
    assert "[등급] G3 / [보너스] +2" in 높음


def test_프롬프트가_보너스를_어떻게_쓰라고_말한다():
    """**값만 실으면 모델이 알아서 하지 않는다.** PRD B-4 는 **「결과를 GM 서사에
    자연스럽게 반영」**이라 **무엇이 얼마나 통하는지**를 지시로 적어야 한다."""
    글 = _프롬프트("G2")

    assert "보너스" in 글
    assert "통한" in 글 or "통하" in 글


def test_게임오버가_없다고_지시한다():
    """**PRD B-4: 「실패해도 게임오버 없음 — 체력 감소·우회 서사로 진행」.**

    이 줄이 없으면 **G0 이 「아무 일도 안 일어났다」로 끝나고**, 그건 아이에게
    **벌**로 읽힌다.
    """
    글 = _프롬프트("G0")

    assert "게임오버" in 글 or "끝내지 않는다" in 글
    assert "우회" in 글 or "다른 길" in 글


@pytest.mark.parametrize("등급", ["G0", "G1", "G2", "G3"])
def test_프롬프트에_점수라는_낱말이_없다(등급: str):
    """**금지어다** (`용어사전.md` 8장). **등급이 서사에 반영되는 것이고 숫자가
    뜨는 게 아니다** — 프롬프트에 그 낱말이 들어가면 **GM 이 서사에서 점수를 말한다.**
    """
    글 = _프롬프트(등급)

    assert "점수" not in 글
    assert "채점" not in 글


def test_경로가_보너스를_바꾸지_않는다():
    """**⛔ PRD A-4·B-4 가 같이 못 박은 자리다.** 「행동」은 **전투·설득·관찰·돌봄
    전부**이고 **경로에 따른 차별이 없다** — 한 경로가 더 센 보너스를 받으면
    **페르소나 2원형(A 이민준 / B 김서윤) 중 하나가 불리해진다.**

    **보너스 함수가 경로를 아예 안 받는다**는 것이 그 증거다.
    """
    import inspect

    받는것 = set(inspect.signature(진행기.보너스).parameters)

    assert 받는것 == {"등급"}


# ── 응답에도 실린다 ──────────────────────────────────────


@pytest.fixture
def _체인을_끊는다(monkeypatch: pytest.MonkeyPatch) -> dict:
    센것 = {"등급": "G3", "프롬프트": []}

    async def _통과(text: str):
        return 검사결과(blocked=False)

    async def _평가(text: str, *, 기록: bool = True):
        return 평가결과(grade=센것["등급"], signals=[], descriptors=[])

    async def _서사(지시: str, 프롬프트: str, *, 턴: int, 허용재시도: int = 1):
        센것["프롬프트"].append(프롬프트)
        return 서사결과(
            출력=GM출력(narrative="서사.", choices=[선택지(id="c1", label="깃털을 줍는다")])
        )

    async def _요약(재료):
        return "요약이다."

    async def _추출(서사: str, 지금: dict):
        return 지금

    async def _되묻기횟수(자녀id: str, 키: str, **_):
        return 1

    monkeypatch.setattr(stage1, "검사하기", _통과)
    monkeypatch.setattr(stage1, "evaluate", _평가)
    monkeypatch.setattr(stage1, "서사", _서사)
    monkeypatch.setattr(stage1, "요약하기", _요약)
    monkeypatch.setattr(stage1, "상태추출", _추출)
    monkeypatch.setattr(stage1, "되묻기횟수", _되묻기횟수)
    return 센것


async def test_보너스가_GM_에게만_가고_응답에는_없다(client: TestClient, _체인을_끊는다: dict):
    """**⛔ 2026-09-16 명세 변경** (PM `5d1f239`). 종전에는 `TurnResult` 에 `grade` 와
    `bonus` 가 실렸다 — **`bonus` 는 정수라 화면이 그대로 숫자로 그리고 그게 「점수」다**
    (8장 금지어 · 비전 3장). `용어사전.md` 3장이 **등급을 응답에 넣지 않는다**로 이미
    못 박았고 **Stage 0 은 `tier` 만 내보낸다.**

    **값이 사라진 게 아니라 나가는 자리만 막혔다** — GM 프롬프트로는 그대로 간다.
    """
    판 = client.post(챕터).json()

    몸 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장}).json()

    assert "grade" not in 몸 and "bonus" not in 몸
    assert "[보너스] +2" in _체인을_끊는다["프롬프트"][-1]


async def test_되묻기를_못_한_G0_은_G1_취급이라_보너스가_0이다(
    client: TestClient, _체인을_끊는다: dict, monkeypatch: pytest.MonkeyPatch
):
    """**PRD A-5 「2회 후에도 G0이면 G1 취급으로 진행」과 맞물리는 자리다.**

    **취급이 G1 이면 보너스도 G1 것이어야 한다** — -1 을 그대로 주면 **되묻기를
    못 받은 아이가 벌까지 받는다.** 판정은 판정 그대로 `grade` 에 남는다.
    """
    판 = client.post(챕터).json()
    _체인을_끊는다["등급"] = "G0"

    async def _못셈(자녀id: str, 키: str, **_):
        return None

    monkeypatch.setattr(stage1, "되묻기횟수", _못셈)

    몸 = client.post(턴, json={"chapter_id": 판["chapter_id"], "text": "공격"}).json()

    assert 몸["turn"] == 1  # 턴은 지나갔다
    # **GM 에게 간 것이 `G1`/+0 이다** — 응답에는 둘 다 안 나간다(명세 변경)
    assert "[등급] G1 / [보너스] +0" in _체인을_끊는다["프롬프트"][-1]
