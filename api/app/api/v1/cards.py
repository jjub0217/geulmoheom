"""3. 카드 (`docs/api/Stage0.md` 3절). 목 응답."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import mock_daily_cap_reached, require_child
from app.errors import AppError, ErrorCode
from app.schemas.stage0 import Card

router = APIRouter(prefix="/cards", tags=["cards"])

Child = Annotated[str, Depends(require_child)]


@router.get("/next")
async def next_card(
    _: Child,
    소진: Annotated[bool, Depends(mock_daily_cap_reached)],
) -> Card:
    """오늘 아직 안 한 카드 중 하나. 소진 시 409 `DAILY_CAP_REACHED`.

    소진 응답에도 `guide.line`("내일 또 보자")을 담는다 — 아이가 빈 화면을 보지 않게.
    """
    if 소진:
        raise AppError(
            ErrorCode.DAILY_CAP_REACHED,
            detail={
                "guide": {"expression": "session_end", "line": "오늘 모험은 여기까지! 내일 또 보자"}
            },
        )
    return Card.model_validate(fx.CARD)


@router.get("/{card_id}")
async def get_card(card_id: str, _: Child) -> Card:
    """재시도 화면 복귀용."""
    return Card.model_validate({**fx.CARD, "card_id": card_id})
