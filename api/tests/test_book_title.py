"""`PATCH /book` — **제목이 실제로 저장된다** (W5 4번 · `Stage0.md` 6절 SHOULD).

**계약이 이미 저장을 약속하고 있었다.** 「PATCH `/book` → `{ "title": "..." }`
(SHOULD, PII 검사)」인데 서버는 **받은 값을 그대로 되돌려 주기만 했다** — 새로고침하면
제목이 돌아온다. **계약을 바꾸는 것이 아니라 계약을 따라가는 것**이다.

**제목도 아이가 쓰는 문장이다.** 실명이 들어오면 **표지에 박힌다** — 본문보다 눈에
더 잘 띄는 자리다. 그래서 `POST /attempts` 와 **같은 마스킹을 지난다.**
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import db, pii
from app.models import Child, Event


def _고치기(client: TestClient, title: str):
    return client.patch("/api/v1/book", json={"title": title})


def _제목(client: TestClient) -> str:
    return client.get("/api/v1/book").json()["title"]


@pytest.fixture(autouse=True)
def 실명없음(monkeypatch: pytest.MonkeyPatch) -> None:
    """**기본은 네트워크를 안 탄다.** 실명 갈래를 보는 테스트가 자기 것을 덧끼운다."""

    async def _없다(text: str) -> list[str]:
        return []

    monkeypatch.setattr(pii, "_실명물어보기", _없다)


async def _이벤트들() -> list[Event]:
    async with db.SessionLocal() as session:
        return list(await session.scalars(select(Event).order_by(Event.id)))


# ── 저장된다 ────────────────────────────────────────────


def test_고친_제목이_저장된다(client: TestClient, 자녀행: Child):
    """**이 항목의 전부다.** 지금은 응답만 바뀌고 새로고침하면 돌아온다.

    **⚠ 기본 제목을 피해서 고른다.** `책()` 이 `{닉네임}의 모험` 으로 짓기 때문에
    (`app/book_store.py`) 하필 그 문자열을 쓰면 **저장이 하나도 안 돼도 통과한다** —
    처음 쓴 「불꽃탐험가의 모험」이 정확히 그 자리였다.
    """
    기본 = _제목(client)
    assert 기본 != "달빛 골짜기의 기록"

    _고치기(client, "달빛 골짜기의 기록")

    assert _제목(client) == "달빛 골짜기의 기록"


def test_응답이_저장된_것과_같다(client: TestClient, 자녀행: Child):
    """**응답과 저장이 갈리면 아이 화면이 거짓말을 한다** — 방금 본 제목과 다시 열었을
    때의 제목이 다르다."""
    몸 = _고치기(client, "은빛 검의 기록").json()

    assert 몸["title"] == _제목(client)


def test_앞뒤_공백은_다듬는다(client: TestClient, 자녀행: Child):
    _고치기(client, "  달빛 골짜기  ")

    assert _제목(client) == "달빛 골짜기"


def test_빈_제목은_안_바꾼다(client: TestClient, 자녀행: Child):
    """**아이 책에서 제목을 없애지 않는다.** 지우고 저장한 경우 지금 제목이 그대로
    돌아오고, 아이는 화면에서 되돌아간 것을 본다."""
    _고치기(client, "달빛 골짜기")

    몸 = _고치기(client, "   ").json()

    assert 몸["title"] == "달빛 골짜기"
    assert _제목(client) == "달빛 골짜기"


def test_아주_긴_제목도_안_터진다(client: TestClient, 자녀행: Child):
    """`books.title` 이 `String(120)` 이다. **자르지 않으면 DB 가 거절해 500 이 되고,
    아이는 제목을 못 고친 채 오류만 본다.**"""
    응답 = _고치기(client, "달" * 500)

    assert 응답.status_code == 200
    assert len(_제목(client)) == 120


# ── 제목에도 PII 검사가 붙는다 ───────────────────────────


@pytest.mark.usefixtures("_NER_켠다")
def test_제목의_실명이_가려진다(client: TestClient, 자녀행: Child, monkeypatch: pytest.MonkeyPatch):
    """**표지에 박히는 자리다.** 본문보다 눈에 더 잘 띈다."""

    async def _잡는다(text: str) -> list[str]:
        return ["김민준"]

    monkeypatch.setattr(pii, "_실명물어보기", _잡는다)

    몸 = _고치기(client, "김민준의 모험").json()

    assert 몸["title"] == f"{pii.PII_MASK}의 모험"
    assert _제목(client) == f"{pii.PII_MASK}의 모험"


def test_제목의_전화번호도_가려진다(client: TestClient, 자녀행: Child):
    """정규식 층도 같이 붙는다 — 실명만 보는 것이 아니다."""
    몸 = _고치기(client, "내 번호 010-1234-5678 모험").json()

    assert "010-1234-5678" not in 몸["title"]
    assert pii.PII_MASK in 몸["title"]


async def test_가린_종류가_이벤트로_남는다(client: TestClient, 자녀행: Child):
    """**종류만 남는다.** 가린 값도, 몇 개였는지도 안 싣는다 (PRD 1.1b) —
    `POST /attempts` 와 같은 자리, 같은 모양이다."""
    _고치기(client, "내 번호 010-1234-5678 모험")

    남은것 = [행 for 행 in await _이벤트들() if 행.event == "pii_masked"]
    assert [행.payload for 행 in 남은것] == [{"layer": "server", "kind": "phone"}]


async def test_안_가렸으면_이벤트가_없다(client: TestClient, 자녀행: Child):
    _고치기(client, "달빛 골짜기")

    assert [행 for 행 in await _이벤트들() if 행.event == "pii_masked"] == []
