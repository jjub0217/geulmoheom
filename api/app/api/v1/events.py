"""7. 이벤트 (`docs/api/Stage0.md` 7절). 목 응답.

클라이언트만 아는 이벤트를 배치로 받는다. **원문 필드 없음** — 스키마가 막는다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.v1.deps import require_child
from app.schemas.stage0 import EventBatch

router = APIRouter(prefix="/events", tags=["events"])

Child = Annotated[str, Depends(require_child)]


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def collect(payload: EventBatch, _: Child) -> None:
    """최대 50건. 목 서버는 받기만 하고 버린다."""
    return None
