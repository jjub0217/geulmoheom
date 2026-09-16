"""W7 1번 — GM 스토리 엔진 유료 실측 (A-1 · `docs/주차계획/W7.md`).

**공짜로 갈릴 것은 이미 다 갈렸다** (검사 21+18개 · Evaluator 가 같은 모델로
`response_schema` 를 쓴다는 실측). **유료로만 갈리는 것 둘만 잰다.**

1. **모델이 지시를 실제로 지키나** — 자수 150~300 · 선택지 2~3개 · 경로 이름 안 쓰기 ·
   입력의 명사를 되받기 · 반말 · 금지어 없음
2. **완료 8초 안에 오나** — **합격선은 `MVP_PRD.md` 7장의 「완료 8초」다.**
   `W7.md` 99행의 「12초」는 실행 층이라 층위로 PRD 가 이긴다. `gm.TIMEOUT_SECONDS`
   12초는 **우리 타임아웃**이지 기준이 아니다

**⛔ 호출은 한 번이다** (2026-09-16 사용자가 그은 선 · PM 판정 `029d0cd`).
**그 한 번을 6턴 `approach` 에 쓴다** — 시련 4경로 조건이 섞여 **프롬프트가 제일 길고
지연 최악치가 거기**다. **6턴이 통과하면 1턴은 대체로 통과한다. 반대는 아니다.**

**⛔ 첫 토큰 3초(PRD 7장)는 이 회차에 못 잰다** — `app/gm.py` 가 비스트리밍
`generate_content` 이고 **`adr/0005` 82행이 그 경우를 이미 적어 뒀다.**

**⛔ 출력 검사(E-1)를 안 태운다** — `검사하기()` 가 **또 하나의 유료 호출**이라
「한 번」을 깬다. 검사가 붙는다는 것은 `tests/test_gm.py` 가 이미 세워 뒀다.

**프롬프트를 여기서 짜지 않는다** — `app.gm.시스템지시()` · `턴프롬프트()` 를 그대로
부른다. 운영과 벤치가 다른 프롬프트를 쓰면 **여기서 잰 수치가 근거를 잃는다**
(`bench_evaluator.py` 와 같은 규칙).

**⛔ 아이 문장을 넣지 않는다** — 아래 입력은 **지어낸 것**이다 (`루브릭_예시셋.md` 와
같은 이유: 매 호출 프로바이더로 간다).

실행: `PYTHONPATH=. uv run python scripts/bench_gm.py`
"""

import asyncio
import json
import time

from google.genai import types

from app import chapter_skeleton as 뼈대
from app.cost import record_usd
from app.gm import GM출력, _금지어걸림, 서사_최대, 서사_최소, 시스템지시, 턴프롬프트
from app.llm import get_client

# `bench_evaluator.py` 와 같은 표 (1M 토큰당 USD).
단가_입력, 단가_출력 = 0.25, 1.50

합격선_ms = 8000.0  # PRD 7장 「완료 8초」
턴 = 6  # `approach` — **시련 조건이 프롬프트에 붙기 시작하는 첫 턴** (시련 비트 자체는 9턴)

상태: dict[str, object] = {
    "hero": {"hp": 3, "items": ["멈춘 태엽 조각", "이끼 묻은 손수건"]},
    "location": "시계탑 3층 톱니방",
}
요약 = (
    "마을 시계가 거꾸로 돌기 시작했다. 탐험가는 시계탑에 들어와 3층까지 올라왔고,"
    " 톱니 소리가 한 박자씩 어긋나는 것을 알아챘다."
)
최근 = [
    {"input": "이끼 낀 돌계단을 한 칸씩 올라가며 톱니 소리를 들어본다", "grade": "G2"},
    {"input": "손수건으로 먼지를 닦아 벽에 새겨진 글씨를 읽는다", "grade": "G3"},
]
# **지어낸 문장이다.** 돌봄·관찰이 섞이게 두었다 — 경로를 섞어 낸다는 지시가
# 실제로 지켜지는지 보려면 입력부터 한 경로에 딱 맞지 않아야 한다.
아이입력 = (
    "톱니 사이에 뭔가 끼어 있는 것 같아서 외투 끈을 풀어 살살 걸어 당겨보며"
    " 톱니가 다시 돌기 전에 빼내려 한다"
)
등급, 보너스 = "G2", 1


def 한번(모델: str, 지시: str, 프롬프트: str):
    """(출력, 지연ms, 입력토큰, 출력토큰, 생각토큰)."""
    시작 = time.perf_counter()
    응답 = get_client().models.generate_content(
        model=모델,
        contents=프롬프트,
        config=types.GenerateContentConfig(
            system_instruction=지시,
            response_mime_type="application/json",
            response_schema=GM출력,
            # **운영과 같게 끈다** (`app/gm.py`). 켜 두면 생각 토큰이 지연에 붙는다.
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    지연 = (time.perf_counter() - 시작) * 1000
    사용 = 응답.usage_metadata
    return (
        GM출력.model_validate_json(응답.text or ""),
        지연,
        사용.prompt_token_count or 0,
        사용.candidates_token_count or 0,
        사용.thoughts_token_count or 0,
    )


def 지시를_지켰나(출력: GM출력) -> list[tuple[bool, str]]:
    """**나온 글로만 판정한다.** 여기서 고치거나 다시 부르지 않는다."""
    글 = 출력.narrative
    라벨 = " / ".join(고른.label for 고른 in 출력.choices)
    # **「힘」은 판정에서 뺀다** — 한 글자라 「힘을 준다」처럼 낱말로 쓰인 것과
    # 경로 이름을 흘린 것이 구분되지 않는다. 대신 참고로 찍는다.
    경로이름 = [길.이름 for 길 in 뼈대.경로들() if len(길.이름) > 1]
    경로이름 += [길.code for 길 in 뼈대.경로들()]
    샌경로 = [이름 for 이름 in 경로이름 if 이름 in 글 or 이름 in 라벨]
    되받음 = [낱말 for 낱말 in ("톱니", "외투", "끈") if 낱말 in 글]

    return [
        (서사_최소 <= len(글) <= 서사_최대, f"자수 {len(글)}자 (지시 {서사_최소}~{서사_최대})"),
        (2 <= len(출력.choices) <= 3, f"선택지 {len(출력.choices)}개 (지시 2~3)"),
        (not 샌경로, f"경로 이름 노출 {샌경로 or '없다'}"),
        (len(되받음) >= 2, f"입력 낱말 되받음 {되받음}"),
        (not _금지어걸림(출력), f"금지어 {_금지어걸림(출력) or '없다'}"),
        ("보스" not in 글 and "보스" not in 라벨, "「보스」 없다"),
        ("니다" not in 글 and "세요" not in 글, "반말 (존댓말 어미 없다)"),
    ]


async def main() -> None:
    from app.gm import _설정된모델

    모델 = _설정된모델()
    지시 = 시스템지시()
    프롬프트 = 턴프롬프트(
        턴=턴,
        상태=상태,
        아이입력=아이입력,
        등급=등급,
        보너스=보너스,
        요약=요약,
        최근=최근,
    )

    print(f"모델 {모델} · thinking 끔 · 호출 1회 (6턴 approach)")
    들어갔나 = 뼈대.시련조건을_보여주나(턴)
    print(f"시련 조건이 프롬프트에 들어갔나: {들어갔나}  (시련 비트 {뼈대.시련턴}턴)")
    print(f"지시 {len(지시)}자 · 프롬프트 {len(프롬프트)}자")
    print(
        f"합격선 완료 {합격선_ms / 1000:.0f}초 (PRD 7장) · 첫 토큰 3초는 비스트리밍이라 못 잰다\n"
    )

    try:
        출력, 지연, 입력토큰, 출력토큰, 생각토큰 = 한번(모델, 지시, 프롬프트)
    except Exception as exc:  # 벤치라 그대로 보여준다
        print(f"실패: {type(exc).__name__}: {str(exc)[:300]}")
        return

    비용 = 입력토큰 / 1e6 * 단가_입력 + (출력토큰 + 생각토큰) / 1e6 * 단가_출력
    print(f"지연 {지연:.0f}ms  {'✅ 8초 안' if 지연 <= 합격선_ms else '⛔ 8초 초과'}")
    print(f"토큰 입력 {입력토큰} · 출력 {출력토큰} · 생각 {생각토큰} · 회당 ${비용:.6f}\n")

    for 통과, 말 in 지시를_지켰나(출력):
        print(f"  {'✅' if 통과 else '⛔'} {말}")

    print(
        f"\n  · 참고 — 「힘」 낱말 쓰임: {'있다' if '힘' in 출력.narrative else '없다'}"
        " (한 글자라 경로 이름 노출과 구분되지 않아 판정에서 뺐다)"
    )
    print(f"\n[서사]\n{출력.narrative}\n")
    for 고른 in 출력.choices:
        print(f"  - ({고른.id}) {고른.label}")
    print(f"\nis_key_scene={출력.is_key_scene} · scene_prompt_hint={출력.scene_prompt_hint!r}")
    print(f"\n원본 JSON\n{json.dumps(출력.model_dump(), ensure_ascii=False, indent=2)}")

    누적 = await record_usd(비용, kind="gm_bench")
    print(f"\n총 ${비용:.6f} · 오늘 누적(Redis) = {누적}")


if __name__ == "__main__":
    asyncio.run(main())
