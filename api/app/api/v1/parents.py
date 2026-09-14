"""1. 학부모 (`docs/api/Stage0.md` 1절).

**목이 아니다** (2026-09-07, E-3). 계정·자녀·접속 코드가 실제로 DB 에 선다.

**여기 있는 이메일·비밀번호는 학부모의 것이다.** 아이에게는 아무것도 묻지 않는다 —
자녀 계정에 들어가는 것은 난수 ID · 닉네임 · 연령대뿐이다 (PRD E-3).

**E-4 로 남는 것**: 동의 화면의 LLM 위탁 고지 · 학부모 화면(목록·오늘 플레이·삭제) ·
계정 삭제 시 자녀 데이터 파기. 여기서는 **동의를 받아 기록하는 것까지**다.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Final

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import tokens
from app.accounts import (
    닉네임에PII가있나,
    닉네임길이가맞나,
    비밀번호맞나,
    비밀번호해시,
    접속코드만들기,
)
from app.api.v1.deps import Session, require_parent
from app.auth import PARENT_COOKIE, clear_auth_cookie, set_auth_cookie
from app.card_store import 오늘시작 as 오늘시작기준
from app.errors import AppError, ErrorCode
from app.models import CardAttempt, Child, Parent
from app.scaffold import 잔여지우기
from app.schemas.stage0 import (
    AccessCode,
    ChildSummary,
    CreateChildRequest,
    CreateChildResponse,
    LoginRequest,
    LoginResponse,
    ParentMe,
    SignupRequest,
    SignupResponse,
    UpdateChildRequest,
    UpdateChildResponse,
)
from app.tokens import issue

router = APIRouter(prefix="/parents", tags=["parents"])

ParentRow = Annotated[Parent, Depends(require_parent)]

# 동의받은 문구가 어느 판이었는지 남긴다 — 문구가 바뀌면 **다시 받아야 하는지**를
# 이 값으로 가른다. **문구 자체의 SSOT 는 `docs/문구.md` 4장**이고, 화면과 LLM 위탁
# 고지는 E-4 다. 여기서는 「무엇에 동의했는지」를 되짚을 수 있게만 해 둔다.
CONSENT_VERSION: Final = "2026-09-07"


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest, response: Response, session: Session) -> SignupResponse:
    """`consent: true` 가 아니면 422 (`Stage0.md` 1절).

    **토큰은 `Set-Cookie: __Host-gm_parent` 로만 나간다.** body 에 없다.

    **라벨링 동의는 별개 컬럼이다** (PRD 1.1b). 하나로 묶어 받지 않는다 — 서비스
    제공에 필수인 보호자 동의와 달리, 라벨링은 **거부해도 이용할 수 있다.**
    """
    if not payload.consent:
        raise AppError(ErrorCode.VALIDATION_ERROR, detail={"fields": [{"field": "consent"}]})

    학부모 = Parent(
        email=payload.email.strip().lower(),
        password_hash=비밀번호해시(payload.password),
        consent_at=datetime.now(UTC),
        consent_version=CONSENT_VERSION,
        labeling_consent=payload.labeling_consent,
    )
    session.add(학부모)
    try:
        # **`commit()` 이 아니라 `flush()` 다** (2026-09-12). id 만 받고 트랜잭션은 연다 —
        # **토큰 발급이 실패하면 행이 남으면 안 된다.**
        #
        # 그 반대를 운영에서 겪었다: `commit()` → `issue()` 순서였고 `issue()` 가 터져
        # **500 인데 계정은 저장됐다.** 그러면 학부모는 **못 들어가는데 다시 가입하면
        # 「이미 가입된 이메일」로 막힌다** — 자기가 만든 계정에 영영 못 들어간다.
        # 화면에 나가는 것은 「잠깐 문제가 생겼어요」 한 줄뿐이라 **아무도 그 상태를
        # 못 본다.** 원인은 그때 `JWT_SECRET` 이었지만 **무엇이 터지든 같은 일이 난다.**
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        # 이미 있는 이메일. **「이미 가입된 이메일」이라고 알려주지 않는다** — 그
        # 문장 하나가 아무나 이메일 존재 여부를 확인하는 창구가 된다.
        raise AppError(ErrorCode.VALIDATION_ERROR, detail={"fields": [{"field": "email"}]}) from exc

    # **토큰을 커밋 앞에서 만든다.** 여기서 터지면 세션이 닫히며 롤백돼 계정이 안 남는다.
    토큰 = issue(학부모.id, "parent")
    await session.commit()

    set_auth_cookie(
        response,
        PARENT_COOKIE,
        토큰,
        # **JWT `exp` 와 쿠키 `Max-Age` 가 어긋나면 안 된다** (`adr/0014` 결정 4).
        # 쿠키만 길면 **브라우저가 죽은 토큰을 계속 보내고 아이는 401 만 본다.**
        max_age=int(tokens.수명("parent").total_seconds()),
    )
    return SignupResponse(parent_id=str(학부모.id), consent_at=학부모.consent_at)


@router.post("/login")
async def login(payload: LoginRequest, response: Response, session: Session) -> LoginResponse:
    """**이메일이 없는 것과 비밀번호가 틀린 것을 구분하지 않는다.**

    구분하면 로그인 화면이 「이 이메일이 우리 서비스에 있는지」를 물어보는 도구가
    된다. 학부모 계정이 곧 아이 계정으로 가는 문이라 더 그렇다.
    """
    학부모 = await session.scalar(
        select(Parent).where(Parent.email == payload.email.strip().lower())
    )
    if 학부모 is None or not 비밀번호맞나(payload.password, 학부모.password_hash):
        raise AppError(ErrorCode.UNAUTHORIZED)

    # **⛔ 아이 쿠키를 지우지 않는다** (`adr/0014` 결정 3). **대칭이 빠진 것이 아니다** —
    # **위험이 한 방향**이다. 부모가 아이 글을 보는 것은 정상이고, 여기서 지우면
    # **아이가 갇힌다**: 돌아올 길이 1회용 접속 코드뿐인데 이미 소진됐다.
    # 부모가 리포트 한 번 볼 때마다 아이가 튕기고 코드를 다시 뽑아야 한다.
    # 부모 쪽 위험은 **세션 수명**이 닫는다 (`adr/0014` 결정 4).
    set_auth_cookie(
        response,
        PARENT_COOKIE,
        issue(학부모.id, "parent"),
        # **JWT `exp` 와 쿠키 `Max-Age` 가 어긋나면 안 된다** (`adr/0014` 결정 4).
        # 쿠키만 길면 **브라우저가 죽은 토큰을 계속 보내고 아이는 401 만 본다.**
        max_age=int(tokens.수명("parent").total_seconds()),
    )
    return LoginResponse(parent_id=str(학부모.id))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    """`Set-Cookie: __Host-gm_parent=; Max-Age=0; ...` — HttpOnly 라 클라이언트가
    스스로 못 지운다. 로컬 상태만 비우면 쿠키는 살아 있다 (`Stage0.md` 1절).

    **인증을 요구하지 않는다.** 만료·손상된 쿠키를 지우려는 것이 로그아웃인데
    `require_parent` 를 걸면 정작 지워야 할 상태에서만 401 로 막힌다. 지우는 것
    말고 하는 일이 없어 열어 둬도 잃을 것이 없고, cross-site POST 는 `SameSite=Lax`
    가 막는다.

    **자녀 쿠키는 건드리지 않는다** — 가족 태블릿에 둘이 함께 앉아 있다.
    """
    clear_auth_cookie(response, PARENT_COOKIE)


@router.get("/me")
async def me(학부모: ParentRow, session: Session) -> ParentMe:
    """성장 데이터·등급·입력 내용은 반환하지 않는다 (P1 대시보드 범위)."""
    아이들 = (
        await session.scalars(
            select(Child).where(Child.parent_id == 학부모.id).order_by(Child.created_at)
        )
    ).all()

    오늘시작 = 오늘시작기준()
    오늘한아이 = (
        set(
            (
                await session.scalars(
                    select(CardAttempt.child_id)
                    .where(CardAttempt.child_id.in_([아이.id for 아이 in 아이들]))
                    .where(CardAttempt.created_at >= 오늘시작)
                    .distinct()
                )
            ).all()
        )
        if 아이들
        else set()
    )

    return ParentMe(
        parent_id=str(학부모.id),
        email=학부모.email,
        # 동의 없이는 계정이 서지 않으므로 이 값은 항상 있다. 타입만 optional 이다.
        consent_at=학부모.consent_at or 학부모.created_at,
        children=[
            ChildSummary(
                child_id=str(아이.id),
                nickname=아이.nickname,
                age_band=아이.age_band,
                daily_cap=아이.daily_cap,
                played_today=아이.id in 오늘한아이,
                last_active_at=아이.last_active_at,
            )
            for 아이 in 아이들
        ],
    )


@router.post("/children", status_code=status.HTTP_201_CREATED)
async def create_child(
    payload: CreateChildRequest, 학부모: ParentRow, session: Session
) -> CreateChildResponse:
    """**닉네임과 연령대만 받는다.** 실명·이메일·학교를 묻는 필드가 없다 (PRD E-3).

    `child_id` 는 UUID v4 난수다 — 순번이 아니라서 **다른 아이의 ID 를 추측할 수 없다.**
    """
    닉네임 = payload.nickname.strip()
    _닉네임검사(닉네임)

    코드, 해시, 만료 = await _안겹치는코드(session)
    아이 = Child(
        parent_id=학부모.id,
        nickname=닉네임,
        age_band=payload.age_band,
        access_code_hash=해시,
        access_code_expires_at=만료,
    )
    session.add(아이)
    await session.commit()

    # **평문 코드는 이 응답 한 번에만 실린다.** 저장하지 않으므로 놓치면 재발급이다.
    return CreateChildResponse(
        child_id=str(아이.id),
        nickname=아이.nickname,
        access_code=코드,
        access_code_expires_at=만료,
    )


@router.post("/children/{child_id}/access-code")
async def reissue_access_code(child_id: str, 학부모: ParentRow, session: Session) -> AccessCode:
    """재발급하면 **이전 기기의 자녀 토큰이 즉시 401 이 된다** (`공통규약.md` 「폐기」).

    코드만 바꾸고 `token_version` 을 그대로 두면, 코드를 잃어버려 다시 받는
    상황(= 남이 그 코드를 봤을 수 있는 상황)에서 **이미 들어와 있는 기기가 그대로
    남는다.** 재발급의 목적이 그것을 끊는 것이다.
    """
    아이 = await _내자녀(child_id, 학부모, session)

    코드, 해시, 만료 = await _안겹치는코드(session)
    아이.access_code_hash = 해시
    아이.access_code_expires_at = 만료
    아이.access_code_used_at = None
    아이.token_version += 1
    await session.commit()

    return AccessCode(access_code=코드, access_code_expires_at=만료)


@router.patch("/children/{child_id}")
async def update_child(
    child_id: str, payload: UpdateChildRequest, 학부모: ParentRow, session: Session
) -> UpdateChildResponse:
    아이 = await _내자녀(child_id, 학부모, session)
    아이.daily_cap = payload.daily_cap
    await session.commit()
    return UpdateChildResponse(daily_cap=아이.daily_cap)


@router.delete("/children/{child_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_child(child_id: str, 학부모: ParentRow, session: Session) -> None:
    """자녀 데이터 즉시 파기 — attempts, books, artworks, events 는 FK `CASCADE` 로 함께 간다.

    **`token_version` 을 먼저 올린다.** 행이 지워지면 `require_child` 가 어차피 401 을
    내지만, 지우는 순서가 바뀌거나 실패해도 토큰이 살아남지 않게 한 번 더 닫는다.

    **되묻기 카운터도 함께 지운다** (E-4). 아이 원문은 없지만 「어느 카드에서 몇 번
    되물었는지」가 남고, TTL 24시간을 기다리는 것은 「즉시 파기」와 다른 말이다.
    **DB 를 먼저 커밋하고 그다음 Redis 를 훑는다** — 순서를 바꾸면 커밋이 실패했을 때
    살아 있는 아이의 카운터를 지운 채로 끝난다.
    """
    아이 = await _내자녀(child_id, 학부모, session)
    아이.token_version += 1
    await session.flush()
    await session.delete(아이)
    await session.commit()

    await 잔여지우기(child_id)


async def _안겹치는코드(session: Session, 시도: int = 5) -> tuple[str, str, datetime]:
    """살아 있는 다른 코드와 겹치지 않는 코드를 뽑는다.

    **겹치면 조회가 아무 쪽이나 골라 다른 아이의 계정으로 들어가진다.** DB 에도
    유니크를 걸어 뒀지만(`8ef582cb7716`), 그건 마지막 방어선이고 사용자에게는 500 으로
    보인다. 여기서 먼저 피한다.

    코드가 6자리(10^6)라 파일럿 규모에서는 첫 시도에 거의 붙는다. 다섯 번을 다
    실패하면 **난수가 고장 났거나 코드 공간이 찼다는 뜻**이라, 조용히 같은 값을
    내보내지 않고 오류로 세운다.
    """
    for _ in range(시도):
        코드, 해시, 만료 = 접속코드만들기()
        겹침 = await session.scalar(select(Child.id).where(Child.access_code_hash == 해시))
        if 겹침 is None:
            return 코드, 해시, 만료

    raise AppError(ErrorCode.INTERNAL_ERROR)


def _닉네임검사(닉네임: str) -> None:
    """길이와 PII. **걸린 값 자체를 응답에 담지 않는다** (PRD 1.1b)."""
    if not 닉네임길이가맞나(닉네임):
        raise AppError(ErrorCode.VALIDATION_ERROR, detail={"fields": [{"field": "nickname"}]})

    걸린것 = 닉네임에PII가있나(닉네임)
    if 걸린것 is not None:
        # `Stage0.md` 1절이 `detail.reason = "PII_DETECTED"` 로 못박은 자리다.
        # **종류(`kind`)까지는 준다** — 학부모가 무엇을 고쳐야 하는지 알아야 하고,
        # 그것은 학부모가 방금 자기 손으로 입력한 값이다.
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            detail={"reason": "PII_DETECTED", "kind": 걸린것},
        )


async def _내자녀(child_id: str, 학부모: Parent, session: Session) -> Child:
    """**남의 자녀에 손대지 못하게 하는 유일한 자리다.**

    `child_id` 는 URL 에서 온 값이라 그대로 믿으면 다른 학부모의 자녀를 조회·수정할
    수 있다. `parent_id` 를 조건에 함께 걸어 **없는 것과 남의 것을 같은 404 로** 만든다 —
    403 으로 가르면 「그 ID 는 존재한다」가 새어 나간다.
    """
    try:
        식별자 = uuid.UUID(child_id)
    except ValueError as exc:
        raise AppError(ErrorCode.NOT_FOUND) from exc

    아이 = await session.scalar(
        select(Child).where(Child.id == 식별자, Child.parent_id == 학부모.id)
    )
    if 아이 is None:
        raise AppError(ErrorCode.NOT_FOUND)
    return 아이
