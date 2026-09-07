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


def test_자녀에게_token_version_이_있다():
    """JWT 는 발급 후 회수할 수 없다. **폐기는 이 값을 1 올리는 것**이고, 그것으로
    그 자녀의 모든 기기가 한 번에 끊긴다 (`공통규약.md` 「폐기」).

    Redis 블랙리스트를 쓰지 않기로 한 결정이 이 컬럼 하나에 걸려 있다.
    """
    컬럼 = Base.metadata.tables["children"].columns["token_version"]

    assert 컬럼.nullable is False
    # 이미 있는 행에도 값이 들어가야 NOT NULL 로 붙는다. 서버 기본값이 없으면
    # 마이그레이션이 기존 행에서 깨진다.
    assert 컬럼.server_default is not None


def test_폐기는_토큰을_저장하지_않고_한다():
    """토큰 자체를 DB 에 두면 그게 곧 탈취 대상이다. 대조하는 것은 정수 하나다."""
    children = Base.metadata.tables["children"]

    assert not any(c.name.endswith("token") for c in children.columns)
