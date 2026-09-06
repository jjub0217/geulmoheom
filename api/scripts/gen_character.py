"""W2 4번 — 캐릭터 표정 4종 재생성 (C-2 중 생성 몫).

정본 `docs/캐릭터/캐릭터색상코드.png`(턴어라운드 3면)를 **레퍼런스 이미지로** 넣어
표정 3종 + 세션 종료 컷을 파생시킨다. 현행 표정 PNG 4종은 스카프·고글·크로스백이
없어 정본과 다른 디자인이다 (`도우미캐릭터설명.md` 「딸려 나오는 일」).

**종횡비를 명시 고정한다.** W1 이미지 벤치의 결함이 정확히 이것이었다 — `image_config`
를 안 줘서 레퍼런스 유무에 따라 1024x1024 와 1408x768 로 갈렸다. 현행 4종이 전부
2048x2048 이므로 **`1:1` 을 고정**한다. 비율이 어긋나면 W3 에서 레이아웃을 다시 잡아야 한다.

**크기는 `1K`(1024x1024)가 상한이다.** `gemini-3.1-flash-lite-image` 는 `2K` 를
400 INVALID_ARGUMENT 로 거부한다 (2026-09-07 실측). 2048 이 필요하면 상위 모델을
써야 하고, 그건 이 세트에 얼마를 쓸지의 문제라 혼자 정하지 않는다.

파일명은 `guide.expression` 코드다 (`app/schemas/stage0.py`). 프론트 매핑이 그 값이라
사람이 읽는 이름보다 코드가 맞다.

실행: `PYTHONPATH=. uv run python scripts/gen_character.py [모델] [크기] [후보수]`
생성물은 `api/out/character/` (gitignore). **`docs/캐릭터/` 에 직접 넣지 않는다** — PM 소유다.
"""

import asyncio
import io
import sys
import time
from functools import cache
from pathlib import Path

from google.genai import types
from PIL import Image

from app.cost import record_usd
from app.llm import get_client

REPO = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parents[1] / "out" / "character"

# W1 벤치 확정 (`adr/0006`). 장당 단가는 2026-09-01 확인치.
# **lite 는 `2K` 를 400 으로 거부한다** (2026-09-07 실측) — 아래 「크기」 참조.
모델단가 = {
    "gemini-3.1-flash-lite-image": 0.0336,
    "gemini-3.1-flash-image": 0.067,
    "gemini-3-pro-image": 0.134,
}

정본 = REPO / "docs" / "캐릭터" / "캐릭터색상코드.png"

# 현행 4종은 2048x2048 이다. 비율이 다르면 W3 에서 레이아웃을 다시 잡아야 하므로
# **`1:1` 은 고정**이고, 크기는 모델이 받는 것 중에서 고른다.
비율 = "1:1"

# `도우미캐릭터설명.md` 화풍 정정 — 2차 리디자인본은 웹툰 톤 셀 셰이딩이다.
# **`3D` 계열 태그를 넣지 않는다.**
STYLE = (
    "2D cel-shaded webtoon illustration, bold dark outlines, flat shading, "
    "soft warm rim light, cozy storybook palette"
)

# 정본이 가진 것 전부. 하나라도 빠지면 아이가 보는 가이드와 삽화 속 가이드가 갈린다.
착용 = (
    "Keep the red panda explorer-scholar from the reference image exactly consistent: "
    "same orange-red fur (#D45B28) with cream face markings (#F6EADB), dark charcoal "
    "scholar mortarboard cap with gold tassel, brass-rimmed goggles resting on the cap, "
    "patterned blue scarf (#457B9D), brown leather explorer vest (#8F5C3E) with chest "
    "pockets, leather satchel on a cross-body strap, striped bushy tail, and the "
    "brass pocket compass (#C29B59) with a cyan glowing crystal (#33E1FF)"
)

# 레퍼런스를 정면 1면으로 잘라도 시트 습관이 남을 수 있어 문구는 함께 둔다.
시트금지 = (
    "Draw ONE single character only, not a turnaround sheet, not multiple views, "
    "no color swatches, no labels, no text, no watermark, no border"
)

# **배경은 정본과 같은 옅은 회색 단색이다. 장면을 그리지 않는다.**
#
# 처음엔 현행 4종처럼 서재를 배경으로 뽑았는데 4장의 배경이 전부 달라졌다 —
# 바닥재도 조명도. 이 넷은 **같은 자리에서 교체되는 표정**이라(아이가 문장을 쓰면
# `default` → `compass_bright`), 배경이 함께 바뀌면 표정이 변한 게 아니라 장면이
# 순간이동한 것으로 읽힌다. 2026-09-07 PM 판정.
#
# 화면에는 카드 스케치 삽화가 이미 큰 사각형으로 들어간다 (A0-2). 가이드까지
# 배경 있는 사각형이면 삽화 둘이 경쟁한다.
#
# 꼬리 개수는 레퍼런스를 정면 1면으로 자르는 것으로 잡았다 (`레퍼런스()` 참조).
# 문구는 남겨 두되 이것만으로는 안 막힌다.
무대 = (
    "full body standing pose, centered, facing the viewer, "
    "exactly ONE striped tail — the character has a single tail, never two, "
    "plain flat light grey studio background (#E8E8E8), completely empty — "
    "no scene, no room, no bookshelves, no floor, no furniture, no particles, "
    "no sparkles in the background, no vignette, even lighting on the character"
)

# 표정 4종. 키는 `GuideExpression` 리터럴 그대로다.
#
# `compass_dim` 의 톤이 이 세트에서 가장 조심할 곳이다 — 되묻기는 실망이 아니라
# 호기심이다 (`용어사전.md` 「부정어 금지」). 실망한 얼굴을 그리면 대사에서 부정어를
# 뺀 것이 그림에서 되살아난다.
표정: dict[str, str] = {
    # 세 표정의 밝기는 default < bright 이고 dim 이 가장 어둡다. 순서가 뒤집히면
    # 나침반이 「아이 문장에만 반응한다」는 장치가 그림에서 무너진다 (용어사전 3장).
    "default": (
        "calm friendly welcoming expression, gentle closed-mouth smile, eyes looking "
        "at the viewer, holding the compass at chest height in one paw; the compass "
        "crystal has a soft steady cyan glow, quiet and even, with no sparkles and "
        "no light trails"
    ),
    "compass_bright": (
        "delighted excited expression, wide open smile, eyes lit up and sparkling, "
        "holding the compass up high; the compass crystal blazes with bright cyan "
        "light with radiant beams and glittering particles close around the compass "
        "itself — the glow must not spill into the empty background"
    ),
    "compass_dim": (
        "curious inquisitive expression, head tilted slightly to one side, one eyebrow "
        "raised, bright interested eyes and a small encouraging smile, one paw raised "
        "in a questioning open gesture, the other holding the compass low; the compass "
        "crystal is almost dark — only the faintest dull cyan ember remains, clearly "
        "dimmer than a resting glow, with absolutely no sparkles, no glitter and no "
        "light beams. The character is intrigued and invites more, absolutely NOT "
        "disappointed, NOT sad, NOT scolding, NOT frowning"
    ),
    # 이 한 장은 재파생이 아니라 **새로 만드는 것**이다. 현행 `캐릭터(세션종료).png` 는
    # `캐릭터(묘사부족).png` 와 바이트가 같다 (md5 4d63f6d9…) — 스캐폴딩 표정을 복사해
    # 둔 것이라 참고할 원본이 없다. 2026-09-07 PM 확인.
    #
    # **아쉬움이 아니라 만족이어야 한다.** 「내일 또 보자」에 붙는 그림이라 더 하고 싶게
    # 만들면 하드 피니시를 그림이 스스로 깬다 (비전 5장). 나침반은 꺼진 게 아니라 쉰다.
    "session_end": (
        "warm satisfied farewell expression, contented gentle smile with eyes softly "
        "creased in happiness, one paw raised in a small goodbye wave, the other arm "
        "hugging a closed storybook against the chest; the compass rests in its pouch "
        "at the hip with its crystal dimmed to a slow calm cyan breathing glow, resting "
        "rather than switched off; a proud and finished end to a good day, "
        "content and NOT sad, NOT longing, NOT tired"
    ),
}


@cache
def 레퍼런스() -> bytes:
    """정본에서 **정면 1면만** 잘라 레퍼런스로 쓴다. 시트를 통째로 넣지 않는다.

    2026-09-07 실측으로 확인한 두 가지다.

    1. **글자가 따라 그려진다.** 하단 스와치 라벨(`FUR MARKINGS VEST LEATHER…`)과
       상단 `SIDE` 가 그림 안에 그대로 박혔다 (4장 전부). 프롬프트에 「no text,
       no labels」를 넣어도 안 막혔다
    2. **꼬리가 둘이 된다.** 3면이 보이니 몸이 셋·꼬리가 셋이라, 한 장에 꼬리를
       두 개 그린다. 프롬프트에 「exactly ONE striped tail, never two」를 넣어도
       안 막혔다 — 한 번은 꼬리가 몸을 통째로 감는 고리가 됐다

    **둘 다 문구로는 안 막히고 레퍼런스에서 없애야 통한다.** 정면 1면에도 학사모·
    고글·스카프·조끼·크로스백·나침반이 다 보이므로 잃는 것이 없다.
    """
    with Image.open(정본) as 그림:
        너비, 높이 = 그림.size
        잘린 = 그림.crop((0, int(높이 * 0.10), int(너비 * 0.40), int(높이 * 0.79)))
        통 = io.BytesIO()
        잘린.save(통, format="PNG")
    return 통.getvalue()


def 한장(모델: str, 크기: str, 코드: str, 회차: int) -> tuple[float, Path | None]:
    프롬프트 = f"{STYLE}. {무대}. Expression: {표정[코드]}. {착용}. {시트금지}."
    시작 = time.perf_counter()
    응답 = get_client().models.generate_content(
        model=모델,
        contents=[
            types.Part.from_bytes(data=레퍼런스(), mime_type="image/png"),
            프롬프트,
        ],
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(aspect_ratio=비율, image_size=크기),
        ),
    )
    지연 = (time.perf_counter() - 시작) * 1000

    파트 = [p for p in 응답.candidates[0].content.parts if p.inline_data]
    if not 파트:
        return 지연, None

    # **PNG 로 저장한다.** 현행 에셋이 PNG 이고, 단색 배경이라 프론트에서 키잉할 수
    # 있어야 한다. API 는 JPEG 로 돌려주고 `image_config.output_mime_type` 은
    # Gemini API 에서 지원되지 않는다 — 그래서 받은 뒤 여기서 바꾼다.
    # **JPEG 압축을 되돌리지는 못한다.** 손실은 이미 들어가 있고 컨테이너만 무손실이다.
    자료 = 파트[0].inline_data
    꼬리 = "" if 회차 == 1 else f"_{회차}"
    경로 = OUT / f"{코드}{꼬리}.png"
    with Image.open(io.BytesIO(자료.data)) as 받은:
        받은.convert("RGB").save(경로, format="PNG")
    return 지연, 경로


async def main() -> None:
    인자 = sys.argv[1:]
    모델 = 인자[0] if 인자 else "gemini-3.1-flash-lite-image"
    크기 = 인자[1] if len(인자) > 1 else "1K"
    후보수 = int(인자[2]) if len(인자) > 2 else 1
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"정본: {정본.name} · 모델 {모델} · {비율} {크기} · 표정당 {후보수}장\n")

    장수, 지연들 = 0, []
    for 코드 in 표정:
        for 회차 in range(1, 후보수 + 1):
            try:
                지연, 경로 = 한장(모델, 크기, 코드, 회차)
            except Exception as exc:
                print(f"  실패 {코드} #{회차}: {type(exc).__name__}: {str(exc)[:120]}")
                continue
            if 경로 is None:
                print(f"  이미지 없음 {코드} #{회차}  ({지연:.0f}ms)")
                continue
            장수 += 1
            지연들.append(지연)
            print(f"  {코드:15} #{회차}  {지연:6.0f}ms  → {경로.name}")

    if not 장수:
        print("\n생성된 장이 없다.")
        return

    비용 = 모델단가.get(모델, 0.0) * 장수
    print(f"\n{장수}장 · 평균 {sum(지연들) / len(지연들):.0f}ms · 약 ${비용:.4f}")
    print(f"생성물: {OUT}")
    print("→ PM 에게 이 경로를 알린다. docs/캐릭터/ 반영은 PM 몫이다.")
    누적 = await record_usd(비용, kind="character_gen")
    print(f"오늘 누적(Redis) = {누적}")


if __name__ == "__main__":
    asyncio.run(main())
