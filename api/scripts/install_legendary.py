"""선정된 `legendary` 삽화를 **조합 키로 넣는다** (W5 7번 ③).

**⛔ 굽지 않는다. 0원이다.** `api/out/` 에 이미 있는 파일을 저장소(S3 또는 로컬
`.artworks/`)의 조합 키 자리로 **옮기기만** 한다. 신규 생성은
2026-09-09 에 없어졌다 (`주차계획/W5.md` 「삽화 — 기존 것 재사용 + 티어 폴백」).

**목록을 여기서 고르지 않는다.** `docs/삽화_legendary_선정.md` 가 PM 검수 결과이고
**그 문서가 SSOT** 다. **자동으로 최신 회차를 고르면 `c02` 가 틀린다** — 그 카드만
가운데 회차(`수리2차`)를 쓴다.

**키가 비밀에서 유도된다** (`storage._조각` — `JWT_SECRET`). 그래서 **넣는 환경과
서버가 도는 환경이 같아야 한다.** 비밀을 갈면 키가 전부 바뀌고 넣은 것이 통째로
안 걸린다 — 그때는 이 스크립트를 다시 돌린다. 틀리는 방향이 「못 찾아서 기본
에셋」이라 아이 화면은 안 멈춘다.

**몇 번을 돌려도 결과가 같다.** 같은 키에 덮어쓴다.

실행: `cd api && PYTHONPATH=. uv run python scripts/install_legendary.py`
"""

import asyncio
import re

from app.config import REPO_ROOT
from app.scene_cards import 모험카드들
from app.storage import 올리기, 조합찾기, 조합키

선정문서 = REPO_ROOT / "docs" / "삽화_legendary_선정.md"
원본뿌리 = REPO_ROOT / "api" / "out"

# 확장자 → mime. **`storage.확장자` 의 반대편이다** — 저장소가 아는 셋 밖은 애초에
# 키가 안 만들어지므로 여기서 걸러 낸다.
mime: dict[str, str] = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}

_카드칸 = re.compile(r"^c\d{2}$")


def 선정목록() -> dict[str, str]:
    """`{카드 id: `api/out/` 아래 상대 경로}`. **문서 표를 그대로 읽는다.**

    표의 둘째 칸이 백틱으로 감싼 경로면 그 카드는 확정이고, `⛔ 재생성` 처럼 경로가
    아니면 **쓸 수 있는 판이 없는 카드**라 빠진다 (`c10`·`c12`). 그 카드의 세 티어는
    전부 기본 에셋으로 간다 — **채우려고 굽지 않는다.**
    """
    고른것: dict[str, str] = {}
    for 줄 in 선정문서.read_text(encoding="utf-8").splitlines():
        if not 줄.lstrip().startswith("|"):
            continue
        칸 = [조각.strip().strip("*").strip() for 조각 in 줄.strip().strip("|").split("|")]
        if len(칸) < 2 or not _카드칸.match(칸[0]):
            continue
        경로 = 칸[1].strip("*").strip()
        if 경로.startswith("`") and 경로.endswith("`"):
            고른것[칸[0]] = 경로.strip("`")
    return 고른것


async def 넣기() -> list[str]:
    """넣은 카드 목록. **못 읽거나 모르는 형식이면 건너뛰고 그 사실을 찍는다.**"""
    넣은것: list[str] = []
    for 카드id, 상대 in sorted(선정목록().items()):
        원본 = 원본뿌리 / 상대
        형식 = mime.get(원본.suffix.lower())
        if 형식 is None:
            print(f"  ⛔ {카드id}: 모르는 형식이라 건너뛴다 ({원본.suffix})")
            continue
        try:
            바이트 = 원본.read_bytes()
        except OSError:
            print(f"  ⛔ {카드id}: 파일을 못 읽는다 ({상대})")
            continue

        키 = 조합키(카드id, "legendary", 형식)
        if 키 is None or await 올리기(키, 바이트, 형식) is None:
            print(f"  ⛔ {카드id}: 저장에 실패했다")
            continue
        print(f"  ✅ {카드id} ← {상대}  ({len(바이트) // 1024}KB)")
        넣은것.append(카드id)
    return 넣은것


async def 훑기() -> None:
    """**빈 조합을 보고한다** (완료 조건 ④). **채우려고 굽지 않는다** — 어느 조합이
    무엇으로 나가는지만 적는다.

    세 갈래다: **그대로**(요청 티어 파일) · **폴백**(같은 카드 `legendary`) ·
    **기본 에셋**(둘 다 없음).
    """
    그대로: list[str] = []
    폴백: list[str] = []
    기본: list[str] = []
    for 카드 in 모험카드들():
        for 티어 in ("basic", "rare", "legendary"):
            조합 = f"{카드.card_id}/{티어}"
            찾은 = await 조합찾기(카드.card_id, 티어)
            if 찾은 is None:
                기본.append(조합)
            elif 찾은.티어폴백:
                폴백.append(조합)
            else:
                그대로.append(조합)

    전체 = len(그대로) + len(폴백) + len(기본)
    print(f"\n조합 {전체}개")
    print(f"  요청 티어 그대로 : {len(그대로)}")
    print(f"  legendary 폴백  : {len(폴백)}")
    print(f"  기본 에셋       : {len(기본)}{'  ← ' + ', '.join(기본) if 기본 else ''}")


async def main() -> None:
    print(f"선정 목록: {선정문서.name}")
    넣은것 = await 넣기()
    print(f"\n{len(넣은것)}장을 조합 키로 넣었다. **굽지 않았다 — 0원이다.**")
    await 훑기()


if __name__ == "__main__":
    asyncio.run(main())
