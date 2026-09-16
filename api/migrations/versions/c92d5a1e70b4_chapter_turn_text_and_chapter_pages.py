"""chapter_turns.text · book_pages.card_attempt_id nullable — 챕터가 책 한 장이 된다

**⛔ 원문 칸은 2026-09-16 사용자 지시로 열렸다.** `api/CLAUDE.md` 8행이 종전
**「원문이 가도 되는 곳은 `card_attempts.text` 단 하나」**였고, 그 한 낱말 때문에
`chapter_turns` 에 칸을 안 만들었다. **그러면 A-7(「챕터 완결 = 책 한 장 · 문장은
아이 원문 그대로」)을 세울 수 없다.**

**⛔ 금지되는 것은 줄지 않았다.** 가르는 선은 **「로그냐 책 콘텐츠냐」**다 —
`logger`·APM·예외 메시지·오류 리포터·**이벤트 payload** 는 그대로 금지이고
**DB 의 책 콘텐츠 칸만 예외**다 (`docs/api/Stage1.md` 2절 11번 정정 · `dc975e5`).

**`book_pages.card_attempt_id` 를 nullable 로 낮춘다** — **챕터 장에는 카드 시도가
없다.** 출처는 `source`·`source_id` 가 들고 있고, 그 둘은 처음부터
`('card', 'chapter')` 로 서 있었다.

Revision ID: c92d5a1e70b4
Revises: b18c4f27a5d1
Create Date: 2026-09-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c92d5a1e70b4'
down_revision: Union[str, Sequence[str], None] = 'b18c4f27a5d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'chapter_turns',
        sa.Column(
            'text',
            sa.Text(),
            nullable=False,
            server_default='',
            comment=(
                "평가에 들어간 문장 (PII 마스킹 뒤). 자유 묘사면 아이 원문이고 책 콘텐츠다 "
                "(PRD 1.1b) — 로그·APM·이벤트로 복사 금지. 고른 턴이면 GM 이 쓴 선택지 "
                "라벨이라 책에는 안 들어간다 (input_type 으로 가른다)"
            ),
        ),
    )
    op.alter_column(
        'book_pages',
        'card_attempt_id',
        existing_type=sa.UUID(),
        # **DB 주석을 달지 않는다** — 모델이 안 들고 있으면 자동 비교가 갈린 것으로
        # 읽는다(`test_migrations`). 이유는 `app/models.py` 의 그 줄 위에 적혀 있다
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        'book_pages', 'card_attempt_id', existing_type=sa.UUID(), nullable=False
    )
    op.drop_column('chapter_turns', 'text')
