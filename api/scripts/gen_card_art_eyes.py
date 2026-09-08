"""카드 20장 삽화를 실제로 뽑아 **사람이 눈으로 본다** (W4 · 사용자 승인 2026-09-08).

**「성공/실패」를 세는 것이 아니다.** 실측 20% 사고는 **전부 「성공」이었다** — 생성이
끝나고 바이트도 왔다. 출력 검사(E-1)는 **프롬프트를 볼 뿐 그림은 안 본다.** 그래서
기계로 잴 수 있는 눈금이 하나도 안 걸렸고, **눈으로 보는 것 말고 방법이 없다.**

**보는 것 셋** (2026-09-08 PM · 실측 20% 가 전부 이 셋이었다)
1. **글자가 박혔는가** — 스와치 라벨(`FUR MARKINGS VEST…`)·`SIDE` 같은 것
2. **턴어라운드 3면 시트를 복제했는가** — 장면 대신 캐릭터가 나란히 선 시트
3. **가이드가 들어 있는가** — 없으면 **안전 MUST 위반**이다 (PRD B-5, 뿔 달린 실루엣 건)

**제품 코드를 그대로 태운다 — `app.artwork.생성` 하나를 부른다.**
`gen_fallback_art.py` 처럼 호출을 다시 짜지 않는다. **20% 사고가 정확히 「스크립트에는
있는데 제품에 안 넘어온 것」이었다** — 여기서 또 스크립트가 자기 경로를 만들면
**재는 대상이 제품이 아니게 되고, 그러면 이 확인 자체가 거짓말이 된다.**
그래서 조립·크롭·출력 검사·타임아웃·비용 기록이 전부 제품 것이다.

**티어는 `legendary`(G3) 하나만 뽑는다.** 셋을 다 뽑으면 $2 이고, 무엇보다 **결함이
가장 잘 드러나는 티어를 고르는 것**이 눈금으로 낫다 — 접미어가 가장 길고
(`dramatic cinematic lighting, intricate detail, painterly finish`) 레퍼런스 지시가
그만큼 밀려서, **모델이 레퍼런스 시트를 더 많이 베낀다.** 근거는 `benchmarks/W4-artwork-eyes.md`.

실행: `PYTHONPATH=. uv run python scripts/gen_card_art_eyes.py`
생성물은 `api/out/카드삽화_G3/` (gitignore). **저장소에 안 넣는다** — 20장이면 수 MB 이고,
여기서 봐야 할 것은 파일이 아니라 판정이다. 판정은 벤치 문서에 남는다.
"""

import asyncio
import time
from pathlib import Path

from app.artwork import 장당USD, 생성
from app.scene_cards import 모험카드들

OUT = Path(__file__).resolve().parents[1] / "out" / "카드삽화_G3"

# **G3 다.** `app.artwork.접미어` 의 키와 같은 값을 쓴다 — 여기 문자열을 지어내면
# 제품에 없는 티어를 뽑고도 모른다.
TIER = "legendary"

확장자 = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


async def main() -> None:
    카드들 = 모험카드들()
    # **튜토리얼 T1~T3 은 `모험카드들()` 이 이미 뺀다** — 대표 미검수라
    # 프리테스트에 안 쓰고, 그래서 여기서 볼 이유도 없다.
    print(f"카드 {len(카드들)}장 · 티어 {TIER} · 약 ${장당USD * len(카드들):.2f}\n")

    OUT.mkdir(parents=True, exist_ok=True)
    받은것 = 0
    for 장면 in 카드들:
        시작 = time.perf_counter()
        결과 = await 생성(장면.card_id, TIER)
        걸린 = time.perf_counter() - 시작

        if 결과.image is None:
            # **여기 걸리는 것도 결함이다.** 운영에서는 조용히 기본 에셋으로 가서
            # 아이에게는 그냥 그림이 나온 것으로 보인다 — 우리만 못 본다.
            print(f"{장면.card_id} [{장면.유형}] ✗ {결과.사유} ({걸린:.1f}초)")
            continue

        경로 = OUT / f"{장면.card_id}.{확장자.get(결과.mime, 'bin')}"
        경로.write_bytes(결과.image)
        받은것 += 1
        크기 = len(결과.image) // 1024
        print(f"{장면.card_id} [{장면.유형}] {경로.name} ({크기}KB, {걸린:.1f}초)")

    print(f"\n{받은것}/{len(카드들)} 장 받았다 → {OUT}")
    print("**여기서 끝이 아니다.** 받은 것을 한 장씩 눈으로 보고 셋을 판정한다 —")
    print("글자 박힘 · 턴어라운드 복제 · 가이드 유무. 판정은 benchmarks/W4-artwork-eyes.md.")


if __name__ == "__main__":
    asyncio.run(main())
