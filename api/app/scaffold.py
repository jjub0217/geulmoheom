"""되묻기 (백로그 A-5 · PRD 4.4 · `Stage0.md` 9절 6번).

G0 판정이면 결과 대신 **질문 하나**를 돌려준다. 카드는 소모하지 않는다.

**질문 문안은 PRD 4.4절에서 읽는다.** 코드에 복사하면 문서와 갈라지고, 갈라진 쪽이
실제로 아이에게 말을 건다. 아이가 읽는 문장이라 더 그렇다.
**LLM 을 부르지 않는다** — PRD 4.0 「되묻기 질문만 4.4 템플릿을 LLM 없이 조립한다」.

되묻기 횟수는 Redis 에 센다. **못 세면 되묻지 않고 결과를 준다** — 셀 수 없다고 같은
카드에서 무한히 되물으면 아이가 그 장면에 갇힌다.
"""

import hashlib
import logging
import re
from functools import lru_cache
from typing import Any

from app.config import REPO_ROOT
from app.db import redis_client
from app.docs_md import 민, 읽기
from app.middleware import current_request_id
from app.scene_cards import 카드

logger = logging.getLogger(__name__)

PRD = REPO_ROOT / "docs" / "MVP_PRD.md"

MAX_SCAFFOLD = 2  # 2회까지 되묻고, 그 뒤 같은 카드의 G0 는 G1 취급으로 진행한다
TTL_SECONDS = 60 * 60 * 24  # 하루. 카드 소진이 자정에 풀리는 것과 맞춘다

_틀줄 = re.compile(r'^- (?P<라벨>[^:]+):\s*"(?P<문장>.+)"\s*$')
_남은자리 = re.compile(r"\{[^}]*\}")

# 4.4 의 틀은 `{대상}을` 처럼 **조사가 박혀 있다.** 그대로 끼우면 「그림자을」이 된다 —
# 20장 중 절반이 받침 없는 명사다(그림자·지도·도깨비·거울·씨앗…). 글쓰기를 다루는
# 제품에서 아이에게 틀린 조사를 보일 수는 없어 **넣는 자리에서 맞춘다.**
_조사쌍: dict[str, tuple[str, str]] = {
    "을": ("을", "를"),
    "를": ("을", "를"),
    "은": ("은", "는"),
    "는": ("은", "는"),
    "이": ("이", "가"),
    "가": ("이", "가"),
    "과": ("과", "와"),
    "와": ("과", "와"),
}


def _받침있음(말: str) -> bool:
    끝 = 말.rstrip()[-1:]
    if not 끝 or not ("가" <= 끝 <= "힣"):
        return True  # 한글이 아니면 건드리지 않는다 (받침 있는 쪽이 원문 그대로다)
    return (ord(끝) - 0xAC00) % 28 != 0


def _채우기(문장: str, 자리: str, 말: str) -> str:
    """`{대상}` 을 명사로 바꾸고, 바로 뒤 조사를 그 명사에 맞춘다."""

    def 바꾸기(맞음: re.Match[str]) -> str:
        뒤 = 맞음.group(1)
        받침, 없음 = _조사쌍.get(뒤, ("", ""))
        return 말 + ((받침 if _받침있음(말) else 없음) if 받침 else 뒤)

    return re.sub(re.escape(자리) + r"(.?)", 바꾸기, 문장)


# 몇 번째 되묻기에 어느 틀을 쓰나. **PRD 4.4 의 라벨 그대로다.**
#
# 「감각」과 「대행 요청 시」는 아직 안 쓴다 —
#   - 감각: `{장소}` 를 명사 태그에서 못 고른다. 태그 순서가 장소를 보장하지 않는다
#     (07 「분수」· 04 「울음」· 13 「잠꼬대」가 두 번째다). **카드 데이터가 장소를 표시하면 켠다**
#   - 대행 요청 시: 「네가 정해」 같은 대행 요청을 가리려면 문구 목록을 코드에 둬야 하는데,
#     그러면 루브릭이 코드로 새어 나온다. **Evaluator 가 G0 안을 갈라 주면 켠다**
_차례: tuple[str, ...] = ("도구/방법", "감정/의도")


@lru_cache
def 질문틀() -> dict[str, str]:
    """PRD 4.4절의 `- 라벨: "문장"` 줄을 모은다."""
    조각 = re.search(r"^### 4\.4 .*?$(.*?)^### 4\.5 ", 읽기(PRD), re.S | re.M)
    if not 조각:
        raise RuntimeError("PRD 4.4절을 못 찾았다. 절 번호가 바뀌었으면 여기를 고친다")
    틀: dict[str, str] = {}
    for 줄 in 조각.group(1).splitlines():
        맞음 = _틀줄.match(민(줄))
        if 맞음:
            틀[맞음["라벨"].strip()] = 맞음["문장"].strip()
    if not 틀:
        raise RuntimeError("PRD 4.4 질문 템플릿을 못 읽었다")
    return 틀


@lru_cache
def 금지어() -> tuple[str, ...]:
    """4.4절의 `금지:` 줄. **부정어를 쓰지 않는다** — 되묻기는 호기심·요청 형식이다."""
    조각 = re.search(r"^### 4\.4 .*?$(.*?)^### 4\.5 ", 읽기(PRD), re.S | re.M)
    if not 조각:
        return ()
    for 줄 in 조각.group(1).splitlines():
        if 민(줄).startswith("금지:"):
            return tuple(re.findall(r'"([^"]+)"', 민(줄)))
    return ()


def 질문(card_id: str, 횟수: int) -> str:
    """되묻기 질문 **하나**. `횟수` 는 1부터.

    카드를 못 찾거나 태그가 없으면 명사가 필요 없는 틀로 간다 — 질문이 없어서
    아이가 빈 화면을 보는 쪽이 더 나쁘다.
    """
    틀들 = 질문틀()
    장면 = 카드(card_id)
    차례 = _차례[min(횟수, len(_차례)) - 1] if 횟수 >= 1 else _차례[0]

    후보 = [차례, *(_ for _ in _차례 if _ != 차례)]
    for 라벨 in 후보:
        문장 = 틀들.get(라벨)
        if not 문장:
            continue
        if 장면 and 장면.대상:
            문장 = _채우기(문장, "{대상}", 장면.대상)
        if not _남은자리.search(문장):  # 채우지 못한 자리가 남으면 아이에게 중괄호가 보인다
            return 문장

    # 여기까지 오면 문서 쪽이 바뀐 것이다. 그래도 아이는 말을 들어야 한다.
    logger.error("되묻기 틀을 못 골랐다", extra={"request_id": current_request_id()})
    return "나침반이 조용하네. 무엇을 할 건지 조금만 더 말해줄래?"


def _아이키(자녀id: str) -> str:
    """식별자를 그대로 키에 쓰지 않는다 — Redis 키는 모니터링·덤프에 그대로 보인다.

    **E-3 전에는 여기 토큰이 들어왔다.** 그때 이 함수의 이유는 「자격증명을 Redis 에
    적지 않는다」였고, 지금은 자녀 ID 라 자격증명이 아니다. 그래도 해싱을 남긴다 —
    키 목록만 봐도 어느 계정이 오늘 무엇을 하고 있는지가 읽히기 때문이다.

    **키가 토큰에서 자녀 ID 로 바뀐 것은 고침이다.** 토큰 기준이면 아이가 다른 기기로
    들어오는 순간 되묻기 횟수가 0 으로 돌아가, 같은 카드에서 상한(2회)을 넘겨 되물을
    수 있었다.
    """
    return hashlib.sha256(자녀id.encode()).hexdigest()[:16]


async def 되묻기횟수(자녀id: str, card_id: str, *, client: Any = None) -> int | None:
    """이번 G0 까지 포함한 되묻기 횟수. 셀 수 없으면 `None`.

    Redis 가 죽어도 아이는 계속 쓸 수 있어야 한다 (`app/cost.py` 와 같은 태도).
    """
    키 = f"scaffold:{_아이키(자녀id)}:{card_id}"
    try:
        redis = client or redis_client
        횟수 = int(await redis.incr(키))
        if 횟수 == 1:
            await redis.expire(키, TTL_SECONDS)
    except Exception as exc:
        logger.warning(
            "되묻기 횟수를 세지 못했다",
            extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
        )
        return None
    return 횟수
