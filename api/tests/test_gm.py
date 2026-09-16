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
from types import SimpleNamespace

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


def test_시스템지시의_복귀문구가_문서에서_온다():
    """**`문구.md` 1.23** (2026-09-16 내려왔다). **규칙만 주면 GM 이 매 턴 다른 말로
    돌리고, 그 말은 십중팔구 거절로 읽힌다.**

    문서가 고른 셋은 **주어가 나침반**이다 — 가이드가 거절하는 게 아니라 나침반이
    그쪽을 모르는 것이라, **규칙을 사람이 아니라 도구가 진다.** GM 이 지어내면
    그 장치가 깨진다 — 1.18 직접쓰기유도와 같은 이유다.
    """
    from app.guide_lines import 복귀문구

    지시 = 시스템지시()

    for 줄 in 복귀문구():
        assert 줄 in 지시
    assert "그대로" in 지시


def test_호출이_thinking_을_끈다():
    """**Evaluator·안전·PII 셋은 끄는데 GM 만 안 껐다** (2026-09-16에 찾았다).

    **켜져 있으면 생각 토큰이 지연과 단가에 그대로 붙는다** — 그리고 **PRD 9장이
    이 모델 축의 경고등으로 둔 것이 바로 지연**이다. 합격선은 **완료 8초**(PRD 7장)고
    **12초는 우리 타임아웃**이지 기준이 아니다.
    """
    잡은: dict[str, object] = {}

    응답 = SimpleNamespace(
        text='{"narrative": "톱니가 돈다.", "choices": [], "is_key_scene": false,'
        ' "scene_prompt_hint": ""}',
        prompt_feedback=None,
        candidates=[SimpleNamespace(finish_reason="STOP")],
    )

    async def _생성(*, model, contents, config):
        잡은["config"] = config
        return 응답

    클라이언트 = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=_생성))
    )

    with pytest.MonkeyPatch.context() as 패치:
        패치.setattr(gm, "get_client", lambda: 클라이언트)
        asyncio.run(gm._한번("gemini-테스트", 시스템지시(), "프롬프트"))

    설정 = 잡은["config"]
    assert 설정.thinking_config is not None, "GM 호출에 thinking_config 가 없다"
    assert 설정.thinking_config.thinking_budget == 0


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


# ── ⛔ 핵심 씬은 뼈대가 정한다 — 돈이다 ──────────────────


def test_핵심씬은_문서에서_둘이_온다():
    """**둘인 이유가 돈이다** (뼈대 「핵심 씬」) — 매 턴 굽으면 한 챕터에 10회이고
    **하루 상한 $0.50 을 한 아이가 혼자 넘긴다.** 코드에 박지 않고 문서에서 읽는다."""
    from app.chapter_skeleton import 핵심씬인가, 핵심씬턴들

    assert 핵심씬턴들() == (1, 9)
    assert 핵심씬인가(1) and 핵심씬인가(9)
    assert not 핵심씬인가(6)


def test_프롬프트가_핵심씬_여부를_싣는다():
    """**안 실어서 결함이 났다** (2026-09-16 유료 실측 · `benchmarks/W7-gm-bench.md`).
    **모델은 모르는 것을 물어보지 않고 추측한다** — 6턴에 `is_key_scene: true` 가 왔다."""
    여섯 = 턴프롬프트(턴=6, 상태=상태, 아이입력=문장, 등급="G2", 보너스=1)
    하나 = 턴프롬프트(턴=1, 상태=상태, 아이입력=문장, 등급="G2", 보너스=1)

    assert "핵심 씬" in 여섯 and "핵심 씬" in 하나
    assert "핵심 씬인가: 아니다" in 여섯
    assert "핵심 씬인가: 예" in 하나


async def test_모델이_핵심씬이라_해도_뼈대가_아니면_덮는다(monkeypatch: pytest.MonkeyPatch):
    """**이 검사가 돈을 지킨다.** 실측에서 모델이 6턴에 `true` 를 냈다.

    **프롬프트 준수율에 맡기지 않는다** — 프롬프트에도 넣되 **최종값은 서버가 쥔다.**
    """
    monkeypatch.setattr(gm, "_한번", _응답(_출력().model_copy(update={"is_key_scene": True})))

    결과 = await 서사(시스템지시(), "프롬프트", 턴=6)

    assert 결과.출력 is not None
    assert 결과.출력.is_key_scene is False


@pytest.mark.parametrize("턴", [1, 9])
async def test_뼈대가_핵심씬이라_하면_모델이_아니라도_켠다(
    monkeypatch: pytest.MonkeyPatch, 턴: int
):
    """**반대 방향도 뼈대가 이긴다.** 1턴은 챕터의 얼굴이고 9턴은 보상의 순간이라
    **거기서 안 구우면 아이가 그림을 못 받는다.**"""
    monkeypatch.setattr(gm, "_한번", _응답(_출력().model_copy(update={"is_key_scene": False})))

    결과 = await 서사(시스템지시(), "프롬프트", 턴=턴)

    assert 결과.출력 is not None
    assert 결과.출력.is_key_scene is True


async def test_삽화_힌트에_고정_문구가_섞이면_뗀다(monkeypatch: pytest.MonkeyPatch):
    """**실측에서 받은 값 그대로다** — 힌트 칸에 `문구.md` 1.18 직접쓰기유도가 왔다.

    **그 칸은 삽화 프롬프트다.** 그대로 넘기면 **그 문장으로 그림을 굽는다.**
    """
    from app.guide_lines import 직접쓰기유도

    섞임 = f"{직접쓰기유도()} 톱니방에 걸린 외투 끈"
    monkeypatch.setattr(gm, "_한번", _응답(_출력().model_copy(update={"scene_prompt_hint": 섞임})))

    결과 = await 서사(시스템지시(), "프롬프트", 턴=9)

    assert 결과.출력 is not None
    assert 직접쓰기유도() not in 결과.출력.scene_prompt_hint
    assert 결과.출력.scene_prompt_hint == "톱니방에 걸린 외투 끈"


async def test_핵심씬이_아니면_삽화_힌트를_비운다(monkeypatch: pytest.MonkeyPatch):
    """**굽지 않는 턴의 힌트는 쓸 데가 없다.** 남겨 두면 다음에 누가 그것을 굽는다."""
    monkeypatch.setattr(
        gm, "_한번", _응답(_출력().model_copy(update={"scene_prompt_hint": "톱니방"}))
    )

    결과 = await 서사(시스템지시(), "프롬프트", 턴=6)

    assert 결과.출력 is not None
    assert 결과.출력.scene_prompt_hint == ""


# ── 출력 검사 ───────────────────────────────────────────


async def test_검사가_통과하면_서사가_나온다(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(gm, "_한번", _응답(_출력()))

    결과 = await 서사(시스템지시(), "프롬프트", 턴=6)

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

    결과 = await 서사(시스템지시(), "프롬프트", 턴=6)

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

    결과 = await 서사(시스템지시(), "프롬프트", 턴=6)

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

    결과 = await 서사(시스템지시(), "프롬프트", 턴=6)

    assert len(호출) == 2
    assert 결과.사유 == "timeout"
    assert 결과.출력 is None


async def test_모델이_없으면_부르지_않는다(monkeypatch: pytest.MonkeyPatch):
    """dev 목은 모델명 없이 돈다. **pilot 은 기동 자체가 막힌다**(`config`)."""
    monkeypatch.setattr(gm, "_설정된모델", lambda: "")

    async def _불려선안됨(모델: str, 지시: str, 프롬프트: str) -> GM출력:
        raise AssertionError("모델이 없는데 호출했다")

    monkeypatch.setattr(gm, "_한번", _불려선안됨)

    결과 = await 서사(시스템지시(), "프롬프트", 턴=6)

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
        결과 = await 서사(시스템지시(), 프롬프트, 턴=6)

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

    결과 = await 서사(시스템지시(), "프롬프트", 턴=6)

    assert 결과.출력 is not None  # 막지 않았다
    assert "부족해" in 결과.금지어걸림  # 셌다
