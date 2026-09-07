"""입력 검사 — 유해 표현 차단 (E-1 · `adr/0009` · `docs/안전_어휘_기준.md`).

**별도 단계다. 내장 필터로 대체하지 않는다** (`adr/0009` 결정 1). 실측에서 내장 필터는
기본값이면 7/7 미탐이었고, 임계값을 최저로 조이면 **유혈·고문·자해는 여전히 새면서
「똥을 던진다」·「바보 도깨비」가 먼저 죽었다.** 임계값에는 「가상 존재 대상」이나
「초등 유머」라는 축이 없다 — 조이면 **초등학생다운 문장부터 죽는다.**

**기준을 코드에 복사하지 않는다** (`api/CLAUDE.md`). 화이트리스트·차단 카테고리·회색
지대는 전부 `docs/안전_어휘_기준.md` 2·3·4장에서 읽는다. 복사해 두면 문서와 갈라지고,
**갈라진 쪽이 실제로 아이를 막는다.**

**프롬프트는 `adr/0009` 실측에 쓰인 것 그대로다.** `scripts/bench_safety.py` 가 여기서
가져다 쓴다 — 둘이 갈라지면 그 ADR 의 「오탐 0」이 운영을 설명하지 못하게 된다.

**아이 원문은 이 파일 어디에서도 로그로 나가지 않는다** (PRD 1.1b). 차단 기록은
`안전_어휘_기준.md` 6장 그대로 `direction`·`category`·`hash` 셋뿐이다.
"""

import asyncio
import hashlib
import logging
import re
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Final

from google.genai import types
from pydantic import BaseModel, Field

from app.config import REPO_ROOT, get_settings
from app.docs_md import 민, 읽기, 표행
from app.llm import get_client
from app.middleware import current_request_id

logger = logging.getLogger(__name__)

기준문서 = REPO_ROOT / "docs" / "안전_어휘_기준.md"

# Evaluator 와 같은 예산이다 (`Stage0.md` 9절 5번). 검사와 평가는 **동시에 던지므로**
# (`adr/0009` 결정 2) 둘 중 느린 쪽이 곧 아이가 기다리는 시간이다.
TIMEOUT_SECONDS: Final = 3.0
RETRIES: Final = 1

# 로그에 나가는 이름. **ASCII 로 고정한다** — 집계·알람이 한글 키로 갈라지지 않게.
# 문서가 카테고리 이름을 바꾸면 이 표와 조용히 어긋나는데, 그걸 막는 것은
# `tests/test_moderation.py` 의 대조 하나뿐이다.
슬러그: Final[dict[str, str]] = {
    "유혈·신체 훼손": "gore",
    "고문·잔혹": "cruelty",
    "죽음 직접 묘사": "death",
    "자해·자살": "self_harm",
    "선정": "sexual",
    "비속어·혐오": "slur",
    "현실 폭력 전이": "real_violence",
    "PII": "pii",
}

# 모델이 목록에 없는 이름을 지어냈을 때. **통과로 뒤집지 않는다.**
UNKNOWN: Final = "unknown"

# 자해·자살만 뒤 처리가 다르다 — 아이에게 한 줄, 기록, 보호자 주간 리포트
# (`MVP_PRD.md` E-1 「자해·자살 신호 처리」, 2026-09-07 대표 판정).
SELF_HARM: Final = "self_harm"


class 검사(BaseModel):
    """Moderation 단계의 구조화 출력."""

    block: bool = Field(description="차단해야 하면 true")
    category: str = Field(default="", description="차단 시 3장 카테고리 이름. 통과면 빈 문자열")


@dataclass(frozen=True)
class 검사결과:
    """`blocked` 는 **판정과 실패를 합친 값**이다 — 둘의 구분은 `unavailable` 에 있다."""

    blocked: bool
    category: str = ""
    # 판정을 못 받은 사유(`timeout`·`error`·`unconfigured`·`rubric`). None 이면 모델이 판정했다.
    unavailable: str | None = None
    latency_ms: float = 0.0

    @property
    def self_harm(self) -> bool:
        return self.category == SELF_HARM


@lru_cache
def 장읽기() -> dict[str, list[str]]:
    """`안전_어휘_기준.md` 를 장 번호별로 쪼갠다. `## 1b` 같은 머리도 숫자로 잡힌다."""
    절: dict[str, list[str]] = {}
    현재: str | None = None
    for 줄 in 읽기(기준문서).splitlines():
        머리 = re.match(r"^## (\d)[.b]", 줄)
        if 머리:
            현재 = 머리.group(1)
            절.setdefault(현재, [])
            continue
        if 현재:
            절[현재].append(줄)
    빠진 = [n for n in ("2", "3", "4") if not 절.get(n)]
    if 빠진:
        raise RuntimeError(f"안전 기준 문서에서 {빠진} 장을 못 읽었다")
    return 절


@lru_cache
def 카테고리들() -> tuple[str, ...]:
    """3장 표의 첫 열. **여기가 카테고리의 원본이다.**

    표 머리글·구분선과 이어붙임 행(`↳`)은 카테고리가 아니라서 뺀다. 「PII (E-2 담당)」
    처럼 뒤에 붙은 괄호 주석도 뗀다 — 이름은 「PII」다.
    """
    이름들: list[str] = []
    for 줄 in 장읽기()["3"]:
        if not 줄.startswith("|"):
            continue
        칸 = 표행(줄)
        if len(칸) < 2:
            continue
        이름 = re.sub(r"\s*\(.*\)\s*$", "", 민(칸[0])).strip()
        if not 이름 or 이름 in {"카테고리", "↳"} or set(이름) <= {"-"}:
            continue
        이름들.append(이름)
    if not 이름들:
        raise RuntimeError("안전 기준 3장에서 카테고리를 하나도 못 읽었다. 표 모양이 바뀌었나")
    return tuple(이름들)


@lru_cache
def 검사지시() -> str:
    """2·3·4장을 **요약하지 않고 원문 표 그대로** 붙인다.

    요약하는 순간 그 요약이 두 번째 기준이 되고, 문서를 고쳐도 아이를 막는 쪽은
    안 바뀐다. `adr/0009` 실측이 쓴 프롬프트와 같은 문자열이다.
    """
    절 = 장읽기()
    return (
        "너는 만 10~12세 아동이 쓰는 판타지 모험 이야기 플랫폼의 입력 검사기다.\n"
        "아이가 쓴 한 문장을 받아 차단할지 통과시킬지만 판정한다. 글의 품질은 보지 않는다.\n\n"
        "## 원칙\n"
        "- **싸움은 허용, 고통의 묘사는 차단.** 기준은 행위가 아니라 결과의 묘사 수준이다\n"
        "- **오탐(안전한 입력을 막음)이 미탐보다 나쁘다.** 아이의 흐름이 끊기고 글쓰기를 그만둔다\n"
        "- 설득·관찰·돌봄·회피는 전투와 동등한 정상 행동이다\n"
        "- 판타지 존재(괴물·도깨비·그림자)를 대상으로 한 전투는 현실 폭력이 아니다\n\n"
        "## 허용 어휘 (막으면 오탐이다)\n"
        + "\n".join(절["2"]).strip()
        + "\n\n## 차단 카테고리와 허용 경계\n"
        + "\n".join(절["3"]).strip()
        + "\n\n## 회색 지대 판정 규칙\n"
        + "\n".join(절["4"]).strip()
        + "\n\n판정만 JSON 으로 낸다. 차단이면 category 에 3장 카테고리 이름을 적는다."
    )


def _설정된모델() -> str:
    return get_settings().evaluator_model.strip()


def _해시(text: str) -> str:
    """차단 기록용. **되돌릴 수 없고, 같은 문장이면 같다** (`안전_어휘_기준.md` 6장).

    같은 아이가 같은 문장을 반복하는지 세려면 식별자가 필요한데, 원문을 남길 수는 없다.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


async def _한번(모델: str, 문장: str) -> 검사:
    """단발 호출. 타임아웃은 부르는 쪽이 건다."""
    응답 = await get_client().aio.models.generate_content(
        model=모델,
        contents=문장,
        config=types.GenerateContentConfig(
            system_instruction=검사지시(),
            response_mime_type="application/json",
            response_schema=검사,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return 검사.model_validate_json(응답.text or "")


async def 검사하기(text: str) -> 검사결과:
    """문장 하나를 검사한다. **예외를 밖으로 내지 않는다.**

    **판정을 못 받으면 막는 쪽으로 닫는다.** `evaluate()` 와 방향이 반대인데,
    **어긋난 것이 아니다. 맞추려 들지 마라.**

    평가가 폴백으로 통과시키는 것은 **못 도와주는 것**이고, 검사가 통과시키는 것은
    **막아야 할 것을 내보내는 것**이다. 값이 다르니 방향이 달라도 된다.

    그리고 값이 **비대칭**이다. 아이가 막혔을 때 치르는 값은 카드 미소모·입력 유지·
    재시도라 **회복된다.** 반대쪽은 **유해 문장이 아이 책에 인쇄되는 것**이고
    **회복되지 않는다** — 그 책은 전체 사용자에게 공유된다 (비전 2장).
    되돌릴 수 없는 쪽을 기본값으로 둔다. 근거는 `안전_어휘_기준.md` 1장
    「Stage 0 은 미탐 0건을 우선」이다.

    **2026-09-07 대표 판정으로 확정됐다. 열려 있는 자리가 아니다** — 안전 정책이라
    뒤집는 것도 「대표 몫」이다.

    **대가는 프로바이더 장애 시 전원이 막히는 것**이라 「차단」과 「판정 못 받음」을
    로그에서 가른다 — 안 나누면 장애가 「아이들이 나쁜 말을 썼다」로 보이고, 그 잘못된
    그림이 곧 **화이트리스트를 조이는 근거**로 쓰인다. 조이면 초등학생다운 문장부터
    죽는다는 것이 오늘 실측이다.

    **이 구분은 편의가 아니라 정책의 일부다** — 대표 판정에 이 장치가 근거로 올라갔다.
    **합치거나 지우지 마라.**
    """
    시작 = time.perf_counter()

    try:
        모델 = _설정된모델()
        검사지시()  # 기준 문서를 못 읽으면 여기서 터진다
    except Exception:
        logger.error("안전 기준을 읽지 못했다", extra={"request_id": current_request_id()})
        return _못받음("rubric", text, 시작)

    if not 모델:
        # dev 목 서버는 모델명 없이 돈다. pilot 은 기동 자체가 막힌다 (`config.PILOT_REQUIRED`).
        return _못받음("unconfigured", text, 시작)

    사유 = "error"
    for _ in range(RETRIES + 1):
        try:
            결과 = await asyncio.wait_for(_한번(모델, text), timeout=TIMEOUT_SECONDS)
        except TimeoutError:
            사유 = "timeout"
        except Exception as exc:
            # **예외 메시지에 아이 입력이 실려 있을 수 있다. 타입만 남긴다.**
            사유 = "error"
            logger.warning(
                "검사 호출 실패",
                extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
            )
        else:
            return _판정(결과, text, 시작)

    return _못받음(사유, text, 시작)


def _판정(결과: 검사, text: str, 시작: float) -> 검사결과:
    if not 결과.block:
        return 검사결과(blocked=False, latency_ms=_지연(시작))

    category = 슬러그.get(민(결과.category), UNKNOWN)
    검사결과값 = 검사결과(blocked=True, category=category, latency_ms=_지연(시작))
    _차단기록(category, text)
    return 검사결과값


def _못받음(사유: str, text: str, 시작: float) -> 검사결과:
    """판정을 못 받았다. **막되 「차단」과 구분해서 남긴다.**"""
    logger.warning(
        "moderation_unavailable",
        extra={
            "request_id": current_request_id(),
            "moderation_unavailable": 사유,
            "direction": "in",
            "text_hash": _해시(text),
        },
    )
    return 검사결과(blocked=True, unavailable=사유, latency_ms=_지연(시작))


def _차단기록(category: str, text: str) -> None:
    """`안전_어휘_기준.md` 6장 — `moderation_blocked` (direction, category, hash).

    **원문 미저장.** 차단된 문장은 책 콘텐츠가 되지 않으므로 어디에도 남지 않는다.
    """
    logger.info(
        "moderation_blocked",
        extra={
            "request_id": current_request_id(),
            "direction": "in",
            "category": category,
            "text_hash": _해시(text),
        },
    )


def _지연(시작: float) -> float:
    return (time.perf_counter() - 시작) * 1000


__all__ = ["SELF_HARM", "검사", "검사결과", "검사지시", "검사하기", "슬러그", "카테고리들"]
