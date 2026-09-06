"""되묻기 (W2 3번 · 백로그 A-5 · PRD 4.4).

지키는 것 넷.

1. 질문 문안·금지어를 **문서에서 읽는다** (PRD 4.4). 코드에 복사하지 않는다
2. 카드 **명사 태그**를 넣는다. 대표 검수로 6장이 바뀌었다 (`cacda91`)
3. **부정어를 쓰지 않는다.** 되묻기는 호기심·요청 형식이다
4. 2회까지만 되묻고, **셀 수 없으면 되묻지 않는다** — 아이를 한 장면에 가두지 않는다
"""

import asyncio
from typing import Any

import pytest

from app import scaffold
from app.scaffold import MAX_SCAFFOLD, 금지어, 되묻기횟수, 질문, 질문틀
from app.scene_cards import 카드, 카드들


class 가짜Redis:
    def __init__(self) -> None:
        self.값: dict[str, int] = {}
        self.만료: dict[str, int] = {}

    async def incr(self, 키: str) -> int:
        self.값[키] = self.값.get(키, 0) + 1
        return self.값[키]

    async def expire(self, 키: str, 초: int) -> None:
        self.만료[키] = 초


class 죽은Redis:
    async def incr(self, 키: str) -> int:
        raise ConnectionError("redis 없음")

    async def expire(self, 키: str, 초: int) -> None:  # pragma: no cover
        raise ConnectionError("redis 없음")


# ── 문서에서 읽는다 ──────────────────────────────────────


def test_PRD_4_4_템플릿을_읽는다():
    틀 = 질문틀()

    assert set(틀) >= {"도구/방법", "감각", "감정/의도", "대행 요청 시"}
    assert "{대상}" in 틀["도구/방법"]


def test_금지어도_문서에서_읽는다():
    assert set(금지어()) >= {"부족해", "다시 써", "틀렸어", "더 길게"}


# ── 명사 태그 치환 ───────────────────────────────────────


def test_카드_명사_태그를_넣는다():
    """대표 검수 반영본이다 — 07번은 「사람들」이 아니라 「시계탑」이다 (`cacda91`)."""
    assert "시계탑" in 질문("c07", 1)
    assert "마을 사람들" in 질문("c13", 1)
    assert "사람들" not in 질문("c07", 1)


def test_조사를_명사에_맞춘다():
    """PRD 4.4 틀은 `{대상}을` 로 조사가 박혀 있다. 그대로 끼우면 「그림자을」이 된다."""
    assert "그림자를" in 질문("c01", 1)  # 받침 없음
    assert "시계탑을" in 질문("c07", 1)  # 받침 있음


def test_어떤_카드에서도_중괄호가_남지_않는다():
    """채우지 못한 자리가 남으면 아이 화면에 중괄호가 보인다."""
    for card_id in [*카드들(), "없는카드"]:
        for 횟수 in (1, 2):
            assert "{" not in 질문(card_id, 횟수)


def test_모르는_카드에도_질문이_나온다():
    """질문이 없어 아이가 빈 화면을 보는 쪽이 더 나쁘다."""
    말 = 질문("없는카드", 1)

    assert 말 and "{" not in 말


def test_되묻기_질문에_부정어가_없다():
    """「부족해」·「다시 써」를 쓰지 않는다 (PRD 4.4 금지)."""
    for card_id in [*카드들(), "없는카드"]:
        for 횟수 in (1, 2, 3):
            말 = 질문(card_id, 횟수)
            assert not any(금지 in 말 for 금지 in 금지어()), 말


def test_두_번째_되묻기는_다른_질문이다():
    """같은 말을 두 번 하면 아이가 같은 벽을 다시 만난다."""
    assert 질문("c01", 1) != 질문("c01", 2)


# ── 횟수 세기 ────────────────────────────────────────────


def test_같은_카드에서_횟수가_는다():
    가짜 = 가짜Redis()

    횟수들 = [asyncio.run(되묻기횟수("토큰", "c01", client=가짜)) for _ in range(MAX_SCAFFOLD + 1)]

    assert 횟수들 == [1, 2, 3]


def test_카드마다_따로_센다():
    가짜 = 가짜Redis()

    asyncio.run(되묻기횟수("토큰", "c01", client=가짜))

    assert asyncio.run(되묻기횟수("토큰", "c02", client=가짜)) == 1


def test_아이마다_따로_센다():
    가짜 = 가짜Redis()

    asyncio.run(되묻기횟수("토큰가", "c01", client=가짜))

    assert asyncio.run(되묻기횟수("토큰나", "c01", client=가짜)) == 1


def test_토큰을_키에_그대로_쓰지_않는다():
    """Redis 에 자격증명을 적는 셈이 된다."""
    가짜 = 가짜Redis()

    asyncio.run(되묻기횟수("비밀토큰", "c01", client=가짜))

    assert all("비밀토큰" not in 키 for 키 in 가짜.값)


def test_첫_회에만_만료를_건다():
    가짜 = 가짜Redis()

    asyncio.run(되묻기횟수("토큰", "c01", client=가짜))
    asyncio.run(되묻기횟수("토큰", "c01", client=가짜))

    assert list(가짜.만료.values()) == [scaffold.TTL_SECONDS]


def test_redis_가_죽어도_예외를_내지_않는다():
    """비용 기록과 같은 태도다 — 인프라가 죽어도 아이는 계속 쓸 수 있어야 한다."""
    assert asyncio.run(되묻기횟수("토큰", "c01", client=죽은Redis())) is None


# ── 장면 카드 문서 ───────────────────────────────────────


def test_카드_20장과_튜토리얼_3장을_읽는다():
    전부 = 카드들()

    assert len([c for c in 전부 if c.startswith("c")]) == 20
    assert {"t1", "t2", "t3"} <= set(전부)


def test_검수_결과_표를_카드로_잘못_읽지_않는다():
    """「검수 결과」 표도 `| 01 |` 로 시작한다. 3열이라 걸러져야 한다."""
    장면 = 카드("c01")

    assert 장면 is not None
    assert 장면.명사태그 == ("그림자", "숲", "넘어짐")  # 검수 반영본
    assert "넘어지고" in 장면.상황문


def test_모든_카드에_명사_태그가_3개다():
    """되묻기 치환용이다 (`장면카드_초안.md` 설계 원칙)."""
    for 장면 in 카드들().values():
        assert len(장면.명사태그) == 3, 장면.card_id


def _tags(장면: Any) -> tuple[str, ...]:
    return 장면.명사태그


@pytest.mark.parametrize("card_id", ["c07", "c13", "c01"])
def test_대표_검수로_바뀐_카드가_반영돼_있다(card_id: str):
    """옛 태그를 캐시하거나 복사해 두면 조용히 옛말을 한다 (`cacda91`)."""
    옛태그 = {"c07": "사람", "c13": "꿈", "c01": "나뭇가지"}

    assert 옛태그[card_id] not in _tags(카드(card_id))
