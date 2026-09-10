"""커밋되는 파일럿 템플릿에 **진짜 값이 들어가는 것**을 막는다.

**2026-09-10 에 두 번 났다.** Render 대시보드에서 만든 Postgres 의 연결 문자열을
`.env.pilot.example` 에 붙여 넣었고, **그 파일은 커밋된다.** 사람이 두 번 다 되돌렸다.

**여기서 막는 이유는 되돌리기가 안 되기 때문이다** — 한 번 push 되면 히스토리에
남고, 지우려면 비밀을 갈아야 한다(그리고 `JWT_SECRET` 을 갈면 삽화 키가 전부
바뀐다, `app/storage.py` `_조각`).

**`.env.example`(개발용)은 검사하지 않는다.** 거기 `DATABASE_URL` 에 있는
`geulmoheom:geulmoheom@localhost` 는 **로컬 도커의 더미**라 그대로 있는 것이
정상이다 — 두 파일을 같은 규칙으로 재면 **개발 템플릿이 빨개져서 이 검사를
꺼 버리게 된다.**
"""

import re

from app.config import REPO_ROOT

파일럿템플릿 = REPO_ROOT / ".env.pilot.example"

# 파일럿에서 **값이 곧 비밀**인 것들. 템플릿에서는 반드시 비어 있어야 한다.
비어야하는키 = (
    "DATABASE_URL",
    "REDIS_URL",
    "GEMINI_API_KEY",
    "JWT_SECRET",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
)

_설정줄 = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
# `scheme://사용자:비밀@호스트` — 붙여 넣기 사고의 모양이다.
_자격증명 = re.compile(r"://[^/\s]+:[^/\s]+@")


def _값들() -> dict[str, str]:
    값 = {}
    for 줄 in 파일럿템플릿.read_text(encoding="utf-8").splitlines():
        if (m := _설정줄.match(줄.strip())) is not None:
            값[m.group(1)] = m.group(2).split("#")[0].strip()
    return 값


def test_비밀은_템플릿에서_비어_있다():
    """**채우는 곳은 Render 대시보드다.** 여기 적으면 저장소에 남는다."""
    값 = _값들()
    채워진것 = {k: len(v) for k in 비어야하는키 if (v := 값.get(k, ""))}

    assert not 채워진것, f"파일럿 템플릿에 값이 들어갔다 (길이만 표시): {채워진것}"


def test_자격증명이_섞인_줄이_없다():
    """`postgresql://user:pw@host` 모양이 어디에도 없어야 한다.

    위 검사는 **아는 키만** 본다 — 새 키가 생기면 그 검사를 안 지난다.
    이건 **모양으로** 잡아서 키 이름을 몰라도 걸린다.
    """
    걸린줄 = [
        번호
        for 번호, 줄 in enumerate(파일럿템플릿.read_text(encoding="utf-8").splitlines(), 1)
        if _자격증명.search(줄)
    ]

    assert not 걸린줄, f"자격증명이 들어간 줄: {걸린줄}행 (내용은 일부러 안 찍는다)"
