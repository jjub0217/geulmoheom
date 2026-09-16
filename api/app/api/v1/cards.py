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
from app.card_store import 모험카드들, 오늘상태, 오늘쓴카드들
from app.card_store import 카드 as 카드읽기
from app.errors import AppError, ErrorCode
from app.guide_lines import 카드첫말
from app.models import Card as CardRow
from app.models import Child as ChildRow
from app.schemas.stage0 import Card
from app.tutorial import 남은카드, 튜토리얼카드인가

router = APIRouter(prefix="/cards", tags=["cards"])

# `require_child` 는 검증된 `children` 행을 준다 (E-3). 예전에는 토큰 문자열이었다.
Child = Annotated[ChildRow, Depends(require_child)]


def _응답(행: CardRow) -> Card:
    return Card.model_validate(
        {
            "card_id": 행.id,
            # **DB 는 `tutorial` 을 들고 있고 응답은 `null` 이다** (2026-09-16 명세 변경).
            # **모드를 이야기 유형 축에 얹지 않는다** — T1~T3 는 위기·발견·만남 중
            # 무엇도 아니고, 문서의 그 열은 **유형이 아니라 목적**이다
            "type": None if 튜토리얼카드인가(행.id) else 행.type,
            "situation": 행.situation_text,
            "prompt_label": 행.prompt_label,
            "guide": {"expression": "default", "line": 카드첫말()},
            "today": fx.TODAY,
        }
    )


def _오늘은끝() -> AppError:
    """소진 응답에도 `guide.line`("내일 또 보자")을 담는다 — 아이가 빈 화면을 보지 않게."""
    return AppError(
        ErrorCode.DAILY_CAP_REACHED,
        detail={
            "guide": {"expression": "session_end", "line": "오늘 모험은 여기까지! 내일 또 보자"}
        },
    )


@router.get("/next")
async def next_card(
    아이: Child,
    session: Session,
    소진: Annotated[bool, Depends(mock_daily_cap_reached)],
) -> Card:
    """오늘 아직 안 한 카드 중 하나. 소진 시 409 `DAILY_CAP_REACHED`.

    **오늘 이미 푼 카드는 후보에서 뺀다** (A0-1). 같은 장면을 두 번 주면 아이는
    「내가 이미 한 건데」로 읽고, 그 순간 카드가 퀘스트가 아니라 무작위 반복이 된다.

    **아이별 순서는 아직 없다.** 남은 것 중 무작위다.
    """
    # **⛔ 튜토리얼이 먼저다 — 그리고 잠금·관문이 없다** (A-6 MUST · W7 10번).
    # `A0-5` 일일 제한을 **적용하지 않는다**: 첫 5~7분이 관문이 되면 **아이는 시작도
    # 못 한다.** 그래서 상한을 보기 **전에** 갈린다.
    #
    # **기본은 꺼져 있다** — T1~T3 가 대표 미검수다 (`장면카드_초안.md`).
    다음튜토리얼 = await 남은카드(session, 아이.id)
    if 다음튜토리얼 is not None:
        행 = await 카드읽기(session, 다음튜토리얼)
        if 행 is None:
            # 씨를 안 뿌렸다. `/readyz` 가 이미 degraded 다
            raise AppError(ErrorCode.INTERNAL_ERROR)
        return _응답(행)

    # **하루 5장에서 멈춘다** (A0-5 · PRD 하드 피니시). 상한은 자녀 행에서 읽는다 —
    # 학부모가 바꿀 수 있는 값이다.
    쓴수, 상한 = await 오늘상태(session, 아이)
    if 소진 or 쓴수 >= 상한:
        raise _오늘은끝()

    후보 = await 모험카드들(session)
    if not 후보:
        # **씨를 안 뿌렸다** (`make seed`). `/readyz` 가 이미 `degraded` 로 서 있고,
        # 여기서는 조용히 빈 값을 주지 않는다 — 아이 화면에는 「닿지 못했을 때」가 뜬다.
        raise AppError(ErrorCode.INTERNAL_ERROR)

    쓴것 = await 오늘쓴카드들(session, 아이.id)
    남은것 = [행 for 행 in 후보 if 행.id not in 쓴것]
    if not 남은것:
        # **일일 상한(5장)이 먼저 걸려 실제로는 안 닿는다.** 그래도 정의해 둔다 —
        # 상한을 올리는 날 여기가 빈 응답이나 500 이 되면 **아이 화면이 멈춘다.**
        raise _오늘은끝()

    return _응답(random.choice(남은것))


@router.get("/{card_id}")
async def get_card(card_id: str, _: Child, session: Session) -> Card:
    """재시도 화면 복귀용.

    모르는 카드는 404 다.

    **⛔ 튜토리얼(T1~T3)은 2026-09-16 부터 열린다** (W7 10번). 종전에는 404 였는데
    **A-6 의 T2 가 「다시 써보기」를 직접 권유**하고 **재시도 화면이 카드를 다시
    읽는다** — 404 면 **그 권유가 막힌다.**
    **꺼져 있을 때도 열어 둔다**: 이 경로는 **아이에게 카드를 고르게 하는 자리가
    아니라 이미 받은 카드로 돌아오는 자리**다. 주는 것은 `/next` 하나뿐이고 **그쪽이
    스위치를 본다.**
    """
    행 = await 카드읽기(session, card_id)
    if 행 is None:
        raise AppError(ErrorCode.NOT_FOUND)
    return _응답(행)
