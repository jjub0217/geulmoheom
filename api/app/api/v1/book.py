"""6. 내 책 (`docs/api/Stage0.md` 6절).

**쓰기 엔진은 수단이고 책과 독자가 목적이다** (비전 2장). 이 엔드포인트가 그 목적이
실제로 쌓이는 자리다.

`text` 는 항상 반환한다 — **아이의 책 콘텐츠**다 (PRD 1.1b). 맞춤법·AI 보정 없음.
**등급이 낮아도 똑같이 쌓인다** — 「기본」도 페이지가 된다.

**제목도 아이가 쓰는 문장이다** — `PATCH /book` 은 `POST /attempts` 와 **같은 마스킹을
지난다**. 실명이 들어오면 본문보다 눈에 더 잘 띄는 **표지**에 박힌다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.v1.deps import Session, require_child
from app.book_store import 삽화주소들, 세어보기, 책, 페이지들
from app.events import 남기기, 이벤트
from app.models import Book as BookRow
from app.models import BookPage as PageRow
from app.models import Child as ChildRow
from app.pii import 실명까지가리기
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


# **열에서 읽어 온다** (`books.title` = `String(120)`). 숫자를 여기 손으로 적으면
# 한쪽만 바뀌고, 그때 **DB 가 거절해 500** 이 난다 — 아이는 제목을 못 고친 채 오류만 본다.
제목상한: int = BookRow.title.type.length


@router.patch("")
async def update_book(
    payload: UpdateBookRequest, 아이: Child, session: Session
) -> UpdateBookResponse:
    """제목을 저장한다 (`Stage0.md` 6절 SHOULD · PII 검사).

    앞뒤 공백을 다듬고 120자에서 자른다. 빈 제목으로는 바뀌지 않고 지금 제목이
    그대로 돌아온다. 응답의 `title` 은 **실제로 저장된 값**이다.
    """
    # **이 함수의 설명은 짧게 둔다.** docstring 이 `/openapi.json` 의 `description` 으로
    # 나가고 프론트 타입까지 따라 바뀐다 — 이유는 아래 주석에 적고, 나가는 문장에는
    # **클라이언트가 알아야 할 동작만** 둔다.
    #
    # **제목도 아이가 쓰는 문장이다.** 본문과 같은 마스킹을 지난다 — 실명이 들어오면
    # **표지**에 박히고, 그 자리는 본문보다 눈에 더 잘 띈다.
    #
    # **빈 제목으로 바꾸지 않는다.** 책에서 제목을 없애는 길을 만들지 않는다. 아이가
    # 지우고 저장하면 화면에서 **되돌아간 것이 보인다.**
    #
    # **길이는 열 너비에서 자른다.** 계약에 상한이 없어 스키마로 막으면 명세가 바뀌는데
    # (`adr/0011` 잠금), 안 자르면 긴 제목이 **DB 에서 500 으로 터진다.**
    # **화면이 몇 자까지 받게 할지는 프론트·`문구.md` 몫**이고, 여기는 그 아래의 바닥이다.
    그책 = await 책(session, 아이)

    다듬은 = payload.title.strip()[:제목상한]
    if not 다듬은:
        return UpdateBookResponse(title=그책.title)

    # **본문과 같은 자리, 같은 인자다** (`app/api/v1/attempts.py`). 자녀 닉네임과 가이드
    # 이름은 서버가 아는 값이라 호출 없이 빼 준다 — 아이가 자기 이름을 제목에 써도
    # 안 가려진다.
    가려진, 가린종류 = await 실명까지가리기(다듬은, 제외=(아이.nickname, 아이.guide_name or ""))
    if 가린종류:
        # **종류만 남긴다.** 가린 값도, 몇 개였는지도 싣지 않는다 (PRD 1.1b).
        await 남기기(
            아이.id,
            *(이벤트("pii_masked", {"layer": "server", "kind": 종류}) for 종류 in 가린종류),
        )

    그책.title = 가려진
    await session.commit()
    return UpdateBookResponse(title=그책.title)
