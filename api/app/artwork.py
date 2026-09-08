"""B-3 등급 연동 삽화 — **프롬프트 조립과 출력 검사**.

여기는 **무엇을 그릴지 정하고, 그것이 나가도 되는지 보는 곳**이다. 실제 생성 호출과
R2 업로드는 다음 조각이다.

**티어는 등급이 정한다** — 매핑은 `app.evaluator.TIER_BY_GRADE` 하나뿐이다. 여기 복사하지 않는다.

**아이 원문은 프롬프트에 안 들어간다.** 삽화는 아이의 1인칭 시점이고 주인공을 그리지
않는다 (PRD B-5, 2026-09-01 대표 확정). 프롬프트에 들어가는 것은 **검수된 카드의
스케치 프롬프트 + 티어 접미어 + 화풍 + 가이드**뿐이다.

**그런데도 출력 검사를 통과해야 나간다** (E-1 양방향 · W4 B-3).
Stage 0 에서는 프롬프트 재료가 전부 우리가 검수한 것이라 걸릴 일이 드물다.
**드물다는 것이 검사를 빼도 된다는 뜻이 아니다** — 이 게이트가 서 있어야
Stage 1 에서 GM 서사가 프롬프트에 들어올 때 그 자리가 이미 막혀 있다.
W3 에서 「검사할 모델 출력이 아직 없어 B-3 로 옮긴다」고 적어 둔 자리가 여기다.

**가이드 캐릭터를 뺀 프롬프트를 만들지 않는다 — 안전 사유다.** 화풍 일관성(B-5)은
W5 로 미뤘지만 **레퍼런스 주입은 그 항목의 일정과 무관하게 여기 있어야 한다.**
W1 벤치에서 가이드 없이 생성한 c01(위기)은 뿔 달린 거대 실루엣이 어두운 숲을 채워
만 10~12세에게 경계에 가까웠고, **가이드가 함께 있으면 톤이 확연히 부드러워진다**
(PRD B-5 · `안전_어휘_기준.md` 5장). W4 는 아동 3명이 실제로 보는 주차다.
"""

import logging
from functools import lru_cache

from app.config import REPO_ROOT
from app.middleware import current_request_id
from app.moderation import 검사결과, 검사하기
from app.scene_cards import 카드
from app.schemas.stage0 import Tier

logger = logging.getLogger(__name__)

# 가이드 캐릭터 정본 (`docs/캐릭터/`). 턴어라운드 3면이라 스카프·고글·가방이 모두 보인다 —
# 표정 PNG 4종은 축약본이라 레퍼런스로 못 쓴다.
레퍼런스 = REPO_ROOT / "docs" / "캐릭터" / "캐릭터색상코드.png"

STYLE = (
    "2D cel-shaded webtoon illustration, bold dark outlines, flat shading, "
    "warm storybook palette, no text, no watermark"
)

# 레퍼런스 이미지와 짝이다. 둘 중 하나만 넣으면 가이드가 안 그려지거나 딴판이 된다.
GUIDE = (
    "Keep the red panda explorer-scholar character in the reference image exactly "
    "consistent: same fur color, face markings, vest, scarf, scholar cap, goggles, "
    "satchel and glowing compass."
)

# 티어별 접미어 3종 (PRD B-3 SHOULD). **장면은 안 바꾸고 밀도만 올린다** —
# 티어가 장면을 바꾸면 같은 카드가 등급마다 다른 이야기가 된다.
접미어: dict[Tier, str] = {
    "basic": "simple flat colors, minimal background detail",
    "rare": "richer lighting, detailed background, subtle depth of field",
    "legendary": "dramatic cinematic lighting, intricate detail, painterly finish",
}


def 프롬프트(card_id: str, tier: Tier) -> str | None:
    """카드 하나의 삽화 프롬프트. **모르는 카드·빈 스케치 프롬프트면 `None`.**

    `None` 은 실패가 아니라 **기본 에셋으로 간다**는 신호다 — 카드 하나 때문에
    아이의 플레이가 멈추지 않는다 (PRD B-3 「플레이 중단 없음」).
    """
    장면 = 카드(card_id)
    if 장면 is None or not 장면.스케치프롬프트:
        return None
    return f"{STYLE}. Scene: {장면.스케치프롬프트}. {접미어[tier]}. {GUIDE}"


@lru_cache
def 레퍼런스바이트() -> bytes | None:
    """없으면 `None` — **부르는 쪽이 생성을 접는다.**

    가이드 없는 삽화를 대신 만들지 않는다. 위 모듈 주석의 안전 사유다.
    """
    try:
        return 레퍼런스.read_bytes()
    except OSError:
        logger.error("가이드 레퍼런스 이미지를 읽지 못했다: %s", 레퍼런스.name)
        return None


async def 내보내도되나(프롬프트문: str) -> 검사결과:
    """삽화 프롬프트의 **출력 검사** (E-1 양방향).

    `검사하기()` 를 그대로 쓴다 — 입력과 출력에 다른 기준을 두지 않는다. 방향도 같다:
    **판정을 못 받으면 막는다.** 여기서 막히는 값은 기본 에셋 한 장이고,
    반대쪽 값은 유해한 그림이 아이 책에 인쇄되는 것이다 (`검사하기()` 주석).
    """
    결과 = await 검사하기(프롬프트문)
    if 결과.blocked:
        # **프롬프트 문장을 로그에 싣지 않는다.** 아이 원문은 아니지만, 같은 자리에
        # Stage 1 에서 GM 서사가 들어온다 — 그때 이 줄이 원문 유출 경로가 된다.
        logger.warning(
            "삽화 프롬프트가 출력 검사에서 막혔다",
            extra={
                "request_id": current_request_id(),
                # `direction` 은 입력 검사와 같은 자리를 쓴다 — 둘을 한 눈금으로 세야
                # 「출력에서만 막힌다」가 보인다 (`안전_어휘_기준.md` 6장).
                # 입력 쪽이 `in` 이라 여기는 `out` 이다 — 짝을 맞춘다
                "direction": "out",
                "category": 결과.category,
                "moderation_unavailable": 결과.unavailable,
            },
        )
    return 결과
