"""W1 6번 — 이미지 모델 벤치 (`docs/adr/0006`).

계획은 `benchmarks/W1-image-bench-plan.md`. 재는 것은 **화풍·지연·단가·일관성**이지
캐릭터 확정이 아니다.

가장 먼저 보는 것은 `adr/0006` 의 미검증 가정이다 —
**레퍼런스 이미지가 실제로 캐릭터 일관성을 주는가.** 실패하면 0006 을 되돌려야 한다.

실행: `PYTHONPATH=. uv run python scripts/bench_image.py`
생성물은 `benchmarks/out/` (gitignore). 문서에는 수치와 판정만 남긴다.
"""

import asyncio
import time
from pathlib import Path

from google.genai import types

from app.cost import record_usd
from app.llm import get_client

REPO = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parents[1] / "benchmarks" / "out"

# adr/0006. 장당 단가 (2026-09-01 확인).
후보: dict[str, float] = {
    "gemini-3.1-flash-lite-image": 0.0336,
    "gemini-3.1-flash-image": 0.067,
    "gemini-3-pro-image": 0.134,
}

# C-2 정본이 미정이라 잠정 선택. 턴어라운드 3면은 색상코드 표와 일치하고
# 스카프·고글·가방이 모두 보인다 (표정 PNG 4종은 축약본).
레퍼런스 = REPO / "docs" / "캐릭터" / "캐릭터색상코드.png"

STYLE = (
    "2D cel-shaded webtoon illustration, bold dark outlines, flat shading, "
    "warm storybook palette, no text, no watermark"
)
GUIDE = (
    "Keep the red panda explorer-scholar character in the reference image exactly "
    "consistent: same fur color, face markings, vest, scarf, scholar cap, goggles, "
    "satchel and glowing compass."
)

# 장면은 docs/장면카드_초안.md 다섯째 열 원문. 인물은 더하지 않는다.
장면 = {
    "c01": "misty forest at dusk, huge silhouette between trees, broken twig in foreground",
    "c04": (
        "giant sitting in the middle of a road crying, leaves falling from the sound, "
        "blocking the way"
    ),
}

티어 = {
    "basic": "simple flat colors, minimal background detail",
    "rare": "richer lighting, detailed background, subtle depth of field",
    "legendary": "dramatic cinematic lighting, intricate detail, painterly finish",
}

# 모델당 4장 — c01 로 티어 차이를, c04 로 장면이 바뀔 때의 외형 유지를 본다.
작업: list[tuple[str, str]] = [
    ("c01", "basic"),
    ("c01", "rare"),
    ("c01", "legendary"),
    ("c04", "legendary"),
]


def 이름(경로: Path | None) -> str:
    return 경로.name if 경로 else "이미지 없음"


def 한장(모델: str, 카드: str, 등급: str, 레퍼런스포함: bool) -> tuple[float, int, Path | None]:
    프롬프트 = f"{STYLE}. Scene: {장면[카드]}. {티어[등급]}."
    contents: list = []
    if 레퍼런스포함:
        contents.append(types.Part.from_bytes(data=레퍼런스.read_bytes(), mime_type="image/png"))
        프롬프트 = f"{프롬프트} {GUIDE}"
    contents.append(프롬프트)

    시작 = time.perf_counter()
    응답 = get_client().models.generate_content(
        model=모델,
        contents=contents,
        config=types.GenerateContentConfig(response_modalities=["IMAGE"], seed=12345),
    )
    지연 = (time.perf_counter() - 시작) * 1000

    파트 = [p for p in 응답.candidates[0].content.parts if p.inline_data]
    if not 파트:
        return 지연, 0, None

    꼬리 = "ref" if 레퍼런스포함 else "noref"
    경로 = OUT / f"{모델}__{카드}_{등급}_{꼬리}.jpg"
    경로.write_bytes(파트[0].inline_data.data)
    return 지연, 응답.usage_metadata.candidates_token_count or 0, 경로


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    총장수, 총비용 = 0, 0.0
    요약: list[tuple[str, float, float, float]] = []

    for 모델, 장당 in 후보.items():
        print(f"── {모델}  (장당 ${장당})")
        지연들 = []
        for 카드, 등급 in 작업:
            try:
                지연, 토큰, 경로 = 한장(모델, 카드, 등급, 레퍼런스포함=True)
            except Exception as exc:
                print(f"   실패 {카드}/{등급}: {type(exc).__name__}: {str(exc)[:100]}")
                continue
            지연들.append(지연)
            총장수 += 1
            print(f"   {카드} {등급:10} {지연:6.0f}ms  out {토큰:5}  → {이름(경로)}")

        # 레퍼런스 없이 한 장 — 있을 때와 비교해 일관성 효과를 본다 (adr/0006 가정 2)
        try:
            지연, _, 경로 = 한장(모델, "c01", "legendary", 레퍼런스포함=False)
            지연들.append(지연)
            총장수 += 1
            print(
                f"   c01 legendary  레퍼런스 없음  {지연:6.0f}ms  → {경로.name if 경로 else '없음'}"
            )
        except Exception as exc:
            print(f"   실패 (레퍼런스 없음): {type(exc).__name__}")

        if 지연들:
            비용 = 장당 * len(지연들)
            총비용 += 비용
            요약.append((모델, sum(지연들) / len(지연들), max(지연들), 비용))
        print()

    print("=== 요약 ===")
    print(f"{'모델':30} {'평균ms':>8} {'최대ms':>8} {'비용$':>8}")
    for 모델, 평균, 최대, 비용 in 요약:
        표시 = "" if 최대 <= 15000 else "  ← 15초 초과 (PRD 7장)"
        print(f"{모델:30} {평균:8.0f} {최대:8.0f} {비용:8.4f}{표시}")

    print(f"\n총 {총장수}장, 약 ${총비용:.4f}")
    print(f"생성물: {OUT}")
    누적 = await record_usd(총비용, kind="image_bench")
    print(f"오늘 누적(Redis) = {누적}")


if __name__ == "__main__":
    asyncio.run(main())
