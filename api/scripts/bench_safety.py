"""W3 선행 — 유해 표현 차단(E-1) **구조 판정용 실측**.

**판정은 「대표 몫」이다** (안전 정책). 이 스크립트는 판정하지 않고 **숫자만 만든다** —
같은 17개를 두 구조로 돌려 오탐·미탐·지연·단가를 잰다 (`docs/안전_시나리오.md`).

| | (가) 내장 필터만 | (나) 별도 Moderation 단계 |
|---|---|---|
| 무엇 | 지금 구조 그대로. Evaluator 호출에 딸린 Gemini 내장 안전 필터가 |
| | 유일한 방어선이다 | Evaluator **앞에** 검사 호출을 하나 더 둔다 |

**기준을 코드에 복사하지 않는다.** 화이트리스트·차단 카테고리·회색 지대는
`docs/안전_어휘_기준.md` 2·3·4장에서 읽고, 시나리오는 `docs/안전_시나리오.md` 에서
읽는다. 복사해 두면 문서와 갈라지고, **갈라진 쪽이 실제로 아이를 막는다**
(`api/CLAUDE.md` 「절대 하지 않는 것」).

**여기 문장은 전부 지어낸 것이다.** 실제 아동 문장은 넣지 않는다 — 매 실행마다
프로바이더로 전송된다 (PRD 1.1b).

실행: `PYTHONPATH=. uv run python scripts/bench_safety.py [반복수]`
"""

import asyncio
import re
import statistics
import sys
import time
from dataclasses import dataclass

from google.genai import types

from app.config import REPO_ROOT, get_settings
from app.docs_md import 민, 읽기, 표행
from app.evaluator import 판정
from app.llm import get_client
from app.moderation import 검사, 검사지시
from app.rubric import 시스템지시

시나리오문서 = REPO_ROOT / "docs" / "안전_시나리오.md"

# `benchmarks/W2-evaluator-bench.md` 확정본과 같은 단가표다. 검사 단계도 같은 모델로
# 잰다 — 구조를 비교하는 것이지 모델을 고르는 것이 아니다.
단가표 = {"in": 0.25, "out": 1.50}


@dataclass(frozen=True)
class 시나리오:
    번호: str  # P1~P10 · B1~B7
    입력: str
    근거: str

    @property
    def 통과기대(self) -> bool:
        return self.번호.startswith("P")


def 시나리오읽기() -> list[시나리오]:
    """`| P1 | 문장 | 근거 |` 3열 표만 읽는다. 「재는 것」 표는 4열이라 여기서 걸린다."""
    묶음: list[시나리오] = []
    번호꼴 = re.compile(r"^[PB]\d{1,2}$")
    for 줄 in 읽기(시나리오문서).splitlines():
        if not 줄.startswith("|"):
            continue
        칸 = 표행(줄)
        if len(칸) != 3 or not 번호꼴.match(민(칸[0])):
            continue
        묶음.append(시나리오(번호=민(칸[0]), 입력=민(칸[1]), 근거=민(칸[2])))
    if not 묶음:
        raise RuntimeError("안전 시나리오를 하나도 못 읽었다. 문서 표 모양이 바뀌었는지 본다")
    return 묶음


def _막혔나(응답: object) -> tuple[bool, str]:
    """내장 필터가 막았는지. (막힘, 사유)."""
    되먹임 = getattr(응답, "prompt_feedback", None)
    if 되먹임 is not None and getattr(되먹임, "block_reason", None):
        return True, f"prompt:{되먹임.block_reason}"

    후보들 = getattr(응답, "candidates", None) or []
    if not 후보들:
        return True, "no_candidate"

    끝 = getattr(후보들[0], "finish_reason", None)
    이름 = getattr(끝, "name", str(끝))
    if 이름 not in ("STOP", "None", "MAX_TOKENS"):
        return True, f"finish:{이름}"
    return False, ""


# `안전_어휘_기준.md` 1b장이 묻는 것은 「2장 화이트리스트를 **필터 임계값으로 재현**할 수
# 있는가」다. 기본값만 재면 그 질문에 답이 안 된다 — **임계값을 가장 낮게 조인 변형**을
# 함께 잰다. 낮출수록 미탐은 줄고 오탐이 는다. 둘을 같이 봐야 판정이 된다.
_엄격 = [
    types.SafetySetting(category=c, threshold="BLOCK_LOW_AND_ABOVE")
    for c in (
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
    )
]


def 가_내장(모델: str, 문장: str, 엄격: bool = False) -> tuple[bool, str, float, int, int]:
    """(가) 지금 구조. **Evaluator 호출 그대로** 부르고 내장 필터가 막았는지만 본다.

    운영에서는 이 자리가 막히면 `evaluate()` 가 예외를 삼키고 **G1 폴백**으로 넘어간다 —
    즉 아이 입력은 「막힌 것」이 아니라 「낮은 등급」으로 흘러간다. 그 사실도 기록한다.
    """
    시작 = time.perf_counter()
    응답 = get_client().models.generate_content(
        model=모델,
        contents=문장,
        config=types.GenerateContentConfig(
            system_instruction=시스템지시(),
            response_mime_type="application/json",
            response_schema=판정,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            safety_settings=_엄격 if 엄격 else None,
        ),
    )
    지연 = (time.perf_counter() - 시작) * 1000
    막힘, 사유 = _막혔나(응답)
    사용 = 응답.usage_metadata
    return (
        막힘,
        사유,
        지연,
        사용.prompt_token_count or 0,
        (사용.candidates_token_count or 0) + (사용.thoughts_token_count or 0),
    )


def 나_별도(모델: str, 지시: str, 문장: str) -> tuple[bool, str, float, int, int]:
    """(나) Evaluator **앞에** 붙는 검사 한 번. 재는 것은 이 호출이 더하는 지연·단가다."""
    시작 = time.perf_counter()
    응답 = get_client().models.generate_content(
        model=모델,
        contents=문장,
        config=types.GenerateContentConfig(
            system_instruction=지시,
            response_mime_type="application/json",
            response_schema=검사,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    지연 = (time.perf_counter() - 시작) * 1000
    사용 = 응답.usage_metadata
    토큰 = (
        사용.prompt_token_count or 0,
        (사용.candidates_token_count or 0) + (사용.thoughts_token_count or 0),
    )

    막힘, 사유 = _막혔나(응답)
    if 막힘:
        # 검사 호출 자체가 내장 필터에 막힌 경우. **차단으로 센다** — 실제 구조에서도
        # 판정을 못 받았으니 통과시킬 수 없다.
        return True, f"내장:{사유}", 지연, *토큰

    결과 = 검사.model_validate_json(응답.text or "")
    return 결과.block, 민(결과.category), 지연, *토큰


# ── (나) 를 병렬로 두면? ────────────────────────────────
#
# 검사와 평가는 **둘 다 아이 문장 하나만 입력으로 받는다.** 검사 결과가 평가의 입력이
# 아니므로 순서를 강제할 이유가 없다 — 동시에 던지고 검사가 차단이면 평가 결과를 버리면
# 된다. 그러면 늘어나는 지연은 「검사 호출 시간」이 아니라 **둘 중 느린 쪽과의 차이**다.
#
# **대신 차단될 문장도 평가에 한 번 태운다.** 프로바이더에 문장이 가는 것은 순차든
# 병렬이든 같지만(같은 호출·같은 키), 「검사 전에는 안 태운다」는 순서를 잃는다.
# **이건 구조 판정에 딸린 안전 정책 판단이라 여기서 정하지 않는다.**


async def _평가비동기(모델: str, 문장: str) -> float:
    시작 = time.perf_counter()
    await get_client().aio.models.generate_content(
        model=모델,
        contents=문장,
        config=types.GenerateContentConfig(
            system_instruction=시스템지시(),
            response_mime_type="application/json",
            response_schema=판정,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return (time.perf_counter() - 시작) * 1000


async def _검사비동기(모델: str, 지시: str, 문장: str) -> float:
    시작 = time.perf_counter()
    await get_client().aio.models.generate_content(
        model=모델,
        contents=문장,
        config=types.GenerateContentConfig(
            system_instruction=지시,
            response_mime_type="application/json",
            response_schema=검사,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return (time.perf_counter() - 시작) * 1000


async def 병렬측정(모델: str, 지시: str, 시나리오들: list[시나리오], 반복: int) -> None:
    """평가만 vs 평가+검사 동시. **재는 것은 벽시계 시간이다** — 아이가 기다리는 시간이다."""
    단독: list[float] = []
    동시: list[float] = []
    for s in 시나리오들:
        for _ in range(반복):
            시작 = time.perf_counter()
            await _평가비동기(모델, s.입력)
            단독.append((time.perf_counter() - 시작) * 1000)

            시작 = time.perf_counter()
            await asyncio.gather(_평가비동기(모델, s.입력), _검사비동기(모델, 지시, s.입력))
            동시.append((time.perf_counter() - 시작) * 1000)

    def p(값: list[float], 분위: float) -> float:
        return sorted(값)[max(0, int(len(값) * 분위) - 1)]

    print("\n── (나-병렬) 검사를 평가와 동시에 던졌을 때 — 벽시계")
    print(f"   평가만        p50 {statistics.median(단독):.0f}ms · p95 {p(단독, 0.95):.0f}ms")
    print(f"   평가+검사 동시 p50 {statistics.median(동시):.0f}ms · p95 {p(동시, 0.95):.0f}ms")
    print(
        f"   **증가분**     p50 {statistics.median(동시) - statistics.median(단독):+.0f}ms · "
        f"p95 {p(동시, 0.95) - p(단독, 0.95):+.0f}ms"
    )


def 단가(입력: int, 출력: int) -> float:
    return (입력 * 단가표["in"] + 출력 * 단가표["out"]) / 1_000_000


def 요약(이름: str, 목록: list[tuple[시나리오, bool, str]], 지연: list[float], 비용: list[float]):
    오탐 = [s for s, 막힘, _ in 목록 if s.통과기대 and 막힘]
    미탐 = [s for s, 막힘, _ in 목록 if not s.통과기대 and not 막힘]
    print(f"\n── {이름}")
    print(f"   오탐 {len(오탐)}/10 · 미탐 {len(미탐)}/7")
    print(
        f"   지연 p50 {statistics.median(지연):.0f}ms · "
        f"p95 {sorted(지연)[max(0, int(len(지연) * 0.95) - 1)]:.0f}ms · "
        f"평균 단가 ${statistics.mean(비용):.6f}/회"
    )
    if 오탐:
        print("   오탐 원문:")
        for s in 오탐:
            print(f"     {s.번호}  {s.입력}")
    if 미탐:
        print("   미탐:", ", ".join(s.번호 for s in 미탐))
    return 오탐, 미탐


def main() -> None:
    반복 = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    모델 = get_settings().evaluator_model.strip()
    if not 모델:
        raise SystemExit("EVALUATOR_MODEL 이 비어 있다 (.env)")

    시나리오들 = 시나리오읽기()
    지시 = 검사지시()
    print(f"모델 {모델} · 시나리오 {len(시나리오들)}개 · 반복 {반복}회")
    print(f"검사 프롬프트 {len(지시):,}자 (`안전_어휘_기준.md` 2·3·4장 원문)\n")

    가결과: list[tuple[시나리오, bool, str]] = []
    엄결과: list[tuple[시나리오, bool, str]] = []
    나결과: list[tuple[시나리오, bool, str]] = []
    가지연: list[float] = []
    나지연: list[float] = []
    가비용: list[float] = []
    엄지연: list[float] = []
    엄비용: list[float] = []
    나비용: list[float] = []

    print(f"{'':4} {'기대':4} {'(가) 내장 기본':20} {"(가') 임계값 최저":20} {'(나) 별도':20}")
    for s in 시나리오들:
        가막힘들: list[bool] = []
        엄막힘들: list[bool] = []
        나막힘들: list[bool] = []
        가사유 = 나사유 = 엄사유 = ""
        for _ in range(반복):
            막힘, 사유, 지연, 입력, 출력 = 가_내장(모델, s.입력)
            가막힘들.append(막힘)
            가사유 = 사유 or 가사유
            가지연.append(지연)
            가비용.append(단가(입력, 출력))

            막힘3, 사유3, 지연3, 입력3, 출력3 = 가_내장(모델, s.입력, 엄격=True)
            엄막힘들.append(막힘3)
            엄사유 = 사유3 or 엄사유
            엄지연.append(지연3)
            엄비용.append(단가(입력3, 출력3))

            막힘2, 사유2, 지연2, 입력2, 출력2 = 나_별도(모델, 지시, s.입력)
            나막힘들.append(막힘2)
            나사유 = 사유2 or 나사유
            나지연.append(지연2)
            나비용.append(단가(입력2, 출력2))

        # **다수결이 아니라 「한 번이라도 막혔나」로 센다.** 아이는 한 번만 겪어도 막힌 것이다.
        가막힘 = any(가막힘들)
        나막힘 = any(나막힘들)
        엄막힘 = any(엄막힘들)
        가결과.append((s, 가막힘, 가사유))
        엄결과.append((s, 엄막힘, 엄사유))
        나결과.append((s, 나막힘, 나사유))

        def 표시(막힘: bool, 사유: str, 막힘들: list[bool]) -> str:
            글 = "차단" if 막힘 else "통과"
            흔들림 = "" if len(set(막힘들)) == 1 else f" ~{sum(막힘들)}/{len(막힘들)}"
            return f"{글}{흔들림} {사유}".strip()

        기대 = "통과" if s.통과기대 else "차단"

        기대통과 = s.통과기대

        def 틀림(막힘: bool, 기대통과: bool = 기대통과) -> str:
            return "✗" if 막힘 == 기대통과 else " "

        print(
            f"{s.번호:4} {기대:4} "
            f"{틀림(가막힘)}{표시(가막힘, 가사유, 가막힘들):19} "
            f"{틀림(엄막힘)}{표시(엄막힘, 엄사유, 엄막힘들):19} "
            f"{틀림(나막힘)}{표시(나막힘, 나사유, 나막힘들):19}"
        )

    요약("(가) 내장 필터만", 가결과, 가지연, 가비용)
    요약("(가') 내장 필터 · 임계값 최저", 엄결과, 엄지연, 엄비용)
    요약("(나) 별도 Moderation 단계", 나결과, 나지연, 나비용)

    asyncio.run(병렬측정(모델, 지시, 시나리오들, 반복))

    총비용 = sum(가비용) + sum(엄비용) + sum(나비용)
    print(f"\n총 {len(가지연) + len(엄지연) + len(나지연)}회 호출 · ${총비용:.4f}")


if __name__ == "__main__":
    main()
