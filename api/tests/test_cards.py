"""카드 조회가 **문서 정본**을 돌려주는지 본다 (W2 5번).

되묻기는 `docs/장면카드_초안.md` 를 읽고 카드 조회는 픽스처를 읽어, 같은 `c01` 이
화면에서는 「나뭇가지가 툭 부러진다」인데 되묻기는 「그림자를…」을 물었다. 픽스처를
지웠으니 **다시 갈라지면 여기가 먼저 깨진다.**
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, update

from app import db
from app.models import Card
from app.scaffold import 질문
from app.scene_cards import 모험카드들, 카드들

카드목록 = 모험카드들()


# 인증된 `client` 는 `tests/conftest.py` 에 있다 — 진짜 자녀 토큰이 들어간다 (E-3).


def test_스무_장이다():
    """20장 + 튜토리얼 3장. 튜토리얼은 `next` 후보가 아니다 (Stage 1 A-6)."""
    assert len(카드목록) == 20
    assert {"t1", "t2", "t3"} <= set(카드들())


@pytest.mark.parametrize("카드", 카드목록, ids=lambda c: c.card_id)
def test_스무_장이_전부_조회된다(client: TestClient, 카드):
    body = client.get(f"/api/v1/cards/{카드.card_id}").json()

    # **글자까지 같다.** 검수본이 바뀌면 코드를 고치지 말고 문서만 고치면 된다는 뜻이다
    assert body["situation"] == 카드.상황문
    assert body["type"] in {"crisis", "discovery", "encounter"}
    assert body["sketch_url"].endswith(f"{카드.card_id}_sketch.webp")
    assert body["prompt_label"] == "탐험가는 어떻게 할까?"


def test_next_는_문서의_카드를_준다(client: TestClient):
    문서 = {c.card_id: c.상황문 for c in 카드목록}

    for _ in range(20):
        body = client.get("/api/v1/cards/next").json()

        assert body["situation"] == 문서[body["card_id"]]


def test_next_는_튜토리얼을_주지_않는다(client: TestClient):
    나온것 = {client.get("/api/v1/cards/next").json()["card_id"] for _ in range(40)}

    assert not 나온것 & {"t1", "t2", "t3"}
    assert len(나온것) > 1  # 한 장에 고정돼 있지 않다


def test_되묻기와_화면이_같은_장면을_가리킨다(client: TestClient):
    """이번 수리의 이유 그 자체다. 화면의 상황문과 되묻기의 대상이 어긋나면
    프론트가 **어긋난 화면을 기준으로** 되묻기 연출을 판단한다."""
    for 카드 in 카드목록:
        상황문 = client.get(f"/api/v1/cards/{카드.card_id}").json()["situation"]

        assert 카드.대상 in 질문(카드.card_id, 1)
        assert 카드.대상 in 상황문


@pytest.mark.parametrize("card_id", ["t1", "c99", "없는카드"])
def test_모르는_카드와_튜토리얼은_404(client: TestClient, card_id: str):
    response = client.get(f"/api/v1/cards/{card_id}")

    assert response.status_code == 404
    assert response.json()["error"]["message"] == "찾는 것이 여기 없어요"


# ── DB 에서 온다 (A0-1 잔여) ───────────────────────────────
#
# 위 테스트들은 **문서와 응답이 같은가**를 본다. 아래 둘은 **응답이 어느 쪽을 읽는가**를
# 가른다 — 문서는 그대로 두고 DB 만 고치면, 문서 리더를 읽는 코드는 안 따라온다.


async def test_카드_조회는_DB_를_읽는다(client: TestClient):
    async with db.SessionLocal() as session:
        await session.execute(
            update(Card).where(Card.id == "c01").values(situation_text="DB 만 아는 장면")
        )
        await session.commit()

    body = client.get("/api/v1/cards/c01").json()

    assert body["situation"] == "DB 만 아는 장면"


async def test_next_도_DB_를_읽는다(client: TestClient):
    """한 장만 남기면 그 한 장만 나와야 한다. 문서를 읽고 있으면 스무 장에서 고른다."""
    async with db.SessionLocal() as session:
        await session.execute(delete(Card).where(Card.id != "c01"))
        await session.commit()

    나온것 = {client.get("/api/v1/cards/next").json()["card_id"] for _ in range(10)}

    assert 나온것 == {"c01"}


async def test_카드를_안_뿌렸으면_준비된_것이_아니다(client: TestClient):
    """**아이가 빈 화면을 보기 전에 알아야 한다.** 뿌리는 것은 배포의 일이라
    (`make seed`) 잊을 수 있고, 잊으면 `/cards/next` 가 줄 것이 없다."""
    async with db.SessionLocal() as session:
        await session.execute(delete(Card))
        await session.commit()

    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["checks"]["cards"] == "down"
