"""서버측 PII 2차 감지·마스킹 (E-2).

**프론트를 믿지 않는다.** `web/src/lib/pii.ts` 가 같은 일을 입력창에서 하지만
그건 아이에게 주는 **즉시 피드백**이고, 클라이언트는 우회된다 (`공통규약.md` 69행).

**두 곳에 같은 규칙을 짰다는 것을 알고 있다.** 갈리는 것 자체는 사고가 아니다 —
서버가 더 넓게 잡는 것은 설계대로다. **서버가 더 좁게 잡는 쪽이 사고다.**

**실명·학교명은 여기 없다 — NER 몫이다** (PRD E-2). 정규식으로 한글 실명을 잡으려
들면 아이가 지은 가이드 이름·괴물 이름이 먼저 걸린다. 「검을 휘두른다」가 막히는 것과
같은 급이다.

**이 모듈은 받은 문자열을 어디로도 내보내지 않는다** — 부른 쪽에 돌려줄 뿐이다
(PRD 1.1b). 감지된 값도 로그에 싣지 않는다. 나가는 것은 **종류뿐**이다.
"""

import re
from typing import Literal, NamedTuple

# `pii_masked` 이벤트의 `kind` 로 그대로 나간다 (`Stage0.md` 7절).
PiiKind = Literal["phone", "email", "address", "school"]

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


def 찾기(text: str) -> list[감지]:
    """앞에서부터 훑어 감지 목록을 준다. **겹치면 먼저 나온 규칙이 이긴다.**"""
    찾은것: list[감지] = []
    for kind, 규칙 in _RULES:
        for m in 규칙.finditer(text):
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
