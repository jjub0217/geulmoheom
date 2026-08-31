"""`/api/v1` 라우터. 엔드포인트는 `docs/api/Stage0.md` 를 따른다.

**지금은 목 응답이다** — 고정 값을 돌려준다 (`_fixtures.py`). 프론트가 백엔드를
기다리지 않고 화면을 만들 수 있게 하는 것이 목적이다 (W1 계획 3번).
스키마(`app/schemas/stage0.py`)는 실구현에서도 그대로 쓴다.
"""

from fastapi import APIRouter

from app.api.v1 import artworks, attempts, book, cards, child, events, parents

router = APIRouter()

for _sub in (parents, child, cards, attempts, artworks, book, events):
    router.include_router(_sub.router)
