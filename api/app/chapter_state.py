"""세션 상태 체인 둘 (A-2 · W7 2번 · `docs/api/Stage1.md` 2절 8·9번).

**⛔ 둘을 한 프롬프트에 몰지 않는다** (PRD A-2 · 아키텍처 문서). **성격이 다르다.**

| | 언제 | 왜 그 주기인가 |
|---|---|---|
| **상태 추출기** | **매 턴** | **체력·아이템·위치는 변화를 놓치면 상태가 틀어진다** |
| **요약기** | **3턴마다** | **돈이다** (2026-09-16 사용자 판정). 15턴 기준 **15회 → 5회** |

**⛔ 요약은 「그 시점까지 전부」를 덮는다.** `1..N-3` 만 덮으면 갱신이 밀린 사이
**요약에도 없고 원문 3턴에도 없는 턴**이 생기고, **그 턴에 아이가 한 일이 GM
컨텍스트에서 통째로 사라진다.** **겹치는 것은 토큰이 조금 늘 뿐이고, 구멍은 해가
있다** (계약 2절 9번 표).

**⛔ 아이 원문을 상태에 넣지 않는다.** 원문이 가도 되는 칸은 셋이고
(`card_attempts.text`·`book_pages.text`·`chapter_turns.text`) **`chapters.state` 는
그중에 없다.** 최근 3턴 원문은 **`chapter_turns` 에서 읽어 프롬프트로 조립**한다 —
**저장이 아니라 조립이다.**

**⛔ 실패가 아이 턴을 죽이지 않는다.** 서사는 이미 나왔고 **상태·요약은 그 다음**이다 —
못 뽑으면 **직전 값을 그대로 들고 간다.** 예외를 밖으로 내지 않는 이유가 그것이고,
`app/cost.py`·`app/scaffold.py` 가 이미 같은 태도다.

**⚠ 요약 재료에 GM 서사가 없다.** `chapter_turns` 는 **아이가 쓴 것과 등급·비트**를
들고 있고 GM 서사는 마지막 것만 `chapters.narrative` 에 있다 — **아이가 한 일의
요약**이라는 뜻이다. 서사까지 요약에 넣으려면 **턴마다 서사를 저장해야** 해서 2번
범위 밖이고, **PM 에게 알린다.**
"""

import json
import logging
from typing import Any, Final

from google.genai import types
from pydantic import BaseModel, Field

from app.config import get_settings
from app.llm import get_client
from app.middleware import current_request_id

logger = logging.getLogger(__name__)

# **3턴마다** (사용자 판정). PRD 는 **「최근 3턴은 원문」**만 조건으로 두고
# **그 밖을 언제 압축하는지는 안 정했다** — 그 빈칸을 돈으로 채운 값이다.
요약주기: Final = 3
# **원문 창.** PRD A-2 「최근 3턴은 원문」.
원문창: Final = 3

# 요약기·추출기 둘 다 **짧은 판정**이라 GM(12초)보다 빠듯하게 끊는다. 넘으면 직전
# 값을 지키고 턴은 지나간다 — **아이를 기다리게 하는 쪽이 더 나쁘다.**
TIMEOUT_SECONDS: Final = 6.0

# 3~4문장 (PRD A-2). 넘겨도 자르지 않는다 — 자르면 문장이 중간에서 끊긴다
요약_최대문장 = 4


class 요약(BaseModel):
    summary: str = Field(description="3~4문장. 아이가 한 일을 시간 순으로")


class 상태변화(BaseModel):
    """**전체 상태를 다시 받지 않는다 — 변화만 받는다** (PRD A-2 「변화를 추출」).

    전체를 받으면 **모델이 안 바뀐 칸까지 새로 쓰고**, 그때 **아이템이 조용히 사라진다.**
    """

    hp_delta: int = Field(default=0, description="체력 변화. 안 바뀌면 0")
    items_added: list[str] = Field(default_factory=list)
    items_removed: list[str] = Field(default_factory=list)
    location: str = Field(default="", description="바뀌었을 때만. 안 바뀌면 빈 문자열")


def 요약할때인가(턴: int) -> bool:
    """**3의 배수 턴에서만 갱신한다.** 0턴(도입)은 아니다 — 요약할 것이 없다."""
    return 턴 > 0 and 턴 % 요약주기 == 0


def 요약재료(턴들: list[Any]) -> list[dict[str, Any]]:
    """`chapter_turns` 행들 → 요약기에 넘길 재료. **그 시점까지 전부다.**

    **⛔ 여기서 자르지 않는다.** 자르면 위 표의 「구멍」이 생긴다.

    **⛔ `gm` 이 2026-09-17 에 붙었다 — 그 전에는 아이 글만 넘어갔다.**
    그래서 요약이 **「아이가 한 일의 요약」**이었고, **GM 이 자기가 한 말을 되먹지
    못했다.** 09-17 한 판에서 **4턴이 밝힌 원인(수정 구슬 지팡이)이 그 뒤 한 번도 안
    나온 채 완결**했다 — **잊은 게 아니라 기억할 방법이 없었다.**

    **⛔ 여기서 접지 않고 요약기가 접게 둔다.** 자르거나 줄이면 **무엇이 중요한지를
    우리가 고르는 것**이 되고, 그건 요약기가 할 일이다. **대신 그 값이 프롬프트를
    키운다** — 턴이 갈수록 무거워지므로 **뒤쪽 턴의 지연을 봐야 한다**(`해커톤_제출전`
    ③ 과 부딪히는 자리).

    **`gm` 이 없는 턴은 키를 안 싣는다.** 칸이 09-17 에 생겨 **그 전 턴은 `None`** 이고,
    빈 문자열로 채우면 **「GM 이 아무 말도 안 한 턴」과 구분이 안 된다.**
    """
    재료: list[dict[str, Any]] = []
    for 것 in 턴들:
        한턴: dict[str, Any] = {
            "turn": 것.turn_no,
            "beat": 것.beat,
            "grade": 것.grade,
            "input": 것.text,
        }
        if 서사 := getattr(것, "gm_narrative", None):
            한턴["gm"] = 서사
        재료.append(한턴)
    return 재료


def 최근원문(턴들: list[Any]) -> list[dict[str, str]]:
    """프롬프트의 `[최근]` 칸 (PRD A-2 「최근 3턴은 원문」).

    **⛔ 저장이 아니라 조립이다** — 원문은 `chapter_turns` 에 있고 `state` 로 복사하지
    않는다. 고른 턴도 들어간다: **GM 이 앞 턴에 무슨 일이 있었는지 알아야** 한다.
    """
    return [{"input": 것.text, "grade": 것.grade} for 것 in 턴들[-원문창:]]


async def 요약하기(재료: list[dict[str, Any]]) -> str:
    """지금까지의 이야기를 3~4문장으로 (PRD A-2).

    **⛔ 아이 원문이 프롬프트로는 가고 로그로는 안 간다.** 예외 메시지에도 안 싣는다 —
    **프로바이더가 프롬프트를 되울려 주는 일이 있다** (`app/gm.py` 와 같은 자리).
    """
    if not 재료:
        return ""
    지시 = (
        "너는 이 모험의 기록자다. 아래 턴 기록을 시간 순으로 3~4문장으로 줄여라."
        " 아이가 한 일과 그 결과만 남기고 평가·칭찬·조언을 쓰지 마라."
        " 아이가 쓴 문장을 그대로 옮기지 말고 무슨 일이 있었는지만 적어라."
        # **⛔ 2026-09-17 에 붙었다.** `gm` 이 재료에 들어오면서 **줄일 것이 두 배**가
        # 됐는데, 지시가 여전히 **「아이가 한 일」**만 말하고 있었다. 그러면 **모델이
        # GM 이 밝힌 것을 버린다** — 칸을 만든 이유가 통째로 사라진다.
        " 각 턴의 gm 은 이야기꾼이 한 말이다. 거기서 **드러난 사실**(사건의 원인,"
        " 등장한 인물·사물의 이름, 바뀐 장소)을 반드시 남겨라 — 뒤 턴이 그것을 이어야 한다."
    )
    나온것 = await _한덩이(요약, 지시, json.dumps(재료, ensure_ascii=False))
    return 나온것.summary if 나온것 else ""


async def 상태추출(서사: str, 지금: dict[str, Any]) -> dict[str, Any]:
    """GM 서사에서 체력·아이템·위치 **변화**를 뽑아 상태에 얹는다 (PRD A-2).

    **⛔ GM 호출과 분리된 호출이다.** 한 프롬프트에 몰면 **둘 다 나빠진다** —
    서사를 쓰면서 구조를 맞추려 하다가 **서사가 딱딱해지고 구조가 헐거워진다.**

    **못 뽑으면 `지금` 을 그대로 돌려준다.** 상태가 안 바뀌는 것이 **틀린 상태로
    바뀌는 것보다 낫다.**
    """
    지시 = (
        "너는 게임 상태 추적기다. 아래 서사를 읽고 주인공의 체력·아이템·위치 변화만"
        " 뽑아라. 서사에 안 나온 것은 바꾸지 마라 — 변화가 없으면 0 과 빈 값이다."
    )
    프롬프트 = json.dumps(
        {"narrative": 서사, "state": {k: 지금.get(k) for k in ("hero", "location")}},
        ensure_ascii=False,
    )
    변화 = await _한덩이(상태변화, 지시, 프롬프트)
    if 변화 is None:
        return 지금
    return _얹기(지금, 변화)


def _얹기(지금: dict[str, Any], 변화: 상태변화) -> dict[str, Any]:
    """**보수적으로 얹는다.** 체력은 0 아래로 안 내리고, 없는 아이템을 빼려 하면 넘긴다."""
    영웅 = dict(지금.get("hero") or {})
    최대 = int(영웅.get("max_hp") or 0)
    체력 = int(영웅.get("hp") or 0) + 변화.hp_delta
    영웅["hp"] = max(0, min(체력, 최대) if 최대 else max(0, 체력))

    가진것 = [것 for 것 in (영웅.get("items") or []) if 것 not in 변화.items_removed]
    영웅["items"] = [*가진것, *(것 for 것 in 변화.items_added if 것 not in 가진것)]

    새것 = {**지금, "hero": 영웅}
    if 변화.location:
        새것["location"] = 변화.location
    return 새것


async def _한덩이(스키마: type[BaseModel], 지시: str, 프롬프트: str) -> Any:
    """구조화 출력 한 번. **실패하면 `None`** — 예외를 밖으로 내지 않는다.

    **⛔ `thinking` 을 끈다** — Evaluator·안전·PII·GM 이 이미 끄고 있다. 켜 두면
    **생각 토큰이 지연과 단가에 그대로 붙는다.**
    """
    모델 = get_settings().evaluator_model.strip()
    if not 모델:
        return None  # dev 목은 모델명 없이 돈다 (`config.PILOT_REQUIRED`)

    import asyncio

    try:
        응답 = await asyncio.wait_for(
            get_client().aio.models.generate_content(
                model=모델,
                contents=프롬프트,
                config=types.GenerateContentConfig(
                    system_instruction=지시,
                    response_mime_type="application/json",
                    response_schema=스키마,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            ),
            timeout=TIMEOUT_SECONDS,
        )
        return 스키마.model_validate_json(응답.text or "")
    except Exception as exc:
        # **예외 메시지를 싣지 않는다** — 프롬프트에 아이 원문이 들어 있고
        # 프로바이더가 그것을 되울려 주는 일이 있다 (PRD 1.1b)
        logger.warning(
            "상태 체인 호출이 실패했다",
            extra={
                "request_id": current_request_id(),
                "exc_type": type(exc).__name__,
                "chain": 스키마.__name__,
            },
        )
        return None
