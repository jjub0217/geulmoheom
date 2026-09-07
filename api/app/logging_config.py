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
    # 입력 검사 (app/moderation.py) — `안전_어휘_기준.md` 6장
    # `moderation_blocked` (direction, category, hash). **원문은 여기 자리가 없다** —
    # 해시는 되돌릴 수 없고, 카테고리는 3장 이름의 ASCII 슬러그다.
    # `moderation_unavailable` 은 「막았다」가 아니라 「판정을 못 받았다」이고,
    # 둘을 안 나누면 프로바이더 장애가 「아이들이 나쁜 말을 썼다」로 보인다.
    "direction",
    "category",
    # 알아본 카테고리를 이어 붙인 것 (`gore+self_harm`). **모델 문자열이 아니라 우리
    # 표에서 만든다** — 그 필드는 모델이 자유롭게 채워서 아이 원문이 섞여 들어올 수 있다.
    # 없으면 「자해가 섞였지만 단독이 아니라 안 센 건」이 전수 검토에서 안 보인다.
    "category_label",
    "text_hash",
    "moderation_unavailable",
    # KPI 이벤트 (app/events.py) — PRD 5장 표의 나머지 필드.
    # **여기 없는 것은 `events` 행에는 남고 로그 줄에서만 사라진다** — 둘이 갈리면
    # 「행은 있는데 로그가 비었다」로 보여서 원인을 엉뚱한 데서 찾게 된다.
    "locked",
    "input_type",
    "char_len",
    "prev_grade",
    "prompted",
    "followed_by_free",
    "next_char_len",
    "cap",
    "layer",
    # 기록 자체가 실패했을 때 (`app/events.py` `남기기`). **잃은 것이 무엇인지는
    # 이름으로만 남긴다** — 값이 실리면 그게 곧 원문이 새는 경로다.
    "event_names",
    # 되묻기 (app/scaffold.py) — PRD 5장 `scaffold_triggered`.
    # 질문은 카드 명사 태그로 만든 것이라 원문이 아니지만, **로그에 담지 않는다.**
    # 세는 데 필요한 것은 몇 번째였는지와 어느 카드였는지뿐이다.
    "card_id",
    "attempt",
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
