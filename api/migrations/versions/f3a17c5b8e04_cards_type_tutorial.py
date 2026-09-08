"""cards.type 에 tutorial 을 넣는다 — 튜토리얼 카드가 앉을 자리가 없었다

장면 카드가 DB 로 들어오면서(A0-1 잔여) **튜토리얼 T1~T3 도 같이 들어간다.**
그런데 `ck_cards_type` 은 위기·발견·만남 셋만 받아서 그 세 장을 넣을 수가 없었다 —
문서의 튜토리얼 표는 「유형」이 아니라 「목적」 열이라 대응하는 값이 애초에 없다
(`app/scene_cards.py`).

**API 의 `type` 은 안 바뀐다.** `CardType` 은 그대로 셋이고, `/cards/{id}` 는 튜토리얼을
404 로 돌려준다 (노출 경로는 Stage 1 A-6). **넓어지는 것은 DB 제약뿐이다** —
그래서 `/openapi.json` 도 그대로다.

**기존 데이터는 없다.** `cards` 는 지금까지 한 번도 채워진 적이 없다 — 카드는
문서 리더가 읽어 왔고 이 테이블은 비어 있었다.

Revision ID: f3a17c5b8e04
Revises: a4c1e8f2b930
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f3a17c5b8e04'
down_revision: Union[str, Sequence[str], None] = 'a4c1e8f2b930'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('ck_cards_type', 'cards', type_='check')
    op.create_check_constraint(
        'ck_cards_type',
        'cards',
        "type in ('crisis', 'discovery', 'encounter', 'tutorial')",
    )


def downgrade() -> None:
    # 되돌리면 튜토리얼 세 장이 제약을 어긴다. **먼저 지워야 한다** —
    # 조용히 남겨 두면 다음 upgrade 까지 제약 없는 행으로 앉아 있는다.
    op.execute("delete from cards where type = 'tutorial'")
    op.drop_constraint('ck_cards_type', 'cards', type_='check')
    op.create_check_constraint(
        'ck_cards_type', 'cards', "type in ('crisis', 'discovery', 'encounter')"
    )
