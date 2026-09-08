"""5. 삽화 (`docs/api/Stage0.md` 5절).

**행이 말하는 그대로 돌려준다** (B-3 ②). 목이던 동안에는 무엇을 물어도 `ready` 라
폴링이 도는지조차 확인할 수 없었다.

**`url` 은 아직 비어 있다.** 그림 주소를 만드는 것은 프록시(`/artworks/{id}/image`,
B-3 ③)의 일이고 그건 다음 조각이다. **저장소 주소를 대신 내보내지 않는다** —
버킷은 공개하지 않기로 판정났고(미결 11-7), 임시로라도 내보내면 그 주소가 프론트에
남는다.

**`status` 는 `pending | ready` 둘뿐이다.** `failed` 는 2026-09-08 계약에서 빠졌다 —
생성 실패도 저장 실패도 15초 초과도 전부 `ready` + `fallback` 으로 수렴한다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header

from app.api.v1.deps import Session, require_child
from app.artwork_store import 내것읽기, 오래_기다렸으면_확정
from app.errors import AppError, ErrorCode
from app.models import Child as ChildRow
from app.schemas.stage0 import Artwork

router = APIRouter(prefix="/artworks", tags=["artworks"])

# `require_child` 는 검증된 `children` 행을 준다 (E-3). 예전에는 토큰 문자열이었다.
Child = Annotated[ChildRow, Depends(require_child)]


@router.get("/{artwork_id}")
async def get_artwork(
    artwork_id: str,
    아이: Child,
    session: Session,
    x_mock_status: Annotated[
        str | None,
        Header(description="**목 서버 전용.** pending | ready 를 강제한다"),
    ] = None,
) -> Artwork:
    """프론트: 3초 뒤 첫 폴링, 이후 2초 간격, 15초 초과 시 중단 (`Stage0.md` 5절).

    **남의 삽화는 404 다.** 403 으로 가르면 「그 삽화는 존재한다」가 샌다.

    **`X-Mock-Status` 는 응답의 `status` 만 덮는다.** 행은 안 건드린다 —
    화면 작업이 「굽는 중」 연출을 붙잡아 두려고 쓰는 값이고, 그것 때문에 DB 가
    바뀌면 그 뒤 폴링이 뭘 보는지 알 수 없어진다.
    **`placeholder_url` 폐기와 함께 B-3 ③ 에서 걷어낸다** — 프론트가 안 쓴다.
    """
    삽화 = await 내것읽기(session, artwork_id, 아이.id)
    if 삽화 is None:
        raise AppError(ErrorCode.NOT_FOUND)

    삽화 = await 오래_기다렸으면_확정(session, 삽화)

    return Artwork(
        artwork_id=str(삽화.id),
        status=x_mock_status if x_mock_status in {"pending", "ready"} else 삽화.status,
        # **프록시가 들어오면 여기가 채워진다** (B-3 ③ — 계약이 바뀌는 커밋).
        url=None,
        tier=삽화.tier,
        fallback=삽화.fallback,
    )
