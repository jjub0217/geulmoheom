"""2. 자녀 인증 (`docs/api/Stage0.md` 2절).

**목이 아니다** (2026-09-07, E-3). 접속 코드를 실제로 대조하고 진짜 토큰을 굽는다.

**아이에게 묻는 것은 접속 코드 하나뿐이다.** 실명·이메일·학교를 묻는 필드가 이
파일에 없다 (PRD E-3). 응답에 `child_id` 가 실리는 것은 프론트가 상태를 붙잡기
위해서이고, **아이 화면에 보이지 않는 것은 화면 몫**이다.
"""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select

from app.accounts import 접속코드해시, 코드가살아있나
from app.api.v1 import _fixtures as fx
from app.api.v1.deps import Session, mock_daily_cap_reached, require_child
from app.auth import CHILD_COOKIE, PARENT_COOKIE, clear_auth_cookie, set_auth_cookie
from app.child_auth_limit import 클라이언트IP, 기기식별자, 기기풀기, 막을까, 실패기록
from app.errors import AppError, ErrorCode
from app.middleware import current_request_id
from app.models import Child
from app.schemas.stage0 import (
    ChildAuthRequest,
    ChildAuthResponse,
    ChildIdentity,
    ChildMe,
    ChildToday,
    UpdateGuideRequest,
    UpdateGuideResponse,
)
from app.tokens import issue

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/child", tags=["child"])

ChildRow = Annotated[Child, Depends(require_child)]
기기 = Annotated[str, Depends(기기식별자)]


@router.post("/auth")
async def auth(
    payload: ChildAuthRequest,
    request: Request,
    response: Response,
    session: Session,
    기기id: 기기,
) -> ChildAuthResponse:
    """접속 코드 교환. 코드는 소진 후 재사용 불가, 토큰 30일.

    **토큰은 `Set-Cookie: __Host-gm_child` 로만 나간다.** body 에 없다.

    **없는 코드·만료된 코드·이미 쓴 코드를 구분하지 않는다.** 셋 다 401 이다 —
    구분하면 코드를 찍어 보는 쪽에 「이 번호는 존재한다」가 새어 나간다.

    **브라우저에서 연다. 실행 형태를 가리지 않는다** (`adr/0014`).
    쿠키 컨텍스트가 하나뿐이라 1회용 코드가 갈릴 데가 없다.

    **속도 제한이 여기 걸린다** (`app/child_auth_limit.py` · 2026-09-07 대표 승인).
    토큰을 받기 전이라 공통규약 표의 「자녀 토큰 10회/분」이 안 걸리는 유일한 자리다.
    """
    아이피 = 클라이언트IP(request)
    # **코드를 대조하기 전에 막는다.** 뒤에 두면 잠긴 기기의 요청도 매번 DB 를 치고,
    # 무엇보다 **틀린 코드와 잠긴 것이 같은 401 로 나가** 아이가 왜 안 되는지 모른다.
    if await 막을까(기기id, 아이피):
        # **누가 걸렸는지 남기지 않는다.** 기기 표식도 IP 도 아이를 가리키는 값이다.
        logger.info("접속 코드 속도 제한", extra={"request_id": current_request_id()})
        raise AppError(ErrorCode.RATE_LIMITED)

    코드 = payload.access_code.strip()
    # 해시 하나로 곧장 찾는다 — 인덱스가 붙어 있고(`8ef582cb7716`) 소금 없는 HMAC 이라
    # 등호로 찾을 수 있다. 소금을 쳤다면 **미사용 코드가 있는 자녀를 전부 훑어야** 했고,
    # 그 경로는 그 자체로 서비스를 세우는 손잡이가 된다 (`app/accounts.py` 「접속코드해시」).
    아이 = await session.scalar(select(Child).where(Child.access_code_hash == 접속코드해시(코드)))

    if 아이 is None or not 코드가살아있나(아이.access_code_expires_at, 아이.access_code_used_at):
        # **세는 단위는 「요청자」다.** 코드마다 세면 안 듣는다 — 찍는 쪽은 매번 다른
        # 코드를 넣으므로 코드별 카운터는 1에서 멈춘다 (`공통규약.md` 함정 절).
        await 실패기록(기기id, 아이피)
        # **누른 코드를 로그에 남기지 않는다.** 6자리라 로그만 모아도 코드북이 된다.
        logger.info("접속 코드 교환 실패", extra={"request_id": current_request_id()})
        raise AppError(ErrorCode.UNAUTHORIZED)

    # **형제자매가 한 기기에서 차례로 들어오는 것이 정상 사용이다.** 앞의 아이가 두어
    # 번 틀린 것을 남겨 두면 아무도 공격하지 않았는데 가족이 잠긴다.
    await 기기풀기(기기id)

    # **1회용.** 여기서 소진 표시를 하고, 해시는 남겨 두지 않는다 — 남기면 재사용
    # 판정이 `used_at` 하나에만 걸리고, 그 컬럼을 실수로 비우는 코드가 생기면
    # 옛 코드가 되살아난다.
    아이.access_code_hash = None
    아이.access_code_used_at = datetime.now(UTC)
    아이.last_active_at = datetime.now(UTC)
    await session.commit()

    set_auth_cookie(
        response, CHILD_COOKIE, issue(아이.id, "child", token_version=아이.token_version)
    )
    # **부모 쿠키를 지운다** (`adr/0014` 결정 3 · 안전).
    # 웹으로 열면서 기기 분리가 없어졌다 — 집 데스크탑 하나에 부모 쿠키와 아이 쿠키가
    # 함께 살면 **아이가 `/parents` 에서 자기 계정을 지울 수 있다**(책이 사라진다).
    #
    # **⛔ 반대 방향은 하지 않는다** (`parents.py` login 참조). **위험이 한 방향**이다.
    # **⛔ `token_version` 을 올리지 않는다.** 그것은 그 아이의 **모든 기기**를 끊는
    # 장치이고(`공통규약.md` 「폐기」), 막으려는 범위는 **이 브라우저 하나**다.
    # 쿠키는 `HttpOnly` 라 지워지면 이 브라우저에서 되살릴 방법이 없다 —
    # **덜 안전하지도 않다.**
    clear_auth_cookie(response, PARENT_COOKIE)
    return ChildAuthResponse(
        child=ChildIdentity(
            child_id=str(아이.id), nickname=아이.nickname, guide_name=아이.guide_name
        ),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    """가족 공용 태블릿에서 아이가 내려오는 경로다 (`Stage0.md` 2절).

    학부모 쿠키는 그대로 둔다. 인증을 요구하지 않는 이유는 `parents.logout` 과 같다.

    **`token_version` 을 올리지 않는다.** 로그아웃은 이 기기에서 내려오는 것이지
    다른 기기를 끊는 것이 아니다 — 그건 학부모의 재발급·삭제 몫이다 (`공통규약.md`
    「폐기」 표). 여기서 올리면 태블릿에서 내려온 아이가 자기 다른 기기까지 잃는다.

    **접속 코드는 1회 사용이라 여기서 내려오면 재발급 없이는 못 들어온다.** 프론트가
    이 버튼을 아이 손에 쉽게 닿는 자리에 두지 않는다 — 계약이 아니라 화면 몫이다.
    """
    clear_auth_cookie(response, CHILD_COOKIE)


@router.get("/me")
async def me(
    아이: ChildRow,
    session: Session,
    소진: Annotated[bool, Depends(mock_daily_cap_reached)],
) -> ChildMe:
    """**프론트가 로그인 상태를 판별하는 유일한 경로다** (`공통규약.md` 「인증 쿠키」).

    `today` 는 아직 목이다 — 카드 소모 이력(A0-1 나머지)과 일일 제한(A0-5)이 W4 다.
    `cap` 만 실제 값을 쓴다. 리셋 기준 타임존은 미결 11-4.
    """
    아이.last_active_at = datetime.now(UTC)
    await session.commit()

    return ChildMe(
        child_id=str(아이.id),
        nickname=아이.nickname,
        guide_name=아이.guide_name,
        today=ChildToday(
            cards_done=아이.daily_cap if 소진 else 2,
            cap=아이.daily_cap,
            locked=소진,
            resets_at=fx.tomorrow_midnight(),
        ),
    )


@router.patch("/guide")
async def rename_guide(
    payload: UpdateGuideRequest, 아이: ChildRow, session: Session
) -> UpdateGuideResponse:
    """아이가 지어주는 이름. 1회. PII 검사.

    **PII 검사는 아직 안 붙었다** — 여기는 아이가 직접 쓰는 자리라 닉네임(학부모가
    쓴다)과 달리 **서버 2차(E-2, NER)를 그대로 태워야 한다.** 정규식만 걸어 두면
    아이가 지은 이름이 걸리는 쪽(「마법약초」류)이 먼저 생긴다. E-2 에서 붙인다.
    """
    아이.guide_name = payload.guide_name
    await session.commit()
    return UpdateGuideResponse(guide_name=아이.guide_name)
