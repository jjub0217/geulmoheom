"""`artworks` 행을 만들고 **뒤에서 굽는다** (B-3 ①).

`app/artwork.py` 는 **무엇을 그릴지 정하고 만드는 곳**이고, 여기는 **그 결과를 행으로
남기는 곳**이다. 나눈 이유는 `artwork.py` 가 DB 를 안 물게 하기 위해서다 —
프롬프트 조립과 출력 검사는 `scripts/bench_image.py` 도 부른다.

**⛔ ~~2026-09-09 — 아이 요청에서 굽는 길이 없어졌다~~ → 2026-09-15 에 되살아났다**
(`adr/0015` ② 대표 판정). **아이 문장으로 굽기 때문에 `pending` 행이 다시 생기고,
`굽기()` 와 `오래_기다렸으면_확정()` 이 둘 다 돈다** (`api/v1/attempts.py` ·
`api/v1/artworks.py`).

**⛔ 이 문단이 그 사실을 하루 넘게 안 따라왔다** (2026-09-16 에 고쳤다). 「안 돈다」로
읽은 탓에 **확정 갈래를 아무도 안 봤고**, 그 사이 **확정이 굽기를 앞질러 아이가
기본 에셋을 받은 회차**가 운영에 남았다(`주차계획/W6.md` 27번). **「지금 안 돈다」를
적는 것은 맞았는데 그것이 참이 아니게 된 날 안 지운 것이 틀렸다.**

**모든 실패가 `ready` 로 수렴한다.** `failed` 는 2026-09-08 계약에서 빠졌다 —
생성 실패도, 저장 실패도, 예외도 **`ready` + `fallback=true`** 다. 그림 자리는
프록시가 기본 에셋으로 메운다 (미결 11-7 · `Stage0.md` 5절).
**아이가 그림을 못 받는 경우를 만들지 않는다는 것이 B-3 의 결정**이고, 이 모듈이
그 결정을 실제로 지키는 자리다.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.artwork import 생성
from app.config import REPO_ROOT
from app.middleware import current_request_id
from app.models import Artwork, CardAttempt
from app.schemas.stage0 import Tier
from app.storage import mime추측, 시도키, 올리기, 읽기, 조합찾기

logger = logging.getLogger(__name__)


async def 만들기(
    session: AsyncSession,
    card_attempt_id: uuid.UUID,
    tier: Tier,
    card_id: str,
    *,
    굽나: bool = False,
) -> Artwork:
    """행 하나. **커밋까지 한다** — 「내 책」과 폴링이 다른 세션으로 이 행을 찾는다.

    **⛔ 여기서 굽지 않는다** (W5 7번 ② · 2026-09-09 확정). **어떤 경우에도
    `pending` 을 만들지 않고, 세 갈래 전부 즉시 `ready` 로 확정한다.**

    1. **요청한 조합이 있다** → 그것을 가리킨다. `fallback = False`
    2. **없고 같은 카드의 `legendary` 가 있다** → 그것을 가리킨다. **`fallback = True`**
    3. **둘 다 없다** → `r2_key` 없이 `fallback = True`. 프록시가 기본 에셋을 준다

    **종전에는 캐시 미스에서 `pending` 을 만들고 뒤에서 구웠다.** 파일럿에는
    `basic`·`rare` 파일이 아예 없어서 **그 길이 곧 「아이가 카드를 쓸 때마다 유료
    호출」**이었다. 그래서 **행 만드는 자리에서 막는다** — 부르는 쪽이 안 굽기로
    마음먹는 것에 기대지 않는다.

    **계약은 안 바뀐다.** `artwork_id` 는 이 시도의 것이고, 주소도
    `/artworks/{id}/image` 하나 그대로다. **어느 종류의 폴백인지는 서버 로그에만
    남긴다** — 아이에게는 어느 쪽이든 그냥 그림이 나온 것이어야 한다.
    """
    if 굽나:
        # **아이 문장으로 구울 행이다** (`adr/0015` ②). `pending` 으로 두고 부르는
        # 쪽이 뒤에서 굽는다 — **여기서 굽지 않는다.** 이 함수는 요청 세션을 쥐고 있고,
        # 굽기는 응답이 나간 뒤에 도는 코드다.
        #
        # **`fallback` 은 거짓으로 시작한다.** 아직 실패하지 않았다 — 15초를 넘기거나
        # 굽기가 실패하면 그때 참이 된다 (`오래_기다렸으면_확정` · `굽기`).
        굽는것 = Artwork(
            card_attempt_id=card_attempt_id, tier=tier, status="pending", fallback=False
        )
        session.add(굽는것)
        await session.commit()
        return 굽는것

    찾은 = await 조합찾기(card_id, tier)
    if 찾은 is None:
        # **아이 원문이 아니다** — 카드 id 와 티어는 우리가 정한 값이라 실어도 된다.
        # 이것이 「빈 조합을 보고한다」의 실물이다: 채우려고 굽지 않고, 어느 조합이
        # 실제로 불렸는지만 남긴다 (`주차계획/W5.md` 「삽화」).
        logger.info(
            "삽화 조합이 없어 기본 에셋으로 간다",
            extra={"request_id": current_request_id(), "card_id": card_id, "tier": tier},
        )
    elif 찾은.티어폴백:
        logger.info(
            "삽화를 같은 카드의 legendary 로 폴백한다",
            extra={"request_id": current_request_id(), "card_id": card_id, "tier": tier},
        )

    삽화 = Artwork(
        card_attempt_id=card_attempt_id,
        tier=tier,
        status="ready",
        r2_key=찾은.키 if 찾은 else None,
        fallback=찾은 is None or 찾은.티어폴백,
        ready_at=datetime.now(UTC),
    )
    session.add(삽화)
    await session.commit()
    return 삽화


async def 굽기(
    artwork_id: uuid.UUID, card_id: str, tier: Tier, 아이문장: str | None = None
) -> None:
    """생성 → 저장 → 행 갱신. **예외를 밖으로 내지 않는다.**

    **⛔ 유료 이미지 호출이 여기서 나간다.** 2026-09-15 에 **아이 요청 경로로 되살아났다**
    (`adr/0015` ②, 대표 판정) — 2026-09-09 에 걷어낸 그 자리다. **상한을 부르는 쪽이
    쥔다**: 하루 카드 5장 + **등급이 오른 재시도만.** 여기서는 안 센다 —
    **세는 자리가 둘이면 한쪽만 바뀐다**(`attempts.굽나`).

    **`아이문장` 은 가린 것이다** (`adr/0015` ②). 원문을 받으면 **가린 것이 그림으로
    되돌아온다.** 여기서 다시 가리지 않는다 — 두 군데서 가리면 한쪽만 바뀌는 날이 온다.

    백그라운드에서 돈다. 여기서 터진 것이 아이 응답을 되돌릴 수는 없지만
    (응답은 이미 나갔다), **행이 `pending` 에 갇히면 프론트가 15초를 헛돈다** —
    그 15초는 아이가 화면 앞에서 기다리는 시간이다. 그래서 **어떤 길로 끝나든
    행은 `ready` 가 된다.**

    **요청 세션에 얹지 않는다.** 응답이 나간 뒤에 도는 코드라 그 세션은 이미 닫혔다.
    """
    try:
        결과 = await 생성(card_id, tier, 아이문장)
        키 = None
        if 결과.image and (오브젝트키 := 시도키(artwork_id, 결과.mime)):
            # **⛔ 조합 키가 아니라 시도 키다** (`adr/0015` ②). 조합 키는 카드+티어
            # 하나에 파일 하나라 **여러 아이가 같이 보는 자리**다 — 아이 문장으로 구운
            # 그림을 거기 덮으면 **다음 아이가 남의 문장으로 그려진 그림을 캐시 히트로
            # 받고**, 깔아 둔 `legendary` 18장도 덮인다.
            키 = await 올리기(오브젝트키, 결과.image, 결과.mime)
        if 키 is None:
            # **기본 에셋 앞에 조합 파일을 한 번 본다.** 미리 깔아 둔 `legendary` 가
            # 있는데 안 보면 **아이가 오늘보다 나쁜 그림을 받는다** — 회색 액자 한 장이다.
            # **`fallback` 은 참이다**: 아이 문장으로 그린 것이 아니다.
            찾은 = await 조합찾기(card_id, tier)
            # **사유는 우리 눈금이다** (`artwork.생성결과`). 아이에게 안 나간다 —
            # 나가면 「기본 그림이야」가 되고, 그건 아이가 자기 문장이 부족했다고 읽는다.
            logger.info(
                "삽화를 못 구워 폴백한다",
                extra={
                    "request_id": current_request_id(),
                    "reason": 결과.사유 or "store",
                    "card_id": card_id,
                    "tier": tier,
                },
            )
            await _끝냈다(artwork_id, 찾은.키 if 찾은 else None, 폴백=True)
            return
        await _끝냈다(artwork_id, 키, 폴백=False)
    except Exception as exc:
        # **예외 메시지를 싣지 않는다** — 프로바이더가 프롬프트를 되울려 주는 일이 있고,
        # Stage 1 에서는 그 프롬프트에 GM 서사가 들어온다.
        logger.warning(
            "삽화 굽기가 실패했다",
            extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
        )
        await _끝냈다(artwork_id, None, 폴백=True)


async def _끝냈다(artwork_id: uuid.UUID, r2_key: str | None, *, 폴백: bool) -> None:
    """`ready` 로 확정한다.

    **`폴백` 을 부르는 쪽이 준다.** 종전에는 `r2_key is None` 으로 유도했는데,
    **조합 파일로 떨어진 경우가 「키는 있지만 폴백」**이라 그 유도가 틀린다
    (`adr/0015` ②). 아이에게는 어느 쪽이든 그냥 그림이 나온 것이어야 하고,
    **어느 종류의 폴백인지는 우리 눈금에만 남는다.**

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
            삽화.fallback = 폴백
            삽화.ready_at = datetime.now(UTC)
            await session.commit()
    except Exception as exc:
        # 여기까지 실패하면 행은 `pending` 으로 남는다. **프론트는 15초 뒤 기본 에셋을
        # 보여주므로 아이 화면은 멈추지 않는다** (`Stage0.md` 5절 폴링 표).
        logger.warning(
            "삽화 상태를 못 굳혔다",
            extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
        )


# **⛔ 프론트 폴링 상한(15초)과 일부러 다른 값이다** (`Stage0.md` 5절 · 2026-09-15 개정).
# 종전에는 `TIMEOUT_SECONDS`(15초)를 그대로 써서 **셋이 같은 값**이었다 —
# 생성 호출 상한 · 이 확정 문턱 · 프론트 폴링.
#
# **그게 결함이었다.** 굽기는 생성 하나가 아니다: **출력 검사 + 생성(≤15초) + R2 업로드.**
# 생성에만 15초를 주면서 확정 문턱도 15초면 **생성이 상한 가까이 걸릴 때 확정이 이긴다** —
# 그러면 **다 구워질 그림을 버리고 `fallback` 으로 굳혀** 아이가 기본 에셋을 받고,
# **책에도 그것이 남는다.** 2026-09-15 운영에서 실제로 났다(`W6.md` 27번 · `+15.66초`).
#
# **60초는 「아직 안 끝났다」와 「죽었다」를 가르는 값이다** — 생성 최대 8.1초(W1 벤치)에
# 검사·업로드·재시도 여유를 다 얹었다. **프론트 15초는 안 올린다**: 아이를 더 기다리게
# 하는 것이 비전 원칙에 걸리고, **아이는 15초에 기본 에셋을 보더라도 행이 뒤에 진짜
# 그림으로 바뀌어 「내 책」에는 남는다.** 확정이 먼저 굳히면 그 회수마저 없어진다.
확정문턱초 = 60.0
기다리는시간 = timedelta(seconds=확정문턱초)


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
    """**60초**를 넘긴 `pending` 을 **`ready` + `fallback` 으로 굳힌다** (`Stage0.md` 5절).

    **이 함수는 돈다** — `adr/0015` ② 로 굽기가 되살아나며 `pending` 행이 다시 생겼다.
    부르는 곳은 `api/v1/artworks.py` 의 폴링 갈래다.

    **왜 굳히는 것이 필요한가** — 서버가 안 굳히면 그 행은 **영영 `pending`** 이다.
    굽기가 죽었거나 프로세스가 내려간 경우가 그렇고, 그러면 그 카드는 **「내 책」에도
    안 선다.** 아이 화면만 넘어가고 기록이 뒤에 남는다.

    **⛔ 그런데 일찍 굳히는 것이 더 나쁘다.** 성급하게 확정하면 **다 구워질 그림을
    버리고 기본 에셋을 주고, 책에도 그것이 남는다.** 2026-09-15 운영에서 났다 —
    **확정 문턱이 생성 상한과 같은 15초라 확정이 굽기를 앞질렀다**(`W6.md` 27번).
    그래서 **문턱은 굽기 전체보다 넉넉해야 한다** — 위 `확정문턱초` 주석.

    **프론트는 15초에 폴링을 끊고 기본 에셋을 보여준다. 그건 그대로 둔다** —
    **아이가 보는 것과 책에 남는 것은 다를 수 있고, 뒤엣것을 지키는 편이 낫다.**
    """
    if 삽화.status != "pending" or datetime.now(UTC) - 삽화.created_at < 기다리는시간:
        return 삽화

    삽화.status = "ready"
    삽화.fallback = True
    삽화.ready_at = datetime.now(UTC)
    await session.commit()
    return 삽화


# 생성이 실패했을 때 아이에게 나가는 그림. **「실패한 그림」으로 보이면 안 된다** —
# 어둡거나 비었거나 물음표·자물쇠 같은 기호가 들어가면 **아이가 자기 문장이 부족했다고
# 읽는다** (`장면카드_초안.md` 「기본 삽화 1장」 사양).
기본에셋 = REPO_ROOT / "api" / "app" / "assets" / "기본삽화.webp"


@lru_cache
def 기본에셋바이트() -> bytes | None:
    """없으면 `None` — 그때 폴백 경로가 404 를 낸다.

    **파일이 빠지면 아동 3명이 그림 자리가 빈 화면을 본다.** 그래서 저장소에
    커밋해 두고(`app/assets/README.md`), 테스트가 실물이 있는지 본다.
    """
    try:
        return 기본에셋.read_bytes()
    except OSError:
        logger.error("기본 삽화 에셋이 없다: %s", 기본에셋.name)
        return None


async def 바이트읽기(삽화: Artwork) -> tuple[bytes, str] | None:
    """프록시가 내보낼 바이트와 mime. **없으면 `None`.**

    **기본 에셋도 같은 주소로 나간다** (2026-09-08 PM 판정). 주소가 갈리면
    「`fallback` 을 아이에게 알리지 않는다」가 **네트워크 탭에서 무너진다** —
    아이는 그냥 그림이 나온 것이어야 한다.

    `r2_key` 가 없을 때뿐 아니라 **저장소를 못 읽을 때도** 기본으로 간다. R2 가 잠깐
    죽었다고 아이가 빈 그림 자리를 보게 두지 않는다.
    """
    if 삽화.r2_key:
        바이트 = await 읽기(삽화.r2_key)
        if 바이트 is not None:
            return 바이트, mime추측(삽화.r2_key)

    기본 = 기본에셋바이트()
    if 기본 is None:
        return None
    # **확장자에서 되돌린다.** 여기에 mime 을 손으로 적으면 파일을 바꿀 때 한쪽만
    # 바뀌고, 틀린 mime 은 브라우저가 다운로드로 처리해 **그림이 조용히 안 뜬다.**
    return 기본, mime추측(기본에셋.name)
