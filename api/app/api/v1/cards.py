"""3. 카드 (`docs/api/Stage0.md` 3절).

**카드는 DB 에서 온다** (A0-1 잔여). 정본은 여전히 `docs/장면카드_초안.md` 이고,
문서 → DB 를 잇는 자리는 `app/card_store.py` 의 `씨뿌리기()` 하나뿐이다.
**여기서 문서를 다시 읽지 않는다** — 두 경로가 생기면 같은 `c01` 이 화면과 되묻기에서
다른 장면이 된다. W2 5번이 그 사고를 고친 자리다.

**아직 목인 것**: 「오늘 안 한 카드」 진짜 선택 · 소모 이력 · 스케치 에셋(W3 A0-3) ·
`guide` · `today`. `next` 는 DB 의 20장 중 하나를 무작위로 고르기만 한다.
"""

import random
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import Session, mock_daily_cap_reached, require_child
from app.card_store import 모험카드들
from app.card_store import 카드 as 카드읽기
from app.errors import AppError, ErrorCode
from app.models import TUTORIAL_TYPE
from app.models import Card as CardRow
from app.models import Child as ChildRow
from app.schemas.stage0 import Card

router = APIRouter(prefix="/cards", tags=["cards"])

# `require_child` 는 검증된 `children` 행을 준다 (E-3). 예전에는 토큰 문자열이었다.
Child = Annotated[ChildRow, Depends(require_child)]


def _응답(행: CardRow) -> Card:
    return Card.model_validate(
        {
            "card_id": 행.id,
            "type": 행.type,
            "situation": 행.situation_text,
            "prompt_label": 행.prompt_label,
            # **스케치 에셋은 아직 없다** (W3 A0-3). 키는 DB 에 있고 주소 모양만 맞춘다.
            "sketch_url": f"{fx.R2}/{행.sketch_r2_key}",
            "guide": fx.CARD_GUIDE,
            "today": fx.TODAY,
        }
    )


@router.get("/next")
async def next_card(
    _: Child,
    session: Session,
    소진: Annotated[bool, Depends(mock_daily_cap_reached)],
) -> Card:
    """오늘 아직 안 한 카드 중 하나. 소진 시 409 `DAILY_CAP_REACHED`.

    소진 응답에도 `guide.line`("내일 또 보자")을 담는다 — 아이가 빈 화면을 보지 않게.

    **아이별 순서·소모 이력은 아직 없다.** 지금은 DB 의 20장에서 무작위다.
    """
    if 소진:
        raise AppError(
            ErrorCode.DAILY_CAP_REACHED,
            detail={
                "guide": {"expression": "session_end", "line": "오늘 모험은 여기까지! 내일 또 보자"}
            },
        )

    후보 = await 모험카드들(session)
    if not 후보:
        # **씨를 안 뿌렸다** (`make seed`). `/readyz` 가 이미 `degraded` 로 서 있고,
        # 여기서는 조용히 빈 값을 주지 않는다 — 아이 화면에는 「닿지 못했을 때」가 뜬다.
        raise AppError(ErrorCode.INTERNAL_ERROR)
    return _응답(random.choice(후보))


@router.get("/{card_id}")
async def get_card(card_id: str, _: Child, session: Session) -> Card:
    """재시도 화면 복귀용.

    모르는 카드와 튜토리얼(T1~T3)은 404 다. 튜토리얼은 노출 경로가 따로 있다 (Stage 1 A-6).
    """
    행 = await 카드읽기(session, card_id)
    if 행 is None or 행.type == TUTORIAL_TYPE:
        raise AppError(ErrorCode.NOT_FOUND)
    return _응답(행)
