"""card_attempts.char_len 컬럼 주석 — 모델에만 있고 DB 에 없던 것

`2c8743a` 가 `char_len` 정의(공백 포함)를 컬럼 주석으로 못박으면서 **모델만 고치고
마이그레이션을 안 남겼다.** 그 커밋 시점에는 이 머신에 Docker 가 안 떠 있어
`alembic upgrade --sql` 오프라인 렌더로만 봤고, 오프라인은 **DB 의 실제 상태와
대조하지 않아** 이 어긋남이 안 보였다. Docker 를 띄운 첫날(2026-09-07)
`alembic check` 이 잡았다.

**데이터가 바뀌지 않는다. 응답 형식도 안 바뀐다.** `COMMENT ON COLUMN` 하나다.
그래도 남긴다 — 주석은 **`char_len` 이 공백을 걷어낸 값이 아니라는 유일한 DB 측
근거**이고, H2 합격선(150자)이 그 정의 위에 선다. 모델에만 있으면 psql 로 스키마를
읽는 사람에게는 없는 것과 같다.

Revision ID: d49b193de27d
Revises: de674cd0df7e
Create Date: 2026-09-07 21:57:23.902255

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd49b193de27d'
down_revision: Union[str, Sequence[str], None] = 'de674cd0df7e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_주석 = (
    "공백 포함 원문 길이 (PRD 5장, 2026-09-07 확정). 공백·줄바꿈을 걷어내지 않는다 — "
    "H2 합격선(150자)과 입력 화면의 「30자」가 같은 정의 위에 선다"
)


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "card_attempts",
        "char_len",
        existing_type=sa.INTEGER(),
        existing_nullable=False,
        comment=_주석,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        "card_attempts",
        "char_len",
        existing_type=sa.INTEGER(),
        existing_nullable=False,
        existing_comment=_주석,
        comment=None,
    )
