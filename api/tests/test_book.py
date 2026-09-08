"""내 책 (A0-4) — **획득 삽화와 그때 쓴 문장이 함께 남는다.**

**쓰기 엔진은 수단이고 책과 독자가 목적이다** (비전 2장). 이 엔드포인트가 그 목적이
실제로 쌓이는 자리다.

지키는 것 넷.

1. **아이 원문 그대로** — 맞춤법·AI 보정 없음 (`Stage0.md` 6절). 마스킹 뒤 텍스트가 원문이다
2. **카드별 최고 티어 1건이 한 페이지** — 재시도로 티어가 오르면 교체된다
3. **등급이 낮아도 책은 똑같이 쌓인다** — 「기본」도 페이지가 된다 (`문구.md` 1.6 둘째)
4. **남의 책은 안 보인다** — 자녀 1명 = 책 1권
"""

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import attempts
from app.evaluator import 평가결과
from app.models import Child
from app.moderation import 검사결과

문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


@pytest.fixture(autouse=True)
def 판정_고정(monkeypatch: pytest.MonkeyPatch) -> dict:
    상태 = {"grade": "G2"}

    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade=상태["grade"], signals=["adj:은빛"], descriptors=["은빛"])

    async def _통과(text: str) -> 검사결과:
        return 검사결과(blocked=False)

    async def _안됨(자녀id: str, card_id: str, **_) -> int:
        return 0

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _통과)
    monkeypatch.setattr(attempts, "되묻은횟수", _안됨)
    return 상태


def _풀기(client: TestClient, card_id: str, text: str = 문장):
    return client.post("/api/v1/attempts", json={"card_id": card_id, "text": text})


def _책(client: TestClient) -> dict:
    return client.get("/api/v1/book").json()


# ── 쌓인다 ──────────────────────────────────────────────


def test_아직_안_썼으면_책이_비어_있다(client: TestClient, 자녀행: Child):
    """**빈 책은 오류가 아니다.** 처음 들어온 아이가 여기서 500 을 보면 안 된다."""
    책 = _책(client)

    assert 책["pages"] == []
    assert 책["counts"] == {"basic": 0, "rare": 0, "legendary": 0}
    assert 책["visibility"] == "private"
    assert 자녀행.nickname in 책["title"]


def test_푼_카드가_페이지가_된다(client: TestClient):
    _풀기(client, "c01")

    (페이지,) = _책(client)["pages"]

    assert 페이지["source"] == "card"
    assert 페이지["source_id"] == "c01"
    assert 페이지["tier"] == "rare"
    assert 페이지["page_no"] == 1


def test_아이_원문_그대로다(client: TestClient):
    """**맞춤법·AI 보정 없음** (`Stage0.md` 6절). 요약도 하지 않는다."""
    이상한문장 = "그림자가 캄캄했지만  나는 살금살금  걸어갔다"
    _풀기(client, "c01", 이상한문장)

    (페이지,) = _책(client)["pages"]

    assert 페이지["text"] == 이상한문장


def test_기본_등급도_책에_쌓인다(client: TestClient, 판정_고정: dict):
    """**등급이 낮아도 책은 똑같이 쌓인다** — 비전 2장이 파는 것이 그것이다."""
    판정_고정["grade"] = "G1"
    _풀기(client, "c01")

    책 = _책(client)

    assert len(책["pages"]) == 1
    assert 책["counts"]["basic"] == 1


def test_카드마다_한_페이지다(client: TestClient):
    _풀기(client, "c01")
    _풀기(client, "c02")

    책 = _책(client)

    assert [p["source_id"] for p in 책["pages"]] == ["c01", "c02"]
    assert [p["page_no"] for p in 책["pages"]] == [1, 2]
    assert 책["counts"]["rare"] == 2


# ── 최고 티어로 교체된다 ─────────────────────────────────


def test_재시도로_티어가_오르면_교체된다(client: TestClient, 판정_고정: dict):
    """**카드별 최고 티어 시도 1건**이 한 페이지다 (`Stage0.md` 6절)."""
    판정_고정["grade"] = "G1"
    처음 = _풀기(client, "c01", "짧게 썼다").json()

    판정_고정["grade"] = "G3"
    client.post(
        "/api/v1/attempts",
        json={"card_id": "c01", "text": "길고 자세하게 다시 썼다", "retry_of": 처음["attempt_id"]},
    )

    (페이지,) = _책(client)["pages"]
    assert 페이지["tier"] == "legendary"
    assert 페이지["text"] == "길고 자세하게 다시 썼다"
    assert 페이지["page_no"] == 1  # 자리는 그대로다


def test_티어가_안_오르면_그대로다(client: TestClient, 판정_고정: dict):
    """**처음 해낸 것을 지키다.** 같은 티어로 다시 써서 페이지가 바뀌면 아이는
    자기가 좋아하던 문장을 잃는다."""
    처음 = _풀기(client, "c01", "처음 쓴 문장").json()

    client.post(
        "/api/v1/attempts",
        json={"card_id": "c01", "text": "나중에 쓴 문장", "retry_of": 처음["attempt_id"]},
    )

    (페이지,) = _책(client)["pages"]
    assert 페이지["text"] == "처음 쓴 문장"


# ── 오늘 것만 ───────────────────────────────────────────


def test_오늘_추가된_페이지만_준다(client: TestClient):
    """세션 종료 화면용 (`Stage0.md` 6절)."""
    _풀기(client, "c01")

    오늘 = client.get("/api/v1/book/today").json()

    assert [p["source_id"] for p in 오늘["pages"]] == ["c01"]


# ── 남의 책은 없다 ──────────────────────────────────────


def test_되묻기와_차단은_페이지가_안_된다(
    client: TestClient, 판정_고정: dict, monkeypatch: pytest.MonkeyPatch
):
    """카드를 안 썼으면 책에도 안 남는다. **막힌 문장이 아이 책에 인쇄되면 안 된다.**"""

    async def _막힘(text: str) -> 검사결과:
        return 검사결과(blocked=True, category="violence")

    monkeypatch.setattr(attempts, "검사하기", _막힘)
    _풀기(client, "c01")

    assert _책(client)["pages"] == []
