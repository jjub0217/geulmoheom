"""오류 응답이 `docs/api/공통규약.md` 형식과 맞는지, 그리고 원문이 새지 않는지 본다."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.errors import CHILD_MESSAGE, HTTP_STATUS, AppError, ErrorCode
from app.main import create_app


class _Attempt(BaseModel):
    text: str
    card_id: int


@pytest.fixture
def client() -> TestClient:
    """뼈대에는 아직 라우트가 없어 검사용 라우트를 붙인 앱을 쓴다."""
    app: FastAPI = create_app()

    @app.post("/__test__/attempts")
    async def _attempts(_: _Attempt) -> dict[str, str]:  # pragma: no cover - 검증에서 막힌다
        return {"ok": "yes"}

    @app.get("/__test__/cap")
    async def _cap() -> None:
        raise AppError(ErrorCode.DAILY_CAP_REACHED)

    @app.get("/__test__/boom")
    async def _boom() -> None:
        raise RuntimeError("아이가 쓴 문장이 예외 메시지에 섞인 상황")

    return TestClient(app, raise_server_exceptions=False)


def test_모든_오류코드에_아이_문구와_상태코드가_있다():
    for code in ErrorCode:
        assert code in HTTP_STATUS
        assert CHILD_MESSAGE[code].strip()


def test_잠금_문구가_말하는_시간이_실제_잠금_시간과_같다():
    """**문구가 「15분 뒤에」라고 말한다.** 잠금 시간을 바꾸면 그 문장이 거짓이 된다 —
    그리고 **거짓말은 아이가 다시 눌러 보는 자리에서 바로 들킨다** (`문구.md` 2.1).

    **문구를 지키려고 잠금을 묶는 검사가 아니다.** 속도 제한은 2026-09-07 대표 승인
    안전 장치이고 여기서 무르지 않는다 — **둘이 갈라졌다는 것만 알린다.**
    이 문구가 09-08 에 고쳐졌는데 코드가 **일주일** 안 따라온 자리라, 다음에는
    **사람이 화면에서 찾기 전에** 빨개져야 한다.
    """
    from app.child_auth_limit import DEVICE_LOCK_SECONDS

    분 = DEVICE_LOCK_SECONDS // 60

    assert f"{분}분" in CHILD_MESSAGE[ErrorCode.RATE_LIMITED]


def test_앱_오류가_공통_형식으로_나간다(client: TestClient):
    response = client.get("/__test__/cap")

    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "DAILY_CAP_REACHED"
    assert body["message"] == "오늘 카드를 다 썼어요"
    assert body["detail"] == {}


def test_검증_오류가_입력_원문을_되돌려주지_않는다(client: TestClient):
    """pydantic 기본 오류의 `input` 을 그대로 내보내면 아이 원문이 응답으로 샌다."""
    원문 = "붉은 이끼가 덮인 바위 뒤에서 바람 냄새가 났다"

    response = client.post("/__test__/attempts", json={"text": 원문})

    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert body["detail"]["fields"] == [{"field": "body.card_id", "type": "missing"}]
    assert 원문 not in response.text


def test_처리되지_않은_예외가_내부_메시지를_노출하지_않는다(client: TestClient):
    response = client.get("/__test__/boom")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "아이가 쓴 문장" not in response.text


def test_openapi_가_생성된다(client: TestClient):
    """프론트의 `make contracts` 가 이 경로만 본다."""
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert response.json()["info"]["title"] == "글모험 API"
