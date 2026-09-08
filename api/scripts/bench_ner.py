"""E-2 서버 2차 NER **비용 실측** (대표 요청, 2026-09-08).

**판정하지 않는다. 숫자만 만든다** — 돈이 나가는 얘기는 「대표 몫」이다.

재는 것은 **NER 호출 하나가 더하는 값**이다. 지금 시도 한 번에 프로바이더 호출이
둘(검사·평가)인데 셋이 된다. 대표가 보는 값은 **호출당 단가가 아니라 파일럿 총액과
증가율**이라, 여기서는 토큰만 정확히 재고 환산은 벤치 기록 문서에서 한다.

**호출을 최소로 태운다.** 문장 여섯 곱하기 1회 = 6회다. 반복이 필요한 것은 지연이지
토큰이 아닌데, **지연은 이미 안다** — 검사 호출과 같은 모양이라
`benchmarks/W3-safety-structure.md` 의 「병렬 +13ms」가 그대로 적용된다.

**여기 문장은 전부 지어낸 것이다.** 실제 아동 문장을 넣지 않는다 — 매 실행마다
프로바이더로 전송된다 (PRD 1.1b).

실행: `PYTHONPATH=. uv run python scripts/bench_ner.py`
"""

import statistics
import sys
import time

from google.genai import types
from pydantic import BaseModel

from app.config import get_settings
from app.llm import get_client

# `benchmarks/W2-evaluator-bench.md`·`W3-safety-structure.md` 와 같은 단가표.
단가표 = {"in": 0.25, "out": 1.50}

# **정규식이 못 잡는 것만 여기 온다** — 실명·학교명 (`공통규약.md` 73행).
# 그래서 시험 문장의 절반이 **아이가 지어낸 이름**이다. 그쪽이 오탐 위험이 큰 자리다.
문장들 = [
    # 잡아야 하는 것
    "김민준이랑 같이 동굴로 들어갔다",
    "나는 별빛초등학교 3반이야",
    # 걸리면 안 되는 것 — 아이가 지은 이름
    "나침이가 은빛 검을 들고 달려갔다",
    "그림자늑대 크라운이 울부짖었다",
    "마법학교 교장 선생님이 문을 열어줬다",
    # 아무것도 없는 것
    "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다",
]


class 이름판정(BaseModel):
    """**돌려받는 것은 종류뿐이다.** 잡아낸 문자열 자체를 받지 않는다 —
    받으면 그게 곧 원문 조각이고, 로그·기록으로 새는 경로가 하나 더 생긴다.
    위치는 서버가 다시 찾는다.
    """

    real_name: bool
    school: bool


지시 = """너는 아동 글쓰기 서비스의 개인정보 검사기다.
문장에 **실제 사람의 이름**이나 **실제 학교 이름**이 있는지만 판단한다.

- real_name: 실제로 존재할 법한 한국 사람 이름(성+이름)이 있으면 true
- school: 실제 학교 이름이 있으면 true

**아이가 지어낸 이름은 false 다.** 판타지 인물·괴물·가이드 캐릭터 이름,
성이 없는 별명, 지어낸 학교(마법학교 등)는 전부 false 다.
**애매하면 false 다** — 아이가 지은 이름을 가리면 아이 문장이 망가진다."""


def 단가(입력: int, 출력: int) -> float:
    return (입력 * 단가표["in"] + 출력 * 단가표["out"]) / 1_000_000


def 한번(모델: str, 문장: str) -> tuple[bool, bool, float, int, int]:
    시작 = time.perf_counter()
    응답 = get_client().models.generate_content(
        model=모델,
        contents=문장,
        config=types.GenerateContentConfig(
            system_instruction=지시,
            response_mime_type="application/json",
            response_schema=이름판정,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    지연 = (time.perf_counter() - 시작) * 1000
    사용 = 응답.usage_metadata
    판정 = 이름판정.model_validate_json(응답.text)
    return (
        판정.real_name,
        판정.school,
        지연,
        사용.prompt_token_count or 0,
        (사용.candidates_token_count or 0) + (사용.thoughts_token_count or 0),
    )


def main() -> int:
    모델 = get_settings().evaluator_model
    if not 모델:
        print("EVALUATOR_MODEL 이 없다. .env 를 확인해라", file=sys.stderr)
        return 2

    print(f"모델 {모델} · 문장 {len(문장들)}개 · 각 1회\n")
    비용: list[float] = []
    지연들: list[float] = []
    입력들: list[int] = []
    출력들: list[int] = []

    for 문장 in 문장들:
        이름, 학교, 지연, 입력, 출력 = 한번(모델, 문장)
        비용.append(단가(입력, 출력))
        지연들.append(지연)
        입력들.append(입력)
        출력들.append(출력)
        print(
            f"real_name={이름!s:5} school={학교!s:5} "
            f"{지연:6.0f}ms  in={입력:4} out={출력:3}  ${단가(입력, 출력):.6f}  {문장}"
        )

    print(
        f"\n입력 토큰 평균 {statistics.mean(입력들):.0f} · 출력 평균 {statistics.mean(출력들):.0f}"
        f"\n지연 p50 {statistics.median(지연들):.0f}ms"
        f"\n**회당 단가 평균 ${statistics.mean(비용):.6f}** · 이번 실행 합계 ${sum(비용):.4f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
