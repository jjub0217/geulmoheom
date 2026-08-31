"""2. 자녀 인증 (`docs/api/Stage0.md` 2절). 목 응답."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import mock_daily_cap_reached, require_child
from app.schemas.stage0 import (
    ChildAuthRequest,
    ChildAuthResponse,
    ChildIdentity,
    ChildMe,
    ChildToday,
    UpdateGuideRequest,
    UpdateGuideResponse,
)

router = APIRouter(prefix="/child", tags=["child"])

Child = Annotated[str, Depends(require_child)]


@router.post("/auth")
async def auth(payload: ChildAuthRequest) -> ChildAuthResponse:
    """접속 코드 교환. 코드는 소진 후 재사용 불가, 토큰 30일."""
    return ChildAuthResponse(
        token=fx.TOKEN,
        child=ChildIdentity(child_id=fx.CHILD_ID, nickname=fx.NICKNAME, guide_name=None),
    )


@router.get("/me")
async def me(
    _: Child,
    소진: Annotated[bool, Depends(mock_daily_cap_reached)],
) -> ChildMe:
    return ChildMe(
        child_id=fx.CHILD_ID,
        nickname=fx.NICKNAME,
        guide_name=fx.GUIDE_NAME,
        today=ChildToday(
            cards_done=5 if 소진 else 2,
            cap=5,
            locked=소진,
            resets_at=fx.tomorrow_midnight(),
        ),
    )


@router.patch("/guide")
async def rename_guide(payload: UpdateGuideRequest, _: Child) -> UpdateGuideResponse:
    """아이가 지어주는 이름. 1회. PII 검사."""
    return UpdateGuideResponse(guide_name=payload.guide_name)
