"""Stage 1 **계약 모양**을 본다 (`docs/api/Stage1.md`).

**목이었다** (W7 0번, `test_stage1_mock.py`). **2026-09-16 에 엔드포인트가 실물이
되면서 이 파일은 계약 모양만 남았다** — 한 판이 실제로 굴러가는지는
`test_stage1_chapters.py` 가 본다. **이름을 바꾼 이유가 그것이다.**

**여기 남은 것은 목이 사라져도 그대로 유효한 것들**이다.

1. **`/openapi.json` 에 뜬다** — 프론트의 `types.gen.ts` 가 여기서 나온다.
   **문서가 아니라 이 스키마가 SSOT 다**
2. **직접 쓴 `text`만 받는다** — 선택지 제출은 **챕터를 보기 전에 막힌다.**
   이전 클라이언트의 `choice_id`에도 직접 쓰기 안내를 돌려준다
3. **인증이 진짜다** — 목이라고 문을 열어 뒀으면 **목이 사라질 때 그 자리가 안 닫혔다.**
   안 열어 뒀고, 그래서 이 검사가 그때도 지금도 같다
4. **「보스」가 명세에 없다** (금지어)

**⛔ 고정값을 검사하지 않는다.** 서사 한 덩이·선택지 라벨은 **GM 이 만든다** —
박아 두면 모델이 바뀌는 날 이 파일이 빨개지고, 그건 결함이 아니다.
"""

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import stage1
from app.main import create_app

pytestmark = pytest.mark.anyio

챕터 = "/api/v1/chapters"
턴 = "/api/v1/turns"


# ── 계약이 뜬다 ─────────────────────────────────────────


def test_네_경로가_openapi_에_뜬다():
    """**완료 조건이다** (W7 0번). 프론트는 문서를 안 읽고 `types.gen.ts` 를 쓴다."""
    경로 = create_app().openapi()["paths"]

    assert "/api/v1/chapters" in 경로
    assert "/api/v1/chapters/current" in 경로
    assert "/api/v1/chapters/{chapter_id}/summary" in 경로
    assert "/api/v1/turns" in 경로


def test_응답_스키마가_뜬다():
    """`ChapterView`·`TurnResult` 가 없으면 프론트 타입이 `unknown` 이 된다."""
    스키마 = create_app().openapi()["components"]["schemas"]

    assert {"ChapterView", "TurnRequest", "TurnResult", "ChapterSummary"} <= set(스키마)


def test_보스라는_낱말이_계약에_없다():
    """**금지어다** (`용어사전.md` 8장). 비트 값은 `trial` 이다.

    **응답·코드·식별자 어디에도 안 쓴다** — 스키마에 한 번 들어가면 프론트 타입을
    타고 화면까지 간다.
    """
    import json

    명세 = json.dumps(create_app().openapi(), ensure_ascii=False)

    assert "보스" not in 명세
    assert "boss" not in 명세.lower()


# ── 직접 쓰기만 ─────────────────────────────────────────


@pytest.mark.parametrize(
    "입력",
    [
        {"choice_id": "c1"},
        {"choice_id": ""},
        {"choice_id": "c1", "text": "지도를 짚는다"},
        {"text": " \t\n "},
        {},
    ],
)
async def test_직접쓰기_아닌_요청은_챕터를_보기_전에_422(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, 입력: dict
):
    async def _조회하면_안됨(*_):
        pytest.fail("직접 쓰기 확인 전에 챕터를 조회했다")

    monkeypatch.setattr(stage1.저장소, "진행중", _조회하면_안됨)
    응답 = client.post(턴, json={"chapter_id": "x", **입력})

    assert 응답.status_code == 422
    assert 응답.json()["error"] == {
        "code": "VALIDATION_ERROR",
        "message": "어떻게 할지 직접 써 주세요.",
        "detail": {},
    }


# ── 인증 ────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("메서드", "경로"),
    [
        ("post", 챕터),
        ("get", f"{챕터}/current"),
        ("post", 턴),
    ],
)
async def test_아이_인증이_없으면_못_들어온다(메서드: str, 경로: str):
    """**목이라고 문을 열어 두지 않는다.** 열어 두면 **목이 사라질 때 그 자리가 안
    닫힌다** — 열린 채로 지나가는 것이 가장 조용한 실패다."""
    익명 = TestClient(create_app())
    몸 = {"json": {"chapter_id": "x", "choice_id": "c1"}} if 메서드 == "post" else {}

    응답 = getattr(익명, 메서드)(경로, **몸)

    assert 응답.status_code in (401, 403)


# ── 완결 · 한 판이 굴러가는 것은 `test_stage1_chapters.py` 가 본다 ────


async def test_요약은_uuid_가_아니면_404(client: TestClient):
    """**모양을 여기서 거른다** — 안 거르면 SQL 층까지 내려가 500 이 된다."""
    응답 = client.get(f"{챕터}/그런거없음/summary")

    assert 응답.status_code == 404
