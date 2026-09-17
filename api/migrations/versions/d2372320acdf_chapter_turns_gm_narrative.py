"""chapter_turns.gm_narrative — GM 이 말한 것을 저장한다

**⛔ 「잊는 것」이 아니라 기억할 방법이 없었다.** 2026-09-17 한 판에서 **4턴이 밝힌
사건의 원인(수정 구슬 지팡이)이 그 뒤 한 번도 안 나온 채 완결**했다. 원인을
`chapter_state.요약재료()` 에서 찾았는데, 거기 넘어가는 것이 **아이가 쓴 글·등급·
비트**뿐이었다 — **GM 서사는 `chapter_turns` 에 칸 자체가 없었다.**
`chapters.narrative` 는 **마지막 하나**뿐이고 새로고침 복구용이다(Stage1.md 1절).

**⛔ `text` 와 성격이 다르다. 규칙을 옮겨 오면 안 된다.** `text` 는 **아이가 쓴 글**이라
`api/CLAUDE.md` 8~9행의 **책 콘텐츠 예외**가 걸리고 **A-7 이 그 값으로 책 한 장을
만든다.** 이 칸은 **AI 가 쓴 글**이라 **책에 안 실리고 그 예외와 무관**하다.

**nullable 로 둔다** — 이미 쌓인 턴에는 그 값이 없고, **없는 것을 빈 문자열로 채우면
「GM 이 아무 말도 안 한 턴」과 구분이 안 된다.**

Revision ID: d2372320acdf
Revises: d3f81a6c2b57
Create Date: 2026-09-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d2372320acdf"
down_revision: str | Sequence[str] | None = "d3f81a6c2b57"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chapter_turns",
        sa.Column(
            "gm_narrative",
            sa.Text(),
            nullable=True,
            comment=(
                "그 턴의 GM 서사. AI 가 쓴 글이라 책에 안 실린다 — text 와 가른다. "
                "요약 재료로 되먹여 GM 이 자기가 한 말을 잇게 한다 (PRD A-2)"
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("chapter_turns", "gm_narrative")
