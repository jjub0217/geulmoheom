"""요청 로깅. **body 를 읽지 않는다.**

디버깅에 필요한 것은 `request_id` 로 잇는다 — body 를 로그에 남기는 대신
요청마다 id 를 붙이고 응답 헤더(`X-Request-ID`)로 돌려준다. 프론트가 그 id 를
알려주면 서버 로그에서 같은 요청을 찾을 수 있고, 원문은 어디에도 안 남는다 (PRD 1.1b).
"""

import logging
import uuid
from collections.abc import Awaitable, Callable
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
