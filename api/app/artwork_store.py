"""`artworks` 행을 만들고 **뒤에서 굽는다** (B-3 ①).

`app/artwork.py` 는 **무엇을 그릴지 정하고 만드는 곳**이고, 여기는 **그 결과를 행으로
남기는 곳**이다. 나눈 이유는 `artwork.py` 가 DB 를 안 물게 하기 위해서다 —
프롬프트 조립과 출력 검사는 `scripts/bench_image.py` 도 부른다.

**아이를 세워 두지 않는다.** `POST /attempts` 는 행을 `pending` 으로 만들고 바로
응답하고, 굽기는 그 뒤에 돈다. 프론트는 3초 뒤부터 2초 간격으로 폴링한다
(`Stage0.md` 5절, 실측 평균 6.2초).

**모든 실패가 `ready` 로 수렴한다.** `failed` 는 2026-09-08 계약에서 빠졌다 —
생성 실패도, 저장 실패도, 예외도 **`ready` + `fallback=true`** 다. 그림 자리는
프록시가 기본 에셋으로 메운다 (미결 11-7 · `Stage0.md` 5절).
**아이가 그림을 못 받는 경우를 만들지 않는다는 것이 B-3 의 결정**이고, 이 모듈이
그 결정을 실제로 지키는 자리다.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.artwork import TIMEOUT_SECONDS, 생성
from app.middleware import current_request_id
from app.models import Artwork, CardAttempt
from app.schemas.stage0 import Tier
from app.storage import 올리기

logger = logging.getLogger(__name__)


async def 만들기(session: AsyncSession, card_attempt_id: uuid.UUID, tier: Tier) -> Artwork:
    """`pending` 행 하나. **커밋까지 한다** — 뒤에서 굽는 쪽이 다른 세션으로 이 행을
    찾아야 하므로, 안 커밋하면 백그라운드가 없는 행을 본다.
    """
    삽화 = Artwork(card_attempt_id=card_attempt_id, tier=tier, status="pending")
    session.add(삽화)
    await session.commit()
    return 삽화


async def 굽기(artwork_id: uuid.UUID, card_id: str, tier: Tier) -> None:
    """생성 → 저장 → 행 갱신. **예외를 밖으로 내지 않는다.**

    백그라운드에서 돈다. 여기서 터진 것이 아이 응답을 되돌릴 수는 없지만
    (응답은 이미 나갔다), **행이 `pending` 에 갇히면 프론트가 15초를 헛돈다** —
    그 15초는 아이가 화면 앞에서 기다리는 시간이다. 그래서 **어떤 길로 끝나든
    행은 `ready` 가 된다.**

    **요청 세션에 얹지 않는다.** 응답이 나간 뒤에 도는 코드라 그 세션은 이미 닫혔다.
    """
    try:
        결과 = await 생성(card_id, tier)
        키 = None
        if 결과.image:
            키 = await 올리기(str(artwork_id), 결과.image, 결과.mime)
        if 키 is None:
            # **사유는 우리 눈금이다** (`artwork.생성결과`). 아이에게 안 나간다 —
            # 나가면 「기본 그림이야」가 되고, 그건 아이가 자기 문장이 부족했다고 읽는다.
            logger.info(
                "삽화를 기본 에셋으로 확정한다",
                extra={"request_id": current_request_id(), "reason": 결과.사유 or "store"},
            )
        await _끝냈다(artwork_id, 키)
    except Exception as exc:
        # **예외 메시지를 싣지 않는다** — 프로바이더가 프롬프트를 되울려 주는 일이 있고,
        # Stage 1 에서는 그 프롬프트에 GM 서사가 들어온다.
        logger.warning(
            "삽화 굽기가 실패했다",
            extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
        )
        await _끝냈다(artwork_id, None)


async def _끝냈다(artwork_id: uuid.UUID, r2_key: str | None) -> None:
    """`ready` 로 확정한다. **`r2_key` 가 없으면 `fallback` 이다.**

    **행이 없어도 조용히 지나간다** — 자녀 삭제(E-4 「즉시 파기」)가 굽는 중에 들어오면
    실제로 난다. 그때 여기서 터지면 로그만 시끄럽고 고칠 것은 없다.
    """
    try:
        async with db.SessionLocal() as session:
            삽화 = await session.get(Artwork, artwork_id)
            if 삽화 is None:
                return
            삽화.status = "ready"
            삽화.r2_key = r2_key
            삽화.fallback = r2_key is None
            삽화.ready_at = datetime.now(UTC)
            await session.commit()
    except Exception as exc:
        # 여기까지 실패하면 행은 `pending` 으로 남는다. **프론트는 15초 뒤 기본 에셋을
        # 보여주므로 아이 화면은 멈추지 않는다** (`Stage0.md` 5절 폴링 표).
        logger.warning(
            "삽화 상태를 못 굳혔다",
            extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
        )


# 프론트가 폴링을 끊는 시각과 **같은 값이어야 한다** (`Stage0.md` 5절 폴링 표).
# 생성 호출 자체의 상한과도 같은 값이라 `app/artwork.py` 것을 그대로 쓴다 — 여기에
# 숫자를 따로 적으면 한쪽만 바뀐다.
기다리는시간 = timedelta(seconds=TIMEOUT_SECONDS)


async def 내것읽기(session: AsyncSession, artwork_id: str, child_id: uuid.UUID) -> Artwork | None:
    """**이 아이의** 삽화만 돌려준다. 아니면 `None` — 부르는 쪽이 404 로 만든다.

    **403 으로 가르지 않는다.** 가르는 순간 「그 삽화는 존재한다」가 새고, 그건
    `{child_id}` 규칙과 같은 자리다 (`Stage0.md` 5절).

    **모양이 UUID 가 아니면 없는 것이다.** 「ID 는 전부 UUID」가 규약이고
    (`공통규약.md`), 안 거르면 SQL 층까지 내려가 500 이 된다.
    """
    try:
        아이디 = uuid.UUID(artwork_id)
    except ValueError:
        return None

    문 = (
        select(Artwork)
        .join(CardAttempt, CardAttempt.id == Artwork.card_attempt_id)
        .where(Artwork.id == 아이디, CardAttempt.child_id == child_id)
    )
    return await session.scalar(문)


async def 오래_기다렸으면_확정(session: AsyncSession, 삽화: Artwork) -> Artwork:
    """15초를 넘긴 `pending` 을 **`ready` + `fallback` 으로 굳힌다** (`Stage0.md` 5절).

    **프론트도 같은 15초에 폴링을 끊는다.** 그런데 서버가 안 굳히면 그 행은 **영영
    `pending`** 이다 — 굽기가 죽었거나 프로세스가 내려간 경우가 그렇고, 그러면
    그 카드는 **「내 책」에도 안 선다.** 아이 화면만 넘어가고 기록이 뒤에 남는다.

    **일찍 굳히지 않는다.** 실측 평균이 6.2초라(`benchmarks/W1-image-bench.md`)
    성급하게 확정하면 **다 구워진 그림을 버리고 기본 에셋을 준다.**
    """
    if 삽화.status != "pending" or datetime.now(UTC) - 삽화.created_at < 기다리는시간:
        return 삽화

    삽화.status = "ready"
    삽화.fallback = True
    삽화.ready_at = datetime.now(UTC)
    await session.commit()
    return 삽화
