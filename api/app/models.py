"""Stage 0 테이블. 기준은 `MVP_PRD.md` 6장 + `docs/api/Stage0.md` 10절.

Stage 1 의 `chapters`·`chapter_turns` 는 이 파일 아래쪽에 있다 (W7 3번).
**`sessions` 는 아직 없다** — 턴 상태는 `chapters` 한 행이 들고 있고, 요약·상태
추출 체인이 붙는 2번(A-2)에서 그 자리가 정해진다.

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
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

CARD_TYPES = ("crisis", "discovery", "encounter")  # 위기 / 발견 / 만남
# 튜토리얼 T1~T3 의 자리. **문서의 그 열은 유형이 아니라 「목적」**이라 대응하는 값이
# 없다 (`app/scene_cards.py`). 카드로는 들어가되 `/cards/next` 후보가 아니다
# (노출 경로는 Stage 1 A-6). **`CARD_TYPES` 를 넓히지 않는다** — 그 셋은 API 의
# `type` 이고, 넓히면 튜토리얼이 모험 카드 조회에 섞여 나간다
TUTORIAL_TYPE = "tutorial"
DB_CARD_TYPES = (*CARD_TYPES, TUTORIAL_TYPE)
GRADES = ("G0", "G1", "G2", "G3")  # 내부 전용. 응답에 넣지 않는다 (용어사전 3장)
TIERS = ("basic", "rare", "legendary")  # 아이가 보는 단계
# `failed` 는 2026-09-08 계약에서 빠졌다 (`Stage0.md` 5절). **제약도 같이 좁힌다** —
# 넓은 채로 두면 코드가 못 쓰는 값을 DB 는 받아들이고, 그 행은 API 로 못 나온다.
ARTWORK_STATUSES = ("pending", "ready")
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
    #
    # **인덱스가 있어야 한다.** 아이는 코드 하나만 들고 오므로(`POST /child/auth`)
    # 이 컬럼이 조회 조건이다. 해시는 소금 없는 HMAC 이라 등호로 찾을 수 있다 —
    # 그 선택의 이유는 `app/accounts.py` 「접속코드해시」에 적어 뒀다.
    #
    # **유니크다.** 코드가 6자리라 살아 있는 코드끼리 겹칠 수 있고, 겹치면 조회가
    # 아무 쪽이나 골라 **다른 아이의 계정으로 들어가진다.** 확률은 낮지만 값이
    # 회복 불가라 「나오면 처리한다」가 아니라 **DB 가 못 만들게** 막는다.
    # Postgres 의 유니크는 NULL 을 여럿 허용하므로, 코드를 다 쓴 자녀들(NULL)은
    # 서로 부딪히지 않는다.
    access_code_hash: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    access_code_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    access_code_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    daily_cap: Mapped[int] = mapped_column(Integer, default=5)
    # 일일 상한 리셋 기준. 헤더를 그대로 믿을지 저장값으로 고정할지는 미결 11-4 (W3)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Seoul")
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # JWT 는 발급 후 서버가 회수할 수 없다. 이 값을 payload 에 담고 검증 때 여기와
    # 대조해 다르면 401 — **폐기는 값을 1 올리는 것**이고, 그 한 번으로 이 자녀의
    # 모든 기기가 끊긴다 (`공통규약.md` 「폐기」). 접속 코드 재발급·자녀 삭제가
    # 올린다. Redis 블랙리스트를 쓰지 않기로 한 결정이 이 정수 하나에 걸려 있다.
    token_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default="1",
        comment=(
            "자녀 토큰 폐기용 세대 번호 (공통규약.md 「폐기」). JWT payload 값과 다르면 401. "
            "접속 코드 재발급·자녀 삭제 시 1 올린다"
        ),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Card(Base):
    """장면 카드 20장 (`docs/장면카드_초안.md`). 튜토리얼 T1~T3 도 여기 들어간다."""

    __tablename__ = "cards"
    __table_args__ = (CheckConstraint(f"type in {DB_CARD_TYPES}", name="ck_cards_type"),)

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
    # Evaluator 가 주는 `["adj:은빛", ...]` 그대로다 (`app/evaluator.py`). **`dict` 가
    # 아니다** — JSONB 는 어느 쪽도 받지만, 선언이 틀려 있으면 읽는 쪽이 `.get()` 을 쓴다
    signals: Mapped[list[str]] = mapped_column(JSONB, default=list)
    highlights: Mapped[list[dict]] = mapped_column(
        JSONB,
        default=list,
        server_default="[]",
        comment=(
            "화면에 실제로 덧칠된 묘사어 (2026-09-08, Stage0.md 10절). "
            "signals 에서 다시 만들면 줄어든다 — 원형(「캄캄한」)과 활용형(「캄캄했지만」)이 "
            "달라 원문 대조에서 걸러진다. 프리테스트 관찰 신호 7번이 이 값을 본다"
        ),
    )
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


BEATS = ("intro", "explore", "rising_action", "approach", "trial", "resolution")
# **넷이 동등하다** (PRD A-4). **「보스」를 식별자에도 쓰지 않는다** (`용어사전.md` 8장)
TRIAL_PATHS = ("force", "persuade", "observe", "care")
TURN_INPUT_TYPES = ("free", "choice")  # 자유 묘사 / 선택지 — `Stage1.md` 2절


class Chapter(Base):
    """한 아이의 챕터 한 판 (`docs/api/Stage1.md` 1절 · W7 3번).

    **⭐ 진행 중인 챕터는 하나다.** 부분 유니크 인덱스로 **DB 가 지킨다** — 코드로만
    막으면 **새로고침 두 번에 두 판이 열리고**, 그러면 아이가 쓴 이야기가 갈라진다.

    **⛔ 아이 원문이 여기 없다.** `narrative`·`choices` 는 **GM 이 낸 글**이고,
    `state` 는 요약이다 (PRD 4.2 의 부분집합). 원문이 가도 되는 곳은
    **`card_attempts.text` 하나**다 (PRD 1.1b · `api/CLAUDE.md`).

    **`narrative` 를 저장하는 이유는 새로고침이다.** `GET /chapters/current` 가
    **지금 장면을 그대로 돌려줘야** 아이가 이야기를 잃지 않는다 — 계약 1절이
    **「아이가 새로고침해도 이야기를 잃지 않는다」**로 못 박은 자리다.
    """

    __tablename__ = "chapters"
    __table_args__ = (
        CheckConstraint(f"beat in {BEATS}", name="ck_chapters_beat"),
        CheckConstraint(
            f"trial_path is null or trial_path in {TRIAL_PATHS}",
            name="ck_chapters_trial_path",
        ),
        CheckConstraint(
            f"trial_best_grade is null or trial_best_grade in {GRADES}",
            name="ck_chapters_trial_best_grade",
        ),
        # **진행 중인 챕터는 아이당 하나.** 완결(`done_at`)한 것은 여러 개다.
        Index(
            "ux_chapters_active_child",
            "child_id",
            unique=True,
            postgresql_where=text("done_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    child_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("children.id", ondelete="CASCADE"), index=True
    )
    # **뼈대 하나뿐이다** (A-1 「판타지 1종·챕터 1개」). 늘리지 않는다 —
    # 값은 `docs/챕터뼈대_초안.md` 의 `ch01` 이다
    chapter_key: Mapped[str] = mapped_column(String(16))
    turn: Mapped[int] = mapped_column(Integer, default=0)
    # **⛔ 비트를 턴으로 다시 계산하지 않는다** — 못 넘은 아이가 10턴에 `resolution`
    # 을 받는다. `chapter_run.진행` 이 굳힌 값을 그대로 둔다
    beat: Mapped[str] = mapped_column(String(16), default="intro")
    trial_progress: Mapped[int] = mapped_column(Integer, default=0)
    trial_path: Mapped[str | None] = mapped_column(String(16))
    trial_best_grade: Mapped[str | None] = mapped_column(
        String(2),
        comment=(
            "시련에서 낸 최고 등급. 보상 티어가 이 값에서 나온다 (Stage1.md 5절) — "
            "12턴까지 G1 만 낸 아이는 basic. 차이는 삽화 티어에서 나지 완결 여부에서 안 난다"
        ),
    )
    state: Mapped[dict] = mapped_column(
        JSONB,
        default=dict,
        comment=(
            "화면에 나가는 상태 (PRD 4.2 의 부분집합). summary·recent_turns·grades 는 "
            "여기 없다 — recent_turns 에는 아이 원문이 들어가고 grades 는 화면이 점수로 그린다"
        ),
    )
    narrative: Mapped[str | None] = mapped_column(
        Text, comment="마지막 GM 서사. 새로고침 복구용이다 (Stage1.md 1절). 아이 원문이 아니다"
    )
    choices: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ChapterTurn(Base):
    """턴 한 번의 기록 (`Stage1.md` 2절 11번).

    **`text` 는 로그가 아니라 아이의 책 콘텐츠다** (PRD 1.1b · 2026-09-16 사용자 지시로
    `api/CLAUDE.md` 가 이 칸을 허용했다). **A-7 이 「챕터 완결 = 책 한 장 · 문장은 아이
    원문 그대로」**라 이 칸 없이는 책을 세울 수 없다.

    **⛔ 금지되는 것은 그대로다** — `logger`·APM·예외 메시지·**이벤트 payload** 에는
    못 간다. 가르는 선은 **「로그냐 책 콘텐츠냐」**다 (계약 2절 11번 정정).

    **⚠ 고른 턴의 `text` 는 GM 이 쓴 선택지 라벨이다.** 평가에 들어간 문장이라 여기
    남지만 **책에는 안 들어간다**(`input_type` 으로 가른다) — 실으면 **아이가 안 쓴
    글이 아이 책에 아이 글로 남는다.**

    **`char_len` 은 길이만이다.** H2 지표(회당 150자)가 이 값을 센다 —
    `card_attempts.char_len` 과 **같은 정의(공백 포함)** 를 쓴다.
    """

    __tablename__ = "chapter_turns"
    __table_args__ = (
        UniqueConstraint("chapter_id", "turn_no", name="uq_chapter_turns_turn"),
        CheckConstraint(f"grade in {GRADES}", name="ck_chapter_turns_grade"),
        CheckConstraint(
            f"trial_path is null or trial_path in {TRIAL_PATHS}",
            name="ck_chapter_turns_trial_path",
        ),
        CheckConstraint(f"input_type in {TURN_INPUT_TYPES}", name="ck_chapter_turns_input_type"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    chapter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chapters.id", ondelete="CASCADE"), index=True
    )
    turn_no: Mapped[int] = mapped_column(Integer)
    beat: Mapped[str] = mapped_column(String(16))
    grade: Mapped[str] = mapped_column(String(2))
    input_type: Mapped[str] = mapped_column(String(8))
    trial_path: Mapped[str | None] = mapped_column(String(16))
    char_len: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(
        Text,
        server_default="",
        comment=(
            "평가에 들어간 문장 (PII 마스킹 뒤). 자유 묘사면 아이 원문이고 책 콘텐츠다 "
            "(PRD 1.1b) — 로그·APM·이벤트로 복사 금지. 고른 턴이면 GM 이 쓴 선택지 "
            "라벨이라 책에는 안 들어간다 (input_type 으로 가른다)"
        ),
    )
    # **⛔ 위 `text` 와 성격이 다르다. 규칙을 옮겨 오지 마라** (2026-09-17).
    # `text` 는 **아이가 쓴 글**이라 `api/CLAUDE.md` 8~9행의 **책 콘텐츠 예외**가 걸리고
    # **A-7 이 그 값으로 책 한 장을 만든다.** 이 칸은 **AI 가 쓴 글**이다 —
    # **책에 안 실리고**, 그 예외와 **무관**하다.
    #
    # **왜 생겼나** — GM 이 말한 것이 **어디에도 저장되지 않아** 다음 턴에 되먹일 수가
    # 없었다. 09-17 한 판에서 **4턴이 밝힌 사건의 원인(수정 구슬 지팡이)이 그 뒤 한
    # 번도 안 나온 채 완결**했다. **잊는 게 아니라 기억할 방법이 없었다** —
    # `chapters.narrative` 는 **마지막 하나**뿐이라 새로고침 복구용이지 기억이 아니다.
    #
    # **⛔ 이 칸을 요약 재료로만 쓴다**(`chapter_state.요약재료()`). 프롬프트에 통째로
    # 붙이지 않는다 — **요약기가 접게** 둔다. 안 접으면 턴이 갈수록 프롬프트가 커지고
    # **아이가 기다리는 시간이 는다.**
    gm_narrative: Mapped[str | None] = mapped_column(
        Text,
        comment=(
            "그 턴의 GM 서사. AI 가 쓴 글이라 책에 안 실린다 — text 와 가른다. "
            "요약 재료로 되먹여 GM 이 자기가 한 말을 잇게 한다 (PRD A-2)"
        ),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class Artwork(Base):
    """삽화 한 장. **출처가 둘이다** (2026-09-16 · W7 14번).

    - **카드 시도** (`card_attempt_id`) — Stage 0
    - **챕터 핵심 씬** (`chapter_id`) — Stage 1. **한 챕터에 둘**(1턴·9턴)이고
      **그 수가 돈이다**: 매 턴 구우면 한 챕터에 10회이고 **하루 상한($0.50)을 한
      아이가 혼자 넘긴다**(뼈대 「핵심 씬」)

    **⛔ 둘 중 정확히 하나가 채워진다** (`ck_artworks_출처`). 둘 다 비면 **주인이 없는
    그림**이고(폴링의 소유 확인이 그 열을 탄다) 둘 다 차면 **어느 쪽 것인지 모른다.**
    """

    __tablename__ = "artworks"
    __table_args__ = (
        CheckConstraint(f"status in {ARTWORK_STATUSES}", name="ck_artworks_status"),
        CheckConstraint(f"tier in {TIERS}", name="ck_artworks_tier"),
        CheckConstraint(
            "(card_attempt_id is null) != (chapter_id is null)", name="ck_artworks_출처"
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    card_attempt_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("card_attempts.id", ondelete="CASCADE"), index=True
    )
    # **Stage 1 핵심 씬.** 턴에 안 걸고 **챕터에 건다** — 한 챕터에 둘뿐이고
    # **책 한 장이 챕터 하나**라(A-7) 세는 단위가 챕터다
    chapter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chapters.id", ondelete="CASCADE"), index=True
    )
    tier: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # **이름이 낡았다. 일부러 그대로 둔다** (2026-09-12, `adr/0014` 이전 · S3 전환).
    # 저장소가 **Cloudflare R2 → AWS S3** 로 바뀌었지만 **컬럼 이름을 바꾸면
    # 마이그레이션**이고, 여기 들어가는 값은 처음부터 URL 이 아니라 **오브젝트 키**라
    # 뜻은 안 틀린다. 판단 근거는 `app/config.py` 의 `s3_*` 주석에 있다.
    r2_key: Mapped[str | None] = mapped_column(String(255))
    # 60초를 넘기면 기본 에셋으로 확정한다 (Stage0.md 5절 B-3)
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
    """한 장. **출처가 둘이다** (`source`).

    - **`card`** — 카드별 **최고 티어 시도 1건**. 티어가 오르면 이 행을 교체한다
    - **`chapter`** — **완결한 챕터 하나** (A-7). **아이가 자유 묘사로 쓴 문장들을
      그대로 이어 붙인다** — 요약·다듬기 없음(비전 2장). 교체가 없다: **챕터는 하루에
      하나 끝나고 다시 쓰지 않는다**
    """

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
    # **챕터 장에는 카드 시도가 없다** (A-7, 2026-09-16). 카드 장은 그대로 채운다 —
    # **비어 있는 것이 「어디서 왔는지 모른다」가 아니다**: 출처는 `source`·`source_id` 다
    card_attempt_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("card_attempts.id"))
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
