"""입력 검사 (E-1). **판정 품질이 아니라 구조와 원문 취급을 본다.**

시나리오 30개로 실제 모델을 때리는 것은 `scripts/bench_safety.py` 몫이다 — 네트워크를
타면 계약 테스트가 모델 테스트가 되고, 실행마다 결과가 흔들린다.

**여기서 지키는 것은 하나다: 아이 원문이 검사 경로에서 새지 않는다.**
차단 단계는 본질적으로 「무엇을 막았는지 남기고 싶어지는」 코드라, 규율이 아니라
테스트로 막는다 (`api/CLAUDE.md` 「절대 하지 않는 것」).
"""

import asyncio
import logging

import pytest

from app import moderation
from app.logging_config import SAFE_EXTRA_KEYS
from app.moderation import 검사, 검사결과, 검사지시, 검사하기, 슬러그, 카테고리들

아이문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


def _고정(monkeypatch: pytest.MonkeyPatch, 결과: 검사 | Exception) -> None:
    """모델 호출을 갈아끼운다. **네트워크를 타지 않는다.**"""

    async def _한번(모델: str, 문장: str) -> 검사:
        if isinstance(결과, Exception):
            raise 결과
        return 결과

    monkeypatch.setattr(moderation, "_한번", _한번)
    monkeypatch.setattr(moderation, "_설정된모델", lambda: "test-model")


# ── 기준은 문서에 있다 ───────────────────────────────────


def test_카테고리를_문서에서_읽는다():
    """`안전_어휘_기준.md` 3장이 원본이다. 코드에 목록을 복사하지 않는다."""
    카테고리 = 카테고리들()

    assert "자해·자살" in 카테고리
    assert "유혈·신체 훼손" in 카테고리
    # 표 머리글과 이어붙임 행(`↳`)은 카테고리가 아니다
    assert "카테고리" not in 카테고리
    assert "↳" not in 카테고리


def test_슬러그_표가_문서와_어긋나면_깨진다():
    """**이 테스트가 유일한 장치다.**

    로그에 나가는 슬러그(`self_harm` 등)는 ASCII 로 고정해야 해서 코드에 있다. 문서가
    카테고리 이름을 바꾸면 조용히 갈라지는데, **갈라진 쪽이 실제로 아이를 막는다.**
    여기서 깨뜨려 사람이 보게 만든다.
    """
    assert set(슬러그) == set(카테고리들())


def test_검사_지시에_문서_원문이_그대로_들어간다():
    """요약하면 **그 요약이 두 번째 기준**이 된다 (`bench_safety.py` 와 같은 이유)."""
    지시 = 검사지시()

    assert "휘두르다" in 지시  # 2장 화이트리스트
    assert "불로 지지다" in 지시  # 3장 차단 예
    assert "똥을 던진다" in 지시  # 4장 회색 지대
    # 오탐이 미탐보다 나쁘다는 것이 프롬프트에 들어 있어야 한다 (기준 1장)
    assert "오탐" in 지시


# ── 판정 ─────────────────────────────────────────────────


async def test_통과면_카테고리가_비어_있다(monkeypatch: pytest.MonkeyPatch):
    _고정(monkeypatch, 검사(block=False))

    결과 = await 검사하기(아이문장)

    assert 결과.blocked is False
    assert 결과.category == ""
    assert 결과.self_harm is False


async def test_차단이면_슬러그가_나온다(monkeypatch: pytest.MonkeyPatch):
    _고정(monkeypatch, 검사(block=True, category="고문·잔혹"))

    결과 = await 검사하기(아이문장)

    assert 결과.blocked is True
    assert 결과.category == "cruelty"


async def test_자해는_따로_갈린다(monkeypatch: pytest.MonkeyPatch):
    """**나머지 열넷과 다르다** — 이야기가 선을 넘은 것이 아니라 아이 자신의 신호일 수 있다.
    뒤 처리(문구·기록·보호자 리포트)가 갈리므로 여기서 구분되어야 한다.
    """
    _고정(monkeypatch, 검사(block=True, category="자해·자살"))

    결과 = await 검사하기(아이문장)

    assert 결과.category == "self_harm"
    assert 결과.self_harm is True


async def test_모르는_카테고리로_와도_차단은_유지된다(monkeypatch: pytest.MonkeyPatch):
    """모델이 목록에 없는 말을 지어내도 **통과로 뒤집히지 않는다.**"""
    _고정(monkeypatch, 검사(block=True, category="어디에도 없는 이름"))

    결과 = await 검사하기(아이문장)

    assert 결과.blocked is True
    assert 결과.category == "unknown"


# ── 판정을 못 받았을 때 ─────────────────────────────────


async def test_검사가_실패하면_막는_쪽으로_닫는다(monkeypatch: pytest.MonkeyPatch):
    """**Evaluator 와 반대 방향이다.** 평가는 실패하면 G1 으로 아이를 통과시키지만,
    검사는 실패하면 막는다 — 기준 1장이 「Stage 0 은 미탐 0건을 우선」이라고 못박았다.

    아이가 치르는 값은 카드 미소모·입력 유지·재시도라 회복 가능하고, 반대쪽 값은
    유해 문장이 아이 책에 인쇄되는 것이다.
    """
    _고정(monkeypatch, RuntimeError("upstream down"))

    결과 = await 검사하기(아이문장)

    assert 결과.blocked is True
    assert 결과.unavailable == "error"


async def test_못_받은_것과_차단한_것이_구분된다(monkeypatch: pytest.MonkeyPatch):
    """둘을 안 나누면 **프로바이더 장애가 「아이들이 나쁜 말을 썼다」로 보인다.**"""
    _고정(monkeypatch, 검사(block=True, category="선정"))

    결과 = await 검사하기(아이문장)

    assert 결과.blocked is True
    assert 결과.unavailable is None


# ── 원문이 새지 않는다 ───────────────────────────────────


@pytest.mark.parametrize(
    "응답",
    [
        검사(block=False),
        검사(block=True, category="자해·자살"),
        검사(block=True, category="유혈·신체 훼손"),
        RuntimeError("boom: 은빛 검을 들고"),  # 예외 메시지에 원문이 실려 온 경우
    ],
)
async def test_어느_분기에서도_원문이_로그에_안_남는다(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    응답: 검사 | Exception,
):
    """**이 파일에서 가장 중요한 테스트다.**

    원문이 가도 되는 곳은 `card_attempts.text` 하나뿐이다 (PRD 1.1b). 검사 경로는
    거기에 해당하지 않는다 — 예외 메시지·카테고리·해시 어디에도 실리면 안 된다.
    """
    _고정(monkeypatch, 응답)

    with caplog.at_level(logging.DEBUG, logger="app"):
        await 검사하기(아이문장)

    전문 = caplog.text
    assert 아이문장 not in 전문
    for 조각 in ("은빛", "살금살금", "그림자"):
        assert 조각 not in 전문


async def test_차단_로그는_해시로_남는다(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    """`안전_어휘_기준.md` 6장 — `moderation_blocked` (direction, category, hash)."""
    _고정(monkeypatch, 검사(block=True, category="고문·잔혹"))

    with caplog.at_level(logging.INFO, logger="app"):
        await 검사하기(아이문장)

    기록 = [r for r in caplog.records if r.message == "moderation_blocked"]
    assert len(기록) == 1
    assert 기록[0].category == "cruelty"
    assert 기록[0].direction == "in"
    # 해시는 되돌릴 수 없고, 같은 문장이면 같아야 센다
    assert 기록[0].text_hash and 아이문장 not in 기록[0].text_hash


async def test_통과는_차단_로그를_남기지_않는다(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _고정(monkeypatch, 검사(block=False))

    with caplog.at_level(logging.INFO, logger="app"):
        await 검사하기(아이문장)

    assert not [r for r in caplog.records if r.message == "moderation_blocked"]


def test_검사가_쓰는_로그_키가_전부_등록돼_있다():
    """`SAFE_EXTRA_KEYS` 에 없는 키는 **출력에서 조용히 사라진다.**

    목록에 없는 것이 곧 차단이라, 등록을 잊으면 차단 로그가 카테고리 없이 남는다.
    """
    for 키 in ("direction", "category", "text_hash", "moderation_unavailable"):
        assert 키 in SAFE_EXTRA_KEYS


def test_해시는_같은_문장에_같고_다른_문장에_다르다():
    assert moderation._해시(아이문장) == moderation._해시(아이문장)
    assert moderation._해시(아이문장) != moderation._해시(아이문장 + "!")


def test_결과는_얼려_둔다():
    """판정 결과가 뒤에서 조용히 바뀌면 「막았는데 통과」가 된다."""
    with pytest.raises(AttributeError):
        검사결과(blocked=True).blocked = False  # type: ignore[misc]


def test_모델이_없으면_통과시킨다(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    """**dev 전용 경로다.** `pilot` 은 `evaluator_model` 없이 기동 자체가 막힌다
    (`config.PILOT_REQUIRED`) — 즉 여기 닿는 것은 목 서버뿐이다.

    여기서 막으면 아이를 지키는 게 아니라 **프론트의 개발 서버가 통째로 멈춘다.**
    안전은 하나도 안 늘고 값만 치른다. 대신 **조용히 통과시키지는 않는다** —
    「검사가 도는 줄 알았는데 안 돌던」 환경은 실측 숫자를 통째로 거짓말로 만든다.
    """
    monkeypatch.setattr(moderation, "_설정된모델", lambda: "")

    with caplog.at_level(logging.WARNING, logger="app"):
        결과 = asyncio.run(검사하기(아이문장))

    assert 결과.blocked is False
    assert 결과.unavailable == "unconfigured"
    assert [r for r in caplog.records if r.message == "moderation_disabled"]


def test_검사가_없는_것과_판정을_못_받은_것은_다르다(monkeypatch: pytest.MonkeyPatch):
    """둘 다 `unavailable` 이 차지만 **한쪽만 막는다.** 합치면 dev 가 멈추거나
    운영이 뚫린다 — 어느 쪽으로 합쳐도 틀린다.
    """
    monkeypatch.setattr(moderation, "_설정된모델", lambda: "")
    없음 = asyncio.run(검사하기(아이문장))

    _고정(monkeypatch, TimeoutError())
    못받음 = asyncio.run(검사하기(아이문장))

    assert 없음.blocked is False
    assert 못받음.blocked is True


# ── 내장 필터가 막은 것도 차단이다 ──────────────────────


class _되먹임:
    def __init__(self, block_reason: str | None) -> None:
        self.block_reason = block_reason


class _후보:
    def __init__(self, finish_reason: str) -> None:
        self.finish_reason = finish_reason


class _응답:
    def __init__(self, block_reason: str | None = None, finish: str = "STOP") -> None:
        self.prompt_feedback = _되먹임(block_reason)
        self.candidates = [_후보(finish)]


def test_정상_응답은_내장차단이_아니다():
    assert moderation.내장차단(_응답()) is None


def test_prompt_feedback_이_막으면_잡는다():
    assert moderation.내장차단(_응답(block_reason="SAFETY")) == "prompt:SAFETY"


def test_finish_reason_이_STOP_이_아니면_잡는다():
    assert moderation.내장차단(_응답(finish="SAFETY")) == "finish:SAFETY"


def test_후보가_없으면_잡는다():
    응답 = _응답()
    응답.candidates = []

    assert moderation.내장차단(응답) == "no_candidate"


def test_내장_사유에_원문이_실리지_않는다():
    """반환하는 것은 프로바이더 열거값뿐이다. 이 값이 로그로 갈 수 있어 확인한다."""
    사유 = moderation.내장차단(_응답(block_reason="SAFETY"))

    assert 사유 is not None
    assert 아이문장 not in 사유


def test_검사_호출이_내장_필터에_막히면_차단이다(monkeypatch: pytest.MonkeyPatch):
    """판정을 못 받았으니 통과시킬 수 없고, 내장 필터가 막을 정도면 통과시킬 문장도 아니다."""
    _고정(monkeypatch, 검사(block=True, category=moderation.BUILTIN))

    결과 = asyncio.run(검사하기(아이문장))

    assert 결과.blocked is True
    assert 결과.category == moderation.BUILTIN


def test_내장_차단은_우리_카테고리와_섞이지_않는다():
    """출처가 다르다. 섞어 세면 **우리 기준의 차단율이 프로바이더 사정에 따라 흔들린다.**"""
    assert moderation.BUILTIN not in 슬러그.values()


def test_pilot_에서_검사가_꺼져_있으면_막는다(monkeypatch: pytest.MonkeyPatch):
    """**여기 오면 사고다.** `PILOT_REQUIRED` 가 기동을 막아야 하는데 뚫린 것이다.

    설정 목록이 바뀌어도 아이가 안 뚫리게, 그 결합에 기대지 않고 런타임에서 한 번 더 닫는다.
    """
    from app.config import Settings

    monkeypatch.setattr(moderation, "_설정된모델", lambda: "")
    monkeypatch.setattr(moderation, "get_settings", lambda: Settings(app_env="pilot"))

    결과 = asyncio.run(검사하기(아이문장))

    assert 결과.blocked is True


def test_pilot_필수_키에_평가_모델이_들어_있다():
    """런타임 방어의 **앞단**이다. 이게 빠지면 pilot 이 검사 없이 뜬다."""
    from app.config import PILOT_REQUIRED

    assert "evaluator_model" in PILOT_REQUIRED


# ── 카테고리 이름이 정확히 안 와도 센다 ─────────────────


def test_합쳐진_이름도_카테고리로_읽는다(monkeypatch: pytest.MonkeyPatch):
    """실측에서 같은 문장(B14)에 「죽음 직접 묘사」와 「유혈·신체 훼손 및 죽음 직접 묘사」가
    번갈아 나왔다. 그대로 두면 **같은 차단이 실행마다 `unknown` 이 됐다 말았다 한다.**

    앞에 오는 것을 쓴다 — 합쳐진 답에서는 앞이 주된 사유다.
    """
    _고정(monkeypatch, 검사(block=True, category="유혈·신체 훼손 및 죽음 직접 묘사"))

    assert asyncio.run(검사하기(아이문장)).category == "gore"


def test_뒤에_붙은_이름도_읽는다(monkeypatch: pytest.MonkeyPatch):
    _고정(monkeypatch, 검사(block=True, category="카테고리: 고문·잔혹"))

    assert asyncio.run(검사하기(아이문장)).category == "cruelty"


def test_아는_이름이_하나도_없으면_unknown_이다(monkeypatch: pytest.MonkeyPatch):
    """넓히되 아무거나 갖다 붙이지는 않는다. **차단은 그대로 유지된다.**"""
    _고정(monkeypatch, 검사(block=True, category="어디에도 없는 이름"))

    결과 = asyncio.run(검사하기(아이문장))

    assert 결과.category == "unknown"
    assert 결과.blocked is True


def test_자해가_다른_이름에_묻히지_않는다(monkeypatch: pytest.MonkeyPatch):
    """**뒤 처리가 갈리는 유일한 카테고리다.** 합쳐진 답에서 앞을 고르는 규칙이
    자해를 지워버리면 아이가 받는 문구가 달라진다 — 여기서 잡는다.
    """
    _고정(monkeypatch, 검사(block=True, category="자해·자살 및 죽음 직접 묘사"))

    assert asyncio.run(검사하기(아이문장)).self_harm is True


def test_자해가_뒤에_와도_자해로_읽는다(monkeypatch: pytest.MonkeyPatch):
    """**순서 규칙보다 자해가 먼저다.** 이것만 뒤 처리가 갈린다.

    값이 비대칭이다 — 아닌 아이에게 「어른한테 말해줘」가 가는 것은 가볍고,
    **맞는 아이에게 안 가는 것은 무겁다.**
    """
    _고정(monkeypatch, 검사(block=True, category="죽음 직접 묘사 및 자해·자살"))

    assert asyncio.run(검사하기(아이문장)).self_harm is True
