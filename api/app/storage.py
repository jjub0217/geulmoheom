"""삽화 저장 — **AWS S3** (2026-09-12 에 Cloudflare R2 에서 갈았다. ADR 은 PM 몫).

**서명을 직접 짜지 않고 클라이언트를 쓴다.** R2 도 S3 호환이라 부르는 코드는 같았고,
갈아탈 때 바뀐 것은 **엔드포인트와 리전 두 값**뿐이다. 이 저장소가 `pyjwt` 를
넣은 것과 같은 이유다 — SigV4 는 손으로 짜면 조용히 틀리는 자리다.

**자격증명이 없으면 `None` 을 돌려준다. 예외를 내지 않는다.** 부르는 쪽은 그것을
「기본 에셋으로 간다」로 읽는다 — 저장소 설정 하나 때문에 아이의 플레이가 멈추지
않는다 (PRD B-3 「플레이 중단 없음」).

**자격증명이 안 채워져 있으면 로컬 디스크로 떨어진다** (2026-09-08 PM 결정, W4 ②).
자격증명 발급은 「대표 몫」인데 **프리테스트가 그 응답 시각에 묶이면 안 된다** —
아동 3명이 보는 것이 「썼더니 그림이 나왔다」이고, 저장할 곳이 없으면 생성은 되고
보여줄 수가 없다. **자격증명이 오면 설정만 바뀐다.**

**로컬은 개발·프리테스트용이다.** 파일럿에서 그리로 떨어지면 삽화가 컨테이너와 함께
사라지므로, 자격증명과 리전을 `config.PILOT_REQUIRED` 에 넣어 **파일럿은 기동 자체가 막히게** 했다.

**버킷은 공개하지 않는다. api 가 프록시한다** (2026-09-08 대표 판정, 미결 11-7 ·
`Stage0.md` 5절). 그래서 **여기는 URL 을 만들지 않는다** — `올리기()` 가 돌려주는 것은
**오브젝트 키**이고, 그것이 `artworks.r2_key` 에 그대로 들어간다. URL 을 만드는 것은
프록시 엔드포인트의 일이다.

**저장소 주소를 클라이언트에 내보내지 않는다.** 「내 책」의 `visibility` 는 Stage 0 에서
항상 `private` 인데, 공개 버킷이면 **URL 하나로 그 `private` 이 무너진다.**
"""

import asyncio
import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass
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


# 저장소가 없을 때 떨어질 자리. `.gitignore` 에 있다 — **아이 창작물이라 저장소에 안 들어간다.**
로컬보관함 = REPO_ROOT / ".artworks"


def 설정됐나() -> bool:
    """셋이 다 있어야 한다. **하나라도 비면 안 켜진 것이다** — 반쯤 설정된 상태로
    올리려 들면 실패가 업로드 시점까지 미뤄져 아이가 기다린 뒤에 드러난다."""
    s = get_settings()
    return bool(
        s.s3_access_key_id.get_secret_value()
        and s.s3_secret_access_key.get_secret_value()
        and s.s3_region
    )


def 조합키(card_id: str, tier: str, mime: str) -> str | None:
    """**카드+티어 하나에 파일 하나.** 같은 조합이면 늘 같은 키다 (W5 7번 ①).

    **결정론적이어야 캐시가 성립한다** — 난수를 붙이면 다음에 못 찾아 또 굽는다.
    Stage 0 삽화에 **아이 입력이 안 들어가서** 가능한 일이다(PRD B-5): 프롬프트
    재료가 카드+티어+화풍+가이드뿐이라 **조합이 60가지로 유한**하다.

    **그러면서 추측 가능해지지는 않는다.** 예전 `키()` 가 `artwork_id` 뒤에 난수를
    붙인 이유가 **「id 를 아는 사람이 곧 그림을 볼 수 있는 사람이 되지 않게」**였는데,
    카드 id·티어는 사실상 공개값이라 그대로 쓰면 그 이유가 깨진다. 그래서 **난수 대신
    비밀에서 유도한 조각**을 붙인다 — 같은 조합이면 같고, 비밀 없이는 못 만든다.

    **비밀이 바뀌면 키가 전부 바뀐다** — 캐시가 비고 다시 굽는다. 틀리는 방향이
    「못 찾아서 다시 굽는다」라 안전한 쪽이다.
    """
    확 = 확장자.get(mime)
    if not 확:
        logger.warning("모르는 이미지 형식이라 저장하지 않는다: %s", mime)
        return None
    return _키(card_id, tier, 확)


def _키(card_id: str, tier: str, 확: str) -> str:
    """**만드는 쪽과 찾는 쪽이 같은 문자열을 써야 한다.** 두 군데에 적어 두면
    한쪽만 바뀌고, 그러면 **못 찾아서 통째로 기본 에셋**이 된다."""
    return f"artworks/{card_id}_{tier}-{_조각(card_id, tier)}.{확}"


def 시도키(artwork_id: uuid.UUID, mime: str) -> str | None:
    """**아이 문장으로 구운 그림 한 장**의 키 (`adr/0015` ②). 모르는 형식이면 `None`.

    **⛔ 조합 키에 올리지 않는다.** 조합 키는 **카드+티어 하나에 파일 하나**라 여러
    아이가 같이 본다 — 거기 덮으면 **한 아이의 그림이 다른 아이에게 캐시 히트로
    나가고**, 깔아 둔 `legendary` 18장도 덮인다. 문장으로 구운 것은 그 아이의 것이다.

    **결정론적이다** — 다시 구우면 같은 자리에 덮는다. 난수면 실패한 굽기가 쓰레기
    파일을 남기고, 그걸 지우는 코드를 또 세워야 한다.

    **그러면서 id 만으로 맞출 수 없다** — `artwork_id` 는 응답에 실려 나가는 값이라
    (`ArtworkRef`) 그것만으로 키가 되면 **id 를 아는 사람이 곧 그림을 볼 수 있는
    사람**이 된다. `조합키` 와 같은 이유로 **비밀에서 유도한 조각**을 붙인다.
    """
    확 = 확장자.get(mime)
    if not 확:
        logger.warning("모르는 이미지 형식이라 저장하지 않는다: %s", mime)
        return None
    return f"artworks/시도/{artwork_id}-{_조각('시도', str(artwork_id))}.{확}"


def _조각(*부분: str) -> str:
    """키 재료에서 유도한 16자. **비밀이 없으면 고정 문자열로 떨어진다** — 개발·테스트가
    그 상태이고, 그때는 그냥 「추측 가능한 키」가 된다. 비공개 버킷 + 프록시라
    거기서 새는 것은 없다.

    **재료를 `/` 로 잇는다.** 조합 키는 `("c01", "basic")`, 시도 키는
    `("시도", artwork_id)` 다 — **둘이 같은 문자열을 만들 수 없어야** 한 쪽 키가
    다른 쪽 자리를 덮지 않는다.
    """
    비밀 = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(비밀, "/".join(부분).encode(), hashlib.sha256).hexdigest()[:16]


@dataclass(frozen=True)
class 찾은삽화:
    """`조합찾기()` 가 찾은 것.

    `티어폴백` 이면 **요청한 티어가 아니라 같은 카드의 `legendary`** 다. 부르는 쪽은
    그것을 `artworks.fallback = true` 로 옮긴다 — **아이에게는 안 알리고**, 어느
    종류의 폴백인지는 서버 로그에만 남는다 (`주차계획/W5.md` 「삽화」).
    """

    키: str
    티어폴백: bool


async def 조합찾기(card_id: str, tier: str) -> 찾은삽화 | None:
    """가리킬 파일이 있으면 그것, 없으면 `None`.

    **찾는 순서가 둘이다** (W5 7번 ①, 2026-09-09).

    1. **요청한 티어** — 있으면 그대로. 폴백이 아니다
    2. **같은 카드의 `legendary`** — **신규 생성을 하지 않기로 확정**되면서
       (`주차계획/W5.md` 「삽화 — 기존 것 재사용 + 티어 폴백」) 갖고 있는 파일이
       `legendary` 뿐이라 생긴 갈래다. **티어가 바꾸는 것은 접미어(밀도)뿐이고
       장면은 같으므로**, 같은 카드 안에서는 밀도가 다른 그림이 나가는 것이지
       엉뚱한 그림이 나가는 것이 아니다
    3. 둘 다 없으면 `None` — 부르는 쪽이 **기본 에셋**으로 간다

    **⚠ `legendary` 키를 새로 계산한다.** 키에 `_조각(card_id, tier)` 가 들어가서
    **티어마다 문자열이 통째로 다르다** — 확장자만 바꿔 훑어서는 안 걸린다.

    **카드를 넘어가지 않는다.** 다른 카드의 그림은 폴백이 아니라 **아이가 쓴 것과
    다른 장면**이다.

    **확장자를 훑는다.** 프로바이더가 무엇을 줄지 우리가 짐작하지 않는다는 규칙이
    그대로라(`확장자` 주석), 어느 확장자로 저장됐는지는 **찾아봐야 안다.**

    **DB 를 안 본다 — 파일을 본다.** 미리 넣어 둔 것은 **행 없이 파일만** 올라오므로
    (`scripts/install_legendary.py`), 행으로 찾으면 그것들이 통째로 안 걸린다.
    """
    if (키 := await _티어에서찾기(card_id, tier)) is not None:
        return 찾은삽화(키, 티어폴백=False)

    if tier != "legendary" and (키 := await _티어에서찾기(card_id, "legendary")) is not None:
        return 찾은삽화(키, 티어폴백=True)

    return None


async def _티어에서찾기(card_id: str, tier: str) -> str | None:
    for 확 in dict.fromkeys(확장자.values()):
        키 = _키(card_id, tier, 확)
        if await 있나(키):
            return 키
    return None


async def 있나(오브젝트키: str) -> bool:
    """그 키에 파일이 있나. **없거나 못 물어보면 `False`** — 예외를 밖으로 내지 않는다.

    **틀리는 방향이 정해져 있다**: 모르면 「없다」이고, 그러면 **한 번 더 굽는다.**
    반대로 틀리면 **없는 파일을 가리키는 `ready` 행**이 생기고 아이 화면에 빈 액자가 뜬다.
    """
    if not 설정됐나():
        return 로컬경로(오브젝트키) is not None
    try:
        await asyncio.to_thread(
            _클라이언트().head_object, Bucket=get_settings().s3_bucket, Key=오브젝트키
        )
        return True
    except Exception:
        # **예외 메시지를 안 싣는다** — botocore 는 요청 정보를 통째로 문자열에 담는다.
        # 「없음(404)」과 「못 물어봄」을 여기서 안 가른다. 둘 다 「없다」로 다뤄야
        # 위 주석의 틀리는 방향이 지켜진다.
        return False


@lru_cache
def _클라이언트() -> Any:
    import boto3

    s = get_settings()
    return boto3.client(
        "s3",
        aws_access_key_id=s.s3_access_key_id.get_secret_value(),
        aws_secret_access_key=s.s3_secret_access_key.get_secret_value(),
        # **안 주면 botocore 가 환경·메타데이터를 뒤지다 늦게 실패한다.** 그래서
        # `PILOT_REQUIRED` 가 리전을 기동에서 막는다.
        region_name=s.s3_region,
        # **비어 있으면 AWS 다** — boto3 가 리전으로 주소를 만든다. 채우면 그리로 간다
        # (R2 로 되돌릴 때 쓰는 손잡이. `app/config.py` `s3_endpoint_url`).
        **({"endpoint_url": s.s3_endpoint_url} if s.s3_endpoint_url else {}),
    )


async def 올리기(오브젝트키: str, image: bytes, mime: str) -> str | None:
    """올리고 **오브젝트 키**를 돌려준다. **실패하면 `None`** — 예외를 밖으로 내지 않는다.

    **키를 여기서 만들지 않는다** (2026-09-09). 부르는 쪽이 `조합키()` 로 만들어 넘긴다 —
    같은 조합이면 같은 키여야 캐시가 성립하고, 그 판단은 **무엇을 굽는지 아는 쪽**에 있다.

    **URL 이 아니다.** 저장소가 S3 든 로컬이든 같은 키가 나오고, 그 키가
    `artworks.r2_key` 에 들어간다. 클라이언트가 보는 주소는 프록시가 만든다.

    boto3 는 동기라 스레드로 넘긴다. 여기서 이벤트 루프를 잡으면 **같은 워커의 다른
    아이들이 함께 멈춘다** — 업로드는 네트워크 왕복이라 짧지 않다.
    """
    if not 설정됐나():
        # **오류가 아니다.** 저장소 자격증명이 아직 안 채워졌다.
        return await _로컬에(오브젝트키, image)

    try:
        await asyncio.to_thread(
            _클라이언트().put_object,
            Bucket=get_settings().s3_bucket,
            Key=오브젝트키,
            Body=image,
            ContentType=mime,
        )
    except Exception as exc:
        # **예외 메시지를 싣지 않는다.** botocore 는 요청 정보를 통째로 문자열에 담는다.
        logger.warning("삽화 저장 실패", extra={"exc_type": type(exc).__name__})
        return None

    return 오브젝트키


async def _로컬에(오브젝트키: str, image: bytes) -> str | None:
    """저장소가 없을 때의 자리. **개발·프리테스트용이다.**

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

    logger.info("저장소가 없어 삽화를 로컬에 저장했다")
    return 오브젝트키


def 로컬경로(오브젝트키: str) -> Path | None:
    """`로컬URL()` 의 짝. **보관함 밖으로 나가는 키를 거부한다** — `../` 한 조각이면
    서버의 아무 파일이나 읽힌다. 키를 우리가 만들었다는 것에 기대지 않는다.
    """
    경로 = (로컬보관함 / 오브젝트키).resolve()
    if not 경로.is_relative_to(로컬보관함.resolve()):
        logger.warning("보관함 밖을 가리키는 키를 거부했다")
        return None
    return 경로 if 경로.is_file() else None


async def 읽기(오브젝트키: str) -> bytes | None:
    """프록시가 내보낼 바이트. **없거나 실패하면 `None`.**

    **저장한 곳에서 읽는다** — 자격증명이 있으면 S3, 아니면 로컬. `올리기()` 와 짝을
    맞춘다. 여기서 갈라지면 **자격증명이 온 날 예전 삽화가 통째로 안 보인다.**
    """
    if not 설정됐나():
        경로 = 로컬경로(오브젝트키)
        if 경로 is None:
            return None
        try:
            return await asyncio.to_thread(경로.read_bytes)
        except OSError as exc:
            logger.warning("삽화 로컬 읽기 실패", extra={"exc_type": type(exc).__name__})
            return None

    try:
        응답 = await asyncio.to_thread(
            _클라이언트().get_object,
            Bucket=get_settings().s3_bucket,
            Key=오브젝트키,
        )
        return await asyncio.to_thread(응답["Body"].read)
    except Exception as exc:
        # **예외 메시지를 싣지 않는다.** botocore 는 요청 정보를 통째로 문자열에 담는다.
        logger.warning("삽화 읽기 실패", extra={"exc_type": type(exc).__name__})
        return None


def mime추측(오브젝트키: str) -> str:
    """키의 확장자에서 되돌린다. **저장할 때 우리가 붙인 것**이라 믿을 수 있다 —
    `키()` 가 아는 셋 밖의 확장자는 애초에 저장되지 않았다.
    """
    확 = 오브젝트키.rsplit(".", 1)[-1]
    for mime, 알던확 in 확장자.items():
        if 알던확 == 확:
            return mime
    return "application/octet-stream"
