"""삽화 프롬프트 조립과 출력 검사 (B-3).

**여기서도 네트워크를 타지 않는다** — 생성 품질은 `scripts/bench_image.py` 몫이다.
지키는 것은 셋이다.

1. **아이 원문이 프롬프트에 안 들어간다** (PRD B-5 — 삽화는 아이의 1인칭 시점)
2. **가이드 캐릭터가 빠진 프롬프트가 안 나간다** — 안전 사유다
3. **프롬프트가 출력 검사를 지나고, 판정을 못 받으면 막는다** (E-1 양방향)
"""

import asyncio
import logging

import pytest

from app import artwork, moderation
from app.artwork import GUIDE, STYLE, 내보내도되나, 레퍼런스바이트, 접미어, 프롬프트
from app.evaluator import TIER_BY_GRADE
from app.logging_config import SAFE_EXTRA_KEYS
from app.moderation import 검사
from app.scene_cards import 모험카드들

아이문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


def _고정(monkeypatch: pytest.MonkeyPatch, 결과: 검사 | Exception) -> None:
    """모델 호출을 갈아끼운다 (`test_moderation.py` 와 같은 꼴)."""

    async def _한번(모델: str, 문장: str) -> 검사:
        if isinstance(결과, Exception):
            raise 결과
        return 결과

    monkeypatch.setattr(moderation, "_한번", _한번)
    monkeypatch.setattr(moderation, "_설정된모델", lambda: "test-model")


# ── 티어 ────────────────────────────────────────────────


def test_티어_접미어가_셋이다():
    """PRD B-3 「G3→전설 / G2→희귀 / G1 이하→기본」. **매핑은 evaluator 가 원본이다.**"""
    assert set(접미어) == set(TIER_BY_GRADE.values()) == {"basic", "rare", "legendary"}


@pytest.mark.parametrize("tier", ["basic", "rare", "legendary"])
def test_티어가_장면을_안_바꾼다(tier):
    """**밀도만 오른다.** 티어가 장면을 바꾸면 같은 카드가 등급마다 다른 이야기가 된다."""
    카드 = 모험카드들()[0]
    문장 = 프롬프트(카드.card_id, tier)

    assert 카드.스케치프롬프트 in 문장
    assert 접미어[tier] in 문장


# ── 프롬프트 재료 ────────────────────────────────────────


@pytest.mark.parametrize("카드", 모험카드들(), ids=lambda c: c.card_id)
def test_스무_장이_전부_프롬프트를_만든다(카드):
    """다섯째 열이 비면 그 카드만 조용히 기본 에셋으로 간다 — **20장에는 없어야 한다.**"""
    assert 프롬프트(카드.card_id, "rare")


@pytest.mark.parametrize("카드", 모험카드들(), ids=lambda c: c.card_id)
def test_가이드가_빠진_프롬프트는_안_나온다(카드):
    """**안전 사유다** (PRD B-5 · W1 벤치). 가이드 없이 생성한 위기 카드는
    만 10~12세에게 경계에 가까웠다. 화풍 일관성(B-5)이 W5 로 밀린 것과 무관하다."""
    assert GUIDE in 프롬프트(카드.card_id, "legendary")


def test_화풍이_모든_프롬프트에_들어간다():
    assert STYLE in 프롬프트("c01", "basic")


def test_아이_원문은_프롬프트에_안_들어간다():
    """프롬프트 재료에 아이 문장이 낄 자리 자체를 두지 않았다 — `프롬프트()` 는
    `card_id` 와 `tier` 만 받는다. **인자가 늘면 이 테스트부터 다시 본다.**"""
    for tier in ("basic", "rare", "legendary"):
        assert 아이문장 not in 프롬프트("c01", tier)


def test_모르는_카드는_None(caplog):
    """실패가 아니라 **기본 에셋으로 간다**는 신호다 (PRD B-3 「플레이 중단 없음」)."""
    assert 프롬프트("c99", "rare") is None


def test_레퍼런스_이미지가_실제로_있다():
    """없으면 부르는 쪽이 생성을 접는다. **정본이 옮겨졌는지를 여기서 잡는다.**"""
    assert 레퍼런스바이트()


# ── 출력 검사 (E-1 양방향) ────────────────────────────────


def test_통과하면_안_막는다(monkeypatch):
    _고정(monkeypatch, 검사(block=False))

    assert not asyncio.run(내보내도되나(프롬프트("c01", "rare"))).blocked


def test_막히면_막힌다(monkeypatch):
    _고정(monkeypatch, 검사(block=True, category="유혈·신체 훼손"))

    결과 = asyncio.run(내보내도되나(프롬프트("c01", "legendary")))

    assert 결과.blocked
    assert 결과.category


def test_판정을_못_받으면_막는다(monkeypatch):
    """**입력 검사와 같은 방향이다.** 여기서 막히는 값은 기본 에셋 한 장이고,
    반대쪽 값은 유해한 그림이 아이 책에 인쇄되는 것이다 (`검사하기()` 주석)."""
    _고정(monkeypatch, RuntimeError("프로바이더 장애"))

    결과 = asyncio.run(내보내도되나(프롬프트("c01", "rare")))

    assert 결과.blocked
    assert 결과.unavailable == "error"


def test_막혀도_프롬프트_문장을_로그에_안_남긴다(monkeypatch, caplog):
    """Stage 0 프롬프트에는 아이 원문이 없지만 **Stage 1 에서 GM 서사가 이 자리에
    들어온다.** 그때 이 줄이 유출 경로가 되지 않게 지금 막아 둔다."""
    _고정(monkeypatch, 검사(block=True, category="유혈·신체 훼손"))
    문장 = 프롬프트("c01", "legendary")

    with caplog.at_level(logging.WARNING, logger="app.artwork"):
        asyncio.run(내보내도되나(문장))

    기록 = [r for r in caplog.records if r.name == "app.artwork"]
    assert 기록
    for r in 기록:
        assert 문장 not in r.getMessage()
        # **실린 extra 가 전부 허용 목록 안이다.** 목록 밖 필드는 포매터가 안 찍지만,
        # 오류 리포터·APM 은 레코드를 통째로 집어간다 (`api/CLAUDE.md`)
        실은것 = set(r.__dict__) - set(logging.makeLogRecord({}).__dict__) - {"taskName", "message"}
        assert 실은것 <= set(SAFE_EXTRA_KEYS), 실은것 - set(SAFE_EXTRA_KEYS)
        assert artwork.STYLE not in str(r.__dict__)
