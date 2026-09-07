"""헬스체크와 `/openapi.json`. DB·Redis 없이 도는 테스트만 둔다 — CI 에는 둘 다 없다."""

import pytest
from fastapi.testclient import TestClient

from app import db
from app.api import system
from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(), raise_server_exceptions=False)


def test_healthz_는_의존성을_보지_않는다(client: TestClient):
    """DB 가 죽어도 200 이어야 한다. 죽었는지는 /readyz 가 답한다."""
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readyz_는_의존성이_살아_있으면_200(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(system, "_check_postgres", lambda: _고정("up"))
    monkeypatch.setattr(system, "_check_redis", lambda: _고정("up"))

    response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "checks": {"postgres": "up", "redis": "up"}}


def test_readyz_는_의존성이_죽으면_503(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """503 이어야 로드밸런서가 트래픽을 안 보낸다. 500(예외)으로 새면 안 된다."""
    monkeypatch.setattr(system, "_check_postgres", lambda: _고정("down"))
    monkeypatch.setattr(system, "_check_redis", lambda: _고정("up"))

    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


def test_readyz_실패_사유에_접속정보가_없다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """asyncpg·redis 예외 문자열에는 호스트·계정이 들어 있다. 그대로 흘리면 안 된다."""

    class _터지는엔진:
        def connect(self):
            raise RuntimeError("connection to server at geulmoheom@localhost:5433 failed")

    # **`system.engine` 이 아니라 `db.engine` 을 갈아끼운다** — system 은 모듈로
    # 참조하므로 원본을 바꿔야 한다. 사본을 바꾸면 통과하는데 실제로는 안 바뀐다.
    monkeypatch.setattr(db, "engine", _터지는엔진())
    monkeypatch.setattr(system, "_check_redis", lambda: _고정("up"))

    response = client.get("/readyz")

    assert response.status_code == 503
    assert "5433" not in response.text
    assert "geulmoheom" not in response.text


def test_openapi_에_헬스체크가_들어_있다(client: TestClient):
    """프론트의 `make contracts` 가 이 문서만 본다."""
    schema = client.get("/openapi.json").json()

    assert "/healthz" in schema["paths"]
    assert "/readyz" in schema["paths"]


async def _고정(값: str) -> str:
    return 값
