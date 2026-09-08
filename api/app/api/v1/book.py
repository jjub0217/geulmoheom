"""6. 내 책 (`docs/api/Stage0.md` 6절).

**쓰기 엔진은 수단이고 책과 독자가 목적이다** (비전 2장). 이 엔드포인트가 그 목적이
실제로 쌓이는 자리다.

`text` 는 항상 반환한다 — **아이의 책 콘텐츠**다 (PRD 1.1b). 맞춤법·AI 보정 없음.
**등급이 낮아도 똑같이 쌓인다** — 「기본」도 페이지가 된다.

**아직 목인 것**: `PATCH /book` 의 제목 저장(SHOULD · PII 검사가 함께 붙는 자리다).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.v1.deps import Session, require_child
from app.book_store import 삽화주소들, 세어보기, 책, 페이지들
from app.models import BookPage as PageRow
from app.models import Child as ChildRow
from app.schemas.stage0 import (
    Book,
    BookCounts,
    BookPage,
    BookToday,
    UpdateBookRequest,
    UpdateBookResponse,
)

router = APIRouter(prefix="/book", tags=["book"])

# `require_child` 는 검증된 `children` 행을 준다 (E-3). 예전에는 토큰 문자열이었다.
Child = Annotated[ChildRow, Depends(require_child)]


def _page(행: PageRow, 삽화주소: str | None) -> BookPage:
    return BookPage(
        page_no=행.page_no,
        source=행.source,
        source_id=행.source_id,
        tier=행.tier,
        # **저장소 주소가 아니라 우리 프록시 주소다** (미결 11-7). 굽는 중이면 `None` —
        # 미리 주면 프론트가 깨진 이미지를 그린다.
        artwork_url=삽화주소,
        text=행.text,
        achieved_at=행.achieved_at,
    )


async def _펼치기(
    session: Session, 아이: ChildRow, request: Request, *, 오늘만: bool = False
) -> tuple[object, list[BookPage]]:
    그책 = await 책(session, 아이)
    행들 = await 페이지들(session, 그책.id, 오늘만=오늘만)

    def 주소만들기(artwork_id: str) -> str:
        return str(request.url_for("get_artwork_image", artwork_id=artwork_id))

    주소 = await 삽화주소들(session, 행들, 주소만들기)
    return 그책, [_page(행, 주소.get(행.id)) for 행 in 행들]


@router.get("")
async def get_book(아이: Child, session: Session, request: Request) -> Book:
    """자녀 1명 = 책 1권. 카드별 최고 티어 시도 1건이 한 페이지.

    **빈 책은 오류가 아니다** — 처음 들어온 아이는 아직 아무것도 안 썼을 뿐이다.
    """
    그책, 페이지 = await _펼치기(session, 아이, request)

    return Book(
        book_id=str(그책.id),
        title=그책.title,
        # Stage 0 에서는 항상 `private`. 필드만 선반영이다 (P1 공유 서재).
        visibility=그책.visibility,
        pages=페이지,
        counts=BookCounts(**await 세어보기(session, 그책.id)),
    )


@router.get("/today")
async def get_today(아이: Child, session: Session, request: Request) -> BookToday:
    """세션 종료 화면용. 오늘 추가·교체된 페이지만.

    **일일 상한에 닿았을 때 아이가 보는 화면이다** (A0-5) — 「오늘 쓴 건 네 책에
    다 있어」(`문구.md` 1.10)가 가리키는 것이 이 목록이다.
    """
    _, 페이지 = await _펼치기(session, 아이, request, 오늘만=True)
    return BookToday(pages=페이지)


@router.patch("")
async def update_book(payload: UpdateBookRequest, _: Child) -> UpdateBookResponse:
    """**아직 저장하지 않는다.** 제목은 아이가 쓰는 문장이라 **PII 검사가 함께 붙어야**
    하고(`Stage0.md` 6절 SHOULD), 그 자리를 따로 세운다."""
    return UpdateBookResponse(title=payload.title)
