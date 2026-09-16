"""artworks 를 챕터에도 걸 수 있게 — 핵심 씬 삽화 (W7 14번)

**출처가 둘이 된다.** 카드 시도(Stage 0)와 **챕터 핵심 씬**(Stage 1).
**⛔ 둘 중 정확히 하나가 채워진다** — 둘 다 비면 **주인이 없는 그림**이고(폴링의 소유
확인이 그 열을 탄다) 둘 다 차면 **어느 쪽 것인지 모른다.**

**턴에 안 걸고 챕터에 건다.** 한 챕터에 **둘**(1턴·9턴)이고 **책 한 장이 챕터 하나**라
(A-7) **세는 단위가 챕터**다. 그 수가 곧 돈이다 — 매 턴 구우면 한 챕터에 10회이고
**하루 상한($0.50)을 한 아이가 혼자 넘긴다**(`docs/챕터뼈대_초안.md` 「핵심 씬」).

Revision ID: d3f81a6c2b57
Revises: c92d5a1e70b4
Create Date: 2026-09-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3f81a6c2b57'
down_revision: Union[str, Sequence[str], None] = 'c92d5a1e70b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('artworks', sa.Column('chapter_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_artworks_chapter_id'), 'artworks', ['chapter_id'])
    op.create_foreign_key(
        'fk_artworks_chapter', 'artworks', 'chapters', ['chapter_id'], ['id'], ondelete='CASCADE'
    )
    op.alter_column('artworks', 'card_attempt_id', existing_type=sa.UUID(), nullable=True)
    op.create_check_constraint(
        'ck_artworks_출처', 'artworks', '(card_attempt_id is null) != (chapter_id is null)'
    )


def downgrade() -> None:
    op.drop_constraint('ck_artworks_출처', 'artworks', type_='check')
    op.alter_column('artworks', 'card_attempt_id', existing_type=sa.UUID(), nullable=False)
    op.drop_constraint('fk_artworks_chapter', 'artworks', type_='foreignkey')
    op.drop_index(op.f('ix_artworks_chapter_id'), table_name='artworks')
    op.drop_column('artworks', 'chapter_id')
