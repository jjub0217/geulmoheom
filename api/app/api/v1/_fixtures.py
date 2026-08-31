"""목 서버가 돌려주는 고정 값.

한곳에 모아 둔다 — 실제 구현이 들어오면 **이 파일만 지우면 된다.**
장면·대사는 `docs/장면카드_초안.md` 와 `docs/api/Stage0.md` 예시를 따랐다.
"""

from datetime import UTC, datetime, timedelta

R2 = "https://r2.example/geulmoheom"

PARENT_ID = "8f1c2d3e-0000-4000-8000-000000000001"
CHILD_ID = "8f1c2d3e-0000-4000-8000-000000000002"
ATTEMPT_ID = "8f1c2d3e-0000-4000-8000-000000000003"
ARTWORK_ID = "8f1c2d3e-0000-4000-8000-000000000004"
BOOK_ID = "8f1c2d3e-0000-4000-8000-000000000005"

TOKEN = "mock-token-목서버-실제-서명-아님"
NICKNAME = "불꽃탐험가"
GUIDE_NAME = "나침이"


def now() -> datetime:
    return datetime.now(UTC)


def tomorrow_midnight() -> datetime:
    return (now() + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


CARD = {
    "card_id": "c01",
    "type": "crisis",
    "situation": (
        "안개 낀 숲에서 나무 사이로 거대한 그림자가 천천히 다가온다. "
        "발밑에서 나뭇가지가 툭 부러진다."
    ),
    "prompt_label": "탐험가는 어떻게 할까?",
    "sketch_url": f"{R2}/cards/c01_sketch.webp",
    "guide": {
        "expression": "default",
        "line": "나침반이 조용하네. 네가 뭘 할지 말해주면 움직일 거야!",
    },
    "today": {"cards_done": 2, "cap": 5},
}

PAGE = {
    "page_no": 1,
    "source": "card",
    "source_id": "c01",
    "tier": "legendary",
    "artwork_url": f"{R2}/artworks/{ARTWORK_ID}.webp",
    "text": "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다",
}
