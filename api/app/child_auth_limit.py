"""`/child/auth` 속도 제한 (E-3 후속 · `docs/api/공통규약.md` 「`/child/auth` 속도 제한」).

**2026-09-07 대표 승인.** 아이가 접속 코드를 넣는 경로는 **토큰을 받기 전**이라
공통규약 표의 「자녀 토큰 10회/분」이 안 걸린다. 따로 건다.

**막으려는 것은 「코드를 계속 바꿔가며 찍어보는 것」이다.** 코드는 6자리·24시간·1회용이고
지금 막고 있는 것은 해시 유니크와 401 통일뿐이라 **찍는 행위 자체는 안 막힌다.**
무게는 **노리는 쪽이 특정 아이를 고를 필요가 없다**는 데 있다 — 그 시간에 살아 있는
코드가 여럿이면 「아무 아이에게나」 걸린다. 파일럿은 아이 10~30명이 동시에 코드를
들고 있는 상태다.

**⚠ 세는 단위는 「요청자」다. 코드마다 세면 이 공격에 안 듣는다** — 공격자는 매번 다른
코드를 넣으므로 각 코드는 1회씩만 시도되고 카운터가 5에 못 간다. 「5회 제한」이라고
하면 자연스럽게 코드 단위가 떠오르는 자리라 여기 다시 적어 둔다.

**기기가 주고 IP 는 보조다.** IP 를 빡빡하게 잡으면 학교·가정처럼 여러 아이가 같은
인터넷을 쓰는 자리에서 **아무 잘못 없는 아이가 막힌다.**

**잠그는 것과 느리게 하는 것을 섞지 않는다.**

| | 무엇 | 무엇을 줄이나 |
|---|---|---|
| ① | 같은 기기 5회 실패 → 15분 **잠금** | 찍는 속도 |
| ② | 같은 IP 시간당 30회 실패 → **느슨한 제동** | 찍는 속도 |
| ③ | 학부모당 살아 있는 코드를 자녀 수만큼으로 | **걸릴 표적 수** |

**③ 은 여기 코드가 아니라 스키마가 지킨다** — 살아 있는 코드는 `children.access_code_hash`
한 열이라 자녀 하나에 하나뿐이고, 재발급은 이전 해시를 **덮어쓴다**(살려 두지 않는다).
그래서 여기 셀 것이 없다. **대신 그 불변을 테스트로 못 박았다**
(`tests/test_child_auth_limit.py` 「살아 있는 코드」). 열을 리스트로 바꾸거나 이력
테이블을 만들면 그 순간 깨지는 성질이라, 코드가 아니라 검사로 남긴다.

**Redis 가 죽으면 열어 준다** (`app/scaffold.py`·`app/cost.py` 와 같은 태도).
못 세는 동안 찍기가 안 막히는 것과 **아이가 아무도 못 들어오는 것** 중에 뒤가 훨씬
나쁘다 — 코드는 6자리·24시간이고 살아 있는 코드가 몇 개뿐이라, 못 세는 몇 분 동안의
기대값이 계정 하나에 못 미친다. **경고 로그가 그 사실을 남긴다.**
"""

import hashlib
import logging
import re
import uuid
from typing import Any, Final

from fastapi import Request

from app import db
from app.auth import DEVICE_COOKIE, set_device_cookie
from app.config import get_settings
from app.middleware import current_request_id, 쿠키굽기예약

logger = logging.getLogger(__name__)

# ① 기기 — 잠근다.
DEVICE_MAX_FAILURES: Final = 5
DEVICE_LOCK_SECONDS: Final = 15 * 60

# ② IP — 병행해서 느슨하게. 실패만 센다.
IP_MAX_FAILURES: Final = 30
IP_WINDOW_SECONDS: Final = 60 * 60


def _키(종류: str, 값: str) -> str:
    """식별자를 그대로 키에 쓰지 않는다 — Redis 키는 모니터링·덤프에 그대로 보인다.

    IP 는 그 자체로 아이를 가리키는 값이라 **평문으로 남기지 않는다.** 기기 id 도
    같이 해싱한다. 우리가 여기서 할 일은 **세는 것**이지 누구인지 아는 것이 아니다.
    """
    return f"childauth:{종류}:{hashlib.sha256(값.encode()).hexdigest()[:16]}"


def 클라이언트IP(request: Request) -> str | None:
    """제동을 걸 IP. 어느 헤더를 믿을지는 **설정이 정한다.**

    **`X-Forwarded-For` 를 파싱하지 않는다.** 그 헤더는 클라이언트가 직접 채워 보낼 수
    있고 맨 앞 값이 바로 그 자리라, 공격자가 요청마다 다른 값을 넣어 ② 를 통째로
    비껴간다. 앞단이 덮어쓰는 헤더 이름 하나(`CF-Connecting-IP` 등)를 **설정으로 받는다.**

    **비어 있으면 접속한 소켓 주소를 쓴다** — 로컬 개발이 그 모양이다. 그대로 파일럿에
    올라가면 **모든 요청이 앞단 IP 하나로 뭉쳐** 시간당 30회가 전체에 걸리므로,
    `client_ip_header` 를 `PILOT_REQUIRED` 에 넣어 기동에서 막는다.
    """
    이름 = get_settings().client_ip_header
    if 이름:
        값 = request.headers.get(이름)
        return 값.strip() or None if 값 else None
    return request.client.host if request.client else None


async def _세기(redis: Any, 키: str, 만료: int, 잠금선: int | None = None) -> int:
    횟수 = int(await redis.incr(키))
    # 첫 실패에서 창을 연다. 잠금선을 넘는 순간 **그 시각부터** 다시 15분을 준다 —
    # 안 밀면 첫 실패로부터 15분이라 마지막 실패 뒤에 남는 시간이 들쭉날쭉해진다.
    if 횟수 == 1 or (잠금선 is not None and 횟수 == 잠금선):
        await redis.expire(키, 만료)
    return 횟수


async def 막을까(기기: str, 아이피: str | None, *, client: Any = None) -> bool:
    """지금 이 요청을 받아주지 않을 것인가. **코드를 대조하기 전에 부른다.**

    **여기서 카운터를 올리지 않는다.** 올리면 잠긴 동안의 재시도가 잠금을 계속
    연장해서, 아이가 15분을 기다리다 한 번 눌러 보는 것만으로 다시 15분이 된다.
    아이는 반드시 눌러 본다.
    """
    try:
        redis = client or db.redis_client
        if int(await redis.get(_키("dev", 기기)) or 0) >= DEVICE_MAX_FAILURES:
            return True
        if 아이피 and int(await redis.get(_키("ip", 아이피)) or 0) >= IP_MAX_FAILURES:
            return True
    except Exception as exc:
        # **열어 준다.** 못 세는 것과 아무도 못 들어오는 것 중 뒤가 훨씬 나쁘다.
        logger.warning(
            "접속 코드 속도 제한을 확인하지 못했다",
            extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
        )
    return False


async def 실패기록(기기: str, 아이피: str | None, *, client: Any = None) -> None:
    """코드가 안 맞은 것을 센다. **맞은 코드는 안 센다.**

    성공까지 세면 학교에서 아이 서른 명이 차례로 들어오는 것만으로 ② 의 시간당 30회가
    찬다. 그건 **정상 사용**이고, 찍는 쪽은 어차피 거의 전부 실패다.
    """
    try:
        redis = client or db.redis_client
        await _세기(redis, _키("dev", 기기), DEVICE_LOCK_SECONDS, DEVICE_MAX_FAILURES)
        if 아이피:
            await _세기(redis, _키("ip", 아이피), IP_WINDOW_SECONDS)
    except Exception as exc:
        logger.warning(
            "접속 코드 실패를 세지 못했다",
            extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
        )


async def 기기풀기(기기: str, *, client: Any = None) -> None:
    """코드가 맞았으면 그 기기의 실패 카운터를 지운다.

    **형제자매가 한 기기에서 차례로 들어오는 것이 정상 사용이다.** 앞의 아이가 두어 번
    틀린 것이 뒤의 아이에게 남으면, 아무도 공격하지 않았는데 가족이 잠긴다.

    IP 쪽은 안 지운다 — 공유 IP 라 남의 실패를 내 성공으로 지워 줄 수 없고, 그렇게
    하면 유효한 코드 하나를 든 쪽이 ② 를 마음대로 되돌린다.
    """
    try:
        redis = client or db.redis_client
        await redis.delete(_키("dev", 기기))
    except Exception as exc:
        logger.warning(
            "접속 코드 실패 카운터를 지우지 못했다",
            extra={"request_id": current_request_id(), "exc_type": type(exc).__name__},
        )


_기기값 = re.compile(r"^[0-9a-f]{32}$")


def 기기식별자(request: Request) -> str:
    """이 요청을 보낸 기기. 없으면 만들고 **응답에 굽기로 예약한다.**

    **의존성으로 두는 이유가 있다** — `Depends` 로 들어가면 엔드포인트 본문이
    한 줄도 안 돌아도(검증 오류 등) 표식이 먼저 발급된다. 실패한 요청일수록
    표식이 필요한 자리라 순서가 그래야 한다.

    **모양을 검사한다.** 쿠키 값은 클라이언트가 아무 문자열로나 바꿔 보낼 수 있는데,
    그대로 받으면 요청마다 다른 긴 값을 넣어 Redis 에 키를 무한히 만드는 손잡이가 된다.
    (세는 값이라 해싱하지만, **만들어지는 키 개수**는 해싱이 안 줄여 준다.)
    """
    값 = request.cookies.get(DEVICE_COOKIE)
    if 값 and _기기값.match(값):
        return 값

    새것 = uuid.uuid4().hex
    쿠키굽기예약(request, lambda 응답: set_device_cookie(응답, 새것))
    return 새것
