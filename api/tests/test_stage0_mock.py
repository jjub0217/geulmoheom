"""목 서버가 `docs/api/Stage0.md` 대로 응답하는지 본다.

프론트는 이 응답 모양에 화면을 맞춘다. 모양이 틀리면 프론트가 두 번 짠다.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

AUTH = {"Authorization": "Bearer mock"}

SIGNUP = (
    "POST",
    "/api/v1/parents/signup",
    {"email": "a@b.c", "password": "x", "consent": True},
    201,
)
EVENTS = (
    "POST",
    "/api/v1/events",
    {"events": [{"event": "session_start", "ts": "2026-09-01T00:00:00Z"}]},
    204,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(), raise_server_exceptions=False)


# ── 인증 ─────────────────────────────────────────────────

인증_필요 = [
    ("GET", "/api/v1/parents/me"),
    ("GET", "/api/v1/child/me"),
    ("GET", "/api/v1/cards/next"),
    ("GET", "/api/v1/book"),
    ("GET", "/api/v1/artworks/a1"),
]


@pytest.mark.parametrize(("method", "path"), 인증_필요)
def test_토큰이_없으면_401(client: TestClient, method: str, path: str):
    response = client.request(method, path)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_401_메시지는_아이가_읽는_문장이다(client: TestClient):
    body = client.get("/api/v1/cards/next").json()["error"]

    assert body["message"] == "다시 한 번 들어와 주세요"
    assert "UNAUTHORIZED" not in body["message"]


def test_bearer_가_아니면_401(client: TestClient):
    response = client.get("/api/v1/cards/next", headers={"Authorization": "mock"})

    assert response.status_code == 401


# ── outcome 3분기 ────────────────────────────────────────


def _attempt(client: TestClient, **headers) -> dict:
    return client.post(
        "/api/v1/attempts",
        headers={**AUTH, **headers},
        json={"card_id": "c01", "text": "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"},
    ).json()


def test_기본은_result(client: TestClient):
    body = _attempt(client)

    assert body["outcome"] == "result"
    assert body["tier"] in {"basic", "rare", "legendary"}
    assert body["artwork"]["status"] == "pending"
    assert body["artwork"]["placeholder_url"]


def test_scaffold_를_헤더로_강제한다(client: TestClient):
    body = _attempt(client, **{"X-Mock-Outcome": "scaffold"})

    assert body["outcome"] == "scaffold"
    assert body["guide"]["expression"] == "compass_dim"
    assert body["scaffold_count"] == 1


def test_blocked_를_헤더로_강제한다(client: TestClient):
    body = _attempt(client, **{"X-Mock-Outcome": "blocked"})

    assert body["outcome"] == "blocked"
    assert body["reason"] in {"moderation", "pii"}


def test_어떤_분기도_등급을_노출하지_않는다(client: TestClient):
    """G0~G3 은 로그 전용이다 (용어사전 3장)."""
    for outcome in ("result", "scaffold", "blocked"):
        전문 = str(_attempt(client, **{"X-Mock-Outcome": outcome}))

        assert "G0" not in 전문
        assert "grade" not in 전문


def test_blocked_는_차단_카테고리를_말하지_않는다(client: TestClient):
    """아이에게 "나쁜 말" 피드백을 주지 않는다."""
    body = _attempt(client, **{"X-Mock-Outcome": "blocked"})

    assert set(body) == {"outcome", "reason", "guide", "today"}


# ── 오류 3종 ─────────────────────────────────────────────


def test_daily_cap_reached_409(client: TestClient):
    response = client.get(
        "/api/v1/cards/next", headers={**AUTH, "X-Mock-Error": "DAILY_CAP_REACHED"}
    )

    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "DAILY_CAP_REACHED"
    assert body["message"] == "오늘 카드를 다 썼어요"
    # 아이가 빈 화면을 보지 않게 대사를 함께 준다
    assert body["detail"]["guide"]["line"]


def test_validation_error_422(client: TestClient):
    """`text` 는 1~500자."""
    response = client.post("/api/v1/attempts", headers=AUTH, json={"card_id": "c01", "text": ""})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_재시도는_상한에_걸리지_않는다(client: TestClient):
    """재시도(`retry_of`)는 일일 카운트를 쓰지 않는다."""
    response = client.post(
        "/api/v1/attempts",
        headers={**AUTH, "X-Mock-Error": "DAILY_CAP_REACHED"},
        json={"card_id": "c01", "text": "다시 써본다", "retry_of": "a1"},
    )

    assert response.status_code == 200


# ── 나머지 엔드포인트 ────────────────────────────────────


def test_전_엔드포인트가_응답한다(client: TestClient):
    호출 = [
        (
            "POST",
            "/api/v1/parents/signup",
            {"email": "a@b.c", "password": "x", "consent": True},
            201,
        ),
        ("POST", "/api/v1/parents/login", {"email": "a@b.c", "password": "x"}, 200),
        ("GET", "/api/v1/parents/me", None, 200),
        ("POST", "/api/v1/parents/children", {"nickname": "불꽃탐험가", "age_band": 11}, 201),
        ("POST", "/api/v1/parents/children/c1/access-code", None, 200),
        ("PATCH", "/api/v1/parents/children/c1", {"daily_cap": 12}, 200),
        ("DELETE", "/api/v1/parents/children/c1", None, 204),
        ("POST", "/api/v1/child/auth", {"access_code": "482913"}, 200),
        ("GET", "/api/v1/child/me", None, 200),
        ("PATCH", "/api/v1/child/guide", {"guide_name": "나침이"}, 200),
        ("GET", "/api/v1/cards/next", None, 200),
        ("GET", "/api/v1/cards/c01", None, 200),
        ("GET", "/api/v1/attempts/a1", None, 200),
        ("GET", "/api/v1/artworks/w1", None, 200),
        ("GET", "/api/v1/book", None, 200),
        ("GET", "/api/v1/book/today", None, 200),
        ("PATCH", "/api/v1/book", {"title": "나의 모험"}, 200),
        (
            "POST",
            "/api/v1/events",
            {"events": [{"event": "session_start", "ts": "2026-09-01T00:00:00Z"}]},
            204,
        ),
    ]

    실패 = [
        (method, path, response.status_code)
        for method, path, body, expected in 호출
        if (response := client.request(method, path, headers=AUTH, json=body)).status_code
        != expected
    ]

    assert 실패 == []


def test_책은_아이_원문을_그대로_돌려준다(client: TestClient):
    """마스킹은 로그 경로에만 건다. 책에는 아이 문장이 그대로 있어야 한다 (PRD 1.1b)."""
    page = client.get("/api/v1/book", headers=AUTH).json()["pages"][0]

    assert page["text"] == "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


def test_daily_cap_이_child_me_에_반영된다(client: TestClient):
    body = client.get(
        "/api/v1/child/me", headers={**AUTH, "X-Mock-Error": "DAILY_CAP_REACHED"}
    ).json()

    assert body["today"]["locked"] is True
    assert body["today"]["cards_done"] == body["today"]["cap"]


# ── 계약 문서 ────────────────────────────────────────────


def test_attempts_응답이_outcome_으로_갈리는_합타입이다(client: TestClient):
    """프론트가 `outcome` 하나로 화면을 가를 수 있어야 한다."""
    schema = client.get("/openapi.json").json()
    응답 = schema["paths"]["/api/v1/attempts"]["post"]["responses"]["200"]
    본문 = 응답["content"]["application/json"]["schema"]

    assert 본문["discriminator"]["propertyName"] == "outcome"
    assert len(본문["oneOf"]) == 3
