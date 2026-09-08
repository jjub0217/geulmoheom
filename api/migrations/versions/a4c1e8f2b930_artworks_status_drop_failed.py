"""artworks.status 에서 failed 를 뺀다 — 나갈 자리가 없는 값이었다

**계약 변경이다** (2026-09-08, `docs/api/Stage0.md` 5절). 15초 초과도, 생성 실패도,
출력 검사 차단도 전부 **안전한 기본 삽화**로 가서 `ready` 로 수렴한다
(PRD B-3 「플레이 중단 없음」). 프론트는 영영 안 오는 값을 기다리고 있었다.

**제약을 코드와 함께 좁힌다.** 넓은 채로 두면 DB 는 받아들이는데 응답 스키마는
거부해서, 그 행은 저장은 되고 **API 로는 못 나온다** — 조용히 500 이 된다.

**기존 데이터는 바꾸지 않는다.** `failed` 행이 있으면 이 마이그레이션이 실패하는데,
**그게 맞다** — 조용히 갈아치우면 무엇이 있었는지가 사라진다. Stage 0 은 아직
삽화를 굽지 않아 실제로는 빈 테이블이다.

**되살리려면 B-3 의 「아이가 그림을 못 받는 경우를 만들지 않는다」를 먼저 뒤집어야 한다.**

Revision ID: a4c1e8f2b930
Revises: 8ef582cb7716
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a4c1e8f2b930'
down_revision: Union[str, Sequence[str], None] = '8ef582cb7716'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('ck_artworks_status', 'artworks', type_='check')
    op.create_check_constraint(
        'ck_artworks_status', 'artworks', "status in ('pending', 'ready')"
    )


def downgrade() -> None:
    op.drop_constraint('ck_artworks_status', 'artworks', type_='check')
    op.create_check_constraint(
        'ck_artworks_status', 'artworks', "status in ('pending', 'ready', 'failed')"
    )
