"""Stage 1 「TRPG」 계약 스키마 (`docs/api/Stage1.md`).

**⛔ 스키마 SSOT 는 `/openapi.json` 이다.** 프론트는 문서를 읽지 않고
`make contracts` 로 **`web/src/api/types.gen.ts`** 를 만들어 쓴다 — 그래서
**이 파일이 떠야 프론트가 착수할 수 있다** (W7 0번).

**⛔ 「보스」라는 낱말을 쓰지 않는다** (`용어사전.md` 8장 금지어). 비트 값은 `trial`
이고, 네 경로는 `force`·`persuade`·`observe`·`care` 다 — **코드·식별자에도 안 쓴다.**

**⛔ `state` 는 PRD 4.2 의 부분집합만 나간다.** `summary`·`recent_turns`·`grades` 를
빼는 이유가 둘이다 — ① **`recent_turns` 에 아이 원문이 들어 있고 그건 책 콘텐츠지
화면 상태가 아니다** (PRD 1.1b) ② **`grades` 를 내보내면 화면이 그것을 점수로
그리게 된다** (금지어).

**⚠ `trial_progress` 도 같은 이유로 조심할 값이다** — 계약이 **「진행도를 숫자로
화면에 그리지 않는다. 서사로 말한다」**고 못 박았다. 필드는 나가지만 **그 값을
그리는 것은 화면 쪽 금지**다.
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.stage0 import ArtworkRef, Guide, Highlight, Tier

# **비트 여섯이 한 챕터다** (`docs/챕터뼈대_초안.md` · PRD A-4 「도입 → 위기 → 시련 →
# 완결」). `explore`·`rising_action`·`approach` 가 「위기」를 셋으로 편 것이다.
Beat = Literal["intro", "explore", "rising_action", "approach", "trial", "resolution"]

# **넷이 동등하다** (PRD A-4). **경로에 따른 차별이 없다** — 등급·삽화 티어·완결 여부
# 전부. **페르소나 2원형(A 이민준 / B 김서윤)이 걸린 자리다**: 한 경로가 더 좋은
# 그림을 받으면 그 원형이 불리해진다.
TrialPath = Literal["force", "persuade", "observe", "care"]


class Choice(BaseModel):
    """선택지 하나. **막힌 아이의 길이지 쓰기를 건너뛰는 길이 아니다** (비전 1장).

    **⛔ 네 경로를 그대로 나열하지 않는다** — 「① 싸운다 ② 말을 건다 ③ 살펴본다
    ④ 달랜다」가 되면 **쓰기가 고르기로 바뀐다.** 경로가 섞이게 낸다 (PRD 4.1).
    """

    id: str
    label: str


class HeroState(BaseModel):
    """PRD 4.2 의 `hero` 부분. **요약이지 원문이 아니다.**"""

    hp: int
    items: list[str] = Field(default_factory=list)


class ChapterState(BaseModel):
    """화면에 나가는 상태. **`summary`·`recent_turns`·`grades` 는 여기 없다** — 위 주석."""

    hero: HeroState
    location: str


class ChapterView(BaseModel):
    """`POST /chapters` · `GET /chapters/current` 의 응답 (`Stage1.md` 1절).

    **진행 중인 챕터가 있으면 새로 안 연다** — 그것을 돌려준다.
    **⭐ 아이가 새로고침해도 이야기를 잃지 않는다.**
    """

    chapter_id: str
    chapter_key: str
    turn: int
    beat: Beat
    narrative: str
    choices: list[Choice]
    state: ChapterState
    turns_left: int
    # **⛔ 없을 수 있다** (2026-09-16 명세 변경 · PM 승인). **핵심 씬이 1턴·9턴 둘뿐**이라
    # 나머지 턴에는 새 그림이 없고, **필수로 두면 서버가 없는 것을 지어내야 한다.**
    # **화면은 액자를 비우지 않고 직전 핵심 씬 그림을 그대로 둔다** — 아이 눈에
    # **그림이 사라지는 것**이 되면 안 된다 (프론트 8번).
    artwork: ArtworkRef | None = None


class TurnRequest(BaseModel):
    """**⛔ `choice_id` 와 `text` 중 정확히 하나다.** 둘 다 오거나 둘 다 없으면 422.

    **⭐ 엔드포인트를 안 가른다** — 가르면 화면이 두 갈래를 따로 그리게 되고,
    A-3 이 **「선택지와 자유 묘사를 한 입력창에」**로 쓰여 있다.

    **⚠ `choice_id` 로 온 턴도 등급이 매겨진다** — 선택지 라벨을 그 아이의 입력으로
    평가한다. **그래야 「고르기만 해도 된다」가 안 된다.** 다만 **G0 스캐폴딩은 안
    띄운다** — 고른 것을 되물으면 뜻이 없다.
    """

    chapter_id: str
    choice_id: str | None = None
    text: str | None = Field(default=None, min_length=1, max_length=500)


class TurnResult(BaseModel):
    """`POST /turns` 의 응답 (`Stage1.md` 2절).

    **`scaffold` 가 오면 `narrative` 는 `null` 이고 턴이 안 는다** — 되묻기가 상한을
    깎으면 **막힌 아이가 더 빨리 잠긴다** (4절).
    """

    turn: int
    beat: Beat
    grade: Literal["G0", "G1", "G2", "G3"]
    # **등급이 서사에 반영되는 것이고 숫자가 뜨는 게 아니다** — 「점수」는 금지어다.
    bonus: int
    scaffold: str | None = None
    narrative: str | None = None
    choices: list[Choice] = Field(default_factory=list)
    state: ChapterState
    turns_left: int
    # **핵심 씬(1턴·9턴)에서만 실린다.** 나머지 턴에는 새 그림이 없다
    artwork: ArtworkRef | None = None
    chapter_done: bool = False
    highlights: list[Highlight] = Field(default_factory=list)
    guide: Guide | None = None
    # **시련 비트에서만 실린다.** `trial_progress` 를 화면이 숫자로 그리지 않는다 —
    # 서사로 말한다 (`Stage1.md` 3절).
    trial_path: TrialPath | None = None
    trial_progress: int | None = None


class ChapterSummary(BaseModel):
    """`GET /chapters/{id}/summary` — 완결 화면 (D-1 하드 피니시).

    **⛔ 「이어서 더 하기」를 응답에 넣지 않는다. 없는 것이 결정이다** (페르소나 7.1).
    """

    chapter_id: str
    chapter_key: str
    title: str
    turns_used: int
    trial_path: TrialPath | None = None
    tier: Tier | None = None
    book_page_no: int | None = None
