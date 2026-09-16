"""공통 오류 형식. 기준은 `docs/api/공통규약.md` 「오류 형식」 표다.

두 가지를 지킨다.

1. `message` 는 **아이가 읽는 문장**이다. 기계용 식별자는 `code` 에만 넣는다
   (`api/CLAUDE.md` 「항상 하는 것」).
2. **응답에 아이 입력 원문을 되돌려 담지 않는다.** 특히 pydantic 검증 오류의
   `input`·`ctx` 에는 아이가 쓴 문장이 그대로 들어 있다 (PRD 1.1b).
"""

import logging
from enum import StrEnum
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.middleware import current_request_id

logger = logging.getLogger(__name__)


class ErrorCode(StrEnum):
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN_ROLE = "FORBIDDEN_ROLE"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    DAILY_CAP_REACHED = "DAILY_CAP_REACHED"
    CARD_ALREADY_DONE_TODAY = "CARD_ALREADY_DONE_TODAY"
    CONSENT_REQUIRED = "CONSENT_REQUIRED"
    RATE_LIMITED = "RATE_LIMITED"
    UPSTREAM_TIMEOUT = "UPSTREAM_TIMEOUT"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    # Stage 1 (`docs/api/Stage1.md` 6절). **넷뿐이다** — 나머지는 위 표 그대로다
    NO_ACTIVE_CHAPTER = "NO_ACTIVE_CHAPTER"
    CHAPTER_DONE_TODAY = "CHAPTER_DONE_TODAY"
    TURN_LIMIT = "TURN_LIMIT"
    GM_UNSAFE = "GM_UNSAFE"


HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.UNAUTHORIZED: 401,
    ErrorCode.FORBIDDEN_ROLE: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.VALIDATION_ERROR: 422,
    ErrorCode.DAILY_CAP_REACHED: 409,
    ErrorCode.CARD_ALREADY_DONE_TODAY: 409,
    ErrorCode.CONSENT_REQUIRED: 403,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.UPSTREAM_TIMEOUT: 504,
    ErrorCode.INTERNAL_ERROR: 500,
    ErrorCode.NO_ACTIVE_CHAPTER: 404,
    ErrorCode.CHAPTER_DONE_TODAY: 409,
    ErrorCode.TURN_LIMIT: 429,
    ErrorCode.GM_UNSAFE: 502,
}

# 아이 화면 문구. **SSOT 는 `docs/문구.md` 2.1 이다** (2026-09-07 확정) — 여기는 그 표를
# 옮겨 놓은 것이고, 문구를 바꾸려면 문서를 먼저 고친다. 코드에서 새로 짓지 않는다.
#
# `docs/용어사전.md` 8장 금지어(부족해·다시 써·틀렸어·점수…)를 쓰지 않고, 그 이전에
# **아이를 탓하는 구조**를 쓰지 않는다. 기계용 식별자는 `code` 에만 — `message` 에
# 코드·필드명·기술 용어가 섞이지 않는다. 아이 입력 원문을 문구에 되담지 않는다 (PRD 1.1b).
CHILD_MESSAGE: dict[ErrorCode, str] = {
    ErrorCode.UNAUTHORIZED: "다시 한 번 들어와 주세요",
    ErrorCode.FORBIDDEN_ROLE: "여기는 지금 들어갈 수 없어요",
    ErrorCode.NOT_FOUND: "찾는 것이 여기 없어요",
    # 종전 「한 번만 더 확인해 주세요」는 **무엇을 확인하라는지 알려주지 않으면서 아이 탓으로
    # 읽힌다.** 422 가 실제로 뜨는 경우는 프론트가 형식을 잘못 보낸 것이라 아이가 고칠 것이 없다.
    ErrorCode.VALIDATION_ERROR: "잠깐 문제가 생겼어요. 다시 한 번 해볼까요",
    ErrorCode.DAILY_CAP_REACHED: "오늘 카드를 다 썼어요",
    ErrorCode.CARD_ALREADY_DONE_TODAY: "이 장면은 오늘 이미 다녀왔어요",
    ErrorCode.CONSENT_REQUIRED: "부모님 확인이 먼저 필요해요",
    # **종전 「조금만 천천히 가볼까요」는 둘이 틀렸다** (`문구.md` 2.1, 2026-09-08 확정 —
    # **코드가 일주일 안 따라왔고 사용자가 화면에서 찾았다**).
    # ① **「조금만」이 거짓이다 — 15분이다.** 이 자리는 아이가 실제로 다시 눌러 보는
    #    자리라 거짓이 바로 들킨다 ② **「천천히 가볼까요」는 아이가 서둘렀다는 뜻이라
    #    탓하는 구조**인데, 실제 원인은 대개 **코드를 잘못 옮겨 적은 것**이다.
    # **부모님을 가리키지 않는다** — 평문 코드는 생성 응답 한 번에만 실려 **부모도 다시
    # 읽을 수 없고**, 그 말은 실질적으로 재발급을 시키는 말이 된다. 재발급은
    # `token_version` 을 올려 **아이가 쓰던 다른 기기를 끊는다.**
    # **「15분」은 `child_auth_limit.DEVICE_LOCK_SECONDS` 와 짝이다** — 검사가 묶어 뒀다.
    ErrorCode.RATE_LIMITED: "지금은 코드를 넣을 수 없어요. 15분 뒤에 다시 해볼까요",
    ErrorCode.UPSTREAM_TIMEOUT: "나침반이 잠깐 느려요. 조금 뒤에 다시 해볼까요",
    ErrorCode.INTERNAL_ERROR: "잠깐 문제가 생겼어요. 조금 뒤에 다시 해볼까요",
    # Stage 1 넷 (2026-09-16 내려왔다 · `문구.md` 2.1).
    # **「챕터」·「턴」을 아이 화면에 안 쓴다** — 내부 용어다 (`용어사전.md`).
    ErrorCode.NO_ACTIVE_CHAPTER: "지금 이어갈 이야기가 없어요",
    ErrorCode.CHAPTER_DONE_TODAY: "오늘 이야기는 이미 끝냈어요",
    # **⛔ 「15분」이 없다.** `RATE_LIMITED` 를 여기 돌려 쓰면 아이가 15분 뒤에
    # 눌러 보고 또 막힌다 — 2.1 이 **「429 가 두 번째 자리를 얻으면 갈라야 한다」**로
    # 예고해 둔 자리이고, 이것이 그 두 번째 자리다
    ErrorCode.TURN_LIMIT: "오늘 모험은 여기까지예요",
    # **⛔ 아이가 뭘 잘못했다고 읽히면 안 된다** — 막힌 것은 출력이지 입력이 아니다
    # (입력 차단은 1.11, 다른 자리다). 주어를 나침반으로 두는 것은
    # `UPSTREAM_TIMEOUT` 이 세운 선례다 — **기술적 실패는 도구가 진다**
    ErrorCode.GM_UNSAFE: "나침반이 길을 못 찾았어요. 다시 해볼까요",
}

# HTTPException(401) 처럼 상태 코드만 던져진 경우의 되매핑.
_STATUS_TO_CODE: dict[int, ErrorCode] = {
    401: ErrorCode.UNAUTHORIZED,
    403: ErrorCode.FORBIDDEN_ROLE,
    404: ErrorCode.NOT_FOUND,
    409: ErrorCode.DAILY_CAP_REACHED,
    422: ErrorCode.VALIDATION_ERROR,
    429: ErrorCode.RATE_LIMITED,
    504: ErrorCode.UPSTREAM_TIMEOUT,
}


class AppError(Exception):
    """서비스 오류. 핸들러가 공통 형식으로 직렬화한다.

    `detail` 에 아이 입력 원문을 담지 않는다 — 응답 body 로 그대로 나간다.
    """

    def __init__(
        self,
        code: ErrorCode,
        *,
        message: str | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.status_code = HTTP_STATUS[code]
        self.message = message or CHILD_MESSAGE[code]
        self.detail = detail or {}
        # 예외 메시지에는 code 만 넣는다. 스택 트레이스가 로그로 가기 때문이다.
        super().__init__(code.value)


def error_response(
    code: ErrorCode,
    *,
    message: str | None = None,
    detail: dict[str, Any] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=HTTP_STATUS[code],
        content={
            "error": {
                "code": code.value,
                "message": message or CHILD_MESSAGE[code],
                "detail": detail or {},
            }
        },
    )


def _safe_fields(errors: list[dict[str, Any]]) -> list[dict[str, str]]:
    """검증 오류에서 **위치와 종류만** 남긴다.

    pydantic 의 원본 오류는 `input`(아이가 보낸 값)과 `ctx`(값이 섞인 문맥)를 포함한다.
    그대로 내보내면 마스킹 미들웨어를 지나기 전의 원문이 응답으로 새어 나간다.
    """
    return [
        {
            "field": ".".join(str(part) for part in error.get("loc", ())),
            "type": str(error.get("type", "invalid")),
        }
        for error in errors
    ]


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return error_response(exc.code, message=exc.message, detail=exc.detail)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(
            ErrorCode.VALIDATION_ERROR,
            detail={"fields": _safe_fields(exc.errors())},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_TO_CODE.get(exc.status_code, ErrorCode.INTERNAL_ERROR)
        return error_response(code)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # 예외 문자열에 아이 입력이 섞여 있을 수 있어 메시지를 로그에 남기지 않는다.
        # 남기는 것은 경로와 예외 타입뿐이다.
        logger.error(
            "처리되지 않은 예외",
            extra={
                "request_id": current_request_id(),
                "path": request.url.path,
                "exc_type": type(exc).__name__,
            },
        )
        return error_response(ErrorCode.INTERNAL_ERROR)
