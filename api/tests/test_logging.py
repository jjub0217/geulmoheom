"""로그 출력에 목록 밖의 필드가 새지 않는지 본다."""

import logging

from app.logging_config import APP_LOGGER, SafeExtraFormatter, configure_logging


def _찍어본다(**extra) -> str:
    record = logging.LogRecord(
        name="app.request",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="요청 처리",
        args=(),
        exc_info=None,
    )
    record.__dict__.update(extra)
    return SafeExtraFormatter("%(levelname)s %(message)s").format(record)


def test_허용된_필드만_찍힌다():
    출력 = _찍어본다(request_id="abc123", path="/api/v1/attempts", status=200)

    assert "request_id=abc123" in 출력
    assert "path=/api/v1/attempts" in 출력


def test_목록에_없는_필드는_찍히지_않는다():
    """실수로 원문을 extra 에 실어도 출력으로 새지 않는다."""
    출력 = _찍어본다(request_id="abc123", text="붉은 이끼가 덮인 바위 뒤로 살금살금")

    assert "붉은 이끼" not in 출력
    assert "request_id=abc123" in 출력


def test_configure_logging_은_여러_번_불러도_핸들러가_늘지_않는다():
    configure_logging()
    처음 = len(logging.getLogger(APP_LOGGER).handlers)

    configure_logging()

    assert len(logging.getLogger(APP_LOGGER).handlers) == 처음
