"""본편 동료는 실제 진행에 맞춰 안내하며, 등급이나 아이 원문을 추정하지 않는다."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app import guide_lines
from app.api.v1 import stage1
from app.chapter_run import 진행
from app.guide_lines import 시련대사, 완결대사, 챕터진행대사, 카드첫말
from app.schemas.stage0 import ArtworkRef


@pytest.mark.anyio
@pytest.mark.parametrize("턴", [0, 4, 8])
async def test_시작과_이어하기가_같은_나침반_안내를_준다(턴: int):
    챕터 = SimpleNamespace(
        id="가상-챕터",
        chapter_key="ch01",
        turn=턴,
        beat="intro" if 턴 == 0 else "approach" if 턴 == 8 else "explore",
        narrative="가상의 장면이다.",
        choices=[],
        state={"hero": {"hp": 10, "items": []}, "location": "가상의 숲"},
    )

    session = AsyncMock()
    session.scalar.return_value = None
    # **`_보기` 가 2026-09-21 부터 「지금까지 쓴 것」을 같이 읽는다** (`Stage1.md` 1절).
    # 이 검사가 재는 것은 **나침반 안내**뿐이라 그 조회는 비워 둔다 — 실제 조회는
    # `test_chapter_state.py` 가 DB 로 잰다.
    결과 = MagicMock()
    결과.scalars.return_value = []
    session.execute.return_value = 결과
    보기 = await stage1._보기(session, 챕터)

    assert 보기.guide is not None
    assert 보기.guide.expression == "default"
    assert 보기.guide.line == 카드첫말()
    assert 보기.turn == 턴
    assert 보기.narrative == 챕터.narrative


@pytest.mark.parametrize(
    ("현재", "상황"),
    [
        (진행(턴=1, 비트="intro"), "normal"),
        (진행(턴=7, 비트="approach"), "normal"),
        (진행(턴=8, 비트="approach"), "enter"),
        (진행(턴=9, 비트="trial", 시련진행=0), "enter"),
        (진행(턴=9, 비트="trial", 시련진행=1), "progress"),
        (진행(턴=9, 비트="trial", 시련진행=2), "passed"),
        (진행(턴=10, 비트="trial", 시련진행=2), "passed"),
    ],
)
def test_진행과_시련의_실제_상태에_맞는_안내를_준다(현재: 진행, 상황: str):
    가이드 = stage1._진행가이드("가상-챕터", 현재)

    assert 가이드.expression == "default"
    assert 가이드.line == (챕터진행대사() if 상황 == "normal" else 시련대사(상황))


@pytest.mark.parametrize(
    "현재",
    [
        진행(턴=10, 비트="resolution", 시련진행=2),
        진행(턴=12, 비트="trial", 시련진행=0),
        진행(턴=12, 비트="trial", 시련진행=1),
        진행(턴=12, 비트="trial", 시련진행=2),
    ],
)
def test_완결에서는_시련_재시도_대신_같은_종료_인사를_준다(현재: 진행):
    첫인사 = stage1._진행가이드("가상-챕터", 현재)

    assert 첫인사.expression == "session_end"
    assert 첫인사.line in 완결대사()
    assert stage1._진행가이드("가상-챕터", 현재) == 첫인사


@pytest.mark.parametrize(
    ("삽화", "기대문구"),
    [
        (
            ArtworkRef(artwork_id="대표", status="ready", url=None),
            "이야기를 완성했어! 네가 쓴 글과 그림이 책에 담겼어.",
        ),
        (
            ArtworkRef(artwork_id="대표", status="pending", url=None),
            "이야기를 완성했어! 네 글은 책에 담겼고, 그림도 곧 완성돼.",
        ),
    ],
)
def test_완결_안내는_대표삽화의_실제_준비상태를_말한다(삽화: ArtworkRef, 기대문구: str):
    가이드 = stage1._진행가이드(
        "가상-챕터", 진행(턴=10, 비트="resolution", 시련진행=2), 대표삽화=삽화
    )

    assert 가이드.expression == "session_end"
    assert 가이드.line == 기대문구


def test_시련_통과_문구를_못_넘었을_때_문구와_혼동하지_않는다(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        guide_lines,
        "_절",
        lambda _: [
            "| 한 번에 못 넘었을 때 (G1) | **가상의 일부 진행 안내** |",
            "| 넘었을 때 | **가상의 통과 안내** |",
        ],
    )
    시련대사.cache_clear()
    try:
        assert 시련대사("passed") == "가상의 통과 안내"
        assert 시련대사("progress") == "가상의 일부 진행 안내"
    finally:
        시련대사.cache_clear()
