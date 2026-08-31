"""환경 분리와 키 보관 (W1 4번)."""

import pytest

from app.config import PILOT_REQUIRED, Settings, get_settings, missing_pilot_keys


def test_비밀값은_repr_에_찍히지_않는다():
    """설정 객체가 로그·오류 리포트에 통째로 들어가도 키가 새지 않아야 한다."""
    settings = Settings(jwt_secret="아주-긴-난수", anthropic_api_key="sk-ant-실제키")

    assert "아주-긴-난수" not in repr(settings)
    assert "sk-ant-실제키" not in repr(settings)
    assert "sk-ant-실제키" not in str(settings.anthropic_api_key)


def test_비밀값은_명시적으로_꺼내야_읽힌다():
    settings = Settings(jwt_secret="아주-긴-난수")

    assert settings.jwt_secret.get_secret_value() == "아주-긴-난수"


def test_dev_는_키가_비어도_뜬다():
    """목 서버 단계에서는 키 없이 개발할 수 있어야 한다."""
    settings = Settings(app_env="dev", anthropic_api_key="", jwt_secret="", image_api_key="")

    assert missing_pilot_keys(settings) == []


def test_pilot_은_키가_비면_뜨지_않는다():
    """조용히 뜨면 아이 문장을 받아 놓고 Evaluator 호출에서 터진다."""
    settings = Settings(app_env="pilot", anthropic_api_key="", jwt_secret="", image_api_key="")

    assert sorted(missing_pilot_keys(settings)) == sorted(PILOT_REQUIRED)


def test_기동이_실패해도_키_값이_새지_않는다(monkeypatch: pytest.MonkeyPatch):
    """pydantic ValidationError 는 입력 dict 를 통째로 메시지에 싣는다.

    그래서 이 검사를 검증기가 아니라 get_settings 에서 한다. 기동 실패
    트레이스백은 로그·CI 로 나가므로 값이 섞이면 그대로 유출이다.
    """
    monkeypatch.setenv("APP_ENV", "pilot")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("IMAGE_API_KEY", "")
    monkeypatch.setenv("JWT_SECRET", "채워진-비밀")
    get_settings.cache_clear()

    with pytest.raises(RuntimeError) as 잡힌것:
        get_settings()

    메시지 = str(잡힌것.value)
    assert "anthropic_api_key" in 메시지
    assert "채워진-비밀" not in 메시지

    get_settings.cache_clear()


def test_키가_다_있으면_pilot_이_뜬다():
    settings = Settings(app_env="pilot", anthropic_api_key="k", jwt_secret="s", image_api_key="i")

    assert missing_pilot_keys(settings) == []
