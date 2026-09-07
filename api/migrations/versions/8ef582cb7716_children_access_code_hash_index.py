"""children.access_code_hash 인덱스 — 아이는 코드 하나만 들고 온다

`POST /child/auth` 는 접속 코드 외에 아무것도 받지 않는다(`Stage0.md` 2절).
그래서 이 컬럼이 조회 조건이 되고, 인덱스가 없으면 자녀 수만큼 훑는다.

해시가 **소금 없는 HMAC** 이라 등호로 찾을 수 있다는 것이 전제다 —
소금을 쳤다면 인덱스로 못 찾고 전수 비교여야 했다. 그 선택의 근거는
`app/accounts.py` 「접속코드해시」에 있다.

**유니크다.** 코드가 6자리라 살아 있는 코드끼리 겹칠 수 있고, 겹치면 조회가 아무
쪽이나 골라 **다른 아이의 계정으로 들어가진다.** 코드를 다 쓴 자녀는 이 값이 NULL 이고
Postgres 의 유니크는 NULL 을 여럿 허용하므로 서로 부딪히지 않는다.

**데이터는 바뀌지 않는다.** 응답 형식도 안 바뀐다.

Revision ID: 8ef582cb7716
Revises: d49b193de27d
Create Date: 2026-09-07

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '8ef582cb7716'
down_revision: Union[str, Sequence[str], None] = 'd49b193de27d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_인덱스 = "ix_children_access_code_hash"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(_인덱스, "children", ["access_code_hash"], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(_인덱스, table_name="children")
