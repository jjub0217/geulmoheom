"""삽화 프록시 — `GET /artworks/{id}/image` (B-3 ③).

**버킷은 공개하지 않는다. api 가 프록시한다** (2026-09-08 대표 판정, 미결 11-7).
「내 책」의 `visibility` 가 Stage 0 에서 항상 `private` 인데 공개 버킷이면 **URL 하나로
그 `private` 이 무너진다** — 그리고 이 제품에서 **링크 공유는 사고가 아니라 설계된
사용 방식**이다 (비전 2장 「가족 공유」).

여기서 지키는 것 넷. **하나만 흘려도 조용히 샌다.**

1. **쿠키 인증** — 아이는 자기 것만
2. **남의 것은 404** — 403 이면 「그 삽화는 존재한다」가 샌다
3. **`Cache-Control: private`** — Cloudflare 가 앞단이라 `private` 이 아니면
   **공유 캐시에 아이 창작물이 남고, 그 사고는 화면에 아무 증상이 없다**
4. **기본 에셋도 같은 주소** — 주소가 갈리면 「`fallback` 을 아이에게 알리지 않는다」가
   무너진다. 네트워크 탭에도 차이가 안 남아야 한다
"""

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app import artwork_store, db
from app.accounts import 비밀번호해시, 접속코드만들기
from app.auth import CHILD_COOKIE
from app.models import Artwork, CardAttempt, Child, Parent

그림 = b"\x89PNG\r\n\x1a\nfake-image-bytes"


async def _삽화를_넣는다(
    child_id: uuid.UUID, *, r2_key: str | None = "artworks/그림.png"
) -> Artwork:
    async with db.SessionLocal() as session:
        시도 = CardAttempt(
            child_id=child_id,
            card_id="c01",
            attempt=1,
            grade="G2",
            tier="rare",
            char_len=10,
            text="은빛 검을 들었다",
        )
        session.add(시도)
        await session.flush()

        삽화 = Artwork(
            card_attempt_id=시도.id,
            tier="rare",
            status="ready",
            r2_key=r2_key,
            fallback=r2_key is None,
            ready_at=datetime.now(UTC),
        )
        session.add(삽화)
        await session.commit()
        await session.refresh(삽화)
        return 삽화


async def _다른아이() -> Child:
    async with db.SessionLocal() as session:
        학부모 = Parent(
            email=f"{uuid.uuid4().hex}@example.test",
            password_hash=비밀번호해시("x"),
            consent_at=datetime.now(UTC),
            consent_version="test",
        )
        session.add(학부모)
        await session.flush()

        _, 해시, 만료 = 접속코드만들기()
        아이 = Child(
            parent_id=학부모.id,
            nickname="다른탐험가",
            age_band=11,
            access_code_hash=해시,
            access_code_expires_at=만료,
        )
        session.add(아이)
        await session.commit()
        await session.refresh(아이)
        return 아이


@pytest.fixture(autouse=True)
def 저장소_고정(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _읽기(오브젝트키: str) -> bytes:
        return 그림

    monkeypatch.setattr(artwork_store, "읽기", _읽기)


# ── 내 그림은 나온다 ─────────────────────────────────────


async def test_내_삽화는_바이트로_나온다(client: TestClient, 자녀행: Child):
    삽화 = await _삽화를_넣는다(자녀행.id)

    response = client.get(f"/api/v1/artworks/{삽화.id}/image")

    assert response.status_code == 200
    assert response.content == 그림
    assert response.headers["content-type"] == "image/png"


async def test_공유_캐시에_안_남는다(client: TestClient, 자녀행: Child):
    """**Cloudflare 가 앞단이다.** `private` 이 아니면 아이 창작물이 공유 캐시에 남고,
    **그 사고는 화면에 아무 증상이 없다** — 우리가 볼 수 있는 자리가 없다."""
    삽화 = await _삽화를_넣는다(자녀행.id)

    response = client.get(f"/api/v1/artworks/{삽화.id}/image")

    assert "private" in response.headers["cache-control"]
    assert "max-age=86400" in response.headers["cache-control"]


async def test_폴링이_이_주소를_가리킨다(client: TestClient, 자녀행: Child):
    """**저장소 주소가 클라이언트로 안 나간다.** 폴링 응답의 `url` 이 이 경로다.

    **절대 주소여야 한다** — web 은 `app.` 이고 api 는 `api.` 라, 상대 경로면
    `<img src>` 가 web 오리진으로 붙어 그림이 통째로 안 뜬다 (`adr/0007`).
    """
    삽화 = await _삽화를_넣는다(자녀행.id)

    url = client.get(f"/api/v1/artworks/{삽화.id}").json()["url"]

    assert url is not None
    assert url.startswith("https://")
    assert url.endswith(f"/api/v1/artworks/{삽화.id}/image")


# ── 남의 것은 없는 것이다 ────────────────────────────────


async def test_남의_삽화는_404(client: TestClient):
    """**403 이 아니다.** 403 으로 가르면 「그 삽화는 존재한다」가 샌다."""
    남 = await _다른아이()
    삽화 = await _삽화를_넣는다(남.id)

    response = client.get(f"/api/v1/artworks/{삽화.id}/image")

    assert response.status_code == 404


async def test_쿠키가_없으면_401(익명: TestClient, 자녀행: Child):
    """**`<img>` 서브리소스라 쿠키가 자동으로 실린다** — 실리지 않으면 여기가 401 이다
    (`Stage0.md` 5절 · `adr/0007` same-site)."""
    삽화 = await _삽화를_넣는다(자녀행.id)

    response = 익명.get(f"/api/v1/artworks/{삽화.id}/image")

    assert response.status_code == 401


async def test_폐기된_토큰으로는_못_본다(client: TestClient, 자녀행: Child):
    """접속 코드를 재발급하면 남은 기기가 끊긴다 (`공통규약.md` 「폐기」).
    **그림도 같이 끊겨야 한다** — 안 끊기면 폐기가 반쪽이다."""
    삽화 = await _삽화를_넣는다(자녀행.id)
    async with db.SessionLocal() as session:
        아이 = await session.get(Child, 자녀행.id)
        아이.token_version += 1
        await session.commit()

    response = client.get(f"/api/v1/artworks/{삽화.id}/image")

    assert response.status_code == 401


def test_UUID_가_아니면_404(client: TestClient):
    response = client.get("/api/v1/artworks/w1/image")

    assert response.status_code == 404


# ── 기본 에셋도 같은 주소 ────────────────────────────────


async def test_기본_에셋도_같은_주소로_나온다(
    client: TestClient, 자녀행: Child, monkeypatch: pytest.MonkeyPatch
):
    """**주소가 갈리면 「`fallback` 을 아이에게 알리지 않는다」가 무너진다.**
    네트워크 탭에도 차이가 안 남아야 한다."""
    monkeypatch.setattr(artwork_store, "기본에셋바이트", lambda: b"fallback-image-bytes")
    삽화 = await _삽화를_넣는다(자녀행.id, r2_key=None)

    response = client.get(f"/api/v1/artworks/{삽화.id}/image")

    assert response.status_code == 200
    assert response.content == b"fallback-image-bytes"
    assert "private" in response.headers["cache-control"]


async def test_저장소가_못_읽어도_기본_에셋이_나온다(
    client: TestClient, 자녀행: Child, monkeypatch: pytest.MonkeyPatch
):
    """R2 가 잠깐 죽은 경우. **아이는 그림 자리가 빈 것을 본다** — 그러면 안 된다."""

    async def _못읽음(오브젝트키: str) -> None:
        return None

    monkeypatch.setattr(artwork_store, "읽기", _못읽음)
    monkeypatch.setattr(artwork_store, "기본에셋바이트", lambda: b"fallback-image-bytes")
    삽화 = await _삽화를_넣는다(자녀행.id)

    response = client.get(f"/api/v1/artworks/{삽화.id}/image")

    assert response.status_code == 200
    assert response.content == b"fallback-image-bytes"


async def test_아직_굽는_중이면_기본_에셋이다(
    client: TestClient, 자녀행: Child, monkeypatch: pytest.MonkeyPatch
):
    """`pending` 인데 `<img>` 가 먼저 붙는 경우. **빈 그림을 주지 않는다.**"""
    monkeypatch.setattr(artwork_store, "기본에셋바이트", lambda: b"fallback-image-bytes")
    삽화 = await _삽화를_넣는다(자녀행.id, r2_key=None)

    response = client.get(f"/api/v1/artworks/{삽화.id}/image")

    assert response.status_code == 200


# ── placeholder_url 은 계약에서 빠졌다 ────────────────────


def test_계약에_placeholder_url_이_없다(client: TestClient):
    """**별도 주소를 두는 것이 「주소를 안 가른다」와 정면으로 어긋난다**
    (2026-09-08 PM). 계약에 남아 있으면 누군가 되살린다."""
    schema = client.get("/openapi.json").json()

    assert "placeholder_url" not in schema["components"]["schemas"]["ArtworkRef"]["properties"]


def test_계약에_X_Mock_Status_가_없다(client: TestClient):
    """폴링이 DB 를 읽게 된 뒤로 쓸 자리가 없다. **프론트도 안 쓴다**(`web/src` 확인)."""
    schema = client.get("/openapi.json").json()
    받는것 = schema["paths"]["/api/v1/artworks/{artwork_id}"]["get"].get("parameters", [])

    assert not [p for p in 받는것 if p["name"].lower() == "x-mock-status"]


async def test_아이_쿠키가_있으면_자기_것만_본다(
    client: TestClient, 자녀행: Child, 학부모행: Parent
):
    """가족 태블릿에는 두 쿠키가 같이 앉아 있다 (`tests/conftest.py`).
    **좁은 쪽을 쓴다** — 아이 쿠키가 있으면 형제자매 그림이 안 보인다.
    """
    async with db.SessionLocal() as session:
        _, 해시, 만료 = 접속코드만들기()
        동생 = Child(
            parent_id=학부모행.id,
            nickname="동생탐험가",
            age_band=10,
            access_code_hash=해시,
            access_code_expires_at=만료,
        )
        session.add(동생)
        await session.commit()
        await session.refresh(동생)

    삽화 = await _삽화를_넣는다(동생.id)

    assert client.cookies.get(CHILD_COOKIE)  # 아이 쿠키가 앉아 있다
    assert client.get(f"/api/v1/artworks/{삽화.id}/image").status_code == 404
