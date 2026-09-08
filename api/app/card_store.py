"""장면 카드를 **DB 에서 읽는다** (A0-1 잔여).

**정본은 여전히 `docs/장면카드_초안.md` 다.** 바뀌는 것은 「누가 런타임에 읽는가」뿐이고,
문서 → DB 를 잇는 자리가 `씨뿌리기()` 하나다. 리더(`app/scene_cards.py`)를 그대로 쓴다 —
카드 본문을 여기 복사하면 대표 검수가 반영될 때마다 갈라진다.

**왜 DB 로 옮기나** — 「오늘 안 한 카드」를 고르려면 카드와 소모 이력이 **같은 곳에서
같은 트랜잭션으로** 보여야 한다 (A0-1 · A0-5). 문서 리더는 그걸 못 한다.

**뿌리는 것은 배포다** — `scripts/seed_cards.py` (`make seed`). 마이그레이션에 데이터를
박지 않는다: 마이그레이션은 그 시점의 스냅샷으로 굳어 **문서가 고쳐져도 안 따라오고**,
카드 본문이 저장소에 한 벌 더 생긴다. 안 뿌린 채로 서면 `/readyz` 가 먼저 안다.

**되묻기(`app/scaffold.py`)는 여전히 문서를 읽는다.** 명사 태그가 필요한데 그건 같은
문서에서 온 값이고, 배포마다 다시 뿌리므로 **두 경로가 같은 정본을 본다.** 갈라지는
경우는 「뿌리는 것을 잊었을 때」 하나뿐이고, 그 하나를 `/readyz` 가 잡는다.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CARD_TYPES, TUTORIAL_TYPE, Card, CardAttempt
from app.scene_cards import 카드들

# 카드 화면의 입력 유도 문장 (`Stage0.md` 3절 예시 · PRD 3장 「탐험가는 어떻게 할까?」).
# **`docs/문구.md` 에 아직 등록돼 있지 않다** — 화면에 그대로 나가는 문장이라 거기가
# SSOT 여야 한다. PM 에게 올려 둔다.
묻는말 = "탐험가는 어떻게 할까?"

# 씨를 다시 뿌릴 때 덮어쓰는 열. **`id` 는 뺀다** — 충돌을 가르는 기준이라 갱신 대상이
# 아니다. 나머지는 전부 문서에서 오는 값이라 문서가 이겨야 한다.
_덮어쓸열 = (
    "type",
    "situation_text",
    "prompt_label",
    "noun_tags",
    "sketch_r2_key",
    "display_order",
)


def _스케치키(card_id: str) -> str:
    """카드 스케치의 저장소 키. **에셋은 아직 없다** (W3 A0-3) — 모양만 맞춰 둔다.

    지금까지 `_fixtures.sketch_url()` 이 만들던 주소와 같은 꼴이라, 에셋이 들어오는
    날 이 함수 하나만 본다.
    """
    return f"cards/{card_id}_sketch.webp"


async def 씨뿌리기(session: AsyncSession) -> int:
    """문서의 카드를 `cards` 에 넣는다. **몇 번을 돌려도 결과가 같다.**

    배포마다 도는 자리라 **덮어쓴다** — 대표 검수로 문서가 바뀌면(`cacda91` 에서 6장)
    그다음 배포에 따라와야 한다. 안 덮어쓰면 DB 가 옛말을 하고, **그 옛말이 아이에게
    나간다.**

    **튜토리얼 T1~T3 도 넣는다.** 미검수라 프리테스트에 안 쓸 뿐이고
    (`장면카드_초안.md` 74행), 노출 경로는 Stage 1 A-6 이다.
    """
    행들 = [
        {
            "id": 장면.card_id,
            "type": 장면.유형코드 or TUTORIAL_TYPE,
            "situation_text": 장면.상황문,
            "prompt_label": 묻는말,
            "noun_tags": list(장면.명사태그),
            "sketch_r2_key": _스케치키(장면.card_id),
            "display_order": 순번,
        }
        for 순번, 장면 in enumerate(카드들().values())
    ]

    문 = insert(Card).values(행들)
    await session.execute(
        문.on_conflict_do_update(
            index_elements=[Card.id],
            set_={열: 문.excluded[열] for 열 in _덮어쓸열},
        )
    )

    # **문서에서 빠진 카드는 지운다.** 남겨 두면 검수에서 걷어낸 장면이 계속 나온다.
    # `card_attempts.card_id` 가 이 행을 참조하므로 **이미 아이가 쓴 카드는 안 지워진다** —
    # FK 위반으로 여기서 터지고, 그때는 지우는 것이 아니라 사람이 판단할 일이다.
    await session.execute(delete(Card).where(Card.id.notin_([행["id"] for 행 in 행들])))

    await session.commit()
    return len(행들)


async def 카드수(session: AsyncSession) -> int:
    """`/readyz` 가 본다. 0 이면 **아직 안 뿌린 것**이다."""
    return await session.scalar(select(func.count()).select_from(Card)) or 0


async def 카드(session: AsyncSession, card_id: str) -> Card | None:
    """모르는 카드면 `None`. 튜토리얼도 여기서는 그대로 돌려준다 — 걸러내는 것은
    엔드포인트의 일이다 (`/cards/{id}` 는 404)."""
    return await session.get(Card, card_id)


async def 모험카드들(session: AsyncSession) -> list[Card]:
    """Stage 0 의 20장. **튜토리얼은 빠진다** (Stage 1 A-6).

    문서 순서(`display_order`)로 돌려준다 — 안 주면 Postgres 가 아무 순서나 주고,
    「오늘 안 한 카드」를 고르는 자리(A0-5)가 그 순서를 본다.
    """
    문 = select(Card).where(Card.type.in_(CARD_TYPES)).order_by(Card.display_order)
    return list(await session.scalars(문))


def 오늘시작() -> datetime:
    """「오늘」의 경계. **이 저장소에 이 기준은 하나여야 한다.**

    **지금은 UTC 자정이다.** 자녀별 타임존으로 가르는 것은 미결 11-4(일일 상한 리셋)와
    같은 판단이라 **거기서 한 번에 정한다** — 두 곳에서 따로 정하면 갈라지고, 갈라지면
    **「오늘 했다는데 카드를 안 준다」**가 된다.

    원래 `app/api/v1/parents.py` 에 있었다. 학부모 화면의 「오늘 놀았나」와 여기 「오늘
    쓴 카드」가 **같은 경계를 봐야 해서** 옮겼다 — 그 함수의 주석이 이미 그렇게 적혀 있었다.
    """
    return datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


async def 오늘쓴카드들(session: AsyncSession, child_id: uuid.UUID) -> set[str]:
    """이 아이가 **오늘 실제로 소모한** 카드들.

    `card_attempts` 행이 곧 소모다 — 되묻기·차단은 행을 안 만들므로 여기 안 잡힌다
    (`Stage0.md` 4절). **재시도도 같은 카드라 잡힌다** — 이미 푼 카드이니 맞다.
    """
    문 = (
        select(CardAttempt.card_id)
        .where(CardAttempt.child_id == child_id, CardAttempt.created_at >= 오늘시작())
        .distinct()
    )
    return set(await session.scalars(문))
