"""1. 학부모 (`docs/api/Stage0.md` 1절). 목 응답."""

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import require_parent
from app.schemas.stage0 import (
    AccessCode,
    CreateChildRequest,
    CreateChildResponse,
    LoginRequest,
    ParentMe,
    SignupRequest,
    SignupResponse,
    TokenResponse,
    UpdateChildRequest,
    UpdateChildResponse,
)

router = APIRouter(prefix="/parents", tags=["parents"])

Parent = Annotated[str, Depends(require_parent)]


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest) -> SignupResponse:
    """`consent: true` 가 아니면 422 (스키마가 아니라 서버 규칙이라 실구현에서 검사한다)."""
    return SignupResponse(parent_id=fx.PARENT_ID, token=fx.TOKEN, consent_at=fx.now())


@router.post("/login")
async def login(payload: LoginRequest) -> TokenResponse:
    return TokenResponse(token=fx.TOKEN)


@router.get("/me")
async def me(_: Parent) -> ParentMe:
    """성장 데이터·등급·입력 내용은 반환하지 않는다 (P1 대시보드 범위)."""
    return ParentMe(
        parent_id=fx.PARENT_ID,
        email="parent@example.com",
        consent_at=fx.now(),
        children=[
            {
                "child_id": fx.CHILD_ID,
                "nickname": fx.NICKNAME,
                "age_band": 11,
                "daily_cap": 5,
                "played_today": True,
                "last_active_at": fx.now(),
            }
        ],
    )


@router.post("/children", status_code=status.HTTP_201_CREATED)
async def create_child(payload: CreateChildRequest, _: Parent) -> CreateChildResponse:
    return CreateChildResponse(
        child_id=fx.CHILD_ID,
        nickname=payload.nickname,
        access_code="482913",
        access_code_expires_at=fx.tomorrow_midnight(),
    )


@router.post("/children/{child_id}/access-code")
async def reissue_access_code(child_id: str, _: Parent) -> AccessCode:
    return AccessCode(access_code="731046", access_code_expires_at=fx.tomorrow_midnight())


@router.patch("/children/{child_id}")
async def update_child(
    child_id: str, payload: UpdateChildRequest, _: Parent
) -> UpdateChildResponse:
    return UpdateChildResponse(daily_cap=payload.daily_cap)


@router.delete("/children/{child_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_child(child_id: str, _: Parent) -> None:
    """자녀 데이터 즉시 파기 — attempts, books, artworks, events, Redis."""
    return None
