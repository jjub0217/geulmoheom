"""요청 로깅. **body 를 읽지 않는다.**

디버깅에 필요한 것은 `request_id` 로 잇는다 — body 를 로그에 남기는 대신
요청마다 id 를 붙이고 응답 헤더(`X-Request-ID`)로 돌려준다. 프론트가 그 id 를
알려주면 서버 로그에서 같은 요청을 찾을 수 있고, 원문은 어디에도 안 남는다 (PRD 1.1b).
"""

import logging
import uuid
from collections.abc import Awaitable, Callable, Iterable
from contextvars import ContextVar
from time import perf_counter

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.masking import safe_query_keys

logger = logging.getLogger("app.request")

REQUEST_ID_HEADER = "X-Request-ID"

_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def current_request_id() -> str:
    return _request_id.get()


def silence_uvicorn_access_log() -> None:
    """uvicorn 기본 액세스 로그를 끈다.

    uvicorn 은 요청 라인을 통째로 남긴다 — `GET /cards/next?nickname=김민준 HTTP/1.1` 처럼
    **쿼리스트링 값까지** 찍힌다. 이 미들웨어를 우회하는 경로라 막는다
    (`api/CLAUDE.md` 「마스킹 미들웨어를 우회하는 경로를 만들지 않는다」).

    같은 정보(method·path·status·소요)를 `RequestLogMiddleware` 가 쿼리 값 없이,
    거기에 `request_id` 까지 붙여 남긴다.
    """
    logging.getLogger("uvicorn.access").disabled = True


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = uuid.uuid4().hex[:12]
        token = _request_id.set(request_id)
        started = perf_counter()

        status_code = 500  # call_next 가 터지면 이 값이 남는다
        try:
            response = await call_next(request)
            status_code = response.status_code
        finally:
            # 남기는 것은 경로와 쿼리 "키 이름"뿐이다. url 전체를 쓰면 쿼리 값이 딸려 간다.
            # f-string 을 쓰지 않는다 — ruff G004 가 막는다 (원문 유출 경로).
            logger.info(
                "요청 처리",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": status_code,
                    "query_keys": safe_query_keys(request.query_params),
                    "duration_ms": round((perf_counter() - started) * 1000, 1),
                },
            )
            _request_id.reset(token)

        response.headers[REQUEST_ID_HEADER] = request_id
        return response


# ── 예외로 끝난 응답에도 나가야 하는 쿠키 ─────────────────────────
#
# FastAPI 가 주입해 주는 `Response` 는 **정상 반환일 때만** 실제 응답에 합쳐진다.
# `AppError` 를 던지면 예외 핸들러가 새 `JSONResponse` 를 만들어 그 헤더가 통째로
# 버려진다. 대부분은 그게 맞다 — 실패한 요청이 토큰을 굽는 일은 없어야 한다.
#
# **`/child/auth` 의 기기 표식만 반대다.** 그 쿠키가 필요한 이유가 「실패를 세는 것」인데
# 실패 응답에서 안 나가면, 클라이언트는 매 요청마다 표식 없이 와서 **매번 새 기기로
# 보이고 카운터가 5에 못 간다.** 즉 ①이 통째로 무력해진다.
_PENDING = "pending_cookies"


def 쿠키굽기예약(request: Request, 굽기: Callable[[Response], None]) -> None:
    """이 요청이 **어떻게 끝나든** 응답에 이 쿠키를 굽는다.

    `request.state` 는 ASGI `scope` 에 얹혀 있어 미들웨어와 엔드포인트가 같은 것을 본다.
    """
    예약: list[Callable[[Response], None]] = getattr(request.state, _PENDING, [])
    예약.append(굽기)
    setattr(request.state, _PENDING, 예약)


class PendingCookieMiddleware(BaseHTTPMiddleware):
    """`쿠키굽기예약` 으로 걸어 둔 것을 실제 응답에 붙인다.

    **엔드포인트 안에서 `response.set_cookie` 를 하는 것으로 대신할 수 없다** — 위에
    적은 대로 예외 경로에서 그 응답 객체가 버려진다.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        예약: Iterable[Callable[[Response], None]] = getattr(request.state, _PENDING, ())
        for 굽기 in 예약:
            굽기(response)
        return response
