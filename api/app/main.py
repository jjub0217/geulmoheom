"""엔트리포인트. `Makefile` 의 `dev-api` 가 `app.main:app` 을 호출한다 — 경로를 바꾸지 않는다."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as v1_router
from app.config import Settings, get_settings
from app.errors import register_error_handlers

API_V1_PREFIX = "/api/v1"  # docs/api/공통규약.md


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    app = FastAPI(
        title="글모험 API",
        version="0.1.0",
        # 프론트의 `make contracts` 가 이 경로만 본다 (Makefile).
        openapi_url="/openapi.json",
        docs_url="/docs" if settings.app_env == "dev" else None,
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,  # 미결 11-2가 HttpOnly 쿠키로 정해질 경우를 위해
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_error_handlers(app)
    app.include_router(v1_router, prefix=API_V1_PREFIX)
    return app


app = create_app()
