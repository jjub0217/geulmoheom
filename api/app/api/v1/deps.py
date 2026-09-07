"""공통 의존성.

**목 서버 단계다.** 토큰은 존재 여부만 본다 — 서명 검증과 `token_version` 대조는
E-3/E-4(가입·연동)에서 붙는다. 다만 **어디서 읽는지는 확정본**이다: 미결 11-2 가
HttpOnly 쿠키로 정해져(`공통규약.md` 「인증 쿠키」) `Authorization: Bearer` 를 안 쓴다.
"""

from typing import Annotated, Literal

from fastapi import Header, Request

from app.auth import CHILD_COOKIE, PARENT_COOKIE
from app.errors import AppError, ErrorCode

MockOutcome = Literal["result", "scaffold", "blocked"]


def _쿠키(request: Request, 이름: str, 다른역할: str) -> str:
    """이 역할의 쿠키를 꺼낸다. 없으면 401, **다른 역할의 것만 있으면 403**이다.

    두 이름을 나눈 이유가 여기서 값을 한다 — 가족 태블릿에는 학부모·자녀 쿠키가
    동시에 앉아 있을 수 있다. 자녀 쿠키로 학부모 API 를 부른 것을 401 로 돌려주면
    프론트가 「로그인이 풀렸다」로 읽고 다시 로그인시킨다. 그건 역할 문제지
    인증 문제가 아니다 (`공통규약.md` 오류 표 `FORBIDDEN_ROLE`).
    """
    값 = request.cookies.get(이름)
    if 값:
        return 값
    if request.cookies.get(다른역할):
        raise AppError(ErrorCode.FORBIDDEN_ROLE)
    raise AppError(ErrorCode.UNAUTHORIZED)


async def require_parent(request: Request) -> str:
    return _쿠키(request, PARENT_COOKIE, CHILD_COOKIE)


async def require_child(request: Request) -> str:
    return _쿠키(request, CHILD_COOKIE, PARENT_COOKIE)


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
