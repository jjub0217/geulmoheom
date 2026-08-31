"""스키마가 원문 취급 원칙을 깨지 않는지 본다 (PRD 1.1b · api/CLAUDE.md).

DB 연결 없이 metadata 만 본다 — CI 에는 Postgres 가 없다.
"""

from app.db import Base, engine
from app.models import CardAttempt

# 아이 원문이 들어가도 되는 자리. 둘 다 책 콘텐츠다.
# `book_pages.text` 는 `card_attempts.text` 를 책 페이지로 굳힌 사본이다.
원문_허용 = {("card_attempts", "text"), ("book_pages", "text")}


def test_원문_컬럼은_책_콘텐츠_두_곳뿐이다():
    """새 테이블에 원문을 복사하면 여기서 걸린다."""
    자유서술_컬럼 = {
        (table.name, column.name)
        for table in Base.metadata.tables.values()
        for column in table.columns
        if column.name in {"text", "raw_text", "input_text", "content"}
    }

    assert 자유서술_컬럼 == 원문_허용


def test_events_에는_원문이_들어가지_않는다():
    events = Base.metadata.tables["events"]

    assert "text" not in events.columns
    assert "원문 금지" in events.columns["payload"].comment


def test_원문_컬럼에_출처_주석이_붙어_있다():
    """DB 를 직접 들여다보는 사람에게도 이 열이 무엇인지 알린다."""
    assert "PRD 1.1b" in CardAttempt.__table__.columns["text"].comment


def test_엔진_echo_가_꺼져_있다():
    """echo 를 켜면 SQL 파라미터로 아이 원문이 로그에 찍힌다."""
    assert engine.echo is False


def test_stage1_테이블은_아직_없다():
    """chapters·sessions 는 W6. 지금 만들면 안 쓰는 스키마가 먼저 굳는다."""
    assert "chapters" not in Base.metadata.tables
    assert "sessions" not in Base.metadata.tables
