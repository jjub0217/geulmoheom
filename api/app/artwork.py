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

import asyncio
import io
import logging
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Final

from google.genai import types

from app.config import REPO_ROOT, get_settings
from app.cost import record_usd
from app.llm import get_client
from app.middleware import current_request_id
from app.moderation import 검사결과, 검사하기
from app.scene_cards import 카드
from app.schemas.stage0 import Tier

logger = logging.getLogger(__name__)

# `Stage0.md` 5절이 **15초**를 상한으로 못 박았다 — 넘으면 프론트가 폴링을 끊고
# 서버도 기본 에셋으로 확정한다. 그래서 생성 호출이 그보다 오래 살아 있을 이유가 없다.
# **재시도를 두지 않는다.** 실측 평균 6.2초라 한 번 더 던지면 상한을 넘는다
# (`benchmarks/W1-image-bench.md`).
TIMEOUT_SECONDS: Final = 15.0

# `adr/0006` 확정 모델의 장당 단가 (2026-09-01 확인). **비용 알람용 근사치다** —
# 청구서가 아니라 F-3 한도를 재는 눈금이고, 모델이 바뀌면 여기도 바뀐다.
장당USD: Final = 0.0336

# 가이드 캐릭터 정본 (`docs/캐릭터/`). 턴어라운드 3면이라 스카프·고글·가방이 모두 보인다 —
# 표정 PNG 4종은 축약본이라 레퍼런스로 못 쓴다.
레퍼런스 = REPO_ROOT / "docs" / "캐릭터" / "캐릭터색상코드.png"

# **시트를 통째로 넣지 않는다. 정면 1면만 잘라 쓴다.** 문구로는 안 막히고
# 레퍼런스에서 없애야 통한다 — 2026-09-07(캐릭터 생성)과 2026-09-08(기본 삽화)에
# 두 번 실측했다.
#
# 1. **글자가 따라 그려진다.** 하단 스와치 라벨(`FUR MARKINGS VEST LEATHER…`)과
#    상단 `SIDE` 가 그림 안에 그대로 박힌다. 프롬프트의 `no text, no watermark` 가
#    **안 막는다** — 기본 삽화 후보 10장 중 1장에서 실제로 났다
# 2. **턴어라운드 구도를 복제한다.** 3면이 보이니 장면 대신 **캐릭터 셋이 나란히 선
#    시트**를 그린다. 10장 중 1장에서 났다. 꼬리가 둘이 되는 것도 같은 원인이다
#
# **둘 다 폴백이 못 막는다** — 생성은 성공했고 바이트도 왔다. **글자가 박힌 그림이
# 그대로 아이 책에 인쇄된다.** 「플레이 중단 없음」이 오히려 망가진 그림을 통과시킨다.
#
# 이 크롭은 `scripts/gen_character.py` 가 먼저 알아낸 것인데 **그 쪽은 스크립트라
# 제품을 짜는 사람이 열 이유가 없었다.** 그래서 이유를 여기 옮겨 적는다 —
# 가리키면 안 읽힌다.
_정면 = (0.0, 0.10, 0.40, 0.79)  # (좌, 상, 우, 하) 비율

STYLE = (
    "2D cel-shaded webtoon illustration, bold dark outlines, flat shading, warm storybook palette"
)

# **구도를 말한다** (2026-09-08, W4 「삽화 결함 수리」 ㉠ · `benchmarks/W4-artwork-eyes.md`).
# 20장 실물에서 **`c08`·`c16` 이 장면을 잃었다** — 눈밭의 문이 **가이드 배 위에** 그려졌고
# 성문 앞 문지기가 아예 사라졌다. 뿌리는 시트 복제(크롭으로 막았다)와 같다:
# **레퍼런스가 장면을 이긴다.**
#
# **`GUIDE` 는 캐릭터를 `exactly consistent` 하게 유지하라고 강하게 말하는데,
# 어디에 얼마나 크게 둘지는 아무도 말하지 않았다.** 그래서 모델이 캐릭터를 화면
# 가운데 세우고 장면을 배경으로 밀었다 — 20장 중 절반 가까이가 정면 전신이었다.
#
# **가이드를 빼서 푸는 것이 아니다.** 가이드는 안전 MUST 라(PRD B-5) 반드시 있어야 하고,
# 여기서 정하는 것은 **크기와 자리**뿐이다.
# **「하나다」를 말한다** (2026-09-08 밤 · 3차). `c13` 에서 **한 화면에 가이드가 둘**
# 나왔다 — 왼쪽 탁자와 오른쪽 분수대에 각각. **턴어라운드 시트 복제와 뿌리가 같다**
# (레퍼런스 캐릭터를 여러 번 그린다). **크롭이 시트는 막았는데 복제 자체는 안 막았다.**
구도 = (
    "Wide shot of the scene; the scene fills the frame. Exactly one red panda guide "
    "appears in the image, never two. The guide is a small secondary figure standing "
    "inside the scene, no more than one third of the frame height, never overlapping "
    "or covering the scene's main subject."
)

# **맨 뒤에 둔다.** 종전에는 `STYLE` 안에 있어 프롬프트 앞쪽이었고, 뒤에 오는
# 티어 접미어·`GUIDE` 에 밀렸다 — `c07` 은 카드가 글자를 안 시켰는데도 **하늘 전체에
# 유사 문자 여러 줄**이 박혔다.
#
# **이 방법을 믿을 근거가 약하다는 것을 안다.** 기본 삽화 때 「문구로는 안 막히고
# 레퍼런스에서 없애야 통한다」를 이미 한 번 확인했다(`_정면` 주석). **그래서 이건
# 가장 싼 것을 먼저 해 보는 것이고, 안 되면 그 사실을 적고 다음을 찾는다** —
# 통과 기준을 뽑기 전에 적어 둔 이유가 그것이다 (`benchmarks/W4-artwork-eyes.md`).
#
# **`c12`·`c14` 는 카드 쪽이 고쳐졌다** (`ed93418`, 2026-09-08 21:13) — `c12` 는 신문 →
# **뜨개질**, `c14` 는 스케치만 **글자 없는 그림 간판**으로. `app/scene_cards.py` 가
# `docs/장면카드_초안.md` 를 직접 읽으므로 **여기서 할 일은 없다.**
#
# **⚠ 그런데 「고쳤으니 이제 안 난다」로 읽으면 안 된다 — 실측이 정반대를 말한다.**
# 수정 23분 뒤에 뽑은 2차(`수리2차/`, 21:36)에서 **목표한 글자(신문·간판)는 없어졌는데
# `c12` 에 동굴 아치 룬이 새로 났다.** `c02`·`c10` 도 1차에 멀쩡했다가 2차에 났다.
# **소품을 하나 빼면 다른 데서 난다** — 이것이 **「글자는 카드별 결함이 아니라
# 확률적이다」**의 근거다 (`benchmarks/W4-artwork-eyes.md` 239행).
#
# **그래서 이 줄을 더 손보지 마라.** ㉢(프롬프트로 막기)는 **두 번 실패했고 안 고치기로
# 확정됐다**(같은 문서 427행). **다음 층은 프롬프트도 카드도 아니다** — **사전 생성에서
# 사람이 거른다.** 그것이 사전 생성의 **비용이 아니라 진짜 근거**다.
글자금지 = "No lettering, no words, no signs, no captions, no watermark anywhere in the image."

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


def _행동절(아이문장: str) -> str:
    """아이 문장을 **동작 절**로 감싼다. **주체를 못 박는 것이 이 함수의 전부다.**

    **9장을 눈으로 세고 나온 결함이다** (`benchmarks/W6-artwork-text-bench.md` 2절).
    종전에는 `Action: <문장>.` 한 줄이었는데 **6/9 에서 가이드(래서판다)나 장면 속
    동물이 그 동작을 했다** — `c07` 셋 다 가이드가 막대를 끼웠다. 모델은 동작을
    **그림 안에 있는 인물**에게 붙인다. **PRD B-5 는 「아이의 1인칭 시점이고 주인공을
    그리지 않는다」**이고, 카드 스케치도 전부 `the viewer` 기준으로 쓰여 있다.

    **`c20` 만 손이 나온 것이 그 증거다** — 그 카드 스케치에 이미 `open palm` 이 있었다.
    **1인칭이 지켜지던 것은 카드가 우연히 손을 들고 있을 때뿐**이었다.

    **그래서 둘을 말한다** — ① 동작의 주체는 **보는 사람**이고 화면에 들어오는 것은
    **많아야 손**이다 ② **장면 속 다른 인물은 그 동작을 하지 않는다.** ②가 없으면 ①을
    적어도 가이드가 대신 한다 — `구도` 절이 가이드를 「장면 안에 선 인물」로 세워 두기
    때문에 **모델에게는 그 인물이 가장 자연스러운 주어**다.

    **⛔ ②에서 「red panda guide」를 이름으로 부르지 않는다.** 처음에는
    `The red panda guide never performs this action.` 이라고 적었는데 **`c07` 에 가이드가
    둘 나왔다** — `구도` 절이 「Exactly one … never two」라고 못 박아 둔 바로 그 실패다
    (`c13` 에서 한 번 났다). **이름을 한 번 더 부르는 것이 복제를 부른다**는 것이
    이 저장소가 이미 아는 모양이고(레퍼런스 시트 복제와 뿌리가 같다), 그래서
    **주어를 지우고 「다른 인물은 안 한다」로 돌렸다.**
    """
    return (
        f"Action by the viewer, from the viewer's own point of view, with at most the "
        f"viewer's hands entering the frame: {아이문장.strip()}. "
        f"No other character in the scene performs it."
    )


def 프롬프트(card_id: str, tier: Tier, 아이문장: str | None = None) -> str | None:
    """카드 하나의 삽화 프롬프트. **모르는 카드·빈 스케치 프롬프트면 `None`.**

    `None` 은 실패가 아니라 **기본 에셋으로 간다**는 신호다 — 카드 하나 때문에
    아이의 플레이가 멈추지 않는다 (PRD B-3 「플레이 중단 없음」).

    **`아이문장` 이 들어오면 그 문장이 「무슨 일이 일어나는지」를 정한다**
    (`adr/0015`, 2026-09-15 대표 판정 ②). **카드의 스케치는 그대로 남는다** —
    배경·장소·등장물은 카드가 쥔다. 버리면 **같은 카드가 같은 장소라는 보장이 사라진다.**

    **⛔ 가린 문장을 넘긴다.** 부르는 쪽이 `pii.가리기()` 를 지난 것을 준다 — 원문을
    넘기면 **가린 것이 그림으로 되돌아온다** (`adr/0015` ②). 여기서 다시 가리지 않는다:
    두 군데서 가리면 **한쪽만 바뀌는 날**이 온다.

    **⛔ 문장에 따옴표를 두르지 않는다.** 이미지 모델은 **따온 문자열을 그림 속 글자로
    그리는 성질**이 있다 — 「글자가 따라 그려진다」(모듈 주석)가 이미 두 번 난 자리라
    **따옴표가 그 표면을 넓힌다.** 구분자가 필요해 보이지만 대가가 더 크다.

    **`글자금지` 가 늘 마지막이다.** 그것으로 막혔다고 가정하지 않는다 —
    **붙이고 나서 한 벌 뽑아 눈으로 센다**(`adr/0015` ③). 프롬프트로 막는 것은
    **두 번 실패했고 안 고치기로 확정됐다**(`글자금지` 주석).

    **문장을 안 넘기면 종전과 완전히 같은 문자열이다.** `scripts/bench_image.py` 와
    Stage 1 이 그렇게 부른다 — 기본값이 다른 그림을 만들면 **벤치가 재던 것이 바뀐다.**
    """
    장면 = 카드(card_id)
    if 장면 is None or not 장면.스케치프롬프트:
        return None
    행동 = f" {_행동절(아이문장)}" if 아이문장 and 아이문장.strip() else ""
    return f"{STYLE}. Scene: {장면.스케치프롬프트}.{행동} {접미어[tier]}. {구도} {GUIDE} {글자금지}"


def 챕터프롬프트(장면힌트: str, tier: Tier, 아이문장: str | None = None) -> str | None:
    """챕터 핵심 씬의 삽화 프롬프트 (B-3 재사용 · W7 14번).

    **⭐ 카드 프롬프트와 같은 부품을 쓴다** — 화풍(`STYLE`)·티어 접미어·구도·가이드
    주입(`GUIDE`)·`글자금지`. **그 다섯이 안전과 일관성을 지는 자리**라 새로 조립하면
    **가이드가 빠지거나 글자가 그려지는 판**이 따로 생긴다.
    **⛔ 특히 `GUIDE` 를 빼지 않는다** — PRD B-5 가 **「삽화에서 가이드를 빼지 않는다 —
    안전 사유」**로 못 박았다(가이드 없이 구운 위기 장면이 만 10~12세에게 경계에
    가까웠다).

    **다른 것은 장면 하나뿐이다.** 카드는 문서의 `스케치프롬프트` 를 쓰지만 챕터는
    **GM 이 낸 `scene_prompt_hint`** 를 쓴다 — 뼈대에는 영어 프롬프트 열이 없고,
    **그 턴에 무엇이 보이는지는 그 턴의 서사를 쓴 GM 이 안다.**

    **비어 있으면 `None`** — 실패가 아니라 **기본 에셋으로 간다**는 신호다
    (PRD B-3 「플레이 중단 없음」).

    **⛔ 이 문자열은 `내보내도되나()` 를 지나야 나간다** (E-1 양방향 · 이미지 프롬프트도
    검사 대상). **모델이 낸 장면이 그대로 이미지 모델로 가는 자리**다.
    """
    장면 = 장면힌트.strip()
    if not 장면:
        return None
    행동 = f" {_행동절(아이문장)}" if 아이문장 and 아이문장.strip() else ""
    return f"{STYLE}. Scene: {장면}.{행동} {접미어[tier]}. {구도} {GUIDE} {글자금지}"


@lru_cache
def 레퍼런스바이트() -> bytes | None:
    """**정본에서 정면 1면만 잘라** 돌려준다. 없거나 못 자르면 `None`.

    `None` 이면 **부르는 쪽이 생성을 접는다** — 가이드 없는 삽화를 대신 만들지
    않는다 (위 모듈 주석의 안전 사유). **자르지 못한 시트를 대신 쓰지도 않는다** —
    그러면 위 `_정면` 주석의 둘이 그대로 돌아온다.

    **정본을 런타임에 읽고 여기서 자른다.** 잘린 사본을 저장소에 두면 대표 검수로
    정본이 바뀔 때 갈라지고, **갈라진 쪽이 실제로 아이에게 나가는 그림을 정한다** —
    장면 카드를 문서에서 뿌리는 것과 같은 이유다.
    """
    try:
        원본 = 레퍼런스.read_bytes()
    except OSError:
        logger.error("가이드 레퍼런스 이미지를 읽지 못했다: %s", 레퍼런스.name)
        return None

    try:
        return _정면만(원본)
    except Exception as exc:
        logger.error(
            "가이드 레퍼런스를 자르지 못했다",
            extra={"exc_type": type(exc).__name__},
        )
        return None


def _정면만(원본: bytes) -> bytes:
    """턴어라운드 시트에서 정면 1면만. **정면에도 학사모·고글·스카프·조끼·크로스백·
    나침반이 다 보이므로 잃는 것이 없다.**"""
    from PIL import Image

    with Image.open(io.BytesIO(원본)) as 그림:
        너비, 높이 = 그림.size
        좌, 상, 우, 하 = _정면
        잘린 = 그림.crop((int(너비 * 좌), int(높이 * 상), int(너비 * 우), int(높이 * 하)))
        통 = io.BytesIO()
        잘린.save(통, format="PNG")
    return 통.getvalue()


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


def _설정된모델() -> str:
    return get_settings().image_model.strip()


@dataclass(frozen=True)
class 생성결과:
    """`image` 가 `None` 이면 **기본 에셋으로 간다** — 부르는 쪽이 그렇게 읽는다.

    `사유` 는 왜 못 만들었나다 — `unconfigured`·`no_prompt`·`no_reference`·
    `blocked`·`timeout`·`error`·`empty`. **아이에게 나가지 않고 우리 눈금이다.**
    """

    image: bytes | None = None
    # 프로바이더가 준 그대로다. **확장자를 우리가 짐작하지 않는다** — 목 픽스처가
    # `.webp` 라고 해서 실제로 webp 가 오는 것은 아니다.
    mime: str = ""
    사유: str = ""
    latency_ms: float = 0.0


async def _한번(모델: str, 프롬프트문: str, 레퍼런스: bytes) -> tuple[bytes, str] | None:
    """단발 호출. 타임아웃은 부르는 쪽이 건다 (`evaluator._한번` 과 같은 꼴)."""
    응답 = await get_client().aio.models.generate_content(
        model=모델,
        contents=[
            types.Part.from_bytes(data=레퍼런스, mime_type="image/png"),
            프롬프트문,
        ],
        # 시드를 고정한다 — 같은 카드·같은 티어는 같은 그림이 나와야 재생성이
        # 「다른 그림」이 되지 않는다 (`adr/0006` · B-5 가 W5 에서 이어받는다).
        config=types.GenerateContentConfig(response_modalities=["IMAGE"], seed=12345),
    )
    파트 = [p for p in 응답.candidates[0].content.parts if p.inline_data]
    if not 파트:
        return None
    안 = 파트[0].inline_data
    return 안.data, 안.mime_type or ""


async def 생성(card_id: str, tier: Tier, 아이문장: str | None = None) -> 생성결과:
    """카드 한 장의 삽화를 만든다. **예외를 밖으로 내지 않는다.**

    막히거나 실패하면 `image=None` 이고, 그건 **기본 에셋으로 간다**는 뜻이다 —
    아이의 플레이는 어느 쪽이든 멈추지 않는다 (PRD B-3).

    순서가 정해져 있다. **출력 검사가 생성보다 먼저다** — 뒤에 두면 막을 그림을
    이미 만든 뒤라 돈이 나가고, 무엇보다 **만들어진 것이 어딘가에 남는다.**

    **`아이문장` 은 가린 것이다** (`adr/0015` ②, `프롬프트()` 주석). 그리고 그것이
    프롬프트에 들어가므로 **위의 출력 검사가 아이 문장까지 본다** — 안전 갈래를
    새로 만들지 않는 이유가 그것이다.
    """
    시작 = time.perf_counter()
    return await 프롬프트로생성(프롬프트(card_id, tier, 아이문장), tier, 시작=시작)


async def 프롬프트로생성(
    프롬프트문: str | None, tier: Tier, *, 시작: float | None = None
) -> 생성결과:
    """**조립된 프롬프트 하나로 굽는다. 순서가 이 함수의 전부다.**

    **⛔ 카드(`생성`)와 챕터 핵심 씬(W7 14번)이 같은 이 함수를 쓴다.** 두 벌로 두면
    **아래 순서가 한쪽에서만 지켜지는 날**이 온다 — 그 순서가 안전과 돈이다:
    **① 프롬프트 없으면 기본 에셋 ② 레퍼런스 없으면 안 만든다 ③ 출력 검사 ④ 생성.**

    **③ 이 ④ 보다 먼저인 이유** — 뒤에 두면 **막을 그림을 이미 만든 뒤**라 돈이 나가고,
    무엇보다 **만들어진 것이 어딘가에 남는다.**

    **② 는 안전 사유다** — PRD B-5: **「삽화에서 가이드를 빼지 않는다」.** 가이드 없이
    구운 위기 장면이 만 10~12세에게 경계에 가까웠다(W1 벤치).
    """
    시작 = time.perf_counter() if 시작 is None else 시작

    def _끝(사유: str, image: bytes | None = None, mime: str = "") -> 생성결과:
        return 생성결과(
            image=image, mime=mime, 사유=사유, latency_ms=(time.perf_counter() - 시작) * 1000
        )

    if not 프롬프트문:
        return _끝("no_prompt")

    레퍼런스 = 레퍼런스바이트()
    if 레퍼런스 is None:
        # **가이드 없이 대신 만들지 않는다.** 모듈 주석의 안전 사유다.
        return _끝("no_reference")

    if (await 내보내도되나(프롬프트문)).blocked:
        return _끝("blocked")

    모델 = _설정된모델()
    if not 모델:
        # dev 목 서버는 모델명 없이 돈다. pilot 은 기동 자체가 막힌다 (`config.PILOT_REQUIRED`).
        return _끝("unconfigured")

    try:
        받은것 = await asyncio.wait_for(_한번(모델, 프롬프트문, 레퍼런스), timeout=TIMEOUT_SECONDS)
    except TimeoutError:
        return _끝("timeout")
    except Exception as exc:
        # **예외 메시지를 싣지 않는다.** 프로바이더가 프롬프트를 되울려 주는 일이 있고,
        # Stage 1 에서는 그 프롬프트에 GM 서사가 들어온다.
        logger.warning(
            "삽화 생성 실패",
            extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
        )
        return _끝("error")

    # **호출이 실제로 나갔으면 기록한다** — 그림이 안 왔어도 돈은 나갔다.
    await record_usd(장당USD, kind="image")

    if not 받은것:
        return _끝("empty")
    이미지, mime = 받은것
    return _끝("", 이미지, mime)
