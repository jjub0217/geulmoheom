"""챕터 뼈대를 **문서에서 읽는다** — `docs/챕터뼈대_초안.md` (PRD A-4 · W7 1번).

**⛔ 뼈대를 코드에 복사하지 않는다.** `scene_cards.py` 와 같은 이유다 — 장면 카드
20장은 대표 검수로 6장이 바뀌었고(`cacda91`) **복사본은 그때마다 조용히 옛말을 한다.**
이 뼈대는 **아직 대표 미검수**라(`챕터뼈대_초안.md` 「열린 것」) **바뀔 것이 거의
확실하다.** 검수로 시련 조건 한 줄이 바뀌면 **코드가 따라와야 하고, 복사본은 안 따라온다.**

**⭐ 뼈대가 코드에 있어야 하는 이유는 하나뿐이다** — A-4 가 **「뼈대마다 네 경로 각각의
해결 조건을 사전 정의하고, GM 이 아이 입력이 어느 경로인지 판별해 그 경로로 전개한다」**
로 MUST 를 걸었다. **사전 정의가 없으면 4경로 동등이 프롬프트 즉흥이 된다.**

**⛔ 해결 조건을 매 턴 프롬프트에 넣지 않는다** — `approach`(6턴)부터다. 일찍 넣으면
**GM 이 시련을 미리 흘린다.** 그 판단은 `gm.py` 가 아니라 `시련조건을_보여주나()` 에 있다.
"""

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from app.config import REPO_ROOT
from app.docs_md import 민, 읽기, 표행

뼈대문서 = REPO_ROOT / "docs" / "챕터뼈대_초안.md"

Beat = Literal["intro", "explore", "rising_action", "approach", "trial", "resolution"]
TrialPath = Literal["force", "persuade", "observe", "care"]

_비트표 = "## 비트 시트"
_경로표 = "### 네 경로"

# `| 1 |` · `| 2~3 |` · `| **9** |` 를 다 받는다. 문서가 시련 줄만 볼드로 강조해 뒀다.
_턴칸 = re.compile(r"^(\d+)(?:~(\d+))?$")

# **해결 조건을 여기서 처음 넣는 비트.** 뼈대 「데이터로 옮길 때」가 그렇게 못 박았다.
시련조건_공개비트: Beat = "approach"

# **시련은 9턴 고정이고 12턴을 넘기지 않는다** (뼈대 비트 시트 아래 두 줄 · PRD A-4).
시련턴 = 9
최대턴 = 12


@dataclass(frozen=True)
class 비트:
    """비트 한 칸. `턴범위` 는 닫힌 구간이다 — `(2, 3)` 이면 2턴과 3턴 둘 다."""

    beat: Beat
    턴범위: tuple[int, int]
    해야할것: str
    하면안될것: str

    def 담나(self, 턴: int) -> bool:
        처음, 끝 = self.턴범위
        return 처음 <= 턴 <= 끝


@dataclass(frozen=True)
class 경로:
    """시련의 한 경로. **넷이 동등하다** (PRD A-4).

    **⛔ 「진짜 원인」을 하나로 두지 않는다.** 발이 톱니에 낀 것은 **관찰에게만 보이는
    것**이지 다른 셋이 틀린 게 아니다 — **힘은 태엽을 세워서, 설득은 새를 진정시켜서,
    돌봄은 떨림을 멈춰서 같은 곳에 닿는다.** 그래서 `통과서사` 가 넷 다 다르다.
    """

    code: TrialPath
    이름: str
    해결조건: str
    통과서사: str


@lru_cache(maxsize=1)
def 비트시트() -> tuple[비트, ...]:
    """비트 여섯. 문서 순서 그대로."""
    나온것: list[비트] = []
    for 줄 in _표줄들(_비트표):
        칸 = 표행(줄)
        if len(칸) < 4:
            continue
        맞음 = _턴칸.match(민(칸[0]))
        if not 맞음:
            continue
        처음 = int(맞음.group(1))
        끝 = int(맞음.group(2) or 처음)
        나온것.append(
            비트(
                beat=민(칸[1]),  # type: ignore[arg-type]
                턴범위=(처음, 끝),
                해야할것=민(칸[2]),
                하면안될것=민(칸[3]),
            )
        )
    if not 나온것:
        raise RuntimeError(f"비트 시트를 읽지 못했다: {뼈대문서.name}")
    return tuple(나온것)


@lru_cache(maxsize=1)
def 경로들() -> tuple[경로, ...]:
    """네 경로. **넷이 아니면 터진다** — 셋이 되면 4경로 동등이 조용히 깨진다."""
    코드 = {"force", "persuade", "observe", "care"}
    나온것: list[경로] = []
    for 줄 in _표줄들(_경로표):
        칸 = 표행(줄)
        if len(칸) < 4 or 민(칸[1]) not in 코드:
            continue
        나온것.append(
            경로(
                code=민(칸[1]),  # type: ignore[arg-type]
                이름=민(칸[0]),
                해결조건=민(칸[2]),
                통과서사=민(칸[3]),
            )
        )
    if {p.code for p in 나온것} != 코드:
        raise RuntimeError(f"네 경로를 다 읽지 못했다: {뼈대문서.name}")
    return tuple(나온것)


def 지금비트(턴: int, *, 시련넘었나: bool = True) -> 비트:
    """그 턴의 비트.

    **⛔ 턴만으로 안 정해진다.** 뼈대가 **「통과 못 하면 10·11턴으로 밀린다」**고
    적어 뒀으니, **9턴을 지나도 시련을 안 넘었으면 비트는 `trial` 에 머문다.**
    표만 보고 10턴을 `resolution` 으로 주면 **시련을 못 넘은 아이에게 완결 서사가
    나간다** — 부르는 쪽이 `시련넘었나` 를 줘야 하는 이유다.

    **기본값이 `True` 인 것은 한 턴만 돌려 보는 자리(1번 왕복)를 위한 편의**이고,
    **실제 진행은 3번(A-4)이 이 값을 쥔다.**

    **⏳ 12턴에도 못 넘으면 어떻게 되나는 아직 안 정했다** (뼈대 「열린 것」 ·
    PM 이 내 판단을 기다린다). **여기서 임의로 정하지 않는다** — 지금은 `trial` 에
    머물고, **그 결정이 3번(A-4)·5번(D-1)과 같이 내려와야 한다.**
    """
    if not 시련넘었나 and 턴 >= 시련턴:
        return 시트의("trial")
    for 것 in 비트시트():
        if 것.담나(턴):
            return 것
    return 시트의("trial" if 턴 >= 시련턴 else "intro")


def 다음비트(턴: int, *, 시련넘었나: bool = True) -> 비트 | None:
    """프롬프트의 `다음 비트` 칸 (PRD 4.1). 마지막이면 `None`."""
    지금 = 지금비트(턴, 시련넘었나=시련넘었나)
    순서 = 비트시트()
    for i, 것 in enumerate(순서):
        if 것.beat == 지금.beat:
            return 순서[i + 1] if i + 1 < len(순서) else None
    return None


def 시트의(beat: Beat) -> 비트:
    for 것 in 비트시트():
        if 것.beat == beat:
            return 것
    raise KeyError(beat)


def 시련조건을_보여주나(턴: int) -> bool:
    """**`approach` 부터다** (뼈대 「데이터로 옮길 때」).

    **⛔ 일찍 넣으면 GM 이 시련을 미리 흘린다.** 아이가 탑을 오르는 중에 「태엽새가
    발이 끼어 있다」를 알게 되면 **관찰 경로가 발견이 아니라 통보가 된다.**
    """
    공개 = 시트의(시련조건_공개비트)
    return 턴 >= 공개.턴범위[0]


def _표줄들(제목: str) -> list[str]:
    """`제목` 뒤에 처음 나오는 표의 본문 줄들. 구분선(`|---|`)과 머리줄은 뺀다."""
    글 = 읽기(뼈대문서)
    자리 = 글.find(제목)
    if 자리 < 0:
        raise RuntimeError(f"{제목} 절이 없다: {뼈대문서.name}")
    줄들 = []
    표시작 = False
    for 줄 in 글[자리:].splitlines()[1:]:
        벗김 = 줄.strip()
        if not 벗김.startswith("|"):
            if 표시작:
                break  # 표가 끝났다. **다음 표까지 훑지 않는다** — 섞이면 조용히 틀린다
            continue
        표시작 = True
        if set(벗김) <= set("|- :"):
            continue
        줄들.append(줄)
    return 줄들
