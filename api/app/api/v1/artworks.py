"""5. 삽화 (`docs/api/Stage0.md` 5절).

**행이 말하는 그대로 돌려준다** (B-3 ②) 그리고 **api 가 그림을 프록시한다** (B-3 ③).

**버킷은 공개하지 않는다** (2026-09-08 대표 판정, 미결 11-7). 「내 책」의 `visibility`
가 Stage 0 에서 항상 `private` 인데, 공개 버킷이면 **URL 하나로 그 `private` 이
무너진다.** 난수 키는 「아무도 URL 을 모른다」에 기대는데, **이 제품에서 링크 공유는
사고가 아니라 설계된 사용 방식**이다 (비전 2장 「가족 공유」) — 반드시 샌다.

**`status` 는 `pending | ready` 둘뿐이다.** `failed` 는 2026-09-08 계약에서 빠졌다 —
생성 실패도 저장 실패도 15초 초과도 전부 `ready` + `fallback` 으로 수렴한다.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app.api.v1.deps import Session, require_child, 볼수있는아이들
from app.artwork_store import 내것읽기, 바이트읽기, 오래_기다렸으면_확정
from app.errors import AppError, ErrorCode
from app.models import Artwork as ArtworkRow
from app.models import Child as ChildRow
from app.schemas.stage0 import Artwork

router = APIRouter(prefix="/artworks", tags=["artworks"])

# `require_child` 는 검증된 `children` 행을 준다 (E-3). 예전에는 토큰 문자열이었다.
Child = Annotated[ChildRow, Depends(require_child)]
볼수있는것 = Annotated[set[uuid.UUID], Depends(볼수있는아이들)]

# 하루. **`private` 이 핵심이다** — 앞단에 공유 캐시가 있으면 `private` 이 아닐 때
# **거기에 아이 창작물이 남고, 그 사고는 화면에 아무 증상이 없다.**
#
# **업체 이름을 적지 않는다** (2026-09-14 훑기 ⑪). 종전은 「Cloudflare 가 앞단이라」였는데
# **앞단이 Vercel 로 바뀌었다**(`adr/0012`). **규칙은 그대로 옳고 이유만 낡았던 것**이라,
# 다음에 앞단이 또 바뀌어도 안 낡을 문장으로 적는다 — **이름이 틀린 전제를 담으면
# 다음 사람이 그 전제로 판단한다.**
캐시규칙 = "private, max-age=86400"


@router.get("/{artwork_id}")
async def get_artwork(artwork_id: str, 아이: Child, session: Session, request: Request) -> Artwork:
    """프론트: 3초 뒤 첫 폴링, 이후 2초 간격, 15초 초과 시 중단 (`Stage0.md` 5절).

    **남의 삽화는 404 다.** 403 으로 가르면 「그 삽화는 존재한다」가 샌다.
    """
    삽화 = await 내것읽기(session, artwork_id, 아이.id)
    if 삽화 is None:
        raise AppError(ErrorCode.NOT_FOUND)

    삽화 = await 오래_기다렸으면_확정(session, 삽화)

    return Artwork(
        artwork_id=str(삽화.id),
        status=삽화.status,
        url=삽화주소(request, 삽화),
        tier=삽화.tier,
        fallback=삽화.fallback,
    )


def 삽화주소(request: Request, 삽화: ArtworkRow) -> str | None:
    """그림 주소. **굽는 중이면 `None`.** `POST /attempts` 도 이것을 쓴다 (2026-09-09).

    **저장소 주소가 아니라 우리 주소다.** 프론트가 `status` 로 가르는데 주소까지
    미리 주면 그 분기가 흐려진다.

    **⛔ 상대 경로다** (2026-09-10 · `adr/0012` 따라오는 작업 ①). 종전 「절대 주소여야
    한다」는 **3단 호스트(`adr/0007` — web 은 `app.`, api 는 `api.`)를 전제**했는데,
    배포가 **한 오리진(`vercel.json` 의 `rewrites`)** 으로 정해지면서 그 전제가 뒤집혔다.
    `request.url_for()` 는 **api 컨테이너가 보는 호스트**를 내놓으므로, 절대 주소로 두면
    `<img>` 가 공개 오리진이 아니라 api 호스트로 나가 **`__Host-` 쿠키가 안 실리고
    그림이 0%** 다. 잘림(43% 보임)보다 나쁘다.

    **`--proxy-headers` 로는 안 풀린다** — uvicorn 은 `X-Forwarded-Proto` 와 `-For` 만
    보고 **`X-Forwarded-Host` 를 안 본다.** 절대 주소를 고집하면 **scheme 만 https 로
    잡히고 호스트는 여전히 api 컨테이너**다.

    **⚠ 로컬 개발에서는 이 값으로 그림이 안 뜬다** — `next dev` 는 web 과 api 가 다른
    오리진이라 `/api/v1/...` 이 web 쪽에 붙는다. **코드는 배포 형태를 따르고 로컬은
    프론트가 프록시로 맞춘다** — 설정으로 갈래를 만들면 **운영에서만 틀리는 값**이
    생기고, 그 실패는 조용하다.

    **셋이 이 한 줄을 공유한다** — 시도 응답(`POST /attempts`) · 폴링 · 책(`GET /book`).
    스키마는 각자 만들어도(`ArtworkRef` · `Artwork` · `BookPage`) **주소 규칙이 갈리면
    한쪽만 고쳐지고 조용하다.** 실제로 시도 응답은 `status` 를 `"pending"` 으로
    **박아 두고** 있었고, 그래서 **캐시 히트로 이미 `ready` 인 삽화도 `pending` 으로
    나갔다.** 2026-09-10 에는 **셋이 각자 `url_for()` 를 부르고 있었다** — 이 함수의
    주석이 「두 곳이 따로 갖지 않는다」고 적은 채였다.
    """
    if 삽화.status != "ready":
        return None
    return 그림경로(request, str(삽화.id))


def 그림경로(request: Request, artwork_id: str) -> str:
    """`<img src>` 에 그대로 들어가는 경로. **상대인 이유는 `삽화주소()` 에 있다.**

    행이 없고 id 만 있는 자리(`GET /book`)가 부른다. **`.path` 를 떼는 것이지 문자열을
    손으로 잇는 것이 아니다** — 라우트가 바뀌면 여기가 따라온다.
    """
    return request.url_for("get_artwork_image", artwork_id=artwork_id).path


@router.get(
    "/{artwork_id}/image",
    response_class=Response,
    responses={200: {"content": {"image/*": {}}, "description": "삽화 바이트"}},
)
async def get_artwork_image(
    artwork_id: str, 볼수있는아이: 볼수있는것, session: Session
) -> Response:
    """그림 바이트. **버킷을 공개하는 대신 여기서 낸다** (미결 11-7).

    **`<img>` 서브리소스로 불린다.** 쿠키가 자동으로 실리려면 브라우저에게 web 과
    같은 오리진으로 보여야 하고, **`adr/0012` 가 `vercel.json` 의 `rewrites` 로 그렇게
    잡았다**(종전 근거는 `adr/0007` 의 same-site 3단 호스트였다) — **`crossOrigin`
    속성을 붙이면 그 자동이 꺼져 그림이 통째로 안 뜬다** (프론트 몫, `Stage0.md` 5절).

    **남의 것은 404 다.** 403 으로 가르면 「그 삽화는 존재한다」가 샌다.
    **기본 에셋도 같은 주소로 나간다** — 주소가 갈리면 「`fallback` 을 아이에게
    알리지 않는다」가 네트워크 탭에서 무너진다.
    """
    삽화 = await _아무_아이의것(session, artwork_id, 볼수있는아이)
    if 삽화 is None:
        raise AppError(ErrorCode.NOT_FOUND)

    받은것 = await 바이트읽기(삽화)
    if 받은것 is None:
        # 저장소도 못 읽고 기본 에셋도 없다. **기본 에셋은 아직 안 만들었다** —
        # 프리테스트 전에 반드시 채운다 (`장면카드_초안.md` 「기본 삽화 1장」).
        raise AppError(ErrorCode.NOT_FOUND)

    바이트, mime = 받은것
    return Response(content=바이트, media_type=mime, headers={"Cache-Control": 캐시규칙})


async def _아무_아이의것(session: Session, artwork_id: str, 아이들: set[uuid.UUID]):
    """볼 수 있는 아이들 중 하나의 것이면 그 행. 아니면 `None`."""
    for child_id in 아이들:
        삽화 = await 내것읽기(session, artwork_id, child_id)
        if 삽화 is not None:
            return 삽화
    return None
