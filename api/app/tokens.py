"""인증 토큰 (`docs/api/공통규약.md` 「인증 쿠키」 · 「수명」 · 「폐기」).

**쿠키 속성은 `app/auth.py`, 토큰 자체는 여기다.** 굽는 자리(`set_auth_cookie`)와
서명하는 자리를 나눈 이유는 로그아웃 때문이다 — 삭제 `Set-Cookie` 는 서명이 필요 없고
속성만 같으면 되는데, 한 모듈에 섞으면 그 사실이 안 보인다.

**JWT 는 발급 후 회수할 수 없다.** 그래서 둘로 나눠 막는다.

- `exp` 는 발급 시각 + **역할이 정한 수명**이고 **절대 고정**이다. 갱신하지 않는다
  (`공통규약.md` 「수명」). **아이는 30일, 부모는 설정값**(`parent_session_hours`,
  기본 2시간 · `adr/0014` 결정 4) — **하나였을 때는 공용 데스크탑에서 부모 세션이
  30일 살아 아이가 학부모 화면에 닿는 창이 30일이었다.**
  아이 쪽 30일이 지나면 접속 코드를 다시 받는다 — 한 달에 한 번 학부모가 개입하는
  것은 이 제품에서 비용이 아니라 가드레일 쪽이다
- 그 안에서 끊어야 할 때는 `children.token_version` 을 1 올린다. 그 한 번으로
  그 자녀의 **모든 기기**가 끊긴다 (`공통규약.md` 「폐기」)

**`payload` 에 닉네임을 담지 않는다.** JWT 는 서명일 뿐 암호화가 아니라 body 가
평문으로 읽힌다. 닉네임은 아이가 실명을 적을 수 있는 자리다 (PRD 1.1b·E-2).
담는 것은 **난수 ID 와 정수 하나**뿐이다.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final, Literal

import jwt

from app.config import get_settings

# 라이브러리가 이 하나만 받아들이게 고정한다. **`alg` 를 토큰에서 읽지 않는다** —
# 읽으면 공격자가 `none` 이나 다른 계열로 바꿔 검증을 통과시킬 수 있다.
ALGORITHM: Final = "HS256"

Role = Literal["parent", "child"]

# `exp` 의 절대 상한 — **아이 기준**이다. 쿠키 `Max-Age` 는 이 안에서만 슬라이딩한다.
# **부모는 `수명()` 이 설정에서 읽는다** (`adr/0014` 결정 4).
MAX_AGE: Final = timedelta(days=30)

# 쿠키를 다시 굽는 최소 간격 (`공통규약.md` 「수명」: 12시간에 최대 1회).
# 매 요청 굽지 않는 이유는 `Set-Cookie` 가 붙은 응답이 캐시 정책을 타고 응답이
# 커지기 때문이고, 안 굽는 것보다 나은 이유는 Safari 16.4+ 가 서브리소스 응답의
# 쿠키를 7일로 깎을 수 있어서다 — 아이가 7일 안에 한 번 들어오면 만료가 계속 밀린다.
REFRESH_AFTER: Final = timedelta(hours=12)


class TokenError(Exception):
    """서명·형식·만료 어느 쪽이든 「이 토큰은 못 믿는다」 하나로 모은다.

    **왜 갈라 놓지 않나** — 호출부가 구분할 수 있으면 응답도 갈라지고, 그러면
    「서명이 틀렸다」와 「만료됐다」가 밖에서 구분된다. 둘 다 401 이면 된다.
    """


@dataclass(frozen=True, slots=True)
class Claims:
    """검증을 통과한 토큰의 내용."""

    subject: uuid.UUID
    role: Role
    # 자녀만 갖는다. 학부모는 `None` — 학부모 폐기는 E-4 이후 과제다
    # (`parents` 에는 아직 세대 번호 컬럼이 없다).
    token_version: int | None
    issued_at: datetime
    expires_at: datetime

    @property
    def 남은수명(self) -> timedelta:
        return self.expires_at - datetime.now(UTC)

    @property
    def 다시구울때인가(self) -> bool:
        """발급된 지 `REFRESH_AFTER` 가 지났으면 쿠키를 다시 굽는다.

        **판단 기준이 `iat` 이지 `exp` 가 아니다.** `exp` 로 재면 절대 만료가
        가까워질수록 자주 굽게 되는데, 정작 그때는 다시 구워도 늘릴 시간이 없다.
        """
        return datetime.now(UTC) - self.issued_at >= REFRESH_AFTER


def 수명(role: Role) -> timedelta:
    """역할마다 다르다 (`adr/0014` 결정 4 · 안전).

    **아이 30일 · 부모는 설정값**(기본 2시간). 하나로 두면 **공용 데스크탑에서 부모
    세션이 30일 살아 아이가 학부모 화면에 닿는 창이 30일**이 된다 — 거기에 자녀 삭제와
    접속 코드 재발급이 있다.

    **쿠키 `Max-Age` 도 이 값을 쓴다** (`api/v1/parents.py`). 둘이 어긋나 쿠키만 길면
    **브라우저가 죽은 토큰을 계속 보내고 아이는 401 만 본다.**
    """
    if role == "parent":
        return timedelta(hours=get_settings().parent_session_hours)
    return MAX_AGE


def issue(subject: uuid.UUID, role: Role, *, token_version: int | None = None) -> str:
    """토큰을 발급한다. **`exp` 는 역할이 정한다** — 아이 30일 · 부모 설정값.

    **이 값은 이후 갱신되지 않는다.** 쿠키 `Max-Age` 만 그 안에서 밀린다.
    """
    지금 = datetime.now(UTC)
    payload: dict[str, object] = {
        "sub": str(subject),
        "role": role,
        "iat": 지금,
        "exp": 지금 + 수명(role),
    }
    if token_version is not None:
        payload["tv"] = token_version

    return jwt.encode(payload, _비밀키(), algorithm=ALGORITHM)


def verify(token: str, *, expected_role: Role) -> Claims:
    """서명·만료·역할을 확인하고 내용을 돌려준다. 아니면 `TokenError`.

    **역할을 여기서 본다.** 호출부에 맡기면 「깜빡한 곳」이 생기는데, 그 한 곳이
    자녀 토큰으로 학부모 API 를 부를 수 있게 되는 자리다.
    """
    try:
        payload = jwt.decode(
            token,
            _비밀키(),
            # 리스트에 하나만 둔다. 토큰 헤더의 `alg` 를 신뢰하지 않는다.
            algorithms=[ALGORITHM],
            options={"require": ["sub", "role", "iat", "exp"]},
        )
    except jwt.PyJWTError as exc:
        # **예외 메시지를 밖으로 넘기지 않는다.** 어디가 틀렸는지 알려주면
        # 토큰을 깎아 보는 쪽에 힌트가 된다.
        raise TokenError from exc

    if payload["role"] != expected_role:
        raise TokenError

    try:
        subject = uuid.UUID(payload["sub"])
    except (ValueError, AttributeError, TypeError) as exc:
        raise TokenError from exc

    tv = payload.get("tv")
    if expected_role == "child" and not isinstance(tv, int):
        # 자녀 토큰에 세대 번호가 없으면 폐기가 성립하지 않는다. 옛 토큰이
        # 남아 있어도 **통과시키지 않는다** — 통과시키면 폐기에 구멍이 생긴다.
        raise TokenError

    return Claims(
        subject=subject,
        role=payload["role"],
        token_version=tv if isinstance(tv, int) else None,
        issued_at=datetime.fromtimestamp(payload["iat"], UTC),
        expires_at=datetime.fromtimestamp(payload["exp"], UTC),
    )


def _비밀키() -> str:
    """`JWT_SECRET`. **비어 있으면 발급도 검증도 하지 않는다.**

    빈 문자열로 서명하면 누구나 같은 키로 토큰을 만들 수 있다. `pilot` 은
    `PILOT_REQUIRED` 가 기동을 막지만(`app/config.py`) **`dev` 는 안 막는다** —
    그래서 여기서 한 번 더 닫는다. 목 서버 시절에는 서명이 아예 없어서 이 자리가
    없었다.
    """
    값 = get_settings().jwt_secret.get_secret_value()
    if not 값.strip():
        raise TokenError
    return 값
