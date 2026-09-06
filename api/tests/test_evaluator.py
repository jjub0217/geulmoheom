"""Evaluator 판정 경로 (W2 2번 · `docs/api/Stage0.md` 9절 5번).

**여기서 네트워크를 타지 않는다.** 실제 모델 정확도는 `scripts/bench_evaluator.py` 가
재고 `benchmarks/W2-evaluator-bench.md` 에 남는다. 이 파일이 지키는 것은 셋이다.

1. 실패해도 **아이를 막지 않는다** (G1 폴백)
2. 폴백이었다는 사실이 **로그에 남는다**
3. 등급·묘사어가 **아이에게도 로그에도 새지 않는다**
"""

import asyncio
import logging

import pytest

from app import evaluator
from app.evaluator import TIER_BY_GRADE, evaluate, highlights, 판정, 평가결과
from app.logging_config import SAFE_EXTRA_KEYS

문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


@pytest.fixture(autouse=True)
def _모델설정(monkeypatch: pytest.MonkeyPatch) -> None:
    """`.env` 값에 기대지 않는다. 미설정 폴백은 따로 본다."""
    monkeypatch.setattr(evaluator, "_설정된모델", lambda: "gemini-테스트")


def _응답(**kwargs):
    async def _한번(모델: str, text: str) -> 판정:
        return 판정(**kwargs)

    return _한번


# ── 등급 → 티어 ──────────────────────────────────────────


@pytest.mark.parametrize(
    ("grade", "tier"),
    [("G0", "basic"), ("G1", "basic"), ("G2", "rare"), ("G3", "legendary")],
)
def test_등급이_티어로_바뀐다(grade: str, tier: str):
    """`Stage0.md` 9절 7번. G0·G1 이 같은 티어인 것이 의도다."""
    assert TIER_BY_GRADE[grade] == tier
    assert 평가결과(grade=grade).tier == tier


# ── 폴백 — 아이를 막지 않는다 ────────────────────────────


def test_타임아웃이면_한_번_더_부르고_G1_로_간다(monkeypatch: pytest.MonkeyPatch):
    호출 = []

    async def _느림(모델: str, text: str) -> 판정:
        호출.append(text)
        await asyncio.sleep(1)
        raise AssertionError("여기까지 오면 안 된다")

    monkeypatch.setattr(evaluator, "TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(evaluator, "_한번", _느림)

    결과 = asyncio.run(evaluate(문장))

    assert len(호출) == 2  # 첫 호출 + 재시도 1회
    assert 결과.grade == "G1"
    assert 결과.fallback == "timeout"


def test_예외가_나도_예외를_밖으로_내지_않는다(monkeypatch: pytest.MonkeyPatch):
    async def _터짐(모델: str, text: str) -> 판정:
        raise RuntimeError(f"프로바이더가 거절했다: {문장}")  # 메시지에 원문이 섞인 상황

    monkeypatch.setattr(evaluator, "_한번", _터짐)

    결과 = asyncio.run(evaluate(문장))

    assert 결과.grade == "G1"
    assert 결과.fallback == "error"


def test_모델명이_비어_있으면_부르지_않고_폴백한다(monkeypatch: pytest.MonkeyPatch):
    """dev 목 서버는 모델명 없이 돈다. pilot 은 기동에서 막힌다 (`config.PILOT_REQUIRED`)."""

    def _부르면안됨(모델: str, text: str) -> 판정:
        raise AssertionError("모델명이 없는데 호출했다")

    monkeypatch.setattr(evaluator, "_설정된모델", lambda: "")
    monkeypatch.setattr(evaluator, "_한번", _부르면안됨)

    결과 = asyncio.run(evaluate(문장))

    assert 결과.fallback == "unconfigured"
    assert 결과.tier == "basic"


def test_한_번_실패하고_다음에_성공하면_폴백이_아니다(monkeypatch: pytest.MonkeyPatch):
    남은 = [1]

    async def _한번뿐(모델: str, text: str) -> 판정:
        if 남은:
            남은.pop()
            raise RuntimeError("일시 오류")
        return 판정(grade="G3", signals=["adj:은빛"])

    monkeypatch.setattr(evaluator, "_한번", _한번뿐)

    결과 = asyncio.run(evaluate(문장))

    assert 결과.grade == "G3"
    assert 결과.fallback is None


# ── 로그 — 폴백 비율이 경보다 ────────────────────────────


def test_폴백이었음이_로그에_남는다(monkeypatch: pytest.MonkeyPatch, caplog):
    monkeypatch.setattr(evaluator, "_설정된모델", lambda: "")

    with caplog.at_level(logging.INFO, logger="app.evaluator"):
        asyncio.run(evaluate(문장))

    기록 = next(r for r in caplog.records if r.message == "eval_result")
    assert 기록.eval_fallback == "unconfigured"
    assert 기록.grade == "G1"


def test_정상_판정도_같은_줄을_남긴다(monkeypatch: pytest.MonkeyPatch, caplog):
    """폴백 비율을 세려면 분모가 있어야 한다."""
    monkeypatch.setattr(evaluator, "_한번", _응답(grade="G2", signals=["adj:은빛"]))

    with caplog.at_level(logging.INFO, logger="app.evaluator"):
        asyncio.run(evaluate(문장))

    기록 = next(r for r in caplog.records if r.message == "eval_result")
    assert 기록.eval_fallback == "none"
    assert 기록.grade == "G2"
    assert 기록.signal_count == 1


def test_묘사어는_로그로_나가지_못한다():
    """`signals`·`descriptors` 는 아이 문장 조각이라 원문과 같다 (PRD 1.1b).

    포매터가 목록에 있는 키만 찍으므로, **목록에 없다는 것이 곧 차단**이다.
    """
    assert "signals" not in SAFE_EXTRA_KEYS
    assert "descriptors" not in SAFE_EXTRA_KEYS
    assert "text" not in SAFE_EXTRA_KEYS
    assert "grade" in SAFE_EXTRA_KEYS  # 등급은 남긴다 — 판정 품질을 되짚는 유일한 수단


# ── 하이라이트 ───────────────────────────────────────────


def test_묘사어를_문장_그대로_돌려준다():
    """`descriptors` 가 주 재료다 — 표면형이 문장과 맞는다."""
    평가 = 평가결과(grade="G2", signals=["adv:살금살금"], descriptors=["은빛", "살금살금"])

    assert [(h.text, h.kind) for h in highlights(평가, 문장)] == [
        ("은빛", "adj"),  # 신호에 없어 짐작한 종류
        ("살금살금", "adv"),  # 신호가 종류를 알려준 것
    ]


def test_활용형이_달라도_신호에서_종류를_찾는다():
    """모델은 「캄캄한」을 주는데 문장에는 「캄캄했지만」이 있다. 앞 두 글자로 맞춘다."""
    글 = "눈앞이 캄캄했지만 나는 문지기의 눈을 똑바로 본다"
    평가 = 평가결과(grade="G3", signals=["adj:캄캄한"], descriptors=["캄캄했지만"])

    골라낸 = highlights(평가, 글)

    assert [(h.text, h.kind) for h in 골라낸] == [("캄캄했지만", "adj")]


def test_문장에_없는_말은_버린다():
    """없는 말을 담으면 프론트가 덧칠할 자리를 못 찾는다."""
    평가 = 평가결과(grade="G2", signals=["adj:빨간", "clause:방법"], descriptors=["용감하게"])

    assert highlights(평가, 문장) == []


def test_범주_이름뿐인_신호는_묘사어가_아니다():
    """`clause:방법` 의 「방법」은 아이가 쓴 말이 아니다.

    **문장에 우연히 같은 낱말이 있어도** 덧칠하지 않는다.
    """
    평가 = 평가결과(grade="G2", signals=["clause:방법", "clause:장소"], descriptors=[])

    assert highlights(평가, "좋은 방법으로 그 장소를 지나간다") == []


def test_묘사어가_없으면_신호에서_주워온다():
    평가 = 평가결과(grade="G2", signals=["adj:은빛", "adv:살금살금"], descriptors=[])

    assert [h.text for h in highlights(평가, 문장)] == ["은빛", "살금살금"]


def test_같은_말이_두_번_들어오면_한_번만_남는다():
    평가 = 평가결과(grade="G2", signals=["adj:은빛"], descriptors=["은빛", "은빛"])

    assert len(highlights(평가, 문장)) == 1


def test_하이라이트에_상한이_있다():
    긴문장 = "가 나 다 라 마 바 사"
    평가 = 평가결과(grade="G3", descriptors=list("가나다라마바사"))

    assert len(highlights(평가, 긴문장)) == evaluator.MAX_HIGHLIGHTS
