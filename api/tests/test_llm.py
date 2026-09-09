"""Gemini 클라이언트가 어디로 가는가 (`주차계획/W5.md` 백엔드 1번).

**여기서 지키는 것은 하나다 — 유료 호출을 끊는 손잡이가 「분기」가 아니라 「주소」일 것.**
설정이 비어 있으면 오늘과 완전히 같은 곳으로 가고, 채워져 있으면 그리로 간다.
`if TESTING:` 을 심으면 **테스트에서만 도는 코드 경로**가 생기고, 그러면 E2E 가 재는
것이 제품이 아니게 된다 (B-3 20% 사고와 같은 모양 · 축 ⑪).
"""

import pytest
from google.genai import errors

from app import llm
from app.artwork import 생성
from app.config import get_settings
from app.evaluator import evaluate
from tests.fake_gemini import 가짜앞단, 못쓰는키


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
    """**`.env` 의 진짜 키를 덮는다.** 환경 변수가 `.env` 를 이긴다 (`app/config.py`).

    값의 근거는 `tests/fake_gemini.못쓰는키` 주석에 있고, **그 값이 정말 못 쓰는
    값인지는 아래 `실물` 테스트가 잰다.**
    """
    monkeypatch.setenv("GEMINI_API_KEY", 못쓰는키)
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


@pytest.mark.실물
async def test_못쓰는_키는_과금이_아니라_거절로_죽는다(monkeypatch: pytest.MonkeyPatch):
    """**뒤집기다 — 이 테스트가 없으면 1번 항목이 안 선 것이다** (완료 판정 1).

    위 셋은 「가짜 앞단으로 갔다」를 잰다. **못 잰 것이 하나 남는다** — **가짜 앞단을
    안 지난 호출이 어떻게 되는가.** 진짜 키가 걸려 있으면 그 호출은 **응답이 오므로
    초록으로 지나가고 청구서로만 보인다.** 틀렸을 때 빨간불이 아니라 돈이 나가는
    자리라, 재는 방법도 뒤집는 것뿐이다.

    **⚠ 「401」이 아니다 — 실측은 `400 INVALID_ARGUMENT · "API key not valid"` 다**
    (2026-09-09). 계획 문서의 「401 로 죽는다」는 줄임말이고, 그대로 단언하면
    **검사가 틀린 것을 문다.**

    **코드만 보면 안 된다** — `400` 은 **요청이 잘못됐을 때도** 온다. 그 둘을 구분하지
    않으면 「키가 거절됐다」와 「우리 본문이 깨졌다」가 같은 초록이 된다 (축 ⑰).
    그래서 **거절 사유가 키를 가리키는지까지 본다.**

    사유는 사람이 읽는 문장(`"API key not valid…"`)이 아니라 **`google.rpc.ErrorInfo`
    의 `reason`** 을 본다. 같은 뜻인데 **영어 문장은 Google 이 언제든 다듬는 것**이고
    `reason` 은 **기계가 읽으라고 있는 값**이다.

    **SDK 를 직접 부른다** — `evaluate()` 는 실패를 삼켜 `fallback` 으로 돌리므로
    거절인지 타임아웃인지가 안 남는다.

    **기본 실행에서는 빠진다** (`pyproject.toml` `addopts`). 진짜 Google 로 나가서
    빠른 잡이 남의 가용성에 묶이면 안 된다. **도는 자리는 느린 잡이다** —
    `uv run pytest -m 실물`.
    """
    monkeypatch.setenv("GEMINI_BASE_URL", "")  # 가짜 앞단을 지나지 않는다

    with pytest.raises(errors.ClientError) as 잡힌:
        await llm.get_client().aio.models.generate_content(
            model=get_settings().evaluator_model, contents="ping"
        )

    사유 = str(잡힌.value)
    assert 잡힌.value.code in (400, 401, 403), f"인증 거절이 아니다 — {사유}"
    assert "API_KEY_INVALID" in 사유, (
        f"거절은 됐는데 키 때문이 아니다. 이 검사는 아무것도 안 잰 것이다 — {사유}"
    )
