"""W1 5번 — LLM 스모크. 후보 모델의 지연·토큰·단가를 실측한다.

`docs/adr/0005` 미결 「절감액 실측」과 PRD 8장 W1 검증 「스모크(토큰·지연·단가 실측)」.
결과로 W2 벤치(B-2, 예시셋 40개)에 올릴 후보를 좁힌다. **여기서 모델을 확정하지 않는다.**

입력 문장은 **PRD 4.3 루브릭의 예시 문장**이다. 아이가 실제로 쓴 문장이 아니다 —
약관상 유료 티어도 남용 탐지 목적의 제한적 로깅이 있어, 스모크에는 실입력을 쓰지 않는다.

실행: `PYTHONPATH=. uv run python scripts/smoke_llm.py`
(`[tool.uv] package = false` 라 프로젝트가 설치되지 않는다 — `app` 을 찾으려면 필요하다)
"""

import asyncio
import statistics
import time
from typing import Literal

from google.genai import types
from pydantic import BaseModel, Field

from app.cost import record_usd
from app.llm import get_client

# 후보 — Evaluator 요구는 「1.5초 이내, 저비용, few-shot 분류, 구조화 출력」 (PRD 4.5).
# 가격은 2026-09-01 확인, **2026-12-31까지의 가격**이다 (이후 인상 예고된 모델 있음).
# cache=None 은 context caching 미지원 — PRD 4.5 가 "few-shot 예시셋은 context caching"
# 이라 했으므로 그 자체가 감점 요인이다.
# thinking_off=False 인 모델은 thinking_budget=0 을 400 으로 거부한다 (2026-09-01 실측).
후보: dict[str, dict[str, float | bool | None]] = {
    "gemini-3.7-flash": {"in": 0.75, "out": 3.75, "cache": 0.075, "thinking_off": True},
    "gemini-3.1-flash-lite": {"in": 0.25, "out": 1.50, "cache": 0.025, "thinking_off": True},
    "gemini-3.5-flash-lite": {"in": 0.30, "out": 2.50, "cache": None, "thinking_off": False},
}
# gemini-2.5-flash-lite 는 뺐다 — 2026-09-01 신규 사용자에게 404 이고
# API 가 gemini-3.5-flash-lite 를 쓰라고 안내한다.

RUBRIC = """너는 초등 5~6학년이 쓴 '행동 묘사 문장'을 4단계로 판정한다.

G0 대행/단답 — 행동이 없거나 AI에게 떠넘김. 10자 미만, "알아서 해줘", "몰라", 선택지 번호만.
   긴 단답("공격공격공격…")도 G0.
G1 기본 행동 — 행동 동사 1개, 대상 있음, 묘사 없음. 형용사·부사 0개.
G2 구체 묘사 — 행동 + 방법·도구·감각 중 1~2개. 형용사·부사 1~2개 또는 "~하면서/~하게" 절.
G3 풍부한 묘사 — 행동 + 방법 + 감각/감정/의도 중 2개 이상. 묘사어 3개 이상, 복문, 이유·감정 포함.

규칙
- 길이는 보조 신호다.
- 맞춤법·띄어쓰기는 무시한다. 초5 수준 오타는 정상 입력이다.
- 뼈대를 벗어난 창의적 입력도 등급대로만 판정한다.
- signals 는 "adj:은빛", "adv:재빨리", "clause:방법" 형식.
- descriptors 는 문장에서 그대로 뽑은 묘사어."""

# PRD 4.3 표의 예시 문장. 기대 등급을 함께 둔다 — 일치율의 아주 거친 첫 신호용이다
# (본 검증은 W2 예시셋 40개, B-2).
표본: list[tuple[str, str]] = [
    ("그냥 가", "G0"),
    ("문을 연다", "G1"),
    ("은빛 검을 들고 괴물의 다리를 재빨리 벤다", "G2"),
    (
        "은빛 갑옷이 달빛에 번쩍이는 걸 보고, 나는 숨을 죽인 채 괴물 뒤로 "
        "살금살금 돌아가 무거운 검을 힘껏 휘두른다",
        "G3",
    ),
]


class 판정(BaseModel):
    grade: Literal["G0", "G1", "G2", "G3"]
    signals: list[str] = Field(default_factory=list)
    descriptors: list[str] = Field(default_factory=list)


def 한번(모델: str, 문장: str) -> tuple[판정, float, int, int]:
    """한 번 호출하고 (판정, 지연ms, 입력토큰, 출력토큰)."""
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
            system_instruction=RUBRIC,
            response_mime_type="application/json",
            response_schema=판정,
            # PRD 4.5 — Evaluator 는 thinking budget 최소. 분류 작업이라 추론이 길 이유가 없다.
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
    )


def 단가(모델: str, 입력: int, 출력: int) -> float:
    표 = 후보[모델]
    return 입력 / 1e6 * float(표["in"]) + 출력 / 1e6 * float(표["out"])


async def main() -> None:
    print(f"표본 {len(표본)}문장 x 후보 {len(후보)}개\n")
    총비용 = 0.0
    요약: list[tuple[str, float, float, int, int, float, str]] = []

    for 모델 in 후보:
        지연들, 입력합, 출력합, 맞은수 = [], 0, 0, 0
        print(f"── {모델}")
        try:
            한번(모델, "문을 연다")  # 워밍업. 첫 호출 지연을 측정에서 뺀다
        except Exception as exc:
            print(f"   실패: {type(exc).__name__}: {exc}")
            continue
        for 문장, 기대 in 표본:
            try:
                결과, 지연, 입력, 출력 = 한번(모델, 문장)
            except Exception as exc:
                print(f"   실패: {type(exc).__name__}: {exc}")
                break
            지연들.append(지연)
            입력합 += 입력
            출력합 += 출력
            맞은수 += 결과.grade == 기대
            표시 = "일치" if 결과.grade == 기대 else "불일치"
            print(
                f"   {표시:4} 기대 {기대} → {결과.grade}  {지연:6.0f}ms  "
                f"in {입력:3} out {출력:3}  {결과.signals}"
            )

        if not 지연들:
            continue
        비용 = 단가(모델, 입력합, 출력합)
        총비용 += 비용
        요약.append(
            (
                모델,
                statistics.mean(지연들),
                max(지연들),
                입력합,
                출력합,
                비용 / len(지연들),
                f"{맞은수}/{len(표본)}",
            )
        )
        print()

    print("\n=== 요약 ===")
    print(f"{'모델':24} {'평균ms':>8} {'최대ms':>8} {'in':>6} {'out':>6} {'회당$':>10}  일치")
    for 모델, 평균, 최대, 입력, 출력, 회당, 일치 in 요약:
        표시 = "" if 최대 <= 1500 else "  ← 1.5초 초과"
        print(f"{모델:24} {평균:8.0f} {최대:8.0f} {입력:6} {출력:6} {회당:10.6f}  {일치}{표시}")

    print(f"\n스모크 총 비용 ≈ ${총비용:.6f}")
    누적 = await record_usd(총비용, kind="llm_smoke")
    print(f"오늘 누적(Redis) = {누적}")


if __name__ == "__main__":
    asyncio.run(main())
