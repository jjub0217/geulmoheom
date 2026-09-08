"""장면 카드를 DB 에 뿌린다 (A0-1). **정본은 `docs/장면카드_초안.md` 다.**

**배포마다 돈다.** 대표 검수로 문서가 바뀌면(`cacda91` 에서 6장) 그다음 배포에
따라와야 하고, 안 따라오면 **DB 가 옛말을 하고 그 옛말이 아이에게 나간다.**

몇 번을 돌려도 결과가 같다 — `app/card_store.py` 의 `씨뿌리기()` 가 덮어쓴다.
문서에서 빠진 카드는 지운다. **이미 아이가 쓴 카드는 FK 가 막아 여기서 터진다** —
그때는 지우는 것이 아니라 사람이 판단할 일이다.

실행: `make seed` (또는 `cd api && PYTHONPATH=. uv run python scripts/seed_cards.py`)
"""

import asyncio

from app import db
from app.card_store import 씨뿌리기


async def main() -> None:
    async with db.SessionLocal() as session:
        수 = await 씨뿌리기(session)
    # 카드 본문은 안 찍는다 — 검수 중인 문장이고, 로그에 남길 이유가 없다.
    print(f"장면 카드 {수}장을 뿌렸다")


if __name__ == "__main__":
    asyncio.run(main())
