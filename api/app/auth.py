"""인증 쿠키 (`docs/api/공통규약.md` 「인증 쿠키」 · 미결 11-2 확정, 2026-09-06).

**토큰은 응답 body 로 내려가지 않는다.** 서버가 `Set-Cookie` 로 굽고 브라우저가 붙인다.
JS 는 토큰을 읽을 수도 보관할 수도 없다 — 로그인 상태는 `GET /parents/me`·`GET /child/me`
로만 판별한다. **`Authorization: Bearer` 를 쓰지 않는다.**

**여기는 쿠키 속성만 안다. 토큰 자체는 `app/tokens.py` 다.** 로그아웃의 삭제
`Set-Cookie` 는 이름·`Path`·`Domain` 유무가 발급 때와 하나라도 다르면 아무것도 안
지우는데, 그때 필요한 것이 속성뿐이라 서명과 같은 자리에 두지 않았다.

**쿠키를 OpenAPI 파라미터로 노출하지 않는다.** 브라우저가 자동으로 붙이는 값이라
프론트가 넘길 것이 없는데, 파라미터로 적으면 `types.gen.ts` 에 인자로 나타나 프론트가
「내가 채워야 하는 값」으로 읽는다. 그래서 `Cookie(...)` 대신 `Request` 에서 직접 읽는다.
"""

from typing import Final

from starlette.responses import Response

from app import tokens

# **이름을 나눈다.** 가족 태블릿에서 학부모가 가입하고 같은 기기를 아이가 쓰는 것이
# 정상 흐름이라, 이름이 같으면 나중에 발급된 쪽이 앞의 것을 덮어쓴다.
# `gm_` 접두사를 뺄 수 없다 — 쿠키는 포트를 구분하지 않아 같은 머신의 다른 로컬
# 프로젝트와 충돌한다.
PARENT_COOKIE: Final = "__Host-gm_parent"
CHILD_COOKIE: Final = "__Host-gm_child"

# **자격증명이 아니다.** 값은 난수 하나이고 아무 권한도 열지 않는다 —
# `/child/auth` 속도 제한이 「같은 기기」를 셀 손잡이로만 쓴다
# (`app/child_auth_limit.py` · `공통규약.md` 「`/child/auth` 속도 제한」).
# 그래도 여기 두는 이유는 **`__Host-` 세 속성이 이 파일에만 있어야 하기 때문**이다.
# 다른 모듈에 복사하면 갈라지고, 갈라진 쪽이 조용히 약한 쿠키를 굽는다.
DEVICE_COOKIE: Final = "__Host-gm_device"
# 하루면 된다. 세는 창이 15분·1시간이라 그보다 길 이유가 없고,
# **기기를 오래 따라다니는 값을 아이 브라우저에 남기지 않는다.**
DEVICE_MAX_AGE_SECONDS: Final = 24 * 60 * 60

# JWT `exp` 는 발급 시각 + 30일 **절대 고정**이고, 쿠키 만료만 슬라이딩한다.
# 여기 값은 그 절대 상한이자 **처음 구울 때의 값**이다. 「남은 시간으로 다시 굽기」는
# E-3 에서 붙었다 — `app/tokens.py` 가 재는 자리이고 `deps._수명밀기` 가 실행한다.
MAX_AGE_SECONDS: Final = int(tokens.MAX_AGE.total_seconds())

# `__Host-` 는 이 셋(`Secure`·`Path=/`·`Domain` 미부착)을 브라우저가 강제하게 만든다.
# 얻는 것은 cookie tossing 차단 — 하위 도메인 하나가 뚫려도 `Domain=geulmoheom.app` 으로
# 같은 이름 쿠키를 덮어쓸 수 없다. `Cookie` 헤더에는 이름·값만 실려 **서버가 진짜를
# 구분할 방법이 없으므로** 브라우저 차원에서 막아야 한다.
#
# `Path` 를 나누지 않는다 — 자녀 토큰이 필요한 엔드포인트가 `/cards` `/attempts`
# `/artworks` `/book` `/events` 로 흩어져 있다. 대신 엔드포인트마다 어느 쿠키를 읽는지
# 서버가 명시한다.
#
# `SameSite=None` 을 쓰지 않는다. web↔api 는 same-site 라 `Lax` 로 모든 메서드에 붙는다.
_ATTRS: Final[dict[str, object]] = {
    "path": "/",
    "secure": True,
    "httponly": True,
    # 문서(`공통규약.md`)가 `SameSite=Lax` 로 적혀 있다. 브라우저는 대소문자를 안 가리지만
    # 헤더를 눈으로 대조할 일이 많은 자리라 표기를 문서와 맞춘다.
    "samesite": "Lax",
    # `domain` 을 넘기지 않는다. Starlette 는 None 이면 속성 자체를 안 붙인다 —
    # `__Host-` 가 요구하는 host-only 가 그것이다.
}


def set_auth_cookie(
    response: Response, name: str, value: str, *, max_age: int = MAX_AGE_SECONDS
) -> None:
    """인증 쿠키를 굽는다. 이름 말고는 학부모·자녀가 완전히 같은 속성이다.

    `max_age` 를 받는 것은 **슬라이딩** 때문이다 (`공통규약.md` 「수명」). 발급 때는
    30일이고, 이미 발급된 쿠키를 다시 구울 때는 **절대 만료까지 남은 시간**이 온다
    (`app/api/v1/deps.py` 「_수명밀기」). **JWT `exp` 는 그대로 두고 쿠키만 민다.**
    """
    response.set_cookie(name, value, max_age=max_age, **_ATTRS)  # type: ignore[arg-type]
    _캐시금지(response)


def set_device_cookie(response: Response, value: str) -> None:
    """속도 제한이 셀 기기 표식을 굽는다. 인증 쿠키와 **속성이 같다.**

    `HttpOnly` 를 붙인다 — JS 가 읽을 일이 없고, 읽을 수 있으면 화면 코드가
    「기기 id」로 다른 일을 하기 시작한다.

    **이 쿠키를 지우면 그 기기의 실패 카운터도 사라진다.** 그래서 기기 하나만으로는
    ① 이 완결되지 않고 ②(IP) 가 병행한다 — 계약이 아니라 설계다.
    """
    response.set_cookie(  # type: ignore[arg-type]
        DEVICE_COOKIE, value, max_age=DEVICE_MAX_AGE_SECONDS, **_ATTRS
    )
    _캐시금지(response)


def clear_auth_cookie(response: Response, name: str) -> None:
    """인증 쿠키를 지운다 (`Stage0.md` 1·2절 로그아웃).

    **발급 때와 `_ATTRS` 를 공유하는 것이 핵심이다.** 이름·`Path`·`Domain` 유무가
    하나라도 다르면 브라우저는 다른 쿠키로 보고 아무것도 지우지 않는다 — 서버는
    204 를 돌려주는데 세션은 살아 있는, 화면에서 안 보이는 실패가 된다.
    속성을 여기 복사해 적지 않는 이유가 그것이다.

    **이름을 받는다 — 한 번에 하나만 지운다.** 아이가 `logout` 으로 **내려올** 때
    학부모까지 끊기면 안 된다. **다만 아이가 `auth` 로 들어올 때는 일부러 학부모를
    지운다** (`adr/0014` 결정 3) — **내려오는 것과 들어오는 것이 다르다.**
    """
    response.delete_cookie(name, **_ATTRS)  # type: ignore[arg-type]
    _캐시금지(response)


def _캐시금지(response: Response) -> None:
    """앞단이 Cloudflare 다.

    토큰을 실은 응답이 공용 캐시에 앉으면 다른 사람에게 나가고, **삭제 `Set-Cookie`
    가 앉으면 반대로 남의 세션을 끊는다.** 굽는 쪽과 지우는 쪽 둘 다 걸어야 한다.
    """
    response.headers["Cache-Control"] = "no-store"
