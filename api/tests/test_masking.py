"""원문이 로그·응답으로 새지 않는지 본다 (PRD 1.1b · api/CLAUDE.md 「절대 하지 않는 것」)."""

import logging

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.masking import MASKED, mask_body
from app.middleware import REQUEST_ID_HEADER

원문 = "붉은 이끼가 덮인 바위 뒤로 살금살금 돌아갔다"


@pytest.fixture
def client() -> TestClient:
    app = create_app()

    @app.post("/__test__/attempts")
    async def _attempts(payload: dict) -> dict:
        # 실제 /attempts 응답처럼 아이 문장을 인용해 되돌려준다
        return {
            "outcome": "result",
            "guide": {"expression": "compass_bright", "line": "'살금살금'이 나침반을 움직였어!"},
            "highlights": [{"text": "살금살금", "kind": "adv"}],
        }

    return TestClient(app, raise_server_exceptions=False)


def test_요청_로그에_원문도_쿼리값도_없다(client: TestClient, caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.INFO):
        response = client.post(
            "/__test__/attempts?card_id=c01&nickname=김민준",
            json={"card_id": "c01", "text": 원문},
        )

    assert response.status_code == 200

    기록 = [record for record in caplog.records if record.name == "app.request"]
    assert 기록, "요청 로그가 남지 않았다"

    전문 = "\n".join(record.getMessage() + repr(record.__dict__) for record in caplog.records)
    assert 원문 not in 전문
    assert "김민준" not in 전문  # 쿼리 값도 안 남는다
    assert "card_id" in 전문  # 쿼리 "키 이름"은 남는다 — 디버깅에 필요하다


def test_request_id_로_요청을_되짚을_수_있다(client: TestClient):
    """원문을 안 남기는 대신 이 id 로 로그와 요청을 잇는다."""
    response = client.post("/__test__/attempts", json={"text": 원문})

    assert response.headers[REQUEST_ID_HEADER]


def test_응답_body_는_그대로_나간다(client: TestClient):
    """마스킹은 로그로 나가는 경로에만 건다. 아이 화면에는 자기 문장이 그대로 보여야 한다."""
    response = client.post("/__test__/attempts", json={"text": 원문})

    assert "살금살금" in response.text


def test_mask_body_가_중첩_구조까지_가린다():
    body = {
        "card_id": "c01",
        "text": 원문,
        "guide": {"expression": "compass_bright", "line": "'살금살금'이 움직였어!"},
        "highlights": [{"text": "살금살금", "kind": "adv"}],
        "today": {"cards_done": 3, "cap": 5},
    }

    가린것 = mask_body(body)

    assert 가린것["text"] == MASKED
    assert 가린것["guide"]["line"] == MASKED
    assert 가린것["highlights"] == MASKED
    assert 가린것["card_id"] == "c01"  # 식별자는 남긴다
    assert 가린것["today"] == {"cards_done": 3, "cap": 5}  # 파생값도 남긴다
    assert body["text"] == 원문  # 원본을 건드리지 않는다


def test_mask_body_가_자격증명도_가린다():
    가린것 = mask_body({"email": "a@b.c", "password": "hunter2", "access_code": "482913"})

    assert set(가린것.values()) == {MASKED}


def test_지나치게_깊은_구조는_통째로_가린다():
    """구조를 다 못 훑으면 못 본 것은 내보내지 않는다."""
    깊은것: dict = {"text": 원문}
    for _ in range(12):
        깊은것 = {"wrap": 깊은것}

    assert 원문 not in repr(mask_body(깊은것))


def test_uvicorn_액세스_로그가_꺼져_있다(client: TestClient):
    """uvicorn 은 요청 라인을 통째로 남겨 쿼리 값이 찍힌다. 우회 경로라 막는다."""
    assert logging.getLogger("uvicorn.access").disabled is True
