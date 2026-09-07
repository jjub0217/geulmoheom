"""엔트리포인트. `Makefile` 의 `dev-api` 가 `app.main:app` 을 호출한다 — 경로를 바꾸지 않는다."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.system import router as system_router
from app.api.v1.router import router as v1_router
from app.config import Settings, get_settings
from app.errors import register_error_handlers
from app.logging_config import configure_logging
from app.middleware import RequestLogMiddleware, silence_uvicorn_access_log

API_V1_PREFIX = "/api/v1"  # docs/api/공통규약.md


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()
    silence_uvicorn_access_log()

    app = FastAPI(
        title="글모험 API",
        version="0.1.0",
        # 프론트의 `make contracts` 가 이 경로만 본다 (Makefile).
        openapi_url="/openapi.json",
        docs_url="/docs" if settings.app_env == "dev" else None,
        redoc_url=None,
    )

    # 미들웨어는 나중에 추가한 것이 바깥이다. 로깅을 CORS 보다 먼저 추가해
    # CORS 응답까지 같은 request_id 로 남게 한다.
    app.add_middleware(RequestLogMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,  # 미결 11-2 확정 — HttpOnly 쿠키다 (공통규약.md 「인증 쿠키」)
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_error_handlers(app)
    app.include_router(system_router)
    app.include_router(v1_router, prefix=API_V1_PREFIX)
    return app


app = create_app()
