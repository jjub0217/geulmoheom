"""서버측 PII 2차 감지·마스킹 (E-2).

**프론트를 믿지 않는다.** `web/src/lib/pii.ts` 가 같은 일을 입력창에서 하지만
그건 아이에게 주는 **즉시 피드백**이고, 클라이언트는 우회된다 (`공통규약.md` 69행).

**두 곳에 같은 규칙을 짰다는 것을 알고 있다.** 갈리는 것 자체는 사고가 아니다 —
서버가 더 넓게 잡는 것은 설계대로다. **서버가 더 좁게 잡는 쪽이 사고다.**

**실명은 여기 없다 — NER 몫이다** (PRD E-2). 정규식으로 한글 실명을 잡으려 들면
아이가 지은 가이드 이름·괴물 이름이 먼저 걸린다. 「검을 휘두른다」가 막히는 것과
같은 급이다. **학교명은 반대다 — 전체 꼴(`○○초등학교`)이라 정규식이 결정적으로
잡고, NER 은 같은 문장을 두 번 중 한 번 놓쳤다** (`benchmarks/W3-ner-cost.md`).

**⛔ 그래서 층이 둘이고, 껐다 켰다 하는 것은 아래층 하나뿐이다.**

- **정규식 넷 — 전화 · 이메일 · 주소 · 학교명.** `가리기()`. **항상 돈다.**
- **NER — 실명 하나.** `실명까지가리기()` 의 뒷부분. **켜져 있다** (`pii_ner_enabled`
  기본 `True` · 2026-09-16 대표 판정). 2026-09-09~09-16 사이에는 꺼져 있었다.

**이 구분이 틀리면 아이 전화번호가 책에 인쇄된다.** 「PII 마스킹을 껐다」로 읽지 말 것.

**이 모듈은 받은 문자열을 어디로도 내보내지 않는다** — 부른 쪽에 돌려줄 뿐이다
(PRD 1.1b). 감지된 값도 로그에 싣지 않는다. 나가는 것은 **종류뿐**이다.
"""

import asyncio
import logging
import re
import unicodedata
from collections.abc import Sequence
from typing import Literal, NamedTuple

from pydantic import BaseModel, Field

from app.middleware import current_request_id

logger = logging.getLogger(__name__)

# `pii_masked` 이벤트의 `kind` 로 그대로 나간다 (`Stage0.md` 7절).
# `name` 은 서버 2차(NER) 전용이다 — 프론트 정규식은 실명을 안 잡는다.
PiiKind = Literal["phone", "email", "address", "school", "name"]

# 가린 자리에 남는 글자. **확정본은 `docs/문구.md` 1.1.**
# **길이와 무관하게 고정 3자다** — 가린 길이가 새면 몇 자리였는지가 드러난다.
# 프론트(`PII_MASK`)와 **같은 글자여야 한다.** 다르면 한 문장 안에 두 모양이 섞인다.
PII_MASK = "○○○"

# 순서가 곧 `찾기` 가 돌려주는 순서다.
_RULES: list[tuple[PiiKind, re.Pattern[str]]] = [
    (
        # 휴대폰(구분자 없어도) · 유선(구분자가 있을 때만).
        # **3-4-4 자릿수 구조로 묶는다** — 「3-4번 문」·「100-200마리」를 안 잡으려면
        # 자릿수가 조건이어야 한다. 앞뒤 숫자 경계는 고정폭 lookaround 로 본다.
        "phone",
        re.compile(
            r"(?<!\d)(?:01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4})(?!\d)"
        ),
    ),
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
    (
        # **번지·호수까지 붙었을 때만.** 「은하시 별빛동」은 실제 주소와 정규식으로
        # 가를 수 없다 — 숫자가 없으면 통과시킨다.
        # 단독 「동」·「구」·「로」를 조건으로 쓰지 않는다. 「동굴」·「구름」·「길」이 걸린다.
        "address",
        re.compile(
            r"\d+\s*동\s*\d+\s*호|\d+\s*번지|[가-힣]{2,}(?:시|군|구)\s*[가-힣]{2,}(?:동|읍|면|리|로|길)\s*\d"
        ),
    ),
    (
        # **학교명 전체 꼴일 때만.** 「우리 학교는 ○○」 을 넣으면 「우리 학교는
        # 마법학교야」가 걸리고, 줄임꼴(`○○초`)을 넣으면 「마법약초」·「기초」가 걸린다.
        "school",
        re.compile(r"[가-힣]{2,}(?:초등학교|중학교|고등학교)"),
    ),
]


class 감지(NamedTuple):
    kind: PiiKind
    start: int
    end: int


def _눕힌것(text: str) -> str:
    """**찾을 때만 쓰는 사본.** 전각(full-width) 숫자로 쓴 번호는 정규식을 그냥 지나간다.

    **글자 수를 유지한다** — NFKC 가 한 글자를 여러 글자로 바꾸는 경우가 있어,
    통째로 눕히면 **찾은 위치가 원문의 위치와 어긋난다.** 1:1 로 눕는 글자만 바꾸고
    나머지는 원래 글자를 둔다. 그래서 아래 `가리기` 가 **원문에 그대로 자를 댈 수 있다.**

    **원문 자체는 눕히지 않는다.** 전각으로 쓴 것도 아이가 고른 모양이고 그대로
    책에 인쇄된다 (`Stage0.md` 4절).
    """
    글자들 = []
    for 글자 in text:
        누운 = unicodedata.normalize("NFKC", 글자)
        글자들.append(누운 if len(누운) == 1 else 글자)
    return "".join(글자들)


def 찾기(text: str) -> list[감지]:
    """앞에서부터 훑어 감지 목록을 준다. **겹치면 먼저 나온 규칙이 이긴다.**"""
    대상 = _눕힌것(text)
    찾은것: list[감지] = []
    for kind, 규칙 in _RULES:
        for m in 규칙.finditer(대상):
            if any(m.start() < 이미.end and 이미.start < m.end() for 이미 in 찾은것):
                continue
            찾은것.append(감지(kind, m.start(), m.end()))
    return sorted(찾은것, key=lambda 것: 것.start)


def 가리기(text: str) -> tuple[str, list[PiiKind]]:
    """가린 문장과 **종류 목록**을 준다.

    **종류는 중복을 지운다.** `pii_masked` 는 종류별 한 건이고, 개수를 세어 남기면
    그 수가 곧 원문의 모양을 알려준다.
    """
    감지들 = 찾기(text)
    if not 감지들:
        return text, []

    조각 = []
    끝 = 0
    for 것 in 감지들:
        조각.append(text[끝 : 것.start])
        조각.append(PII_MASK)
        끝 = 것.end
    조각.append(text[끝:])

    종류: list[PiiKind] = []
    for 것 in 감지들:
        if 것.kind not in 종류:
            종류.append(것.kind)

    return "".join(조각), 종류


# ── 실명 (NER) ────────────────────────────────────────────
#
# **✅ 2026-09-16 대표 판정으로 다시 켰다** (W7 17번 · `app/config.py` `pii_ner_enabled`).
#
# **조건이 날짜가 아니라 사건이었다.** 2026-09-09 판정(「실명 검사 제거. 이름 노출해도
# 괜찮음」)이 끄면서 `docs/미룬것.md` 가 **「Stage 1 가족 공유(A-7)가 열리기 전에 반드시
# 되살릴 것」**으로 못 박아 뒀고, **A-7 이 닫히며 아이 책이 인쇄로 기기 밖에 나간다.**
#
# **⭐ 지우지 않고 설정으로 둔 것이 값을 했다** — 되살리는 데 든 것이 **기본값 한 줄**이고
# `benchmarks/W5-ner-accuracy.md` 의 **61/61 실측도 그대로 유효**하다.
#
# **켜진 것은 이 절뿐이다.** 위 정규식 넷(전화·이메일·주소·학교명)은 **켜짐과 무관하게**
# 그대로 가린다 — **2026-09-09 판정 대상이 아니었다.** 이 구분이 틀리면 아이 전화번호가
# 책에 인쇄된다.
#
# **끈 갈래는 살아 있다.** 다시 끄는 것은 대표 판정 자리이고, 그 갈래는
# `tests/test_pii.py` 의 `_NER_끈다` 검사 둘이 계속 잰다 — **한쪽만 재면 다른 쪽이
# 영영 안 재진다.**
#
# **`ner_unavailable` 이 다시 깨어난다** — 파일럿 관측 항목으로 돌아온다. 타임아웃은
# 조용하다(로그 한 줄 + 실명이 안 가려진 채 통과). 그 건수가 이 위험의 실측값이다.
#
# **NER 이 맡는 것은 실명뿐이다** (2026-09-08 대표 판정, 미결 11-6).
# 학교명은 위 정규식이 결정적으로 잡고, NER 은 같은 문장을 두 번 중 한 번 놓쳤다
# (`benchmarks/W3-ner-cost.md`) — 중복이면서 더 불안정하다.
#
# **이 호출로 아이 문장이 프로바이더에 간다.** 그건 이 단계의 결함이 아니라 전제다 —
# 검사·평가도 같은 곳으로 가고, `adr/0009` 48행이 「원문이 밖으로 나간다는 사실은
# 순차든 병렬이든 같다」고 이미 적어 뒀다. 여기서 막는 것은 **우리가 저장하는 것**이다:
# 마스킹 뒤 문자열만 `card_attempts.text` 로 가고 책에 인쇄된다.

NER_TIMEOUT = 3.0


class 실명들(BaseModel):
    """**문장에 있는 그대로** 돌려받는다. 위치를 숫자로 받지 않는 이유는 모델이
    글자 offset 을 잘 못 세기 때문이고, 그러면 **엉뚱한 자리를 가린다.**
    """

    names: list[str] = Field(default_factory=list)


_NER_지시 = """너는 아동 글쓰기 서비스의 개인정보 검사기다.
문장에 **실제 사람의 이름**이 있으면 그 이름을 문장에 있는 그대로 골라낸다.

- 실제로 존재할 법한 한국 사람 이름(성+이름)만 고른다
- **아이가 지어낸 이름은 고르지 않는다.** 판타지 인물·괴물·가이드 캐릭터 이름,
  성이 없는 별명은 전부 아니다
- **애매하면 고르지 않는다** — 아이가 지은 이름을 가리면 아이 문장이 망가진다
- 고른 이름은 **문장에 나온 글자 그대로** 적는다. 바꾸거나 풀어 쓰지 않는다"""


def _NER_켜짐() -> bool:
    """**설정 하나가 가른다.** `if TESTING:` 류가 아니라 운영에서도 같은 자리를 지난다 —
    켜면 오늘 껐던 그 코드가 그대로 돈다 (축 ⑪).
    """
    from app.config import get_settings

    return get_settings().pii_ner_enabled


async def _실명물어보기(text: str) -> list[str]:
    """단발 호출. **여기만 갈아끼우면 테스트가 네트워크를 안 탄다.**"""
    from google.genai import types

    from app.config import get_settings
    from app.llm import get_client

    응답 = await get_client().aio.models.generate_content(
        model=get_settings().evaluator_model.strip(),
        contents=text,
        config=types.GenerateContentConfig(
            system_instruction=_NER_지시,
            response_mime_type="application/json",
            response_schema=실명들,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return 실명들.model_validate_json(응답.text or "").names


async def 실명까지가리기(text: str, *, 제외: Sequence[str]) -> tuple[str, list[PiiKind]]:
    """정규식 층 + 실명 NER. **아이를 막지 않는다.**

    `제외` 는 자녀 닉네임·가이드 이름이다 — **서버가 이미 아는 값이라 호출 없이
    오탐을 줄인다** (PRD E-2). 모델이 가이드 이름을 실명이라고 해도 우리는 안다.

    **✅ 실명 갈래는 기본으로 켜져 있다** (2026-09-16 대표 판정 · `pii_ner_enabled`).
    **끄더라도 정규식 넷은 그대로 돈다** — 이 함수는 어느 쪽이든 계속 불러야 한다.

    **NER 이 죽어도 정규식 결과로 진행한다.** 실명을 못 잡는 것과 아이가 못 쓰는 것
    중 후자가 나쁘다 — 판정을 못 받으면 막는 E-1 과 방향이 반대이고, 그건 값이 다르기
    때문이다. 여기서 통과시키는 것은 **못 가린 것**이지 **막아야 할 것을 내보내는 것**이
    아니다.
    """
    가려진, 종류 = 가리기(text)

    # **끄면 여기서 끝난다.** 기본값은 **켜짐**이다 (2026-09-16 대표 판정). 정규식 넷은
    # 이미 위에서 돌았고 **실명 갈래만 안 탄다** — 끈 동안은 호출이 안 나가 돈도 안 들고
    # 이 경로로는 아이 문장이 프로바이더에 가지도 않는다.
    if not _NER_켜짐():
        return 가려진, 종류

    try:
        이름들 = await asyncio.wait_for(_실명물어보기(가려진), timeout=NER_TIMEOUT)
    except Exception as 오류:  # 뒷단이 죽어도 아이는 계속 쓴다
        logger.warning(
            "ner_unavailable",
            extra={"request_id": current_request_id(), "exc_type": type(오류).__name__},
        )
        return 가려진, 종류

    빼둘것 = {값.strip() for 값 in 제외 if 값 and 값.strip()}
    잡힌것 = 0
    for 이름 in 이름들:
        이름 = 이름.strip()
        # **문장에 그대로 없으면 버린다.** 모델이 지어낸 문자열은 어디를 가릴지
        # 알 수 없고, 억지로 맞추면 엉뚱한 자리를 가린다.
        if not 이름 or 이름 in 빼둘것 or 이름 not in 가려진:
            continue
        가려진 = 가려진.replace(이름, PII_MASK)
        잡힌것 += 1

    if 잡힌것:
        종류 = [*종류, "name"]
    return 가려진, 종류
