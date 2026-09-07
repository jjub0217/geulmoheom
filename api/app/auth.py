"""인증 쿠키 (`docs/api/공통규약.md` 「인증 쿠키」 · 미결 11-2 확정, 2026-09-06).

**토큰은 응답 body 로 내려가지 않는다.** 서버가 `Set-Cookie` 로 굽고 브라우저가 붙인다.
JS 는 토큰을 읽을 수도 보관할 수도 없다 — 로그인 상태는 `GET /parents/me`·`GET /child/me`
로만 판별한다. **`Authorization: Bearer` 를 쓰지 않는다.**

**아직 목이다.** 굽는 값은 고정 문자열이고 서명 검증이 없다 — 실제 JWT 발급과
`children.token_version` 대조는 E-3/E-4 에서 붙는다. 다만 **쿠키 속성은 지금 확정본
그대로**다. 로그아웃의 삭제 `Set-Cookie` 는 이름·`Path`·`Domain` 유무가 발급 때와
하나라도 다르면 아무것도 안 지운다 — 그래서 속성을 여기 한곳에만 둔다.

**쿠키를 OpenAPI 파라미터로 노출하지 않는다.** 브라우저가 자동으로 붙이는 값이라
프론트가 넘길 것이 없는데, 파라미터로 적으면 `types.gen.ts` 에 인자로 나타나 프론트가
「내가 채워야 하는 값」으로 읽는다. 그래서 `Cookie(...)` 대신 `Request` 에서 직접 읽는다.
"""

from typing import Final

from starlette.responses import Response

# **이름을 나눈다.** 가족 태블릿에서 학부모가 가입하고 같은 기기를 아이가 쓰는 것이
# 정상 흐름이라, 이름이 같으면 나중에 발급된 쪽이 앞의 것을 덮어쓴다.
# `gm_` 접두사를 뺄 수 없다 — 쿠키는 포트를 구분하지 않아 같은 머신의 다른 로컬
# 프로젝트와 충돌한다.
PARENT_COOKIE: Final = "__Host-gm_parent"
CHILD_COOKIE: Final = "__Host-gm_child"

# JWT `exp` 는 발급 시각 + 30일 **절대 고정**이고, 쿠키 만료만 슬라이딩한다.
# 여기 값은 그 절대 상한이다. 「남은 시간으로 다시 굽기」(12시간에 최대 1회)는
# 실제 JWT 가 있어야 계산되므로 E-3 에서 붙는다.
MAX_AGE_SECONDS: Final = 30 * 24 * 60 * 60

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


def set_auth_cookie(response: Response, name: str, value: str) -> None:
    """인증 쿠키를 굽는다. 이름 말고는 학부모·자녀가 완전히 같은 속성이다."""
    response.set_cookie(name, value, max_age=MAX_AGE_SECONDS, **_ATTRS)  # type: ignore[arg-type]
    # 앞단이 Cloudflare 다. 토큰을 실은 응답이 공용 캐시에 앉으면 다른 사람에게 나간다.
    response.headers["Cache-Control"] = "no-store"
