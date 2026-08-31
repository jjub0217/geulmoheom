"""6. 내 책 (`docs/api/Stage0.md` 6절). 목 응답.

`text` 는 항상 반환한다 — 아이의 책 콘텐츠다 (PRD 1.1b). 맞춤법·AI 보정 없음.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import require_child
from app.schemas.stage0 import (
    Book,
    BookCounts,
    BookPage,
    BookToday,
    UpdateBookRequest,
    UpdateBookResponse,
)

router = APIRouter(prefix="/book", tags=["book"])

Child = Annotated[str, Depends(require_child)]


def _page() -> BookPage:
    return BookPage.model_validate({**fx.PAGE, "achieved_at": fx.now()})


@router.get("")
async def get_book(_: Child) -> Book:
    """자녀 1명 = 책 1권. 카드별 최고 티어 시도 1건이 한 페이지."""
    return Book(
        book_id=fx.BOOK_ID,
        title=f"{fx.NICKNAME}의 모험",
        visibility="private",
        pages=[_page()],
        counts=BookCounts(basic=3, rare=5, legendary=2),
    )


@router.get("/today")
async def get_today(_: Child) -> BookToday:
    """세션 종료 화면용. 오늘 추가·교체된 페이지만."""
    return BookToday(pages=[_page()])


@router.patch("")
async def update_book(payload: UpdateBookRequest, _: Child) -> UpdateBookResponse:
    return UpdateBookResponse(title=payload.title)
