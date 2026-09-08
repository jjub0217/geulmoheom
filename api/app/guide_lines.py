"""가이드 대사를 **`docs/문구.md` 에서 읽는다** (C-1 배선 · W4 4번).

**문구를 코드에 복사하지 않는다.** `문구.md` 가 SSOT 이고 코드가 따라온다 —
복사해 두면 문서와 갈라지고, **갈라진 쪽이 실제로 아이에게 말을 건다.**
루브릭·장면 카드·되묻기가 이미 같은 방식이다 (`app/rubric.py` · `app/scene_cards.py` ·
`app/scaffold.py`).

**되묻기는 여기 없다.** `MVP_PRD.md` 4.4 가 SSOT 이고 `app/scaffold.py` 가 그것을
읽는다 (`문구.md` 1.12 가 이 문서의 예외로 명시). 완성된 문장이 아니라 **조립 규칙**이고
금지어 목록이 그 절 안에 붙어 있어서, 떼면 **틀과 금지가 갈라진다.**

**자해 대사도 여기 없다.** `문구.md` 1.2 는 **대표 판정 문장**이고 차단 문구(1.11)와
겹치면 **자해 쪽이 이긴다** — 무작위로 고르는 이 자리에 섞이면 안 된다.
"""

import random
import re
from functools import lru_cache
from typing import Final

from app.config import REPO_ROOT
from app.docs_md import 민, 읽기
from app.schemas.stage0 import Tier

문구문서 = REPO_ROOT / "docs" / "문구.md"

# `> 1. **문장**` 꼴만 읽는다. 같은 절의 「지킬 것」은 `-` 로 시작해 여기 안 걸린다.
_대사줄 = re.compile(r"^>\s*\d+\.\s*(?P<문장>.+?)\s*$")

# 절 제목. **번호로 찾지 않는다** — `문구.md` 는 절 순서가 번호 순이 아니다(1.9 가 1.8
# 앞에 있다). 제목 앞부분으로 맞춘다.
# **1.5(삽화 대기)는 여기 없다.** 그 대사가 뜨는 6~8초는 폴링 중이라 오는 응답이
# `Artwork` 뿐이고 `guide` 가 없다 (`Stage0.md` 5절) — 서버가 내려줄 자리가 아예 없어
# 프론트가 `web/src/components/artwork-copy.ts` 에 옮겨 뒀다. **읽는 코드를 여기 두면
# 아무도 안 부르는 채로 남는다.**
결과 = "### 1.6"
종료 = "### 1.10"
차단 = "### 1.11"

# 1.6 안에서 티어를 가르는 소제목. 문서가 코드 식별자를 함께 적어 둬서 그것으로 맞춘다 —
# 「기본」이라는 낱말로 맞추면 「지킬 것」의 「기본에도 「부족하다」가 없다」에 걸린다.
_티어표시: Final[dict[str, Tier]] = {
    "`basic`": "basic",
    "`rare`": "rare",
    "`legendary`": "legendary",
}


def _절(제목: str) -> list[str]:
    """그 `###` 절의 줄들. 다음 `###` 에서 끊는다."""
    줄들: list[str] = []
    안에 = False
    for 줄 in 읽기(문구문서).splitlines():
        if 줄.startswith("### "):
            안에 = 줄.startswith(제목)
            continue
        if 안에:
            줄들.append(줄)
    return 줄들


def _대사들(줄들: list[str]) -> list[str]:
    return [민(맞음["문장"]) for 줄 in 줄들 if (맞음 := _대사줄.match(줄))]


@lru_cache
def 종료대사() -> list[str]:
    """일일 상한 소진 (`문구.md` 1.10). **다섯 다 「내일」이 들어간다** — 하드 피니시는
    가드레일이지 차단이 아니다."""
    return _확인(_대사들(_절(종료)), "1.10 종료 인사")


@lru_cache
def 차단대사() -> list[str]:
    """검사 차단 (`문구.md` 1.11). **주어가 전부 나침반이다** — 아이를 탓하지 않고
    무엇에 걸렸는지도 말하지 않는다."""
    return _확인(_대사들(_절(차단)), "1.11 차단 문구")


@lru_cache
def 결과대사() -> dict[Tier, list[str]]:
    """티어별 결과 대사 (`문구.md` 1.6). **기본에도 「부족하다」가 없다.**"""
    묶음: dict[Tier, list[str]] = {}
    지금: Tier | None = None
    for 줄 in _절(결과):
        for 표시, 티어 in _티어표시.items():
            if 표시 in 줄 and 줄.startswith("**"):
                지금 = 티어
                묶음.setdefault(티어, [])
                break
        else:
            if 지금 and (맞음 := _대사줄.match(줄)):
                묶음[지금].append(민(맞음["문장"]))

    if set(묶음) != set(_티어표시.values()) or not all(묶음.values()):
        raise RuntimeError("문구.md 1.6 에서 티어 셋을 다 읽지 못했다. 절 모양이 바뀌었는지 본다")
    return 묶음


def _확인(대사: list[str], 어디: str) -> list[str]:
    """**비어 있으면 죽는다.** 조용히 빈 목록을 돌려주면 아이 화면에 빈 말풍선이 뜨고,
    그 사고는 문서를 고친 사람에게 안 보인다."""
    if not 대사:
        raise RuntimeError(f"문구.md {어디} 에서 대사를 못 읽었다. 절 모양이 바뀌었는지 본다")
    return 대사


def 하나(대사: list[str], 씨앗: object | None = None) -> str:
    """하나를 고른다 (`문구.md` 1.6·1.10·1.11 「하나를 고른다」).

    **씨앗을 주면 같은 씨앗에 같은 문장이 나온다.** 결과 대사가 그렇다 — 시도 id 로
    고정해야 **아이가 새로고침했을 때 나침반이 다른 말을 하지 않는다.** 하이라이트를
    저장한 것과 같은 이유이고, 여기서는 **열을 늘리지 않고 되풀이할 수 있어** 그렇게 한다.

    **씨앗이 없으면 그때그때 다르다.** 소진·차단처럼 **다시 볼 일이 없는 자리**가 그것이고,
    거기서는 같은 문장이 반복되면 기계로 읽힌다.
    """
    if 씨앗 is None:
        return random.choice(대사)
    return random.Random(str(씨앗)).choice(대사)
