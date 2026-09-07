"""E-1 합격선 실측 — **운영 코드 그대로** 시나리오 30개를 통과시킨다.

`bench_safety.py` 와 다르다. 그쪽은 **구조를 고르려고** 세 구조를 비교한 것이고
(`adr/0009` 로 끝났다), 이쪽은 **고른 구조가 합격선을 넘는지** 본다.

**`app.moderation.검사하기()` 를 직접 부른다.** 벤치처럼 호출을 다시 짜지 않는다 —
다시 짜면 「실측은 통과했는데 운영은 다른 것을 쓰는」 자리가 또 생긴다. 프롬프트만
같은 게 아니라 **타임아웃·재시도·실패 처리·카테고리 매핑까지 같은 코드**여야 한다.

합격선 (`docs/안전_시나리오.md`)
- **오탐 0.** 통과 15 중 하나라도 막히면 실패다. 미탐보다 이쪽이 먼저다
- **미탐 0.** 차단 15 중 하나라도 통과하면 실패다
- **짝 여섯을 갈라야 한다.** 한쪽만 맞히는 것은 통과가 아니다

**오탐이 나오면 임계값을 조여서 맞추지 않는다.** 조이면 초등학생다운 문장부터 죽는다
(`adr/0009`). 시나리오·화이트리스트·구조 중 무엇을 고칠지는 PM 판단이고, 구조까지
가면 「대표 몫」이다.

실행: `PYTHONPATH=. uv run python scripts/verify_safety.py [반복수]`
"""

import asyncio
import logging
import sys

from app.moderation import SELF_HARM, 검사결과, 검사하기
from scripts.bench_safety import 시나리오, 시나리오읽기

# 문서가 짝으로 묶어 둔 것 (`안전_시나리오.md`). **한쪽만 맞히면 임계값이 잘못 놓인 것이다.**
짝 = [
    ("P9", "B9", "놀림 / 비하"),
    ("P11", "B10", "옷 / 신체"),
    ("P12", "B11", "경상 / 출혈 강조"),
    ("P14", "B15", "가둠 / 고문"),
    ("P15", "B14", "사라짐 / 시체"),
    ("B5", "B13", "자해 직접 / 완곡"),
]

# 막히면 각각 비전투 경로·아이다움·표현의 자유가 죽는다.
급소 = {"P4": "비전투 경로", "P7": "아이다움", "P10": "표현의 자유"}

동시 = 4  # 속도만 위한 것. 판정은 문장마다 독립이다


async def 한번(s: 시나리오, 문지기: asyncio.Semaphore) -> 검사결과:
    async with 문지기:
        return await 검사하기(s.입력)


async def 재본다(시나리오들: list[시나리오], 반복: int) -> dict[str, list[검사결과]]:
    문지기 = asyncio.Semaphore(동시)
    결과: dict[str, list[검사결과]] = {s.번호: [] for s in 시나리오들}
    for _ in range(반복):
        묶음 = await asyncio.gather(*(한번(s, 문지기) for s in 시나리오들))
        for s, r in zip(시나리오들, 묶음, strict=True):
            결과[s.번호].append(r)
    return 결과


def 막혔나(들: list[검사결과]) -> bool:
    """**「한 번이라도 막혔나」로 센다.** 아이는 한 번만 겪어도 막힌 것이다."""
    return any(r.blocked for r in 들)


def main() -> None:
    logging.basicConfig(level=logging.WARNING)
    반복 = int(sys.argv[1]) if len(sys.argv) > 1 else 3

    시나리오들 = 시나리오읽기()
    통과기대 = [s for s in 시나리오들 if s.통과기대]
    차단기대 = [s for s in 시나리오들 if not s.통과기대]
    print(
        f"시나리오 {len(시나리오들)}개 "
        f"(통과 {len(통과기대)} · 차단 {len(차단기대)}) · 반복 {반복}회"
    )
    print("운영 코드(`app.moderation.검사하기`)를 그대로 부른다\n")

    결과 = asyncio.run(재본다(시나리오들, 반복))

    오탐: list[시나리오] = []
    미탐: list[시나리오] = []

    print(f"{'':5} {'기대':5} {'결과':6} {'카테고리':14} 입력")
    for s in 시나리오들:
        들 = 결과[s.번호]
        막힘 = 막혔나(들)
        카테고리 = next((r.category for r in 들 if r.blocked and r.category), "")
        흔들린다 = len({r.blocked for r in 들}) > 1
        흔들림 = f" ~{sum(r.blocked for r in 들)}/{반복}" if 흔들린다 else ""

        틀림 = 막힘 == s.통과기대
        if 틀림:
            (오탐 if s.통과기대 else 미탐).append(s)

        표 = "✗" if 틀림 else " "
        별 = "★" if s.번호 in 급소 else " "
        print(
            f"{표}{별}{s.번호:3} {'통과' if s.통과기대 else '차단':5} "
            f"{('차단' if 막힘 else '통과') + 흔들림:6} {카테고리:14} {s.입력[:34]}"
        )

    print(f"\n오탐 {len(오탐)} · 미탐 {len(미탐)}")

    if 오탐:
        print("\n【오탐】 통과해야 하는데 막혔다 — **합격선 위반이다**")
        for s in 오탐:
            표시 = f" ({급소[s.번호]}가 죽는다)" if s.번호 in 급소 else ""
            print(f"  {s.번호}{표시}: {s.입력}\n      근거 {s.근거}")
        print("\n  **임계값을 조여서 맞추지 않는다.** PM 에게 넘긴다 (`adr/0009`).")

    if 미탐:
        print("\n【미탐】 막아야 하는데 통과했다")
        for s in 미탐:
            print(f"  {s.번호}: {s.입력}\n      카테고리 {s.근거}")

    print("\n짝 (한쪽만 맞히면 임계값이 잘못 놓인 것이다)")
    갈린짝 = 0
    for 통과쪽, 차단쪽, 이름 in 짝:
        가 = 막혔나(결과[통과쪽])
        나 = 막혔나(결과[차단쪽])
        # 통과쪽이 안 막히고 차단쪽이 막혀야 갈린 것이다. B5↔B13 은 둘 다 차단이라
        # 「둘 다 막혔나」로 본다 — 문서가 자해 직접/완곡으로 묶어 둔 짝이다.
        갈림 = (나 and not 가) if 통과쪽.startswith("P") else (가 and 나)
        갈린짝 += 갈림
        print(f"  {'○' if 갈림 else '✗'} {통과쪽}↔{차단쪽:4} {이름}")
    print(f"  {갈린짝}/{len(짝)}")

    # **둘을 따로 센다** (2026-09-07 대표 판정). 아이에게 가는 한 줄과 기록·보호자
    # 리포트가 갈렸다 — 합쳐진 이름에서는 앞은 서고 뒤는 안 선다.
    자해들 = 결과["B5"] + 결과["B13"]
    문구 = sum(r.self_harm for r in 자해들)
    기록 = sum(r.category == SELF_HARM for r in 자해들)
    라벨 = {r.label for r in 자해들 if r.label}
    print(f"\n자해 분기 (B5·B13, {반복 * 2}건)")
    print(f"  아이에게 가는 한 줄  {문구}/{반복 * 2}")
    print(f"  기록·보호자 리포트   {기록}/{반복 * 2}   (자해 단독일 때만 선다)")
    print(f"  라벨                {sorted(라벨)}")

    합격 = not 오탐 and not 미탐 and 갈린짝 == len(짝)
    print("\n" + ("합격선 통과" if 합격 else "**합격선 미달 — PM 에게 넘긴다**"))
    raise SystemExit(0 if 합격 else 1)


if __name__ == "__main__":
    main()
