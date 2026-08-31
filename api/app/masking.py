"""요청·응답 body 에서 아이 원문이 밖으로 나가는 것을 막는다 (PRD 1.1b).

원문이 가도 되는 곳은 `card_attempts.text` 하나뿐이다. 로그·APM·오류 리포터로
body 를 넘기는 경로가 생기면 **반드시 `mask_body` 를 통과시킨다.**

`app/middleware.py` 는 애초에 body 를 읽지 않는다. 이 모듈은 나중에 오류 리포터나
디버그 덤프처럼 body 를 손에 쥐는 코드가 생겼을 때 쓰는 거름망이다.
"""

from typing import Any

MASKED = "[마스킹]"

# 아이 원문이 실리는 필드. `docs/api/Stage0.md` 의 요청·응답에서 뽑았다.
CHILD_TEXT_FIELDS = frozenset(
    {
        "text",  # POST /attempts 입력, 책 페이지 원문
        "raw_text",
        "input_text",
        "content",
        "nickname",  # 실명을 적는 아이가 있다
        "guide_name",  # 아이가 지어준 이름
        "title",  # 책 제목
        "caption",
        "line",  # 캐릭터 대사. 아이 문장을 따옴표로 인용한다
        "highlights",  # 아이가 쓴 묘사어 그 자체
    }
)

# 원문은 아니지만 로그에 남으면 안 되는 것.
CREDENTIAL_FIELDS = frozenset({"password", "token", "access_code", "email", "jwt", "secret"})

SENSITIVE_FIELDS = CHILD_TEXT_FIELDS | CREDENTIAL_FIELDS


def mask_body(value: Any, *, _depth: int = 0) -> Any:
    """dict·list 를 재귀로 훑어 민감 필드 값을 `[마스킹]` 으로 바꾼다.

    원본을 건드리지 않고 새 객체를 돌려준다. 깊이가 지나치면 통째로 마스킹한다 —
    구조를 다 못 훑으면 원문이 남을 수 있어, 못 본 것은 내보내지 않는다.
    """
    if _depth > 8:
        return MASKED

    if isinstance(value, dict):
        return {
            key: MASKED if key in SENSITIVE_FIELDS else mask_body(item, _depth=_depth + 1)
            for key, item in value.items()
        }

    if isinstance(value, list | tuple):
        return [mask_body(item, _depth=_depth + 1) for item in value]

    return value


def safe_query_keys(query_params: Any) -> list[str]:
    """쿼리스트링은 **키 이름만** 남긴다. 값에 무엇이 실릴지 보장할 수 없다."""
    return sorted(set(query_params))
