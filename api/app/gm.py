"""GM 스토리 엔진 (A-1 · W7 1번). **프롬프트 구조는 `MVP_PRD.md` 4.1 이 SSOT 다.**

**⛔ 새로 설계하지 않는다.** 4.1 이 아홉 칸(`[역할]`~`[출력 형식]`)을 이미 적어 뒀고,
**뼈대는 `app/chapter_skeleton.py` 가 문서에서 읽고**, **고정 문구는 `문구.md` 에서
온다.** 여기서 지어내는 문자열이 있으면 그 자리가 곧 드리프트다.

**⛔ 출력이 아이에게 가는 글이다 — 그래서 출력 검사를 지난다** (E-1 양방향).
`artwork.내보내도되나()` 와 **같은 `검사하기()` 를 쓴다** — 입력과 출력에 다른 기준을
두지 않는다. **새 안전 경로를 만들지 않는 것이 요점**이다: 만들면 둘이 갈리고,
**갈린 쪽으로 아이에게 글이 나간다.**

**⛔ 차단되면 한 번만 다시 부르고, 또 차단이면 `502 GM_UNSAFE`** (`Stage1.md` 2절 7).
**폴백 서사를 만들지 않는다** — 막힌 자리에 우리가 글을 지어 넣으면 **그 글에는
검사가 없다.**

**⚠ 아이 원문은 프롬프트로만 간다. 로그에 안 남는다** (PRD 1.1b).
예외 메시지에도 안 싣는다 — **프로바이더가 프롬프트를 되울려 주는 일이 있다.**
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Final

from google.genai import types
from pydantic import BaseModel, Field

from app import chapter_skeleton as 뼈대
from app.config import get_settings
from app.guide_lines import 복귀문구, 직접쓰기유도
from app.llm import get_client
from app.middleware import current_request_id
from app.moderation import 검사하기, 내장차단
from app.scaffold import 금지어

logger = logging.getLogger(__name__)

# **Evaluator 는 3초인데 여기는 길다.** 150~300자를 만드는 호출이고, W1 이미지 벤치가
# 아니라 **아이가 화면 앞에서 기다리는 시간**이 상한이다. PRD 9장이 후보 모델을
# 「지연 11초 · 경고등」으로 뒀으니 **그보다 짧게 끊어 두고, 넘으면 모델 판정을 다시 본다.**
TIMEOUT_SECONDS: Final = 12.0
RETRIES: Final = 1

# 출력 검사가 두 번 막았을 때. **폴백 서사가 아니라 오류다** (`Stage1.md` 6절).
UNSAFE: Final = "gm_unsafe"

# **150~300자** (PRD 4.1 `[지시]`). 프롬프트에만 쓰고 응답을 잘라내지 않는다 —
# 자르면 문장이 중간에서 끊겨 **아이가 읽다 만 글을 본다.**
서사_최소, 서사_최대 = 150, 300


class 선택지(BaseModel):
    """**⛔ 네 경로를 그대로 나열하지 않는다** — 뼈대 「하면 안 되는 것」 ②."""

    id: str
    label: str


class GM출력(BaseModel):
    """PRD 4.1 `[출력 형식]` 그대로."""

    narrative: str
    choices: list[선택지] = Field(default_factory=list)
    is_key_scene: bool = False
    scene_prompt_hint: str = ""


@dataclass
class 서사결과:
    """**예외를 밖으로 내지 않는다.** 실패는 `사유` 로 온다 — `unsafe`·`timeout`·`error`."""

    출력: GM출력 | None
    사유: str | None = None
    latency_ms: float = 0.0
    재호출: bool = False
    금지어걸림: tuple[str, ...] = field(default_factory=tuple)

    @property
    def 막혔나(self) -> bool:
        return self.사유 == UNSAFE


def _설정된모델() -> str:
    """**GM 모델은 Evaluator 와 같은 것으로 먼저 잰다** (2026-09-16 사용자 판정).

    **새 승인이 필요 없고 돈이 덜 든다.** 안 되면 올리는 것이 **대표 판정 자리**다 —
    PRD 9장 #1 이 `gemini-3.7-flash` 를 「지연 11초 · 경고등」으로 뒀다.
    **여기서 모델을 갈아끼우지 않는다.**
    """
    return get_settings().evaluator_model.strip()


def 시스템지시() -> str:
    """매 턴 안 바뀌는 칸들 (PRD 4.1 `[역할]`·`[말투]`·`[역할 경계]`·`[안전]`·`[출력 형식]`).

    **`[역할 경계]` 의 복귀 문구가 `문구.md` 1.23 으로 내려왔다** (2026-09-16).
    **종전에는 규칙만 있었다** — 그러면 **GM 이 매 턴 다른 말로 돌리고, 그 말은 대개
    거절로 읽힌다.** 문서가 고른 셋은 **주어가 나침반**이라 아이와 가이드 사이가 안 상한다.

    **셋을 다 주고 고르는 것은 GM 이 한다.** 이 문장만 그렇다 — **서사 안에 섞여
    나가야** 해서다. 다른 대사는 서버가 하나 골라 내려준다.
    """
    금지 = " · ".join(금지어())
    복귀 = " / ".join(f"「{줄}」" for 줄 in 복귀문구())
    return "\n".join(
        [
            "[역할] 너는 나침반, 래서판다 탐험가-학자이자 이 모험의 게임 마스터다."
            " 플레이어는 만 10~12세 「탐험가」다.",
            f"[말투] 반말. 짧은 문장. 호기심·격려. 다음 말을 쓰지 않는다: {금지}",
            "[역할 경계] 모험 진행·되묻기·격려·종료 인사만 한다."
            " 그 밖의 요청이 오면 나무라지 않고 다음 셋 중 하나를 그대로 써서 모험으로"
            f" 돌아오게 한다: {복귀}"
            " 이 문장을 새로 짓거나 고치지 않고, 왜 안 되는지 설명하지 않는다."
            " 플레이어의 이름·나이·학교·사는 곳을 묻지 않는다.",
            "[안전] 유혈·고문·신체 훼손·선정적 묘사·자해를 쓰지 않는다."
            " 전투는 「물리친다」·「쓰러뜨린다」 수준에서 멈춘다.",
            "[출력 형식] JSON: {narrative, choices[], is_key_scene, scene_prompt_hint}",
        ]
    )


def 턴프롬프트(
    *,
    턴: int,
    상태: dict[str, object],
    아이입력: str,
    등급: str,
    보너스: int,
    요약: str = "",
    최근: list[dict[str, str]] | None = None,
    시련넘었나: bool = True,
) -> str:
    """턴마다 바뀌는 칸들 (PRD 4.1 `[챕터 뼈대]`~`[지시]`).

    **⛔ 시련 4경로 해결 조건은 `approach`(6턴)부터만 넣는다** — 뼈대 「데이터로 옮길
    때」. **일찍 넣으면 GM 이 시련을 미리 흘리고**, 그러면 **관찰 경로가 발견이 아니라
    통보가 된다.** 판단은 `뼈대.시련조건을_보여주나()` 하나에 있다.

    **⚠ `아이입력` 은 가린 것이어야 한다.** 부르는 쪽이 PII 마스킹을 지나 준다
    (`Stage1.md` 2절 2). **여기서 다시 가리지 않는다** — 두 군데서 가리면 한쪽만
    바뀌는 날이 온다 (`artwork_store.굽기()` 와 같은 자리).
    """
    지금 = 뼈대.지금비트(턴, 시련넘었나=시련넘었나)
    다음 = 뼈대.다음비트(턴, 시련넘었나=시련넘었나)

    뼈대칸 = [
        "[챕터 뼈대]",
        f"  현재 비트: {지금.beat}",
        f"  다음 비트: {다음.beat if 다음 else '(없음 — 이 비트가 마지막이다)'}",
        f"  이 비트에서 할 것: {지금.해야할것}",
        f"  이 비트에서 하면 안 되는 것: {지금.하면안될것}",
        f"  시련 비트 턴: {뼈대.시련턴}",
    ]
    if 뼈대.시련조건을_보여주나(턴):
        뼈대칸.append("  시련 4경로 해결 조건 — 넷이 전부 진짜로 통한다:")
        for 길 in 뼈대.경로들():
            뼈대칸.append(f"    {길.code}({길.이름}) 판별: {길.해결조건} → 통과: {길.통과서사}")
        뼈대칸.append(
            "    ⛔ 네 경로를 선택지로 나열하지 않는다."
            " 어느 경로가 맞는지 알려주지 않는다."
            " 넷 어디에도 안 맞는 입력은 등급대로 판정하고 서사로 흡수한다."
        )

    최근줄 = "\n".join(
        f"  - 입력: {것.get('input', '')} / 등급: {것.get('grade', '')}" for 것 in (최근 or [])
    )
    return "\n".join(
        [
            *뼈대칸,
            f"[상태] {json.dumps(상태, ensure_ascii=False)}",
            f"[요약] {요약 or '(아직 없다 — 첫 턴이다)'}",
            f"[최근]\n{최근줄}" if 최근줄 else "[최근] (없다)",
            f"[이번 턴 입력] {아이입력}",
            f"[등급] {등급} / [보너스] {보너스:+d}",
            "[지시] 입력의 명사·형용사를 되받아 서사에 반영하라."
            f" {서사_최소}~{서사_최대}자."
            " 끝에 선택지 2~3개를 낸다 —"
            " 힘·설득·관찰·돌봄이 **섞이도록** 구성하고 경로 이름을 쓰지 않는다."
            " 비전투 해결을 전투 해결과 **동등하게 성공으로** 서술하라."
            f" 선택지 뒤에 붙는 고정 문장은 우리가 넣는다: 「{직접쓰기유도()}」"
            " — 그 문장을 네가 다시 쓰지 마라.",
        ]
    )


async def _한번(모델: str, 지시: str, 프롬프트: str) -> GM출력:
    응답 = await get_client().aio.models.generate_content(
        model=모델,
        contents=프롬프트,
        config=types.GenerateContentConfig(
            system_instruction=지시,
            response_mime_type="application/json",
            response_schema=GM출력,
            # **끈다** — Evaluator·안전·PII 가 이미 끄고 있고 **GM 만 빠져 있었다**
            # (2026-09-16). 켜 두면 **생각 토큰이 지연과 단가에 그대로 붙는데**,
            # PRD 9장이 이 모델 축의 경고등으로 둔 것이 **바로 지연**이다.
            # 합격선은 **완료 8초**(PRD 7장)이고 위의 12초는 우리 타임아웃이지 기준이 아니다.
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    if 사유 := 내장차단(응답):
        raise 내장차단됨(사유)
    return GM출력.model_validate_json(응답.text or "")


class 내장차단됨(Exception):
    """프로바이더 내장 필터가 막았다. **재시도하지 않는다** — 같은 프롬프트다."""


async def 서사(
    지시: str,
    프롬프트: str,
    *,
    허용재시도: int = RETRIES,
) -> 서사결과:
    """GM 한 덩이. **예외를 밖으로 내지 않는다.**

    **순서가 정해져 있다 — 생성 → 출력 검사.** 검사가 막으면 **한 번만 다시 부르고**,
    또 막히면 `unsafe` 다 (`Stage1.md` 2절 7). **폴백 서사를 만들지 않는다.**

    **⛔ 금지어는 검사가 아니라 로그로만 센다.** 「부족해」가 섞였다고 아이에게
    오류를 보이면 **그 턴이 통째로 사라진다** — 서사는 나가고 **우리가 그 빈도를 본다.**
    프롬프트가 이미 금지하고 있고, 자주 나면 그때 프롬프트를 고칠 자리다.
    """
    시작 = time.perf_counter()

    def _끝(출력: GM출력 | None, 사유: str | None = None, *, 재호출: bool = False) -> 서사결과:
        return 서사결과(
            출력=출력,
            사유=사유,
            latency_ms=(time.perf_counter() - 시작) * 1000,
            재호출=재호출,
            금지어걸림=_금지어걸림(출력),
        )

    모델 = _설정된모델()
    if not 모델:
        # dev 목은 모델명 없이 돈다. pilot 은 기동 자체가 막힌다 (`config.PILOT_REQUIRED`).
        return _끝(None, "unconfigured")

    사유 = "error"
    for 회차 in range(허용재시도 + 1):
        try:
            출력 = await asyncio.wait_for(_한번(모델, 지시, 프롬프트), timeout=TIMEOUT_SECONDS)
        except 내장차단됨:
            return _끝(None, UNSAFE, 재호출=회차 > 0)
        except TimeoutError:
            사유 = "timeout"
            continue
        except Exception as exc:
            # **예외 메시지를 싣지 않는다** — 프로바이더가 프롬프트를 되울려 주는 일이
            # 있고, 이 프롬프트에는 아이 원문이 들어 있다 (PRD 1.1b).
            사유 = "error"
            logger.warning(
                "GM 호출이 실패했다",
                extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
            )
            continue

        # **출력 검사** (E-1 양방향). `artwork.내보내도되나()` 와 같은 `검사하기()` 다.
        if (await 검사하기(출력.narrative)).blocked:
            logger.warning(
                "GM 서사가 출력 검사에서 막혔다",
                extra={
                    "request_id": current_request_id(),
                    "direction": "output",
                    "turn_retry": 회차,
                },
            )
            if 회차 < 허용재시도:
                continue
            return _끝(None, UNSAFE, 재호출=True)

        return _끝(출력, None, 재호출=회차 > 0)

    return _끝(None, 사유)


def _금지어걸림(출력: GM출력 | None) -> tuple[str, ...]:
    """서사에 섞인 금지어. **막지 않고 센다** — 위 `서사()` 주석."""
    if 출력 is None:
        return ()
    return tuple(말 for 말 in 금지어() if 말 in 출력.narrative)
