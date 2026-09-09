"""목 서버가 돌려주는 고정 값.

한곳에 모아 둔다 — 실제 구현이 들어오면 **이 파일만 지우면 된다.**
**장면 카드 본문은 여기 없다** — `app/scene_cards.py` 가 문서에서 읽는다.
대사는 `docs/api/Stage0.md` 예시를 따랐다.
"""

from datetime import UTC, datetime, timedelta

# **`R2` 와 `PAGE` 를 걷어냈다** (2026-09-09). `R2` 는 `https://r2.example/...` 라는
# 없는 주소였고, `sketch_url` 이 그것을 실제 응답에 실어 **아이 화면에 빈 액자가
# 떴다** — 실기기 리허설에서 사람이 보고서야 걸렸다. 프론트가 「못 불러와도 안
# 무너지게」 옳게 처리해 둬서 **기계는 아무것도 안 켰다.**
# **죽은 픽스처를 남기면 계약보다 오래 산다** — `placeholder_url` 과 같은 자리다.

PARENT_ID = "8f1c2d3e-0000-4000-8000-000000000001"
CHILD_ID = "8f1c2d3e-0000-4000-8000-000000000002"
ATTEMPT_ID = "8f1c2d3e-0000-4000-8000-000000000003"
ARTWORK_ID = "8f1c2d3e-0000-4000-8000-000000000004"
BOOK_ID = "8f1c2d3e-0000-4000-8000-000000000005"

# **ASCII 만 쓴다.** 이 값은 이제 `Set-Cookie` 에 실리는데 그 헤더는 latin-1 로
# 인코딩된다 — 한글이 들어가면 응답을 만드는 순간 `UnicodeEncodeError` 로 500 이 나고,
# 화면에는 「서버에 못 닿음」으로만 보인다. 2026-09-07 에 실제로 밟았다.
# (실제 JWT 는 base64url 이라 늘 ASCII 다. 목만 조심하면 된다)
TOKEN = "mock-token-not-a-real-signature"
NICKNAME = "불꽃탐험가"
GUIDE_NAME = "나침이"


def now() -> datetime:
    return datetime.now(UTC)


def tomorrow_midnight() -> datetime:
    return (now() + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


CARD_ID = "c01"  # 목 전용 경로(강제 헤더·재시도 복구)가 쓰는 기본 카드

# 카드 **본문**(상황문·유형·명사 태그)은 여기 없다. `app/scene_cards.py` 가
# `docs/장면카드_초안.md` 에서 읽는다 — 복사본을 두면 대표 검수가 반영될 때마다 갈라진다.
# 여기 남는 것은 아직 목인 부분뿐이다.
PROMPT_LABEL = "탐험가는 어떻게 할까?"
# **`CARD_GUIDE` 를 걷어냈다** (2026-09-09). 그 문장이 `문구.md` 에 없는 채로
# 여기에만 살아 있었고, **문서를 고쳐도 화면이 안 따라왔다.** 이제 1.4b 를 읽는다
# (`app/guide_lines.py` `카드첫말`). **죽은 픽스처를 남기면 계약보다 오래 산다** —
# `R2`·`placeholder_url` 과 같은 자리다.
TODAY = {"cards_done": 2, "cap": 5}
