"""카드 조회가 **문서 정본**을 돌려주는지 본다 (W2 5번).

되묻기는 `docs/장면카드_초안.md` 를 읽고 카드 조회는 픽스처를 읽어, 같은 `c01` 이
화면에서는 「나뭇가지가 툭 부러진다」인데 되묻기는 「그림자를…」을 물었다. 픽스처를
지웠으니 **다시 갈라지면 여기가 먼저 깨진다.**
"""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.scaffold import 질문
from app.scene_cards import 모험카드들, 카드들

AUTH = {"Authorization": "Bearer mock"}

카드목록 = 모험카드들()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(), raise_server_exceptions=False)


def test_스무_장이다():
    """20장 + 튜토리얼 3장. 튜토리얼은 `next` 후보가 아니다 (Stage 1 A-6)."""
    assert len(카드목록) == 20
    assert {"t1", "t2", "t3"} <= set(카드들())


@pytest.mark.parametrize("카드", 카드목록, ids=lambda c: c.card_id)
def test_스무_장이_전부_조회된다(client: TestClient, 카드):
    body = client.get(f"/api/v1/cards/{카드.card_id}", headers=AUTH).json()

    # **글자까지 같다.** 검수본이 바뀌면 코드를 고치지 말고 문서만 고치면 된다는 뜻이다
    assert body["situation"] == 카드.상황문
    assert body["type"] in {"crisis", "discovery", "encounter"}
    assert body["sketch_url"].endswith(f"{카드.card_id}_sketch.webp")
    assert body["prompt_label"] == "탐험가는 어떻게 할까?"


def test_next_는_문서의_카드를_준다(client: TestClient):
    문서 = {c.card_id: c.상황문 for c in 카드목록}

    for _ in range(20):
        body = client.get("/api/v1/cards/next", headers=AUTH).json()

        assert body["situation"] == 문서[body["card_id"]]


def test_next_는_튜토리얼을_주지_않는다(client: TestClient):
    나온것 = {client.get("/api/v1/cards/next", headers=AUTH).json()["card_id"] for _ in range(40)}

    assert not 나온것 & {"t1", "t2", "t3"}
    assert len(나온것) > 1  # 한 장에 고정돼 있지 않다


def test_되묻기와_화면이_같은_장면을_가리킨다(client: TestClient):
    """이번 수리의 이유 그 자체다. 화면의 상황문과 되묻기의 대상이 어긋나면
    프론트가 **어긋난 화면을 기준으로** 되묻기 연출을 판단한다."""
    for 카드 in 카드목록:
        상황문 = client.get(f"/api/v1/cards/{카드.card_id}", headers=AUTH).json()["situation"]

        assert 카드.대상 in 질문(카드.card_id, 1)
        assert 카드.대상 in 상황문


@pytest.mark.parametrize("card_id", ["t1", "c99", "없는카드"])
def test_모르는_카드와_튜토리얼은_404(client: TestClient, card_id: str):
    response = client.get(f"/api/v1/cards/{card_id}", headers=AUTH)

    assert response.status_code == 404
    assert response.json()["error"]["message"] == "찾는 것이 여기 없어요"
