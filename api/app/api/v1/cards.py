"""3. 카드 (`docs/api/Stage0.md` 3절).

**상황문은 `app/scene_cards.py` 가 문서에서 읽는다** (W2 5번). 되묻기는 이미 문서를
읽는데 카드 조회만 픽스처를 읽어, 같은 `c01` 이 화면과 되묻기에서 다른 장면이었다 —
대표 검수(`cacda91`)를 리더만 따라갔기 때문이다.

**아직 목인 것**: 「오늘 안 한 카드」 진짜 선택 · 소모 이력(W3 A0-1) · 스케치
에셋(W3 A0-3) · `guide` · `today`. `next` 는 20장 중 하나를 무작위로 고르기만 한다.
"""

import random
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import mock_daily_cap_reached, require_child
from app.errors import AppError, ErrorCode
from app.scene_cards import 모험카드들, 장면카드
from app.scene_cards import 카드 as 카드읽기
from app.schemas.stage0 import Card

router = APIRouter(prefix="/cards", tags=["cards"])

Child = Annotated[str, Depends(require_child)]


def _응답(카드: 장면카드) -> Card:
    return Card.model_validate(
        {
            "card_id": 카드.card_id,
            "type": 카드.유형코드,
            "situation": 카드.상황문,
            "prompt_label": fx.PROMPT_LABEL,
            "sketch_url": fx.sketch_url(카드.card_id),
            "guide": fx.CARD_GUIDE,
            "today": fx.TODAY,
        }
    )


@router.get("/next")
async def next_card(
    _: Child,
    소진: Annotated[bool, Depends(mock_daily_cap_reached)],
) -> Card:
    """오늘 아직 안 한 카드 중 하나. 소진 시 409 `DAILY_CAP_REACHED`.

    소진 응답에도 `guide.line`("내일 또 보자")을 담는다 — 아이가 빈 화면을 보지 않게.

    **아이별 순서·소모 이력은 아직 없다** (W3 A0-1). 지금은 20장에서 무작위다.
    """
    if 소진:
        raise AppError(
            ErrorCode.DAILY_CAP_REACHED,
            detail={
                "guide": {"expression": "session_end", "line": "오늘 모험은 여기까지! 내일 또 보자"}
            },
        )
    return _응답(random.choice(모험카드들()))


@router.get("/{card_id}")
async def get_card(card_id: str, _: Child) -> Card:
    """재시도 화면 복귀용.

    모르는 카드와 튜토리얼(T1~T3)은 404 다. 튜토리얼은 노출 경로가 따로 있다 (Stage 1 A-6).
    """
    카드 = 카드읽기(card_id)
    if 카드 is None or not 카드.유형코드:
        raise AppError(ErrorCode.NOT_FOUND)
    return _응답(카드)
