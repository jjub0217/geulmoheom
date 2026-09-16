"""GM 스토리 엔진 (A-1 · W7 1번 · PRD 4.1).

**여기서 네트워크를 타지 않는다.** 실제 서사 품질은 유료 호출로 재고 벤치에 남는다
(`bench_evaluator.py` 와 같은 자리). 이 파일이 지키는 것은 넷이다.

1. **프롬프트가 문서에서 온다** — 뼈대·금지어·고정 문구를 코드가 지어내지 않는다
2. **⛔ 시련 4경로 조건이 `approach` 전에는 프롬프트에 없다** — 일찍 넣으면 **GM 이
   시련을 미리 흘리고 관찰 경로가 발견이 아니라 통보가 된다**
3. **출력 검사를 지난다** — 막히면 한 번 다시 부르고, 또 막히면 `unsafe`.
   **폴백 서사를 만들지 않는다**
4. **아이 원문이 로그에 안 새어 나간다** (PRD 1.1b)
"""

import asyncio
import logging

import pytest

from app import gm
from app.gm import GM출력, 서사, 선택지, 시스템지시, 턴프롬프트

문장 = "이끼 낀 돌계단을 한 칸씩 올라가며 톱니 소리를 들어본다"
상태 = {"hero": {"hp": 3, "items": []}, "location": "시계탑 앞"}


@pytest.fixture(autouse=True)
def _모델설정(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gm, "_설정된모델", lambda: "gemini-테스트")


@pytest.fixture(autouse=True)
def _검사는통과(monkeypatch: pytest.MonkeyPatch) -> None:
    """출력 검사는 기본으로 통과시킨다. **막는 경우는 따로 본다.**"""

    class _통과:
        blocked = False

    async def _검사(text: str):
        return _통과()

    monkeypatch.setattr(gm, "검사하기", _검사)


def _출력(narrative: str = "시계탑 톱니가 삐걱 돌아간다. 위에서 깃털 하나가 떨어진다.") -> GM출력:
    return GM출력(
        narrative=narrative,
        choices=[선택지(id="c1", label="깃털을 줍는다"), 선택지(id="c2", label="위를 올려다본다")],
        is_key_scene=False,
        scene_prompt_hint="",
    )


def _응답(출력: GM출력):
    async def _한번(모델: str, 지시: str, 프롬프트: str) -> GM출력:
        return 출력

    return _한번


# ── 프롬프트가 문서에서 온다 ─────────────────────────────


def test_시스템지시에_금지어가_들어간다():
    """**PRD 4.4 의 `금지:` 줄을 읽는다** — 코드에 복사하지 않는다."""
    from app.scaffold import 금지어

    지시 = 시스템지시()

    for 말 in 금지어():
        assert 말 in 지시


def test_시스템지시가_개인정보를_묻지_말라고_한다():
    """**PRD 4.1 `[역할 경계]`** — 아이에게 이름·나이·학교를 묻는 GM 이 되면 안 된다."""
    지시 = 시스템지시()

    assert "이름" in 지시 and "묻지 않는다" in 지시


def test_프롬프트가_뼈대를_문서에서_받아온다():
    """비트 이름과 「하면 안 되는 것」이 프롬프트에 실려야 GM 이 그걸 안 한다."""
    글 = 턴프롬프트(턴=1, 상태=상태, 아이입력=문장, 등급="G2", 보너스=1)

    assert "현재 비트: intro" in 글
    assert "다음 비트: explore" in 글
    assert "위험하다고 말하기" in 글  # 1턴의 「하면 안 되는 것」


def test_직접쓰기_유도는_GM_이_다시_쓰지_않게_한다():
    """**고정 문구는 우리가 넣는다** (`문구.md` 1.18). GM 이 매 턴 지어내면 흔들린다."""
    from app.guide_lines import 직접쓰기유도

    글 = 턴프롬프트(턴=2, 상태=상태, 아이입력=문장, 등급="G2", 보너스=1)

    assert 직접쓰기유도() in 글
    assert "다시 쓰지 마라" in 글


# ── ⛔ 시련 조건을 일찍 흘리지 않는다 ────────────────────


@pytest.mark.parametrize("턴", [1, 2, 3, 4, 5])
def test_approach_전에는_시련_조건이_프롬프트에_없다(턴: int):
    """**이 파일에서 가장 중요한 검사다.**

    일찍 넣으면 **GM 이 시련을 미리 흘리고**, 그러면 아이가 탑을 오르는 중에
    「태엽새의 발이 끼어 있다」를 알게 된다 — **관찰 경로가 발견이 아니라 통보가 된다.**
    """
    글 = 턴프롬프트(턴=턴, 상태=상태, 아이입력=문장, 등급="G2", 보너스=1)

    assert "해결 조건" not in 글
    assert "observe" not in 글
    assert "톱니에 끼어" not in 글


@pytest.mark.parametrize("턴", [6, 7, 8, 9])
def test_approach_부터는_네_경로가_다_들어간다(턴: int):
    """**넷이 다 있어야 동등하다.** 하나가 빠지면 그 경로가 조용히 불리해진다."""
    글 = 턴프롬프트(턴=턴, 상태=상태, 아이입력=문장, 등급="G2", 보너스=1)

    for 코드 in ("force", "persuade", "observe", "care"):
        assert 코드 in 글
    assert "네 경로를 선택지로 나열하지 않는다" in 글


def test_프롬프트에_보스가_없다():
    """**금지어다** (`용어사전.md` 8장). 프롬프트에 들어가면 서사로 나온다."""
    for 턴 in range(1, 13):
        글 = 턴프롬프트(턴=턴, 상태=상태, 아이입력=문장, 등급="G2", 보너스=1)
        assert "보스" not in 글
        assert "boss" not in 글.lower()


# ── 출력 검사 ───────────────────────────────────────────


async def test_검사가_통과하면_서사가_나온다(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(gm, "_한번", _응답(_출력()))

    결과 = await 서사(시스템지시(), "프롬프트")

    assert 결과.출력 is not None
    assert 결과.사유 is None
    assert not 결과.막혔나


async def test_검사가_한_번_막으면_다시_부르고_통과한다(monkeypatch: pytest.MonkeyPatch):
    """**한 번만 다시 부른다** (`Stage1.md` 2절 7)."""
    호출 = []

    async def _한번(모델: str, 지시: str, 프롬프트: str) -> GM출력:
        호출.append(1)
        return _출력()

    막은횟수 = []

    class _판정:
        def __init__(self, blocked: bool) -> None:
            self.blocked = blocked

    async def _검사(text: str):
        막은횟수.append(1)
        return _판정(len(막은횟수) == 1)  # 첫 번만 막는다

    monkeypatch.setattr(gm, "_한번", _한번)
    monkeypatch.setattr(gm, "검사하기", _검사)

    결과 = await 서사(시스템지시(), "프롬프트")

    assert len(호출) == 2
    assert 결과.출력 is not None
    assert 결과.재호출 is True


async def test_두_번_막히면_unsafe_이고_서사를_지어내지_않는다(monkeypatch: pytest.MonkeyPatch):
    """**폴백 서사를 만들지 않는다** — 막힌 자리에 우리가 글을 넣으면 **그 글에는
    검사가 없다.** `502 GM_UNSAFE` 로 간다 (`Stage1.md` 6절)."""

    class _막음:
        blocked = True

    async def _검사(text: str):
        return _막음()

    monkeypatch.setattr(gm, "_한번", _응답(_출력()))
    monkeypatch.setattr(gm, "검사하기", _검사)

    결과 = await 서사(시스템지시(), "프롬프트")

    assert 결과.막혔나
    assert 결과.출력 is None  # **지어낸 서사가 없다**


async def test_타임아웃이면_한_번_더_부르고_사유가_남는다(monkeypatch: pytest.MonkeyPatch):
    호출 = []

    async def _느림(모델: str, 지시: str, 프롬프트: str) -> GM출력:
        호출.append(1)
        await asyncio.sleep(1)
        raise AssertionError("여기까지 오면 안 된다")

    monkeypatch.setattr(gm, "TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(gm, "_한번", _느림)

    결과 = await 서사(시스템지시(), "프롬프트")

    assert len(호출) == 2
    assert 결과.사유 == "timeout"
    assert 결과.출력 is None


async def test_모델이_없으면_부르지_않는다(monkeypatch: pytest.MonkeyPatch):
    """dev 목은 모델명 없이 돈다. **pilot 은 기동 자체가 막힌다**(`config`)."""
    monkeypatch.setattr(gm, "_설정된모델", lambda: "")

    async def _불려선안됨(모델: str, 지시: str, 프롬프트: str) -> GM출력:
        raise AssertionError("모델이 없는데 호출했다")

    monkeypatch.setattr(gm, "_한번", _불려선안됨)

    결과 = await 서사(시스템지시(), "프롬프트")

    assert 결과.사유 == "unconfigured"


# ── 아이 원문이 안 샌다 ─────────────────────────────────


async def test_실패_로그에_아이_원문이_없다(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    """**예외 메시지에 프롬프트가 되울려 오는 일이 있다** (PRD 1.1b).

    그 프롬프트에는 아이 원문이 들어 있다 — **타입만 남긴다.**
    """

    async def _터짐(모델: str, 지시: str, 프롬프트: str) -> GM출력:
        raise RuntimeError(f"프로바이더가 되울렸다: {문장}")

    monkeypatch.setattr(gm, "_한번", _터짐)

    프롬프트 = 턴프롬프트(턴=1, 상태=상태, 아이입력=문장, 등급="G2", 보너스=1)
    with caplog.at_level(logging.WARNING):
        결과 = await 서사(시스템지시(), 프롬프트)

    assert 결과.사유 == "error"
    assert caplog.records, "로그가 아예 안 남으면 이 검사가 아무것도 안 잰다"
    for 기록 in caplog.records:
        # **재는 것은 「원문이 어디에도 없다」다** — 키 목록이 아니다.
        # 메시지·인자·extra 값을 다 훑는다: 한 군데만 새도 새는 것이다.
        전부 = " ".join(str(값) for 값 in 기록.__dict__.values()) + 기록.getMessage()
        assert 문장 not in 전부
        # **남는 것은 타입뿐이다.**
        assert getattr(기록, "exc_type", None) == "RuntimeError"
        assert 기록.exc_info is None, "예외 객체를 실으면 메시지에 원문이 따라온다"


# ── 금지어는 막지 않고 센다 ─────────────────────────────


async def test_금지어가_섞이면_막지_않고_센다(monkeypatch: pytest.MonkeyPatch):
    """**서사는 나가고 우리가 빈도를 본다.**

    「부족해」가 섞였다고 아이에게 오류를 보이면 **그 턴이 통째로 사라진다** —
    프롬프트가 이미 금지하고 있고, 자주 나면 그때 프롬프트를 고칠 자리다.
    """
    monkeypatch.setattr(gm, "_한번", _응답(_출력("네 문장은 조금 부족해. 그래도 가보자.")))

    결과 = await 서사(시스템지시(), "프롬프트")

    assert 결과.출력 is not None  # 막지 않았다
    assert "부족해" in 결과.금지어걸림  # 셌다
