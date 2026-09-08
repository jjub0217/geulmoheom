"""환경 분리와 키 보관 (W1 4번)."""

import pytest

from app.config import PILOT_REQUIRED, Settings, get_settings, missing_pilot_keys


def test_비밀값은_repr_에_찍히지_않는다():
    """설정 객체가 로그·오류 리포트에 통째로 들어가도 키가 새지 않아야 한다."""
    settings = Settings(jwt_secret="아주-긴-난수", gemini_api_key="AIza-실제키")

    assert "아주-긴-난수" not in repr(settings)
    assert "AIza-실제키" not in repr(settings)
    assert "AIza-실제키" not in str(settings.gemini_api_key)


def test_비밀값은_명시적으로_꺼내야_읽힌다():
    settings = Settings(jwt_secret="아주-긴-난수")

    assert settings.jwt_secret.get_secret_value() == "아주-긴-난수"


def test_dev_는_키가_비어도_뜬다():
    """목 서버 단계에서는 키 없이 개발할 수 있어야 한다."""
    settings = Settings(
        app_env="dev", gemini_api_key="", jwt_secret="", image_model="", evaluator_model=""
    )

    assert missing_pilot_keys(settings) == []


def test_pilot_은_키가_비면_뜨지_않는다():
    """조용히 뜨면 아이 문장을 받아 놓고 Evaluator 호출에서 터진다."""
    settings = Settings(
        app_env="pilot", gemini_api_key="", jwt_secret="", image_model="", evaluator_model=""
    )

    assert sorted(missing_pilot_keys(settings)) == sorted(PILOT_REQUIRED)


def test_기동이_실패해도_키_값이_새지_않는다(monkeypatch: pytest.MonkeyPatch):
    """pydantic ValidationError 는 입력 dict 를 통째로 메시지에 싣는다.

    그래서 이 검사를 검증기가 아니라 get_settings 에서 한다. 기동 실패
    트레이스백은 로그·CI 로 나가므로 값이 섞이면 그대로 유출이다.
    """
    monkeypatch.setenv("APP_ENV", "pilot")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("IMAGE_MODEL", "")
    monkeypatch.setenv("JWT_SECRET", "채워진-비밀")
    monkeypatch.setenv("EVALUATOR_MODEL", "어떤-모델")
    get_settings.cache_clear()

    with pytest.raises(RuntimeError) as 잡힌것:
        get_settings()

    메시지 = str(잡힌것.value)
    assert "gemini_api_key" in 메시지
    assert "채워진-비밀" not in 메시지

    get_settings.cache_clear()


def test_키가_다_있으면_pilot_이_뜬다():
    settings = Settings(
        app_env="pilot",
        gemini_api_key="k",
        jwt_secret="s",
        image_model="어떤-이미지-모델",
        evaluator_model="어떤-모델",
        r2_account_id="acct",
        r2_access_key_id="키",
        r2_secret_access_key="비밀",
        r2_public_base_url="https://img.geulmoheom.test",
    )

    assert missing_pilot_keys(settings) == []


def test_R2_가_비면_pilot_이_안_뜬다():
    """**2026-09-08 에 넣었다.** 파일럿에 반드시 필요한데 검사에 없어서, 비어 있어도
    서버가 아무 소리 없이 떴다. 로컬 디스크 폴백은 개발·프리테스트용이고
    **파일럿에서 그리로 떨어지면 삽화가 컨테이너와 함께 사라진다.**"""
    settings = Settings(
        app_env="pilot",
        gemini_api_key="k",
        jwt_secret="s",
        image_model="어떤-이미지-모델",
        evaluator_model="어떤-모델",
    )

    assert set(missing_pilot_keys(settings)) == {
        "r2_account_id",
        "r2_access_key_id",
        "r2_secret_access_key",
        "r2_public_base_url",
    }


def test_모델명에_기본값이_없다():
    """구체 모델명은 코드가 아니라 `.env` 에 있다.

    처음 이유는 adr/0005 결정 2번(「지금 정하지 않는다」)이었고, W2 벤치로
    `evaluator_model` 은 확정됐다 (`benchmarks/W2-evaluator-bench.md`).
    그래도 기본값은 두지 않는다 — 코드에 값이 박히면 `.env` 를 안 채워도 도는 것처럼
    보이고, `PILOT_REQUIRED` 검사가 그대로 무력해진다.
    """
    기본값 = Settings.model_fields

    assert 기본값["evaluator_model"].default == ""
    assert 기본값["gm_model"].default == ""


def test_설정값에_주석이_섞이지_않는다():
    """`.env` 의 `KEY=   # 설명` 은 값이 비었을 때 주석 전체가 값이 된다.

    dotenv 는 값이 **있을 때만** 인라인 주석을 떼어낸다. 빈 값 뒤의 주석은 그대로 값이 된다.
    2026-09-01 에 `IMAGE_PROVIDER` 가 `'# fal | replicate'` 로 읽히고 있었다 —
    프로바이더 분기가 조용히 어긋나는 종류의 버그다.
    """
    설정 = Settings()

    섞인것 = [
        이름
        for 이름, 값 in 설정.model_dump().items()
        if isinstance(값, str) and 값.lstrip().startswith("#")
    ]

    assert 섞인것 == []


def test_cors_기본값에_와일드카드가_없다():
    """`allow_credentials=True` 와 `"*"` 는 함께 쓸 수 없다.

    Starlette 는 둘을 같이 줘도 **에러를 내지 않고 요청 오리진을 그대로 반사한다.**
    CORS 오류가 안 나서 정상으로 보이지만, 실제로는 임의의 사이트가 아이 세션으로
    API 를 호출할 수 있는 상태다 (`공통규약.md` 「CORS」).
    """
    오리진들 = Settings().cors_origins

    assert 오리진들
    assert "*" not in 오리진들


def test_cors_기본값은_https_다():
    """개발 환경도 https 다 (`공통규약.md` 「개발 환경도 https다」).

    `__Host-` 쿠키는 Secure 를 강제하는데 Secure 쿠키가 `http://localhost` 에 붙는지가
    브라우저마다 갈린다. 파일럿이 태블릿이라 Safari 를 건너뛸 수 없어서, 여기가
    http 로 되돌아가면 인증이 **로컬에서만** 되는 상태로 조용히 돌아간다.
    """
    for 오리진 in Settings().cors_origins:
        assert 오리진.startswith("https://"), 오리진
