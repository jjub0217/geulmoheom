"""Evaluator — 아이가 쓴 문장의 등급 판정 (백로그 B-1 · PRD 4.3 · `Stage0.md` 9절 5번).

**루브릭은 `app/rubric.py` 가 문서에서 읽는다.** 여기는 호출·폴백·변환만 한다.

세 가지를 지킨다.

1. **아이를 막지 않는다.** 타임아웃 3초 → 재시도 1회 → 그래도 실패하면 `G1` 폴백이다.
   판정이 없다고 아이가 쓴 문장을 되돌려보내지 않는다.
   **입력 검사(`app/moderation.py`)는 실패하면 반대로 막는다. 어긋난 것이 아니다** —
   평가가 폴백으로 통과시키는 것은 **못 도와주는 것**이고 검사가 통과시키는 것은
   **막아야 할 것을 내보내는 것**이라, 값이 다르니 방향이 다르다. 맞추려 들지 마라.
2. **폴백이었다는 사실을 로그로 남긴다.** 표시가 없으면 판정 품질이 조용히 나빠져도 모른다.
   **폴백 비율이 곧 경보다.**
3. **원문·묘사어를 로그에 남기지 않는다** (PRD 1.1b). `signals`·`descriptors` 는 아이 문장에서
   그대로 뽑은 조각이라 원문과 같다. 로그로 나가는 것은 **개수**뿐이다
   (PRD 5장 `eval_result` = `grade, signal_count, latency_ms`).
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import cast

from google.genai import types
from pydantic import BaseModel, Field

from app.config import get_settings
from app.llm import get_client
from app.middleware import current_request_id
from app.rubric import 등급, 시스템지시
from app.schemas.stage0 import Highlight, HighlightKind, Tier

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 3.0
RETRIES = 1  # 첫 호출 실패 후 한 번만 더. 최악 3+3초는 `Stage0.md` 9절 5번 그대로다
FALLBACK_GRADE: 등급 = "G1"

# `Stage0.md` 9절 7번. 응답에는 티어만 나간다 — **등급 문자는 로그 전용이다** (용어사전 3장).
TIER_BY_GRADE: dict[str, Tier] = {
    "G0": "basic",
    "G1": "basic",
    "G2": "rare",
    "G3": "legendary",
}

_HIGHLIGHT_KINDS: frozenset[str] = frozenset({"adj", "adv", "clause"})
MAX_HIGHLIGHTS = 5


class 판정(BaseModel):
    """Evaluator 의 구조화 출력 (PRD 4.3 「출력」)."""

    grade: 등급
    signals: list[str] = Field(default_factory=list)
    descriptors: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class 평가결과:
    grade: str
    signals: list[str] = field(default_factory=list)
    descriptors: list[str] = field(default_factory=list)
    fallback: str | None = None  # 폴백 사유. None 이면 모델이 실제로 판정했다
    latency_ms: float = 0.0
    # 프롬프트 길이. **기록을 미룰 수 있어야 해서 결과에 담는다** — 차단된 문장은
    # `eval_result` 를 남기지 않으므로(`adr/0009` 결정 3) 로그 시점이 호출 시점과 갈린다.
    prompt_chars: int | None = None

    @property
    def tier(self) -> Tier:
        return TIER_BY_GRADE[self.grade]


def _설정된모델() -> str:
    return get_settings().evaluator_model.strip()


async def _한번(모델: str, 문장: str) -> 판정:
    """단발 호출. 타임아웃은 부르는 쪽이 건다."""
    응답 = await get_client().aio.models.generate_content(
        model=모델,
        contents=문장,
        config=types.GenerateContentConfig(
            system_instruction=시스템지시(),
            response_mime_type="application/json",
            response_schema=판정,
            # 확정 모델은 thinking 을 끈다 (`benchmarks/W2-evaluator-bench.md`).
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return 판정.model_validate_json(응답.text or "")


async def evaluate(text: str, *, 기록: bool = True) -> 평가결과:
    """문장 하나를 판정한다. **예외를 밖으로 내지 않는다.**

    실패 사유는 `fallback` 에 담아 돌려준다 — `timeout`·`error`·`unconfigured`·`rubric`.

    **`기록=False` 는 입력 검사와 병렬로 던질 때 쓴다** (`adr/0009` 결정 2·3). 검사가
    차단하면 이 판정은 버려지는데, 버린 판정이 `eval_result` 로 남으면 **등급 분포와
    폴백 비율이 오염된다** — 화면에 보여주지도 않은 평가가 H2 판정 자료에 섞인다.
    통과했을 때 부르는 쪽이 `평가기록()` 을 부른다.
    """
    시작 = time.perf_counter()

    try:
        모델 = _설정된모델()
        지시길이 = len(시스템지시())  # 루브릭 문서를 못 읽으면 여기서 터진다
    except Exception:
        logger.error("루브릭을 읽지 못해 폴백한다", extra={"request_id": current_request_id()})
        return _폴백("rubric", 시작, 기록=기록)

    if not 모델:
        # dev 목 서버는 모델명 없이 돈다. pilot 은 기동 자체가 막힌다 (`config.PILOT_REQUIRED`).
        return _폴백("unconfigured", 시작, 기록=기록)

    사유 = "error"
    for _ in range(RETRIES + 1):
        try:
            결과 = await asyncio.wait_for(_한번(모델, text), timeout=TIMEOUT_SECONDS)
        except TimeoutError:
            사유 = "timeout"
        except Exception as exc:
            # 예외 메시지에 아이 입력이 실려 있을 수 있다. 타입만 남긴다.
            사유 = "error"
            logger.warning(
                "Evaluator 호출 실패",
                extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
            )
        else:
            지연 = (time.perf_counter() - 시작) * 1000
            평가 = 평가결과(
                grade=결과.grade,
                signals=결과.signals,
                descriptors=결과.descriptors,
                latency_ms=지연,
                prompt_chars=지시길이,
            )
            if 기록:
                평가기록(평가)
            return 평가

    return _폴백(사유, 시작, 지시길이=지시길이, 기록=기록)


def _폴백(사유: str, 시작: float, *, 지시길이: int | None = None, 기록: bool = True) -> 평가결과:
    평가 = 평가결과(
        grade=FALLBACK_GRADE,
        fallback=사유,
        latency_ms=(time.perf_counter() - 시작) * 1000,
        prompt_chars=지시길이,
    )
    if 기록:
        평가기록(평가)
    return 평가


def 평가기록(평가: 평가결과) -> None:
    """`eval_result` (PRD 5장). 등급은 남기고 **문장 조각은 남기지 않는다.**

    **차단된 문장에는 부르지 않는다** (`adr/0009` 결정 3).
    """
    logger.info(
        "eval_result",
        extra={
            "request_id": current_request_id(),
            "grade": 평가.grade,
            "tier": 평가.tier,
            "signal_count": len(평가.signals),
            "latency_ms": round(평가.latency_ms),
            # 폴백 비율이 경보다. 정상 판정에도 `none` 을 남겨 비율을 셀 수 있게 한다.
            "eval_fallback": 평가.fallback or "none",
            **({"prompt_chars": 평가.prompt_chars} if 평가.prompt_chars is not None else {}),
        },
    )


def highlights(평가: 평가결과, text: str) -> list[Highlight]:
    """감지된 묘사어를 프론트가 입력문 위에 덧칠할 수 있는 형태로 바꾼다.

    **`descriptors` 가 주 재료다.** 「문장에서 그대로 뽑은 묘사어」라 표면형이 맞는다
    (`Stage0.md` 4절 「Evaluator 가 감지한 묘사어」). `signals` 는 종류를 알려주지만
    말은 원형으로 온다 — 「캄캄한」을 주는데 문장에는 「캄캄했지만」이 있다.

    **문장에 실제로 있는 조각만 남긴다.** 없는 말을 담으면 프론트가 덧칠할 자리를 못 찾는다.
    `clause:방법` 처럼 범주 이름만 온 신호도 여기서 걸러진다.
    """
    골라낸: list[Highlight] = []
    본: set[str] = set()

    def 넣기(조각: str, 종류: HighlightKind) -> None:
        if 조각 and 조각 not in 본 and 조각 in text and len(골라낸) < MAX_HIGHLIGHTS:
            본.add(조각)
            골라낸.append(Highlight(text=조각, kind=종류))

    for 묘사어 in 평가.descriptors:
        넣기(묘사어.strip(), _종류(묘사어.strip(), 평가.signals))

    # 신호 쪽에만 있고 문장에 그대로 실린 말 (descriptors 가 빈 경우의 보루).
    # **`clause` 는 여기서 쓰지 않는다** — 뒤에 오는 것이 「방법」·「이유」 같은 범주 이름이라
    # 아이가 쓴 말이 아니다. 우연히 문장에 같은 낱말이 있으면 엉뚱한 데를 덧칠하게 된다.
    for 종류, 조각 in _신호쪼개기(평가.signals):
        if 종류 != "clause":
            넣기(조각, 종류)

    return 골라낸


def _신호쪼개기(signals: list[str]) -> list[tuple[HighlightKind, str]]:
    쌍: list[tuple[HighlightKind, str]] = []
    for 신호 in signals:
        종류, _, 조각 = 신호.partition(":")
        if 종류 in _HIGHLIGHT_KINDS and 조각.strip():
            쌍.append((cast(HighlightKind, 종류), 조각.strip()))
    return 쌍


def _종류(묘사어: str, signals: list[str]) -> HighlightKind:
    """묘사어의 종류를 신호에서 찾는다. 활용형이 달라 앞 두 글자로도 맞춰 본다.

    못 찾으면 짐작한다 — **`kind` 는 프론트 표시용이고, 틀려도 덧칠 위치는 맞는다.**
    묘사어를 통째로 버리는 쪽이 아이에게 더 손해다 (결과 연출에서 되읽어 주는 말이다).
    """
    for 종류, 조각 in _신호쪼개기(signals):
        if 조각 == 묘사어 or (len(조각) >= 2 and 조각[:2] == 묘사어[:2]):
            return 종류
    return "clause" if " " in 묘사어 else "adj"


__all__ = ["TIER_BY_GRADE", "evaluate", "highlights", "판정", "평가결과", "평가기록"]
