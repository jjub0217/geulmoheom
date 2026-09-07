"""2. 자녀 인증 (`docs/api/Stage0.md` 2절). 목 응답."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import mock_daily_cap_reached, require_child
from app.auth import CHILD_COOKIE, clear_auth_cookie, set_auth_cookie
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
async def auth(payload: ChildAuthRequest, response: Response) -> ChildAuthResponse:
    """접속 코드 교환. 코드는 소진 후 재사용 불가, 토큰 30일.

    **토큰은 `Set-Cookie: __Host-gm_child` 로만 나간다.** body 에 없다.
    """
    set_auth_cookie(response, CHILD_COOKIE, fx.TOKEN)
    return ChildAuthResponse(
        child=ChildIdentity(child_id=fx.CHILD_ID, nickname=fx.NICKNAME, guide_name=None),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    """가족 공용 태블릿에서 아이가 내려오는 경로다 (`Stage0.md` 2절).

    학부모 쿠키는 그대로 둔다. 인증을 요구하지 않는 이유는 `parents.logout` 과 같다.

    **접속 코드는 1회 사용이라 여기서 내려오면 재발급 없이는 못 들어온다.** 프론트가
    이 버튼을 아이 손에 쉽게 닿는 자리에 두지 않는다 — 계약이 아니라 화면 몫이다.
    """
    clear_auth_cookie(response, CHILD_COOKIE)


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
