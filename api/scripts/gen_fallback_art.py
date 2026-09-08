"""기본 삽화(`fallback`) 후보를 뽑는다 — 사양은 `docs/장면카드_초안.md` 「기본 삽화 1장」.

**생성이 실패했을 때 아이에게 나가는 그림 한 장**을 고르기 위한 후보 생성이다.
`app/artwork.py` 의 조립·레퍼런스·출력 검사를 **그대로** 쓴다 — 화풍이 카드 삽화와
갈리면 아이가 알아보고, 그러면 **주소를 한 개로 통일한 것이 무의미해진다.**

**티어 접미어를 붙이지 않는다.** 폴백은 등급과 무관한데 접미어가 붙으면
**G3 를 쓴 아이가 `basic` 삽화를 받아 잘못된 등급 신호를 읽는다.**

**시드만 바꿔 열 장.** `app/artwork.py` 는 재생성이 「다른 그림」이 되지 않게 시드를
고정하는데, 여기서는 **고르려고 뽑는 것**이라 반대로 흔들어야 한다.

실행: `PYTHONPATH=. uv run python scripts/gen_fallback_art.py`
생성물은 `api/out/기본삽화/` (gitignore). 고른 한 장만 `app/assets/기본삽화.png` 로 옮긴다.
"""

import asyncio
import time
from pathlib import Path

from google.genai import types

from app.artwork import GUIDE, STYLE, 장당USD, _설정된모델, 내보내도되나, 레퍼런스바이트
from app.cost import record_usd

OUT = Path(__file__).resolve().parents[1] / "out" / "기본삽화"

# PM 사양 (2026-09-08). **특정 장면이 아니어야 한다** — 카드 20장 어디에 붙어도
# 어긋나지 않아야 하고 위기·발견·만남 셋을 다 받는다. 그래서 「길이 열리는 순간」이다.
# **새벽·따뜻한 빛이고 기호가 없다** — 어둡거나 비었거나 물음표·자물쇠가 들어가면
# 아이가 자기 문장이 부족했다고 읽는다.
장면 = (
    "misty trail opening ahead at dawn, soft warm light between tall trees, "
    "small glowing compass floating in the foreground, no path markers, no text"
)

시드들 = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111]


async def main() -> None:
    모델 = _설정된모델()
    if not 모델:
        raise SystemExit("IMAGE_MODEL 이 비어 있다 (.env)")

    레퍼런스 = 레퍼런스바이트()
    if 레퍼런스 is None:
        # **가이드 없이 대신 만들지 않는다** — 안전 사유다 (PRD B-5).
        raise SystemExit("가이드 레퍼런스 이미지를 못 읽었다")

    프롬프트문 = f"{STYLE}. Scene: {장면}. {GUIDE}"

    # **출력 검사가 생성보다 먼저다** (E-1 양방향). 카드 삽화와 같은 순서다.
    if (await 내보내도되나(프롬프트문)).blocked:
        raise SystemExit("프롬프트가 출력 검사에서 막혔다")

    OUT.mkdir(parents=True, exist_ok=True)
    from app.llm import get_client

    for 시드 in 시드들:
        시작 = time.perf_counter()
        응답 = await get_client().aio.models.generate_content(
            model=모델,
            contents=[
                types.Part.from_bytes(data=레퍼런스, mime_type="image/png"),
                프롬프트문,
            ],
            config=types.GenerateContentConfig(response_modalities=["IMAGE"], seed=시드),
        )
        await record_usd(장당USD, kind="image")

        파트 = [p for p in 응답.candidates[0].content.parts if p.inline_data]
        if not 파트:
            print(f"seed {시드}: 이미지가 안 왔다")
            continue

        안 = 파트[0].inline_data
        확장자 = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(
            안.mime_type or "", "bin"
        )
        경로 = OUT / f"fallback-{시드:03d}.{확장자}"
        경로.write_bytes(안.data)
        걸린 = time.perf_counter() - 시작
        print(f"seed {시드}: {경로.name} ({len(안.data) // 1024}KB, {걸린:.1f}초)")

    print(f"\n총 {len(시드들)}장 · 약 ${장당USD * len(시드들):.2f}\n→ {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
