"""공통 의존성 — 누가 부르는지 확인하고, 쿠키 수명을 밀어 준다.

**목이 아니다** (2026-09-07, E-3). 서명을 검증하고 `children.token_version` 을
DB 와 대조한다. 어디서 읽는지는 미결 11-2 확정본 그대로다 — HttpOnly 쿠키이고
`Authorization: Bearer` 를 쓰지 않는다 (`공통규약.md` 「인증 쿠키」).

**세 가지가 여기서 갈린다.**

1. 쿠키가 없으면 401, **다른 역할의 것만 있으면 403** — 가족 태블릿에는 두 쿠키가
   동시에 앉아 있다
2. 자녀는 `token_version` 이 DB 와 다르면 401 — **폐기가 실제로 작동하는 자리**다
3. 발급된 지 12시간이 지났으면 쿠키를 다시 굽는다 (`공통규약.md` 「수명」).
   **JWT `exp` 는 안 늘린다** — 늘리는 것은 쿠키 `Max-Age` 뿐이다
"""

from typing import Annotated, Literal

from fastapi import Depends, Header, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import tokens
from app.auth import CHILD_COOKIE, PARENT_COOKIE, set_auth_cookie
from app.db import get_session
from app.errors import AppError, ErrorCode
from app.models import Child, Parent

MockOutcome = Literal["result", "scaffold", "blocked"]

Session = Annotated[AsyncSession, Depends(get_session)]


def _쿠키(request: Request, 이름: str, 다른역할: str) -> str:
    """이 역할의 쿠키를 꺼낸다. 없으면 401, **다른 역할의 것만 있으면 403**이다.

    두 이름을 나눈 이유가 여기서 값을 한다 — 자녀 쿠키로 학부모 API 를 부른 것을
    401 로 돌려주면 프론트가 「로그인이 풀렸다」로 읽고 다시 로그인시킨다. 그건
    역할 문제지 인증 문제가 아니다 (`공통규약.md` 오류 표 `FORBIDDEN_ROLE`).
    """
    값 = request.cookies.get(이름)
    if 값:
        return 값
    if request.cookies.get(다른역할):
        raise AppError(ErrorCode.FORBIDDEN_ROLE)
    raise AppError(ErrorCode.UNAUTHORIZED)


async def require_parent(request: Request, response: Response, session: Session) -> Parent:
    """학부모 토큰을 검증하고 그 행을 돌려준다."""
    원문 = _쿠키(request, PARENT_COOKIE, CHILD_COOKIE)
    주장 = _검증(원문, "parent")

    학부모 = await session.get(Parent, 주장.subject)
    if 학부모 is None:
        # 서명은 맞는데 행이 없다 — 계정이 지워졌다. 401 이다.
        raise AppError(ErrorCode.UNAUTHORIZED)

    _수명밀기(response, PARENT_COOKIE, 원문, 주장)
    return 학부모


async def require_child(request: Request, response: Response, session: Session) -> Child:
    """자녀 토큰을 검증하고 그 행을 돌려준다. **`token_version` 을 여기서 대조한다.**"""
    원문 = _쿠키(request, CHILD_COOKIE, PARENT_COOKIE)
    주장 = _검증(원문, "child")

    아이 = await session.scalar(select(Child).where(Child.id == 주장.subject))
    if 아이 is None:
        raise AppError(ErrorCode.UNAUTHORIZED)

    # **폐기.** 접속 코드를 다시 발급하거나 자녀를 지우면 이 값이 올라가고, 그 한 번으로
    # 남아 있는 모든 기기가 여기서 끊긴다 (`공통규약.md` 「폐기」). JWT 는 회수할 수
    # 없으므로 **매 요청 대조하는 이 줄이 유일한 회수 수단**이다.
    if 주장.token_version != 아이.token_version:
        raise AppError(ErrorCode.UNAUTHORIZED)

    _수명밀기(response, CHILD_COOKIE, 원문, 주장)
    return 아이


def _검증(원문: str, 역할: tokens.Role) -> tokens.Claims:
    """`TokenError` 를 401 로 바꾼다. **왜 틀렸는지는 밖으로 안 나간다.**"""
    try:
        return tokens.verify(원문, expected_role=역할)
    except tokens.TokenError as exc:
        raise AppError(ErrorCode.UNAUTHORIZED) from exc


def _수명밀기(response: Response, 이름: str, 원문: str, 주장: tokens.Claims) -> None:
    """쿠키를 **절대 만료까지 남은 시간**으로 다시 굽는다 (`공통규약.md` 「수명」).

    **토큰은 그대로다.** 같은 문자열을 `Max-Age` 만 바꿔 다시 내려보낸다 — 새로
    발급하면 `exp` 가 밀려 「절대 30일」이 무너진다.

    **왜 필요한가** — Safari 16.4+ 는 서브리소스 응답의 `Set-Cookie` 를 7일로 깎을 수
    있다. 다시 구우면 아이가 7일에 한 번만 들어와도 만료가 계속 밀린다. 매 요청이
    아니라 12시간에 한 번인 이유는 `app/tokens.py` `REFRESH_AFTER` 에 있다.

    **남은 시간이 없으면 굽지 않는다.** `Max-Age` 가 0 이하면 브라우저는 그것을
    삭제로 읽어, 만료 직전 요청 하나가 아이를 그 자리에서 로그아웃시킨다.
    """
    if not 주장.다시구울때인가:
        return

    남음 = int(주장.남은수명.total_seconds())
    if 남음 <= 0:
        return

    set_auth_cookie(response, 이름, 원문, max_age=남음)


async def mock_outcome(
    x_mock_outcome: Annotated[
        MockOutcome | None,
        Header(description="**목 서버 전용.** outcome 3분기를 강제한다. 실서버에는 없다"),
    ] = None,
) -> MockOutcome | None:
    """헤더가 없으면 `None` — **실제 판정 경로로 간다.**

    W2 2번에서 기본값 `"result"` 를 걷어냈다. 프론트 화면 작업(W3)이 아직 이 헤더로
    3분기를 강제하므로 **헤더 자체는 남긴다.**
    """
    return x_mock_outcome


async def mock_daily_cap_reached(
    x_mock_error: Annotated[
        Literal["DAILY_CAP_REACHED"] | None,
        Header(description="**목 서버 전용.** 일일 상한 소진 상태를 강제한다. 실서버에는 없다"),
    ] = None,
) -> bool:
    return x_mock_error == "DAILY_CAP_REACHED"
