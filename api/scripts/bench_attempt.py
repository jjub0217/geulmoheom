"""W2 2번 — `POST /attempts` **응답 전체**를 실측한다.

`benchmarks/W2-evaluator-bench.md` 가 잰 것은 **Evaluator 호출 하나**다. 아이가 기다리는 건
엔드포인트 왕복이라, 미들웨어·검증·응답 조립까지 붙은 값을 따로 잰다.
기준은 PRD 4.5 「Evaluator — 1.5초 이내」.

**TestClient 로 앱을 직접 부른다.** uvicorn·소켓 왕복(로컬 수 ms)은 빠지고 그 위는 다 들어간다.

문장은 `docs/루브릭_예시셋.md` 에서 가져온다 — **실제 아이 문장을 쓰지 않는다.**
등급마다 골고루 넣어 출력 토큰 수가 한쪽으로 쏠리지 않게 한다.

실행: `PYTHONPATH=. uv run python scripts/bench_attempt.py [등급당개수]`
"""

import statistics
import sys
import time

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.rubric import 등급들, 시스템지시, 예시셋읽기

AUTH = {"Authorization": "Bearer bench"}
한도_MS = 1500


def 문장들(등급당: int) -> list[tuple[str, str]]:
    묶음: list[tuple[str, str]] = []
    for 급 in 등급들:
        같은급 = [e for e in 예시셋읽기() if e.등급 == 급]
        묶음 += [(급, e.입력) for e in 같은급[:등급당]]
    return 묶음


def main() -> None:
    등급당 = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    설정 = get_settings()
    if not 설정.evaluator_model.strip():
        raise SystemExit("EVALUATOR_MODEL 이 비어 있다. 이 상태면 폴백만 재게 된다 (.env)")

    print(f"모델 {설정.evaluator_model} · 시스템 지시 {len(시스템지시())}자")

    지연: list[float] = []
    폴백 = 0
    with TestClient(create_app()) as client:
        for 기대, 문장 in 문장들(등급당):
            시작 = time.perf_counter()
            응답 = client.post(
                "/api/v1/attempts",
                headers=AUTH,
                json={"card_id": "c01", "text": 문장},
            )
            걸림 = (time.perf_counter() - 시작) * 1000
            본문 = 응답.json()
            지연.append(걸림)
            # 폴백이면 G1(basic) 이 나온다. 티어만으로는 못 가르니 로그(eval_fallback)를 함께 본다.
            폴백 += 1 if 응답.status_code != 200 else 0
            넘음 = " ←1.5초 초과" if 걸림 > 한도_MS else ""
            print(
                f"  {기대} → {본문.get('tier', 응답.status_code):<9} "
                f"{걸림:6.0f}ms  묘사어 {len(본문.get('highlights', []))}개{넘음}"
            )

    넘은수 = sum(1 for d in 지연 if d > 한도_MS)
    print(
        f"\n평균 {statistics.mean(지연):.0f}ms · 중앙 {statistics.median(지연):.0f}ms · "
        f"최대 {max(지연):.0f}ms · 1.5초 초과 {넘은수}/{len(지연)}"
    )
    if 넘은수:
        print("← 초과가 있다. 어느 프롬프트 크기에서 넘었는지 benchmarks/ 에 적는다")
    if 폴백:
        print(f"← 200 이 아닌 응답 {폴백}건. 폴백만 잰 값은 근거가 못 된다")


if __name__ == "__main__":
    main()
