"""토큰 수명 — **역할마다 다르다** (`adr/0014` 결정 4).

**하나였다.** `MAX_AGE = 30일` 을 부모와 아이가 같이 썼고, 그래서 공용 데스크탑에서
부모가 한 번 로그인하면 **30일 동안 아이가 학부모 화면에 닿았다** — 자녀 삭제와
접속 코드 재발급이 거기 있다. 그것이 `adr/0014` 결정 3 위험의 **실제 크기**였다.

**아이는 30일 그대로다.** 아이까지 짧게 하면 **매주 학부모가 코드를 다시 뽑아야** 하고,
그건 이 제품에서 가드레일이 아니라 막힘이다.
"""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.config import get_settings
from app.tokens import ALGORITHM, issue, 수명


def _남은시간(토큰: str) -> timedelta:
    청구 = jwt.decode(토큰, get_settings().jwt_secret.get_secret_value(), algorithms=[ALGORITHM])
    return datetime.fromtimestamp(청구["exp"], UTC) - datetime.now(UTC)


@pytest.fixture(autouse=True)
def _설정을_다시_읽는다():
    """**`get_settings()` 에 `@lru_cache` 가 걸려 있다.**

    앞 검사가 `monkeypatch` 로 환경을 바꾼 뒤 캐시를 채워 두면, 그 검사가 끝나 환경이
    돌아와도 **캐시된 설정은 그대로 남는다.** 그 위에서 수명을 재면 **초록이 거짓**이 된다.
    """
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_부모_토큰은_설정된_수명으로_발급된다():
    """공용 데스크탑에서 부모 세션이 길게 남으면 **아이가 학부모 화면에 닿는다.**"""
    남음 = _남은시간(issue(uuid.uuid4(), "parent"))

    assert timedelta(hours=1, minutes=55) < 남음 <= timedelta(hours=2)


def test_아이_토큰은_30일_그대로다():
    """**아이는 안 건드린다.** 짧게 하면 매주 재발급이 필요해진다."""
    남음 = _남은시간(issue(uuid.uuid4(), "child", token_version=1))

    assert timedelta(days=29, hours=23) < 남음 <= timedelta(days=30)


def test_수명이_설정을_읽는다_코드에_안_박혀_있다():
    """**값은 설정에 있다** (`adr/0014` 결정 4). 바꿀 근거가 생기면 그 자리만 고친다.

    **이 검사가 없으면 「2시간」이 코드에 박혀도 위 둘이 초록이다** — 둘 다 기본값이
    2시간일 때 같은 답을 낸다.
    """
    설정 = get_settings()
    원래 = 설정.parent_session_hours
    try:
        object.__setattr__(설정, "parent_session_hours", 5)
        assert 수명("parent") == timedelta(hours=5)
    finally:
        object.__setattr__(설정, "parent_session_hours", 원래)

    assert 수명("child") == timedelta(days=30)
