"""`adr/0015` ③ — **아이 문장이 프롬프트에 들어간 그림을 사람이 눈으로 센다.**

**재는 것 셋** (`adr/0015` ③ · PM 2026-09-15).

1. **글자 박힘** — 한글 문장이 프롬프트에 들어가 **표면이 넓어졌다.** `글자금지` 한 줄로
   막혔다고 가정하지 않는 것이 이 판단의 전부다 (`artwork.글자금지` 주석: 프롬프트로
   막기는 **두 번 실패했고 안 고치기로 확정됐다**)
2. **일치도** — **아이가 쓴 행동이 그림에 나오나.** `adr/0015` 가 고치려던 것이고
   여기가 그것을 처음 눈으로 보는 자리다
3. **가이드 일관성** — 레퍼런스가 그대로 먹히나

**⛔ 아이 원문을 쓰지 않는다.** 회차 기록에도 안 적은 것이고 `루브릭_예시셋.md` 와 같은
규칙이다 — 매 호출 프로바이더로 전송된다. **뜻이 같은 문장을 새로 지어 넣는다.**

**카드는 회차에서 어긋난 셋이다.** 고쳤다는 증거는 **같은 자리에서 제대로 나오는 한 장**이다.

**돈이 나간다** — 장당 $0.0336 곱하기 9장 = **약 $0.30**. 2026-09-15 사용자 승인.
실행: `PYTHONPATH=. uv run python scripts/bench_artwork_text.py`
**골라 뽑기**: `... bench_artwork_text.py c07:legendary c18:rare` — 프롬프트를 고치고
**몇 장만 다시 재는** 자리다. 아홉 장을 매번 다시 뽑으면 그 값이 곧 안 재는 이유가 된다.
생성물은 `benchmarks/out/` (gitignore). 문서에는 판정만 남긴다.
"""

import asyncio
import sys
from pathlib import Path

from app.artwork import 생성
from app.scene_cards import 카드

OUT = Path(__file__).resolve().parents[1] / "benchmarks" / "out" / "W6-0015"

# **회차에서 어긋난 셋** (`프리테스트_결과_2026-09-14.md` 1장).
# 문장은 **내가 지은 것**이고 아이 원문이 아니다 — 뜻만 같게 맞췄다.
재료: list[tuple[str, str, str]] = [
    (
        "c20",
        "씨앗을 땅에 심고 흙을 덮어준다",
        "「땅에 심어볼래」 → 빛나는 보석·수정이 나왔다 (아이 둘이 같은 자리)",
    ),
    (
        "c07",
        "시계탑의 큰 톱니에 막대를 끼워 바늘을 멈춘다",
        "「시계탑을 멈출래」 → 시계탑이 계속 돌았다",
    ),
    (
        "c18",
        "고양이 목걸이에 달린 열쇠를 손에 들고 자세히 들여다본다",
        "「열쇠를 확인하고 있는 건 잘 모르겠어」",
    ),
]
티어들 = ("basic", "rare", "legendary")


async def 돈다(고른것: set[tuple[str, str]] | None = None) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    잰것: list[tuple[str, str, str, float, int]] = []

    for card_id, 문장, 왜 in 재료:
        장면 = 카드(card_id)
        print(f"\n── {card_id} — {장면.상황문 if 장면 else '?'}")
        print(f"   회차: {왜}")
        print(f"   넣는 문장: {문장}")
        for tier in 티어들:
            if 고른것 is not None and (card_id, tier) not in 고른것:
                continue
            결과 = await 생성(card_id, tier, 문장)
            if 결과.image is None:
                print(f"   {tier:10} ❌ {결과.사유}")
                잰것.append((card_id, tier, 결과.사유, 결과.latency_ms, 0))
                continue
            확 = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[결과.mime]
            길 = OUT / f"{card_id}_{tier}.{확}"
            길.write_bytes(결과.image)
            print(
                f"   {tier:10} ✅ {결과.latency_ms / 1000:.1f}초 · "
                f"{len(결과.image) // 1024}KB · {길.name}"
            )
            잰것.append((card_id, tier, "", 결과.latency_ms, len(결과.image)))

    성공 = [x for x in 잰것 if not x[2]]
    평균 = sum(x[3] for x in 성공) / max(len(성공), 1) / 1000
    print(f"\n{len(성공)}/{len(잰것)} 장 · 평균 {평균:.1f}초")
    print(f"약 ${0.0336 * len(성공):.2f} · {OUT}")


if __name__ == "__main__":
    # `c07:legendary` 꼴. 없으면 아홉 장 전부.
    고름 = {tuple(인자.split(":", 1)) for 인자 in sys.argv[1:]} or None
    asyncio.run(돈다(고름))
