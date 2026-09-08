"""LLM·이미지 API 하루 비용 누적과 알람 (PRD F-3).

`DAILY_COST_ALERT_USD` 를 넘으면 **하루에 한 번만** 경고를 남긴다. 매 호출마다 짖으면
로그가 묻혀서 아무도 안 본다.

**비용 기록이 요청을 막지 않는다.** Redis 가 죽어도 아이는 계속 쓸 수 있어야 한다 —
여기서 예외가 나면 삼키고 경고만 남긴다.

지금은 호출하는 곳이 없다. W1 5번(LLM 스모크)·6번(이미지 벤치)이 첫 사용처다.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from app import db
from app.config import get_settings

logger = logging.getLogger(__name__)

TTL_SECONDS = 60 * 60 * 24 * 3  # 사흘. 어제치를 들여다볼 여유만 둔다


def _today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def _total_key(날짜: str) -> str:
    return f"cost:{날짜}"


def _alerted_key(날짜: str) -> str:
    return f"cost:alerted:{날짜}"


async def record_usd(amount_usd: float, *, kind: str, client: Any = None) -> float | None:
    """오늘 누적에 더하고, 한도를 넘었으면 한 번만 알린다.

    `kind` 는 `evaluator` · `image` 처럼 무엇에 쓴 돈인지. **원문이나 아이 식별자를 넣지 않는다.**
    돌려주는 값은 오늘 누적(USD). 기록에 실패하면 `None`.
    """
    client = client or db.redis_client
    날짜 = _today()
    한도 = get_settings().daily_cost_alert_usd

    try:
        누적 = float(await client.incrbyfloat(_total_key(날짜), amount_usd))
        await client.expire(_total_key(날짜), TTL_SECONDS)

        if 누적 >= 한도:
            처음 = await client.set(_alerted_key(날짜), "1", nx=True, ex=TTL_SECONDS)
            if 처음:
                logger.error(
                    "일일 비용 한도 초과",
                    extra={"kind": kind, "total_usd": round(누적, 4), "limit_usd": 한도},
                )
    except Exception as exc:
        # 비용 기록 실패가 아이의 요청을 막지 않는다.
        logger.warning("비용 기록 실패", extra={"kind": kind, "exc_type": type(exc).__name__})
        return None

    return 누적


async def today_usd(client: Any = None) -> float:
    """오늘 누적. 운영자가 들여다보는 용도."""
    client = client or db.redis_client
    try:
        값 = await client.get(_total_key(_today()))
    except Exception as exc:
        logger.warning("비용 조회 실패", extra={"exc_type": type(exc).__name__})
        return 0.0
    return float(값) if 값 else 0.0
