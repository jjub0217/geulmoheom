"""장면 카드를 **문서에서 읽는다** — `docs/장면카드_초안.md`.

되묻기 질문이 카드의 명사 태그를 치환해 만들어진다 (PRD 4.4). **태그를 코드에 복사하지
않는다** — 대표 검수로 6장이 바뀌었고(`cacda91`), 복사본은 그때마다 조용히 옛말을 한다.
07번은 이제 「사람들」이 아니라 「시계탑·분수·풍차」다.

카드가 DB(`cards` 테이블)로 들어가면 시드도 이 리더를 쓴다. 지금은 읽기만 한다.
"""

import re
from dataclasses import dataclass
from functools import lru_cache

from app.config import REPO_ROOT
from app.docs_md import 민, 읽기, 표행

카드문서 = REPO_ROOT / "docs" / "장면카드_초안.md"

# 카드 표만 읽는다. 「검수 결과」 표도 `| 01 |` 로 시작해 그냥 훑으면 섞인다.
_표제목 = ("## 카드 목록", "## 튜토리얼 전용 카드")
_번호 = re.compile(r"^(\d{2}|T[1-3])$")


@dataclass(frozen=True)
class 장면카드:
    card_id: str
    유형: str  # 위기 / 발견 / 만남 · 튜토리얼은 「목적」
    상황문: str
    명사태그: tuple[str, ...]

    @property
    def 대상(self) -> str | None:
        """되묻기의 `{대상}` — 장면에서 아이가 손을 뻗을 대상이다.

        20장 모두 **첫 태그**가 그 자리다 (그림자·지도·도깨비·시계탑·마을 사람들…).
        """
        return self.명사태그[0] if self.명사태그 else None


def _카드번호(칸: str) -> str:
    """문서의 `01`·`T1` 을 API 의 `card_id` 로. 목 응답이 쓰는 `c01` 과 같은 꼴이다."""
    return f"c{칸}" if 칸.isdigit() else 칸.lower()


@lru_cache
def 카드들() -> dict[str, 장면카드]:
    묶음: dict[str, 장면카드] = {}
    구간 = False
    for 줄 in 읽기(카드문서).splitlines():
        if 줄.startswith("## "):
            구간 = 줄.startswith(_표제목)
            continue
        if not 구간 or not 줄.startswith("|"):
            continue
        칸 = 표행(줄)
        # 5열 이상 = 카드 표. 「검수 결과」는 3열이라 여기서 걸린다.
        if len(칸) < 5 or not _번호.match(칸[0]):
            continue
        태그 = tuple(민(t) for t in 칸[3].split(",") if 민(t))
        번호 = _카드번호(칸[0])
        묶음[번호] = 장면카드(card_id=번호, 유형=민(칸[1]), 상황문=민(칸[2]), 명사태그=태그)
    if not 묶음:
        raise RuntimeError("장면 카드를 하나도 못 읽었다. 문서 표 모양이 바뀌었는지 본다")
    return 묶음


def 카드(card_id: str) -> 장면카드 | None:
    """모르는 카드면 `None`. **부르는 쪽이 없어도 돌아가게 만든다** — 카드 하나 때문에
    아이 입력이 막히면 안 된다."""
    return 카드들().get(card_id)
