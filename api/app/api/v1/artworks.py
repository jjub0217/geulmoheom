"""5. 삽화 (`docs/api/Stage0.md` 5절). 목 응답.

폴링이냐 SSE 냐는 **미결 11-1** 이다 — 이미지 벤치의 생성 지연 실측이 결정 입력이다.
목 서버는 폴링 전제로 `status` 를 돌려준다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header

from app.api.v1 import _fixtures as fx
from app.api.v1.deps import require_child
from app.models import Child as ChildRow
from app.schemas.stage0 import Artwork

router = APIRouter(prefix="/artworks", tags=["artworks"])

# `require_child` 는 검증된 `children` 행을 준다 (E-3). 예전에는 토큰 문자열이었다.
Child = Annotated[ChildRow, Depends(require_child)]


@router.get("/{artwork_id}")
async def get_artwork(
    artwork_id: str,
    _: Child,
    x_mock_status: Annotated[
        str | None,
        Header(description="**목 서버 전용.** pending | ready 를 강제한다"),
    ] = None,
) -> Artwork:
    """프론트: 2초 간격 폴링, 15초 초과 시 중단하고 `placeholder_url` 유지 (B-3)."""
    status = x_mock_status if x_mock_status in {"pending", "ready"} else "ready"

    return Artwork(
        artwork_id=artwork_id,
        status=status,
        url=f"{fx.R2}/artworks/{artwork_id}.webp" if status == "ready" else None,
        tier="rare",
        fallback=False,
    )
