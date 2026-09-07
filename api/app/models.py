"""Stage 0 테이블. 기준은 `MVP_PRD.md` 6장 + `docs/api/Stage0.md` 10절.

Stage 1 의 `chapters`·`sessions` 는 여기 없다 — W6 에 추가한다.

**`card_attempts.text` 가 아이 원문이 들어가는 유일한 자리다** (PRD 1.1b).
다른 테이블(특히 `events.payload`)에 원문을 복사하지 않는다.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

CARD_TYPES = ("crisis", "discovery", "encounter")  # 위기 / 발견 / 만남
GRADES = ("G0", "G1", "G2", "G3")  # 내부 전용. 응답에 넣지 않는다 (용어사전 3장)
TIERS = ("basic", "rare", "legendary")  # 아이가 보는 단계
ARTWORK_STATUSES = ("pending", "ready", "failed")
VISIBILITIES = ("private", "family", "public")  # Stage 0 은 항상 private
PAGE_SOURCES = ("card", "chapter")


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


class Parent(Base):
    __tablename__ = "parents"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consent_version: Mapped[str | None] = mapped_column(String(32))
    # 아이 문장을 Evaluator 개선용 라벨링에 쓰는 별도 동의. 거부해도 서비스는 이용 가능하고
    # 책에는 원문이 그대로 남는다 (Stage0.md 1절). 라벨링 셋 추출 시 이 값으로 거른다.
    labeling_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Child(Base):
    __tablename__ = "children"
    __table_args__ = (CheckConstraint("age_band between 10 and 12", name="ck_children_age_band"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    parent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("parents.id", ondelete="CASCADE"))
    nickname: Mapped[str] = mapped_column(String(40))
    age_band: Mapped[int] = mapped_column(SmallInteger)
    guide_name: Mapped[str | None] = mapped_column(String(40))
    # 접속 코드는 평문으로 두지 않는다. 6자리·24시간·1회용 (Stage0.md 1절)
    access_code_hash: Mapped[str | None] = mapped_column(String(255))
    access_code_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    access_code_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    daily_cap: Mapped[int] = mapped_column(Integer, default=5)
    # 일일 상한 리셋 기준. 헤더를 그대로 믿을지 저장값으로 고정할지는 미결 11-4 (W3)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Seoul")
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Card(Base):
    """장면 카드 20장 (`docs/장면카드_초안.md`). 튜토리얼 T1~T3 도 여기 들어간다."""

    __tablename__ = "cards"
    __table_args__ = (CheckConstraint(f"type in {CARD_TYPES}", name="ck_cards_type"),)

    id: Mapped[str] = mapped_column(String(16), primary_key=True)  # "c01", "t1"
    type: Mapped[str] = mapped_column(String(16))
    situation_text: Mapped[str] = mapped_column(Text)
    prompt_label: Mapped[str] = mapped_column(String(80))
    noun_tags: Mapped[list[str]] = mapped_column(ARRAY(String(32)), default=list)
    sketch_r2_key: Mapped[str] = mapped_column(String(255))
    display_order: Mapped[int] = mapped_column(Integer)  # `order` 는 SQL 예약어


class CardAttempt(Base):
    """카드 1장에 대한 입력 1회.

    `text` 는 **로그가 아니라 아이의 책 콘텐츠**다 (PRD 1.1b). 여기 말고 어디에도 복사하지 않는다.
    """

    __tablename__ = "card_attempts"
    __table_args__ = (
        CheckConstraint(f"grade in {GRADES}", name="ck_card_attempts_grade"),
        CheckConstraint(f"tier is null or tier in {TIERS}", name="ck_card_attempts_tier"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    child_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("children.id", ondelete="CASCADE"), index=True
    )
    card_id: Mapped[str] = mapped_column(ForeignKey("cards.id"))
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    retry_of: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("card_attempts.id"))
    prompted: Mapped[bool] = mapped_column(Boolean, default=False)
    grade: Mapped[str] = mapped_column(String(2))
    tier: Mapped[str | None] = mapped_column(String(16))
    signals: Mapped[dict] = mapped_column(JSONB, default=dict)
    scaffold_count: Mapped[int] = mapped_column(Integer, default=0)
    char_len: Mapped[int] = mapped_column(
        Integer,
        comment=(
            "공백 포함 원문 길이 (PRD 5장, 2026-09-07 확정). 공백·줄바꿈을 걷어내지 않는다 — "
            "H2 합격선(150자)과 입력 화면의 「30자」가 같은 정의 위에 선다"
        ),
    )
    text: Mapped[str] = mapped_column(
        Text, comment="아이 원문. 책 콘텐츠로 보관한다 (PRD 1.1b). 로그·APM 으로 복사 금지"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class Artwork(Base):
    __tablename__ = "artworks"
    __table_args__ = (
        CheckConstraint(f"status in {ARTWORK_STATUSES}", name="ck_artworks_status"),
        CheckConstraint(f"tier in {TIERS}", name="ck_artworks_tier"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    card_attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("card_attempts.id", ondelete="CASCADE"), index=True
    )
    tier: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    r2_key: Mapped[str | None] = mapped_column(String(255))
    # 15초를 넘기면 기본 에셋으로 확정한다 (Stage0.md 5절 B-3)
    fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Book(Base):
    """자녀 1명 = 책 1권 (Stage 0)."""

    __tablename__ = "books"
    __table_args__ = (CheckConstraint(f"visibility in {VISIBILITIES}", name="ck_books_visibility"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    child_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("children.id", ondelete="CASCADE"), unique=True
    )
    title: Mapped[str] = mapped_column(String(120))
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BookPage(Base):
    """카드별 **최고 티어 시도 1건**이 한 페이지. 티어가 오르면 이 행을 교체한다."""

    __tablename__ = "book_pages"
    __table_args__ = (
        UniqueConstraint("book_id", "source", "source_id", name="uq_book_pages_source"),
        CheckConstraint(f"source in {PAGE_SOURCES}", name="ck_book_pages_source"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    book_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(16), default="card")
    source_id: Mapped[str] = mapped_column(String(64))  # 카드 id / 챕터 id
    page_no: Mapped[int] = mapped_column(Integer)
    card_attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("card_attempts.id"))
    artwork_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("artworks.id"))
    tier: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(
        Text, comment="아이 원문 그대로. 맞춤법·AI 보정 없음 (Stage0.md 6절)"
    )
    achieved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Event(Base):
    """append-only 로그 (`검증가설_성공지표.md` 로그 이벤트 10종).

    **`payload` 에 아이 원문을 넣지 않는다.** 길이·종류 같은 파생값만 담는다 (PRD 1.1b).
    """

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    child_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("children.id", ondelete="CASCADE"), index=True
    )
    event: Mapped[str] = mapped_column(String(64), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    payload: Mapped[dict] = mapped_column(
        JSONB, default=dict, comment="원문 금지. 파생값(길이·종류·티어)만"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
