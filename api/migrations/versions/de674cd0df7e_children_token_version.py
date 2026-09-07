"""children.token_version — 자녀 토큰 폐기 (`docs/api/공통규약.md` 「폐기」)

JWT 는 발급 후 회수할 수 없다. 이 정수를 JWT payload 에 담고 검증 때 DB 값과
대조해 다르면 401 — **폐기는 값을 1 올리는 것**이고, 그 한 번으로 그 자녀의 모든
기기가 끊긴다. 접속 코드 재발급·자녀 삭제가 올린다.

**응답 형식은 바뀌지 않는다.** 스키마만 바뀐다.

Revision ID: de674cd0df7e
Revises: 12b733c89591
Create Date: 2026-09-07 17:57:47.631212

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'de674cd0df7e'
down_revision: Union[str, Sequence[str], None] = '12b733c89591'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # `server_default="1"` 이 있어야 이미 있는 행이 NOT NULL 을 만족한다.
    # 이 값을 빼면 기존 자녀가 있는 DB 에서 마이그레이션이 그 자리에서 죽는다.
    op.add_column(
        "children",
        sa.Column(
            "token_version",
            sa.Integer(),
            nullable=False,
            server_default="1",
            comment=(
                "자녀 토큰 폐기용 세대 번호 (공통규약.md 「폐기」). JWT payload 값과 "
                "다르면 401. 접속 코드 재발급·자녀 삭제 시 1 올린다"
            ),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    # 되돌리면 **폐기된 토큰이 되살아난다.** 되돌린 뒤에는 접속 코드를 다시 발급한다.
    op.drop_column("children", "token_version")
