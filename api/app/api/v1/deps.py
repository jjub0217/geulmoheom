"""공통 의존성.

**목 서버 단계다.** 토큰은 존재 여부만 본다 — 서명 검증은 E-3/E-4(가입·연동)에서 붙는다.
토큰 저장 위치가 미결 11-2 라 지금 인증을 확정하면 다시 짠다 (W1 계획 「하지 않는 것」).
"""

from typing import Annotated, Literal

from fastapi import Header

from app.errors import AppError, ErrorCode

MockOutcome = Literal["result", "scaffold", "blocked"]


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AppError(ErrorCode.UNAUTHORIZED)

    token = authorization[len("bearer ") :].strip()
    if not token:
        raise AppError(ErrorCode.UNAUTHORIZED)
    return token


async def require_parent(
    authorization: Annotated[str | None, Header(description="Bearer <parent_jwt>")] = None,
) -> str:
    return _bearer(authorization)


async def require_child(
    authorization: Annotated[str | None, Header(description="Bearer <child_jwt>")] = None,
) -> str:
    return _bearer(authorization)


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
