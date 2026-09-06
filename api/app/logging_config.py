"""로깅 설정.

uvicorn 은 자기 로거(`uvicorn.*`)만 설정한다. 우리 로거에 핸들러를 붙이지 않으면
`RequestLogMiddleware` 가 남기는 줄이 **아무 데도 나오지 않는다** — 원문을 안 남기는 대신
`request_id` 로 요청을 되짚기로 했는데, 그 수단이 통째로 사라진다.

포매터는 `extra` 로 넘긴 필드 중 **아래 목록에 있는 것만** 찍는다.
목록에 없는 키는 무시한다 — 실수로 원문을 `extra` 에 실어도 출력으로 새지 않는다.
"""

import logging

APP_LOGGER = "app"

# 출력할 필드. 여기 없는 것은 찍히지 않는다.
SAFE_EXTRA_KEYS = (
    "request_id",
    "method",
    "path",
    "status",
    "duration_ms",
    "query_keys",
    "exc_type",
    # 비용 알람 (app/cost.py)
    "kind",
    "total_usd",
    "limit_usd",
    # Evaluator (app/evaluator.py) — PRD 5장 `eval_result`.
    # **등급은 남기고 문장 조각은 남기지 않는다.** signals·descriptors 는 아이 문장에서
    # 그대로 뽑은 말이라 원문과 같다. 그래서 개수(`signal_count`)만 목록에 있다.
    "grade",
    "tier",
    "signal_count",
    "latency_ms",
    "eval_fallback",
    "prompt_chars",
)


class SafeExtraFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        parts = [f"{key}={getattr(record, key)}" for key in SAFE_EXTRA_KEYS if hasattr(record, key)]
        return " ".join([base, *parts]) if parts else base


def configure_logging(level: int = logging.INFO) -> None:
    """`app.*` 로거에 핸들러를 붙인다. 여러 번 불러도 핸들러가 늘지 않는다."""
    logger = logging.getLogger(APP_LOGGER)

    if not any(isinstance(handler, logging.StreamHandler) for handler in logger.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(SafeExtraFormatter("%(levelname)-8s %(name)s: %(message)s"))
        logger.addHandler(handler)

    logger.setLevel(level)
    # 루트로 올려보내지 않는다 — 다른 곳에 붙은 핸들러로 같은 줄이 두 번 나가는 것을 막는다.
    logger.propagate = False
