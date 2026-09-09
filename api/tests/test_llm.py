"""Gemini 클라이언트가 어디로 가는가 (`주차계획/W5.md` 백엔드 1번).

**여기서 지키는 것은 하나다 — 유료 호출을 끊는 손잡이가 「분기」가 아니라 「주소」일 것.**
설정이 비어 있으면 오늘과 완전히 같은 곳으로 가고, 채워져 있으면 그리로 간다.
`if TESTING:` 을 심으면 **테스트에서만 도는 코드 경로**가 생기고, 그러면 E2E 가 재는
것이 제품이 아니게 된다 (B-3 20% 사고와 같은 모양 · 축 ⑪).
"""

import pytest

from app import llm
from app.artwork import 생성
from app.config import get_settings
from app.evaluator import evaluate
from tests.fake_gemini import 가짜앞단


@pytest.fixture(autouse=True)
def _캐시비우기() -> None:
    """`get_settings`·`get_client` 둘 다 `lru_cache` 다. 안 비우면 앞 테스트가 문 값이 굳는다."""
    get_settings.cache_clear()
    llm.get_client.cache_clear()
    yield
    get_settings.cache_clear()
    llm.get_client.cache_clear()


@pytest.fixture(autouse=True)
def _키와모델(monkeypatch: pytest.MonkeyPatch) -> None:
    # **ASCII 여야 한다.** 키는 헤더로 나가고, 한글을 넣으면 401 이 아니라
    # `UnicodeEncodeError` 로 죽어 「어디로 갔는가」가 안 보인다 (2026-09-09 실측).
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-not-valid-anywhere")
    monkeypatch.setenv("EVALUATOR_MODEL", "gemini-3.1-flash-lite")


def test_base_url_이_비면_오늘과_같은_곳으로_간다(monkeypatch: pytest.MonkeyPatch):
    """운영에서 이 값은 비어 있다. **비었을 때 갈리는 경로가 생기면 안 된다.**"""
    monkeypatch.setenv("GEMINI_BASE_URL", "")

    # SDK 에 공개 접근자가 없다. **요청이 실제로 나갈 주소**라 사적 경로로 본다.
    간곳 = llm.get_client()._api_client._http_options.base_url

    assert "googleapis.com" in (간곳 or "")


async def test_base_url_을_넣으면_평가가_그리로_간다(monkeypatch: pytest.MonkeyPatch):
    """가짜 앞단이 답한 등급이 그대로 나온다 — **G3 는 폴백 등급(G1)이 아니다.**"""
    with 가짜앞단() as 앞단:
        monkeypatch.setenv("GEMINI_BASE_URL", 앞단.base_url)

        결과 = await evaluate("은빛 검을 들고 그림자 뒤로 살금살금 돌아간다", 기록=False)

        assert 결과.grade == "G3"
        assert 결과.fallback is None
        assert 앞단.받은경로, "가짜 앞단에 요청이 안 왔다 — 진짜 Gemini 로 나갔다는 뜻이다"


async def test_이미지_생성도_그리로_간다(monkeypatch: pytest.MonkeyPatch):
    """**갈래는 주소로 나뉜다** — 이미지 모델 이름에 `image` 가 들어간다 (`adr/0006`).

    삽화 경로는 굽기 전에 **출력 검사**(글 모델)를 먼저 부르므로, 이 하나가 **두 갈래를
    다 지난다** — 둘 중 하나라도 진짜로 나가면 여기서 안 끝난다.
    """
    monkeypatch.setenv("IMAGE_MODEL", "gemini-3.1-flash-lite-image")

    with 가짜앞단() as 앞단:
        monkeypatch.setenv("GEMINI_BASE_URL", 앞단.base_url)

        결과 = await 생성("c01", "legendary")

        assert 결과.image, f"그림이 안 왔다 (사유={결과.사유})"
        assert 결과.mime == "image/png"
        assert any("image" in 길 for 길 in 앞단.받은경로), "이미지 갈래로 안 갔다"
        assert any("image" not in 길 for 길 in 앞단.받은경로), "출력 검사가 안 돌았다"
