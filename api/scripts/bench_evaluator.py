"""W2 1번 — Evaluator 모델 확정 (`docs/adr/0005`).

W1 스모크는 입력 300토큰짜리 최소 프롬프트라 확정 근거가 못 된다
(`benchmarks/W1-llm-smoke.md` 「주의」). **예시셋 40개를 실제로 붙여 재측정한다.**

**루브릭·예시셋·판정 경계를 코드에 복사하지 않는다.** 전부 문서에서 읽는다 —
`MVP_PRD.md` 4.3절과 `docs/루브릭_예시셋.md`. 복사해 두면 문서와 갈라지고,
갈라진 쪽이 실제로 아이를 판정한다. (W1 스모크는 4.3절을 코드에 박아 뒀다.
이 스크립트가 그 방식을 대체한다)

**측정 모드가 둘인 이유** — 예시셋 40개가 few-shot 으로 프롬프트에 들어가는데
같은 40개로 일치율을 재면 답이 문제지에 적혀 있다.

- `loo` (기본) — leave-one-out. 재는 문장 하나를 few-shot 에서 빼고 39개만 넣는다.
  **일치율은 이 수치가 정직하다.** 매 호출 프롬프트가 달라 context caching 은 안 걸린다
- `all` — 40개를 그대로 넣는다. **운영과 같은 형태라 지연·단가·caching 은 이쪽이 실측이다.**
  여기서 나온 일치율은 상한선이지 성능이 아니다

실행: `PYTHONPATH=. uv run python scripts/bench_evaluator.py [loo|all|both]`
"""

import asyncio
import re
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from google.genai import types
from pydantic import BaseModel, Field

from app.cost import record_usd
from app.llm import get_client

REPO = Path(__file__).resolve().parents[2]
예시셋문서 = REPO / "docs" / "루브릭_예시셋.md"
PRD = REPO / "docs" / "MVP_PRD.md"

# W1 스모크가 좁힌 후보 (`benchmarks/W1-llm-smoke.md`).
# `gemini-3.7-flash` 는 평균 11초로 이미 탈락. `gemini-3.5-flash-lite` 는 context
# caching 미지원이라 예시셋이 붙는 이 시점에 탈락시킨다 — **탈락을 숫자로 남기려고**
# 후보에 두되 기본 실행에서는 뺀다.
# **`gemini-3.1-flash` 는 없다** — 2026-09-07 `models.list()` 확인, 404. lite 만 있다.
# 일치율이 80% 를 못 넘기면 그때 `gemini-3.5-flash` 로 올린다 (단가 미확인).
# 먼저 lite 로 재고, 넘으면 상위 모델을 부르지 않는다 — 「가장 좋은 것」이 아니라
# 「쓸 만한 것」을 고르는 것이 이 벤치의 목적이다 (주차 계획 위험 표).
후보: dict[str, dict[str, float | bool | None]] = {
    "gemini-3.1-flash-lite": {"in": 0.25, "out": 1.50, "cache": 0.025, "thinking_off": True},
}

등급 = Literal["G0", "G1", "G2", "G3"]


class 판정(BaseModel):
    grade: 등급
    signals: list[str] = Field(default_factory=list)
    descriptors: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class 예시:
    등급: str
    카드: str
    입력: str
    유형: str  # 전투 / 비전투

    @property
    def 비전투(self) -> bool:
        return self.유형 == "비전투"


def _표행(줄: str) -> list[str]:
    return [칸.strip() for 칸 in 줄.strip().strip("|").split("|")]


def 예시셋읽기() -> list[예시]:
    """`## G0 — …` 섹션마다 표를 읽는다. 열 개수가 등급마다 다르므로 앞 4열만 쓴다."""
    묶음: list[예시] = []
    현재: str | None = None
    for 줄 in 예시셋문서.read_text(encoding="utf-8").splitlines():
        머리 = re.match(r"^## (G[0-3]) ", 줄)
        if 머리:
            현재 = 머리.group(1)
            continue
        if 줄.startswith("## "):
            현재 = None
        if 현재 is None or not 줄.startswith("|"):
            continue
        칸 = _표행(줄)
        if len(칸) < 4 or not 칸[0].isdigit():
            continue  # 머리글·구분선
        묶음.append(예시(등급=현재, 카드=칸[1], 입력=칸[2], 유형=칸[3]))
    return 묶음


def 경계읽기() -> list[str]:
    """「판정 경계」 표를 규칙 줄로. 예시셋만으로는 안 잡히는 것들이다."""
    규칙: list[str] = []
    구간 = False
    for 줄 in 예시셋문서.read_text(encoding="utf-8").splitlines():
        if 줄.startswith("## 판정 경계"):
            구간 = True
            continue
        if 구간 and 줄.startswith("## "):
            break
        if not 구간 or not 줄.startswith("|"):
            continue
        칸 = _표행(줄)
        if len(칸) != 2 or 칸[0] in {"상황", ""} or set(칸[0]) <= {"-", ":"}:
            continue
        규칙.append(f"- {_민(칸[0])} → {_민(칸[1])}")
    return 규칙


def _민(글: str) -> str:
    """마크다운 강조·인라인 코드를 뗀다. 프롬프트에 별표가 들어갈 이유가 없다."""
    return re.sub(r"[*`]", "", 글).strip()


def 루브릭읽기() -> str:
    """PRD 4.3절의 표와 규칙을 그대로 가져온다. 요약하지 않는다 — 요약이 곧 해석이다."""
    본문 = PRD.read_text(encoding="utf-8")
    조각 = re.search(r"^### 4\.3 .*?$(.*?)^### 4\.4 ", 본문, re.S | re.M)
    if not 조각:
        raise RuntimeError("PRD 4.3절을 못 찾았다. 절 번호가 바뀌었으면 여기를 고친다")
    줄들 = []
    for 줄 in 조각.group(1).strip().splitlines():
        if set(줄.strip()) <= {"-", "|", ":", " "} and 줄.strip():
            continue  # 표 구분선
        줄들.append(_민(줄))
    return "\n".join(줄들).strip()


def 번갈아(few: list[예시]) -> list[예시]:
    """등급을 번갈아 배치한다. 문서 순서대로 넣으면 프롬프트 끝이 전부 G3 라
    최근 예시 쪽으로 판정이 쏠린다. **무작위로 섞지 않는다** — 매 호출 순서가
    달라지면 context caching 이 깨지고 재현도 안 된다."""
    통: dict[str, list[예시]] = {}
    for e in few:
        통.setdefault(e.등급, []).append(e)
    줄: list[예시] = []
    for i in range(max(len(v) for v in 통.values()) if 통 else 0):
        for 급 in sorted(통):
            if i < len(통[급]):
                줄.append(통[급][i])
    return 줄


def 프롬프트(few: list[예시]) -> str:
    보기 = "\n".join(f"- 「{e.입력}」 → {e.등급}" for e in 번갈아(few))
    return (
        "너는 초등 5~6학년이 쓴 '행동 묘사 문장'을 4단계로 판정한다.\n"
        "루브릭은 아래가 전부다. 여기 없는 기준을 스스로 만들지 않는다.\n\n"
        f"[루브릭]\n{루브릭읽기()}\n\n"
        f"[판정 경계]\n" + "\n".join(경계읽기()) + "\n\n"
        f"[예시]\n{보기}\n\n"
        "출력은 {grade, signals, descriptors}. "
        'signals 는 "adj:은빛", "adv:재빨리", "clause:방법" 형식이고 '
        "descriptors 는 문장에서 그대로 뽑은 묘사어다."
    )


def 한번(모델: str, 지시: str, 문장: str) -> tuple[판정, float, int, int, int]:
    """(판정, 지연ms, 입력토큰, 출력토큰, 캐시적중토큰)."""
    끄기 = (
        {"thinking_config": types.ThinkingConfig(thinking_budget=0)}
        if 후보[모델]["thinking_off"]
        else {}
    )
    시작 = time.perf_counter()
    응답 = get_client().models.generate_content(
        model=모델,
        contents=문장,
        config=types.GenerateContentConfig(
            system_instruction=지시,
            response_mime_type="application/json",
            response_schema=판정,
            **끄기,
        ),
    )
    지연 = (time.perf_counter() - 시작) * 1000
    사용 = 응답.usage_metadata
    return (
        판정.model_validate_json(응답.text),
        지연,
        사용.prompt_token_count or 0,
        (사용.candidates_token_count or 0) + (사용.thoughts_token_count or 0),
        사용.cached_content_token_count or 0,
    )


def 단가(모델: str, 입력: int, 출력: int) -> float:
    표 = 후보[모델]
    return 입력 / 1e6 * float(표["in"]) + 출력 / 1e6 * float(표["out"])


@dataclass
class 집계:
    모델: str
    모드: str
    지연: list[float]
    입력토큰: int = 0
    출력토큰: int = 0
    캐시토큰: int = 0
    맞음: int = 0
    전체: int = 0
    비전투맞음: int = 0
    비전투전체: int = 0
    인접오판: int = 0
    건너뛴오판: int = 0
    등급별: dict[str, list[int]] | None = None  # 등급 → [맞음, 전체]
    혼동: list[tuple[str, str, str]] | None = None  # (기대, 받은, 입력)

    def 일치율(self) -> float:
        return 100 * self.맞음 / self.전체 if self.전체 else 0.0

    def 비전투일치율(self) -> float:
        return 100 * self.비전투맞음 / self.비전투전체 if self.비전투전체 else 0.0


def 재기(모델: str, 예시들: list[예시], 모드: str) -> 집계:
    묶음 = 집계(모델=모델, 모드=모드, 지연=[], 등급별={}, 혼동=[])
    전체지시 = 프롬프트(예시들)

    for 대상 in 예시들:
        지시 = 전체지시 if 모드 == "all" else 프롬프트([e for e in 예시들 if e is not 대상])
        try:
            결과, 지연, 입력, 출력, 캐시 = 한번(모델, 지시, 대상.입력)
        except Exception as exc:
            print(f"    실패 {대상.등급} {대상.카드}: {type(exc).__name__}: {str(exc)[:100]}")
            continue

        묶음.지연.append(지연)
        묶음.입력토큰 += 입력
        묶음.출력토큰 += 출력
        묶음.캐시토큰 += 캐시
        묶음.전체 += 1
        묶음.비전투전체 += 1 if 대상.비전투 else 0
        칸 = 묶음.등급별.setdefault(대상.등급, [0, 0])
        칸[1] += 1

        if 결과.grade == 대상.등급:
            묶음.맞음 += 1
            칸[0] += 1
            묶음.비전투맞음 += 1 if 대상.비전투 else 0
        else:
            차 = abs(int(결과.grade[1]) - int(대상.등급[1]))
            if 차 == 1:
                묶음.인접오판 += 1
            else:
                묶음.건너뛴오판 += 1
            묶음.혼동.append((대상.등급, 결과.grade, 대상.입력))
    return 묶음


def 보고(묶음: 집계) -> None:
    if not 묶음.전체:
        print("    측정된 것이 없다.")
        return
    회당 = 단가(묶음.모델, 묶음.입력토큰 // 묶음.전체, 묶음.출력토큰 // 묶음.전체)
    넘음 = sum(1 for d in 묶음.지연 if d > 1500)
    print(
        f"    일치율 {묶음.일치율():5.1f}%  ({묶음.맞음}/{묶음.전체})"
        f"   비전투 {묶음.비전투일치율():5.1f}% ({묶음.비전투맞음}/{묶음.비전투전체})"
    )
    print(
        "    등급별 "
        + "  ".join(f"{g} {v[0]}/{v[1]}" for g, v in sorted(묶음.등급별.items()))
        + f"   인접오판 {묶음.인접오판} · 건너뛴오판 {묶음.건너뛴오판}"
    )
    print(
        f"    지연 평균 {statistics.mean(묶음.지연):.0f}ms · 중앙 "
        f"{statistics.median(묶음.지연):.0f}ms · 최대 {max(묶음.지연):.0f}ms"
        f"   1.5초 초과 {넘음}/{묶음.전체}"
    )
    print(
        f"    입력 {묶음.입력토큰 // 묶음.전체}토큰/회 (캐시적중 "
        f"{묶음.캐시토큰 // 묶음.전체}) · 출력 {묶음.출력토큰 // 묶음.전체}토큰/회"
        f" · 회당 ${회당:.6f}"
    )
    if 묶음.일치율() < 80:
        print("    ← 합격선 80% 미달. 모델이 아니라 루브릭·예시셋을 먼저 의심한다")
    if 묶음.건너뛴오판:
        print("    ← 건너뛴 오판이 있다. 루브릭 자체가 흔들린 것이니 PM 에게 알린다")
    for 기대, 받은, 문장 in 묶음.혼동:
        줄임 = f"{문장[:40]}…" if len(문장) > 40 else 문장
        print(f"      {기대}→{받은}  「{줄임}」")


async def main() -> None:
    모드인자 = sys.argv[1] if len(sys.argv) > 1 else "loo"
    모드들 = ["loo", "all"] if 모드인자 == "both" else [모드인자]

    예시들 = 예시셋읽기()
    비전투 = sum(1 for e in 예시들 if e.비전투)
    print(f"예시셋 {len(예시들)}개 (비전투 {비전투}) · 판정 경계 {len(경계읽기())}줄")
    print(f"프롬프트 길이 {len(프롬프트(예시들))}자\n")
    if len(예시들) != 40:
        print(f"※ 40개가 아니다 ({len(예시들)}개). 문서 표가 바뀌었는지 본다\n")

    총비용 = 0.0
    for 모델 in 후보:
        for 모드 in 모드들:
            print(f"── {모델}  [{모드}]")
            묶음 = 재기(모델, 예시들, 모드)
            보고(묶음)
            총비용 += 단가(모델, 묶음.입력토큰, 묶음.출력토큰)
            print()

    print(f"총 약 ${총비용:.4f}")
    누적 = await record_usd(총비용, kind="evaluator_bench")
    print(f"오늘 누적(Redis) = {누적}")


if __name__ == "__main__":
    asyncio.run(main())
