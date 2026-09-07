"""계정 — 비밀번호 · 접속 코드 · 닉네임 검사 (백로그 E-3, `docs/api/Stage0.md` 1·2절).

**아이에게는 실명·이메일·학교를 묻지 않는다.** 자녀 계정에 들어가는 것은
난수 ID · 닉네임 · 연령대뿐이다 (PRD E-3). 이메일과 비밀번호는 **학부모 쪽에만** 있다.

여기 있는 것은 순수 함수뿐이다 — DB 도 요청도 모른다. 라우터에서 부른다.
"""

import hashlib
import hmac
import logging
import re
import secrets
import unicodedata
from datetime import UTC, datetime, timedelta
from typing import Final

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error

from app.config import get_settings

logger = logging.getLogger(__name__)

# 접속 코드는 6자리·24시간·1회용 (`Stage0.md` 1절).
CODE_DIGITS: Final = 6
CODE_TTL: Final = timedelta(hours=24)

_해시기 = PasswordHasher()


# ── 학부모 비밀번호 ───────────────────────────────────────


def 비밀번호해시(평문: str) -> str:
    """argon2id. **평문을 로그·예외에 남기지 않는다** — 이 함수 밖으로 안 나간다."""
    return _해시기.hash(평문)


def 비밀번호맞나(평문: str, 해시: str) -> bool:
    """틀렸다는 것만 돌려준다. **왜 틀렸는지 구분하지 않는다.**

    형식이 깨진 해시와 비밀번호 불일치를 밖에서 구분할 수 있으면, 그 차이가
    「이 이메일은 존재한다」를 알려주는 신호가 된다.
    """
    try:
        return _해시기.verify(해시, 평문)
    except (Argon2Error, TypeError, ValueError):
        return False


# ── 접속 코드 ─────────────────────────────────────────────


def 접속코드만들기() -> tuple[str, str, datetime]:
    """`(아이에게 보여줄 6자리, DB 에 넣을 해시, 만료 시각)`.

    **평문은 응답 한 번에만 실리고 저장하지 않는다.** 학부모가 놓치면 재발급이다
    (`POST /parents/children/{id}/access-code`).

    `secrets` 로 뽑는다 — `random` 은 예측 가능해서 **한 아이의 코드로 다른 아이의
    코드를 계산할 수 있게 된다.**
    """
    코드 = f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"
    return 코드, 접속코드해시(코드), datetime.now(UTC) + CODE_TTL


def 접속코드해시(코드: str) -> str:
    """서버 비밀키를 섞은 HMAC-SHA256. **소금 없는 결정적 해시다 — 일부러 그렇다.**

    아이는 코드 하나만 들고 온다(`POST /child/auth`). 소금을 치면 어느 자녀 행인지
    찾으려고 **미사용 코드가 있는 자녀를 전부 훑어 하나씩 비교**해야 하고, 느린 해시를
    n 번 돌리는 그 경로는 그 자체로 서비스를 세우는 손잡이가 된다.

    **DB 만 새면 코드를 못 되돌린다** — 비밀키가 없으면 10^6 을 다 돌려도 맞출 수 없다.
    비밀키까지 함께 샌 경우는 어차피 토큰을 직접 만들 수 있어 이 선택과 무관하다.

    **비밀번호에 이 방식을 쓰지 않는다.** 저쪽은 사람이 고른 값이라 사전 공격이 통하고,
    이쪽은 서버가 뽑은 난수라 통하지 않는다.
    """
    비밀키 = get_settings().jwt_secret.get_secret_value()
    if not 비밀키.strip():
        # `app/tokens.py` 와 같은 이유로 닫는다. 빈 키로 만든 해시는 누구나 재현한다.
        raise ValueError("JWT_SECRET 이 비어 있다")
    return hmac.new(비밀키.encode(), 코드.encode(), hashlib.sha256).hexdigest()


def 코드가살아있나(만료: datetime | None, 사용시각: datetime | None) -> bool:
    """만료 전이고 아직 안 쓴 코드인가. **둘 중 하나만 봐서는 안 된다.**"""
    if 만료 is None or 사용시각 is not None:
        return False
    return datetime.now(UTC) < 만료


# ── 닉네임 PII 검사 ───────────────────────────────────────
#
# **여기서 잡는 것은 정규식으로 잡히는 것뿐이다.** 실명·학교명은 서버 2차(NER,
# E-2)가 잡는다 — 이 파일이 아니라 `app/pii.py` 가 설 자리다.
#
# 클라이언트 패턴(`공통규약.md` 「클라이언트 PII 패턴은 빌드 타임 상수다」)과 **같은
# 것을 노리되 같은 목록이 아니다.** 저쪽은 아이가 타이핑하는 중에 도는 즉시 피드백이라
# 오탐이 곧 사고이고(「마법약초」가 막히는 것), 이쪽은 **학부모가 자녀를 만들 때 한 번**
# 도는 검사라 조금 더 조여도 아이의 글쓰기를 막지 않는다.

_전화 = re.compile(r"\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}")
_이메일 = re.compile(r"[^\s@]+@[^\s@]+\.[A-Za-z]{2,}")
# **줄임꼴(`○○초`)을 넣지 않는다** — 「마법약초」·「기초」가 걸린다 (PRD E-2, 2026-09-07).
_학교 = re.compile(r".+(초등학교|중학교|고등학교)")
# 번지·호수처럼 **숫자가 붙었을 때만** 주소로 본다. 숫자 없는 지명(「은하시 별빛동」)은
# 아이가 지어낸 세계일 수 있어 통과시킨다.
_주소 = re.compile(r"\d+\s*(번지|호|동|가|층)\b")

_패턴: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    ("phone", _전화),
    ("email", _이메일),
    ("school", _학교),
    ("address", _주소),
)

NICKNAME_MIN: Final = 1
NICKNAME_MAX: Final = 40  # `children.nickname` 컬럼 길이와 같다


def 닉네임에PII가있나(닉네임: str) -> str | None:
    """걸린 종류의 이름을 돌려준다. 깨끗하면 `None`.

    **값 자체를 돌려주지 않는다.** 호출부가 로그나 응답에 실을 수 있어, 애초에
    손에 쥐어주지 않는다 (PRD 1.1b).
    """
    # 전각 숫자·이형태를 먼저 눕힌다. 전각으로 쓴 번호는 전화번호 정규식을 그냥 지나간다.
    평평하게 = unicodedata.normalize("NFKC", 닉네임)
    for 이름, 패턴 in _패턴:
        if 패턴.search(평평하게):
            return 이름
    return None


def 닉네임길이가맞나(닉네임: str) -> bool:
    """공백만 있는 닉네임과 컬럼을 넘는 길이를 막는다."""
    return len(닉네임.strip()) >= NICKNAME_MIN and len(닉네임) <= NICKNAME_MAX
