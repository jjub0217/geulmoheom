"""일일 비용 알람 (W1 4번 「일 한도 알람 발동 확인」)."""

import logging
from types import SimpleNamespace

import pytest

from app.cost import record_usd, today_usd
from app.logging_config import SAFE_EXTRA_KEYS, SafeExtraFormatter

한도 = 10.0


class 가짜레디스:
    """redis.asyncio 중 cost.py 가 쓰는 부분만 흉내낸다."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def incrbyfloat(self, key: str, amount: float) -> str:
        self.store[key] = str(float(self.store.get(key, 0)) + amount)
        return self.store[key]

    async def expire(self, key: str, seconds: int) -> bool:
        return True

    async def set(self, key: str, value: str, nx: bool = False, ex: int | None = None):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    async def get(self, key: str) -> str | None:
        return self.store.get(key)


class 죽은레디스(가짜레디스):
    async def incrbyfloat(self, key: str, amount: float) -> str:
        raise ConnectionError("Error 61 connecting to localhost:6381")


@pytest.fixture(autouse=True)
def 한도를_고정한다(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.cost.get_settings", lambda: SimpleNamespace(daily_cost_alert_usd=한도))


@pytest.fixture
def redis() -> 가짜레디스:
    return 가짜레디스()


async def test_누적된다(redis: 가짜레디스):
    await record_usd(1.5, kind="evaluator", client=redis)
    누적 = await record_usd(2.0, kind="image", client=redis)

    assert 누적 == pytest.approx(3.5)
    assert await today_usd(client=redis) == pytest.approx(3.5)


async def test_한도_아래면_알람이_없다(redis: 가짜레디스, caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.ERROR):
        await record_usd(한도 - 0.01, kind="evaluator", client=redis)

    assert caplog.records == []


async def test_한도를_넘으면_알람이_뜬다(redis: 가짜레디스, caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.ERROR):
        await record_usd(한도, kind="evaluator", client=redis)

    assert len(caplog.records) == 1
    기록 = caplog.records[0]
    assert 기록.levelno == logging.ERROR
    assert 기록.kind == "evaluator"
    assert 기록.total_usd == pytest.approx(한도)
    assert 기록.limit_usd == 한도


async def test_알람은_하루에_한_번만_짖는다(redis: 가짜레디스, caplog: pytest.LogCaptureFixture):
    """매 호출마다 짖으면 로그가 묻혀서 아무도 안 본다."""
    with caplog.at_level(logging.ERROR):
        for _ in range(5):
            await record_usd(한도, kind="image", client=redis)

    assert len(caplog.records) == 1


async def test_알람_내용이_로그_출력에_실린다(redis: 가짜레디스, caplog: pytest.LogCaptureFixture):
    """허용 목록에 없는 필드는 포매터가 버린다. 알람 필드가 목록에 있어야 실제로 보인다."""
    assert {"kind", "total_usd", "limit_usd"} <= set(SAFE_EXTRA_KEYS)

    with caplog.at_level(logging.ERROR):
        await record_usd(한도, kind="evaluator", client=redis)

    출력 = SafeExtraFormatter("%(message)s").format(caplog.records[0])

    assert "limit_usd=10.0" in 출력
    assert "kind=evaluator" in 출력


async def test_redis_가_죽어도_요청을_막지_않는다(
    caplog: pytest.LogCaptureFixture,
):
    """비용 기록 실패로 아이가 못 쓰게 되면 안 된다."""
    with caplog.at_level(logging.WARNING):
        결과 = await record_usd(1.0, kind="evaluator", client=죽은레디스())

    assert 결과 is None
    assert caplog.records[0].levelno == logging.WARNING


async def test_실패_로그에_접속정보가_없다(caplog: pytest.LogCaptureFixture):
    """redis 예외 문자열에는 호스트·포트가 들어 있다."""
    with caplog.at_level(logging.WARNING):
        await record_usd(1.0, kind="evaluator", client=죽은레디스())

    전문 = caplog.records[0].getMessage() + repr(caplog.records[0].__dict__)

    assert "6381" not in 전문
    assert "ConnectionError" in 전문  # 타입은 남긴다 — 디버깅에 필요하다
