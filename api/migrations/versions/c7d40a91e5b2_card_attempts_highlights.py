"""card_attempts.highlights — 다시 만들면 줄어든다

**새로고침 복구가 하이라이트를 잃고 있었다** (2026-09-08, `docs/api/Stage0.md` 10절).
`signals` 만으로 다시 만들면 **원형(「캄캄한」)과 문장의 활용형(「캄캄했지만」)이 달라**
원문 대조에서 걸러진다. 가이드 대사도 첫 하이라이트에서 나오므로 **대사까지 바뀐다.**

**덧칠은 보상이라 화면이 죽지는 않는다. 그런데 줄어드는 것이 문제다** —
프리테스트 관찰 신호 7번이 **「자기 문장이 하이라이트된 것을 알아보는가」**이고,
아이가 새로고침하면 그 관찰이 오염된다. **원인이 제품인지 복구 결함인지 못 가르고**,
아이 원문은 문서로 안 옮기므로 나중에 되짚을 수도 없다.

**기존 행은 빈 배열이다.** 아직 파일럿 전이라 실사용 데이터가 없고, 있더라도
빈 값이면 예전처럼 `signals` 에서 만드는 것이 아니라 **덧칠이 없는 채로 나간다** —
없는 것을 지어내지 않는다.

Revision ID: c7d40a91e5b2
Revises: f3a17c5b8e04
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c7d40a91e5b2'
down_revision: Union[str, Sequence[str], None] = 'f3a17c5b8e04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'card_attempts',
        sa.Column(
            'highlights',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default='[]',
            comment=(
                "화면에 실제로 덧칠된 묘사어 (2026-09-08, Stage0.md 10절). "
                "signals 에서 다시 만들면 줄어든다 — 원형(「캄캄한」)과 활용형(「캄캄했지만」)이 "
                "달라 원문 대조에서 걸러진다. 프리테스트 관찰 신호 7번이 이 값을 본다"
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column('card_attempts', 'highlights')
