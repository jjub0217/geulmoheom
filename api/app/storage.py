"""삽화 저장 — Cloudflare R2 (`아키텍처 및 구현난의도.md` 구성 표 · `adr/0007`).

R2 는 S3 호환이라 **서명을 직접 짜지 않고 클라이언트를 쓴다.** 이 저장소가 `pyjwt` 를
넣은 것과 같은 이유다 — SigV4 는 손으로 짜면 조용히 틀리는 자리다.

**자격증명이 없으면 `None` 을 돌려준다. 예외를 내지 않는다.** 부르는 쪽은 그것을
「기본 에셋으로 간다」로 읽는다 — 저장소 설정 하나 때문에 아이의 플레이가 멈추지
않는다 (PRD B-3 「플레이 중단 없음」).

**R2 가 안 채워져 있으면 로컬 디스크로 떨어진다** (2026-09-08 PM 결정, W4 ②).
자격증명 발급은 「대표 몫」인데 **프리테스트가 그 응답 시각에 묶이면 안 된다** —
아동 3명이 보는 것이 「썼더니 그림이 나왔다」이고, 저장할 곳이 없으면 생성은 되고
보여줄 수가 없다. **자격증명이 오면 설정만 바뀐다.**

**로컬은 개발·프리테스트용이다.** 파일럿에서 그리로 떨어지면 삽화가 컨테이너와 함께
사라지므로, R2 넷을 `config.PILOT_REQUIRED` 에 넣어 **파일럿은 기동 자체가 막히게** 했다.

**아직 안 정한 것 하나 — 삽화 URL 의 접근 정책.** `r2_public_base_url` 이라는 이름은
공개 버킷을 전제하는데, **삽화는 아이 원문과 같은 창작물**이고 「내 책」의 기본
`visibility` 는 `private` 이다. URL 만 알면 누구나 열린다면 그 `private` 은 이름뿐이다.
**그동안의 대비로 키를 추측 불가능하게 만든다** — 아래 `키()` 참고. 정책이 정해지면
바꿀 자리는 `공개URL()` 하나다 (**미결 11-7**, PM 권고는 api 프록시, 대표 판정 대기).
"""

import asyncio
import logging
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import REPO_ROOT, get_settings

logger = logging.getLogger(__name__)

# 프로바이더가 준 mime → 확장자. **짐작하지 않는다** — 모르는 mime 은 저장하지 않는다.
# 확장자가 틀리면 브라우저가 다운로드로 처리해 그림이 안 뜨고, 그 실패는 조용하다.
확장자: dict[str, str] = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}


# R2 가 없을 때 떨어질 자리. `.gitignore` 에 있다 — **아이 창작물이라 저장소에 안 들어간다.**
로컬보관함 = REPO_ROOT / ".artworks"


def 설정됐나() -> bool:
    """넷이 다 있어야 한다. **하나라도 비면 안 켜진 것이다** — 반쯤 설정된 상태로
    올리려 들면 실패가 업로드 시점까지 미뤄져 아이가 기다린 뒤에 드러난다."""
    s = get_settings()
    return bool(
        s.r2_account_id
        and s.r2_access_key_id.get_secret_value()
        and s.r2_secret_access_key.get_secret_value()
        and s.r2_public_base_url
    )


def 키(artwork_id: str, mime: str) -> str | None:
    """R2 오브젝트 키. **`artwork_id` 뒤에 난수를 붙인다.**

    `artwork_id` 는 API 응답에 실려 나가는 값이라, 그것만으로 키가 되면 **id 를 아는
    사람이 곧 그림을 볼 수 있는 사람**이 된다. 난수 한 조각이 그 둘을 끊는다.
    접근 정책이 서명 URL 로 정해지면 이 난수는 필요 없어지지만, **정해질 때까지의
    기본값은 열어 두는 쪽이 아니라 닫는 쪽이다.**
    """
    확 = 확장자.get(mime)
    if not 확:
        logger.warning("모르는 이미지 형식이라 저장하지 않는다: %s", mime)
        return None
    return f"artworks/{artwork_id}-{uuid.uuid4().hex[:16]}.{확}"


@lru_cache
def _클라이언트() -> Any:
    import boto3

    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=f"https://{s.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=s.r2_access_key_id.get_secret_value(),
        aws_secret_access_key=s.r2_secret_access_key.get_secret_value(),
        # R2 는 리전이 하나다. 안 주면 botocore 가 환경에서 찾다가 실패한다.
        region_name="auto",
    )


def 공개URL(오브젝트키: str) -> str:
    return f"{get_settings().r2_public_base_url.rstrip('/')}/{오브젝트키}"


async def 올리기(artwork_id: str, image: bytes, mime: str) -> str | None:
    """올리고 URL 을 돌려준다. **실패하면 `None`** — 예외를 밖으로 내지 않는다.

    boto3 는 동기라 스레드로 넘긴다. 여기서 이벤트 루프를 잡으면 **같은 워커의 다른
    아이들이 함께 멈춘다** — 업로드는 네트워크 왕복이라 짧지 않다.
    """
    오브젝트키 = 키(artwork_id, mime)
    if not 오브젝트키:
        return None

    if not 설정됐나():
        # **오류가 아니다.** R2 자격증명이 아직 안 채워졌다 (2026-09-08 대표 몫으로 올림).
        return await _로컬에(오브젝트키, image)

    try:
        await asyncio.to_thread(
            _클라이언트().put_object,
            Bucket=get_settings().r2_bucket,
            Key=오브젝트키,
            Body=image,
            ContentType=mime,
        )
    except Exception as exc:
        # **예외 메시지를 싣지 않는다.** botocore 는 요청 정보를 통째로 문자열에 담는다.
        logger.warning("삽화 저장 실패", extra={"exc_type": type(exc).__name__})
        return None

    return 공개URL(오브젝트키)


async def _로컬에(오브젝트키: str, image: bytes) -> str | None:
    """R2 가 없을 때의 자리. **개발·프리테스트용이다.**

    `올리기()` 와 같은 모양의 값을 돌려줘야 부르는 쪽이 두 경우를 안 가른다 —
    가르기 시작하면 **로컬에서만 되는 코드**가 생긴다.
    """
    경로 = 로컬보관함 / 오브젝트키
    try:
        await asyncio.to_thread(경로.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(경로.write_bytes, image)
    except OSError as exc:
        logger.warning("삽화 로컬 저장 실패", extra={"exc_type": type(exc).__name__})
        return None

    logger.info("R2 가 없어 삽화를 로컬에 저장했다")
    return 로컬URL(오브젝트키)


def 로컬URL(오브젝트키: str) -> str:
    """**공개 URL 이 아니다.** 접근 정책(미결 11-7)이 정해질 때까지, 이 경로를 실제로
    서빙하는 자리는 만들지 않는다 — 만들면 그 순간 정책이 「공개」로 굳는다.
    """
    return f"/artworks/files/{오브젝트키}"


def 로컬경로(오브젝트키: str) -> Path | None:
    """`로컬URL()` 의 짝. **보관함 밖으로 나가는 키를 거부한다** — `../` 한 조각이면
    서버의 아무 파일이나 읽힌다. 키를 우리가 만들었다는 것에 기대지 않는다.
    """
    경로 = (로컬보관함 / 오브젝트키).resolve()
    if not 경로.is_relative_to(로컬보관함.resolve()):
        logger.warning("보관함 밖을 가리키는 키를 거부했다")
        return None
    return 경로 if 경로.is_file() else None
