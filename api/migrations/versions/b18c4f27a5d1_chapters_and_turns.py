"""chapters · chapter_turns — Stage 1 한 판을 저장한다

**⭐ 진행 중인 챕터는 아이당 하나다. 그것을 DB 가 지킨다** (부분 유니크 인덱스).
코드로만 막으면 **새로고침 두 번에 두 판이 열리고** 아이가 쓴 이야기가 갈라진다.
계약 1절이 **「아이가 새로고침해도 이야기를 잃지 않는다」**로 못 박은 자리다.

**⛔ `chapter_turns` 에 아이 원문 칸이 없다. 그것이 이 마이그레이션의 결정이다.**
`Stage1.md` 2절 11번이 **「아이 원문은 로그에 안 남는다 — 등급·경로·소요만」**이고,
원문이 가도 되는 곳은 **`card_attempts.text` 하나**다 (PRD 1.1b · `api/CLAUDE.md`).
**책에 실릴 문장을 어디에 둘지는 9번(A-7)에서 정한다** — 그때까지 여기에 칸을
만들지 않는다. **없는 칸은 실수로 안 채워진다.**

**`narrative` 는 GM 이 낸 글이라 원문이 아니다.** 저장하는 이유는 새로고침이고,
`GET /chapters/current` 가 지금 장면을 그대로 돌려줘야 한다.

Revision ID: b18c4f27a5d1
Revises: c7d40a91e5b2
Create Date: 2026-09-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b18c4f27a5d1'
down_revision: Union[str, Sequence[str], None] = 'c7d40a91e5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BEATS = "('intro', 'explore', 'rising_action', 'approach', 'trial', 'resolution')"
TRIAL_PATHS = "('force', 'persuade', 'observe', 'care')"
GRADES = "('G0', 'G1', 'G2', 'G3')"
INPUT_TYPES = "('free', 'choice')"


def upgrade() -> None:
    op.create_table(
        'chapters',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('child_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('chapter_key', sa.String(length=16), nullable=False),
        sa.Column('turn', sa.Integer(), nullable=False),
        sa.Column('beat', sa.String(length=16), nullable=False),
        sa.Column('trial_progress', sa.Integer(), nullable=False),
        sa.Column('trial_path', sa.String(length=16), nullable=True),
        sa.Column(
            'trial_best_grade',
            sa.String(length=2),
            nullable=True,
            comment=(
                "시련에서 낸 최고 등급. 보상 티어가 이 값에서 나온다 (Stage1.md 5절) — "
                "12턴까지 G1 만 낸 아이는 basic. 차이는 삽화 티어에서 나지 완결 여부에서 안 난다"
            ),
        ),
        sa.Column(
            'state',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment=(
                "화면에 나가는 상태 (PRD 4.2 의 부분집합). summary·recent_turns·grades 는 "
                "여기 없다 — recent_turns 에는 아이 원문이 들어가고 grades 는 화면이 점수로 그린다"
            ),
        ),
        sa.Column(
            'narrative',
            sa.Text(),
            nullable=True,
            comment="마지막 GM 서사. 새로고침 복구용이다 (Stage1.md 1절). 아이 원문이 아니다",
        ),
        sa.Column('choices', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False
        ),
        sa.CheckConstraint(f"beat in {BEATS}", name='ck_chapters_beat'),
        sa.CheckConstraint(
            f"trial_path is null or trial_path in {TRIAL_PATHS}", name='ck_chapters_trial_path'
        ),
        sa.CheckConstraint(
            f"trial_best_grade is null or trial_best_grade in {GRADES}",
            name='ck_chapters_trial_best_grade',
        ),
        sa.ForeignKeyConstraint(['child_id'], ['children.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_chapters_child_id'), 'chapters', ['child_id'])
    op.create_index(op.f('ix_chapters_created_at'), 'chapters', ['created_at'])
    op.create_index(op.f('ix_chapters_done_at'), 'chapters', ['done_at'])
    # **진행 중인 챕터는 아이당 하나.** 완결한 것은 여러 개다
    op.create_index(
        'ux_chapters_active_child',
        'chapters',
        ['child_id'],
        unique=True,
        postgresql_where=sa.text('done_at IS NULL'),
    )

    op.create_table(
        'chapter_turns',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('chapter_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('turn_no', sa.Integer(), nullable=False),
        sa.Column('beat', sa.String(length=16), nullable=False),
        sa.Column('grade', sa.String(length=2), nullable=False),
        sa.Column('input_type', sa.String(length=8), nullable=False),
        sa.Column('trial_path', sa.String(length=16), nullable=True),
        sa.Column('char_len', sa.Integer(), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False
        ),
        sa.CheckConstraint(f"grade in {GRADES}", name='ck_chapter_turns_grade'),
        sa.CheckConstraint(f"input_type in {INPUT_TYPES}", name='ck_chapter_turns_input_type'),
        sa.CheckConstraint(
            f"trial_path is null or trial_path in {TRIAL_PATHS}", name='ck_chapter_turns_trial_path'
        ),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('chapter_id', 'turn_no', name='uq_chapter_turns_turn'),
    )
    op.create_index(op.f('ix_chapter_turns_chapter_id'), 'chapter_turns', ['chapter_id'])
    op.create_index(op.f('ix_chapter_turns_created_at'), 'chapter_turns', ['created_at'])


def downgrade() -> None:
    op.drop_table('chapter_turns')
    op.drop_index('ux_chapters_active_child', table_name='chapters')
    op.drop_table('chapters')
