"""`/api/v1` 라우터. 엔드포인트는 `docs/api/Stage0.md` 를 따른다.

**지금은 목 응답이다** — 고정 값을 돌려준다 (`_fixtures.py`). 프론트가 백엔드를
기다리지 않고 화면을 만들 수 있게 하는 것이 목적이다 (W1 계획 3번).
스키마(`app/schemas/stage0.py`)는 실구현에서도 그대로 쓴다.
"""

from fastapi import APIRouter

from app.api.v1 import artworks, attempts, book, cards, child, events, parents, stage1

router = APIRouter()

for _sub in (parents, child, cards, attempts, artworks, book, events):
    router.include_router(_sub.router)

# **Stage 1 은 라우터가 둘이다** — `prefix` 가 `/chapters` 와 `/turns` 로 갈린다.
# **엔드포인트를 안 가르는 것은 턴 쪽 이야기다**(`Stage1.md` 2절: 선택지든 자유
# 묘사든 `POST /turns` 한 자리) — 챕터와 턴은 서로 다른 자원이라 접두사가 다르다.
router.include_router(stage1.router)
router.include_router(stage1.턴라우터)
