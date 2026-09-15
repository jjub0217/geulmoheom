"""삽화 저장 (B-3). **네트워크를 타지 않는다** — boto3 호출을 갈아끼운다.

지키는 것 넷.

1. **자격증명이 없으면 로컬로 떨어진다** — 아이의 플레이가 저장소 설정에 안 묶인다
   (2026-09-08 PM 결정 · 프리테스트가 대표 응답 시각에 묶이면 안 된다)
2. **키가 `artwork_id` 만으로 만들어지지 않는다** — id 는 응답에 실려 나간다
3. **로컬 경로가 보관함 밖으로 못 나간다** — 키를 우리가 만들었다는 것에 안 기댄다
4. **실패 로그에 botocore 예외 문자열이 안 실린다** — 요청 정보가 통째로 들어 있다
"""

import asyncio
import io
import logging
import uuid

import pytest
from pydantic import SecretStr

from app import storage
from app.config import get_settings
from app.storage import mime추측, 설정됐나, 시도키, 올리기, 읽기, 조합키

이미지 = b"\x89PNG\r\n\x1a\n" + b"0" * 64


@pytest.fixture
def 설정됨(monkeypatch: pytest.MonkeyPatch):
    """R2 넷을 채운 설정. **`.env` 를 안 건드린다.**"""
    s = get_settings()
    monkeypatch.setattr(s, "s3_access_key_id", SecretStr("키"), raising=False)
    monkeypatch.setattr(s, "s3_secret_access_key", SecretStr("비밀"), raising=False)
    monkeypatch.setattr(s, "s3_region", "ap-northeast-2", raising=False)
    monkeypatch.setattr(s, "s3_bucket", "geulmoheom-artworks", raising=False)
    return s


def _올림(monkeypatch: pytest.MonkeyPatch, 예외: Exception | None = None) -> list[dict]:
    """`put_object` 를 갈아끼우고 받은 인자를 모은다."""
    받은: list[dict] = []

    class _가짜:
        def put_object(self, **kw):
            받은.append(kw)
            if 예외:
                raise 예외

    monkeypatch.setattr(storage, "_클라이언트", lambda: _가짜())
    return 받은


# ── 설정 ────────────────────────────────────────────────


def test_지금은_설정이_비어_있다():
    """**현재 상태를 못 박아 둔다.** R2 자격증명 넷이 안 채워졌고 그건 대표 몫이다
    (2026-09-08 올림). 채워지면 이 테스트가 깨지고, **그때 깨지는 것이 맞다** —
    설정이 들어온 것을 알려 주는 장치가 이것뿐이다."""
    assert not 설정됐나()


@pytest.mark.parametrize("빈칸", ["s3_access_key_id", "s3_secret_access_key", "s3_region"])
def test_하나라도_비면_안_켜진_것이다(설정됨, monkeypatch, 빈칸):
    """셋 다 있어야 켜진 것이다. 반쯤 설정된 채로 올리려 들면 실패가 업로드 시점까지 미뤄진다 —
    **아이가 6~8초 기다린 뒤에** 드러난다."""
    빈값 = SecretStr("") if "key" in 빈칸 else ""
    monkeypatch.setattr(설정됨, 빈칸, 빈값, raising=False)

    assert not 설정됐나()


# ── 키 ──────────────────────────────────────────────────


def test_조합_키는_결정론적이되_추측할_수_없다():
    """**2026-09-09 에 `키(artwork_id, mime)` 를 대체했다** (W5 7번 ① lazy 캐시).

    종전 키는 `artwork_id` 뒤에 **난수**를 붙였다 — 이유는 「id 를 아는 사람이 곧
    그림을 볼 수 있는 사람이 되지 않게」였다. 캐시는 **같은 조합이면 같은 키**를
    요구하므로 난수를 못 쓴다. **그 대신 비밀에서 유도한 조각**을 붙여 **두 성질을
    같이 지킨다** — 결정론적이고, 조합만 알아서는 못 만든다.
    """
    첫, 둘 = 조합키("c01", "basic", "image/png"), 조합키("c01", "basic", "image/png")

    assert 첫 == 둘
    assert 첫.startswith("artworks/c01_basic-") and 첫.endswith(".png")
    # **조합만으로 맞출 수 있으면 안 된다.**
    assert 첫 != "artworks/c01_basic.png"


def test_아이_문장으로_구운_것은_조합_키에_안_올라간다():
    """**같은 키에 올리면 한 아이의 그림이 다른 아이에게 나간다** (`adr/0015` ②).

    조합 키는 **카드+티어 하나에 파일 하나**라 여러 아이가 같이 본다. 아이 문장으로
    구운 그림은 **그 아이의 것**이라 그 자리에 덮으면 안 된다 — 덮으면 다음 아이가
    같은 카드를 썼을 때 **남이 쓴 문장으로 그려진 그림**을 캐시 히트로 받는다.
    **그리고 깔아 둔 `legendary` 18장이 아이 그림으로 덮인다.**
    """
    시도 = 시도키(uuid.UUID("11111111-1111-1111-1111-111111111111"), "image/png")

    assert 시도 != 조합키("c01", "legendary", "image/png")
    assert not 시도.startswith("artworks/c01")


def test_시도_키도_결정론적이되_추측할_수_없다():
    """**결정론적이어야 다시 구워도 같은 자리에 덮인다** — 난수면 실패한 굽기가
    쓰레기 파일을 남긴다. **그러면서 id 만으로 맞출 수는 없어야 한다**(`조합키` 와 같은 이유).
    """
    아이디 = uuid.UUID("22222222-2222-2222-2222-222222222222")

    첫, 둘 = 시도키(아이디, "image/png"), 시도키(아이디, "image/png")

    assert 첫 == 둘
    assert 첫.endswith(".png")
    assert 첫 != f"artworks/시도/{아이디}.png"
    assert 시도키(uuid.UUID("33333333-3333-3333-3333-333333333333"), "image/png") != 첫


def test_시도_키도_모르는_형식은_저장하지_않는다():
    assert 시도키(uuid.UUID("44444444-4444-4444-4444-444444444444"), "image/heic") is None


@pytest.mark.parametrize(
    ("mime", "확"), [("image/png", "png"), ("image/jpeg", "jpg"), ("image/webp", "webp")]
)
def test_확장자는_프로바이더가_준_mime_에서_온다(mime, 확):
    """**짐작하지 않는다.** 목 픽스처가 `.webp` 라고 실제로 webp 가 오는 것은 아니다."""
    assert 조합키("c01", "basic", mime).endswith(f".{확}")


def test_모르는_형식은_저장하지_않는다():
    """확장자가 틀리면 브라우저가 다운로드로 처리해 그림이 안 뜨고, **그 실패는 조용하다.**"""
    assert 조합키("c01", "basic", "image/heic") is None
    assert 조합키("c01", "basic", "") is None


# ── 올리기 ──────────────────────────────────────────────


def test_올리면_오브젝트_키를_돌려준다(설정됨, monkeypatch):
    """**URL 이 아니다.** 버킷을 공개하지 않고 api 가 프록시한다 (대표 판정, 미결 11-7) —
    **저장소 주소가 클라이언트로 안 나간다.**"""
    받은 = _올림(monkeypatch)

    키값 = asyncio.run(올리기("artworks/그림.png", 이미지, "image/png"))

    assert len(받은) == 1
    보낸 = 받은[0]
    assert 보낸["Bucket"] == "geulmoheom-artworks"
    assert 보낸["Body"] == 이미지
    assert 보낸["ContentType"] == "image/png"
    assert 키값 == 보낸["Key"]
    assert "http" not in 키값


def test_모르는_형식이면_키가_안_나온다():
    """**막는 자리가 `올리기` 에서 `조합키` 로 옮겨졌다** (2026-09-09). 키를 못 만들면
    부르는 쪽이 올리지 않는다 (`artwork_store.굽기`)."""
    assert 조합키("c01", "basic", "image/heic") is None


def test_실패하면_None_이고_예외가_안_샌다(설정됨, monkeypatch, caplog):
    """botocore 예외는 **요청 정보를 통째로 문자열에 담는다.** 타입만 남긴다."""
    비밀 = "AKIA-비밀키-가-예외에-실렸다"
    _올림(monkeypatch, 예외=RuntimeError(비밀))

    with caplog.at_level(logging.WARNING, logger="app.storage"):
        assert asyncio.run(올리기("artworks/그림.png", 이미지, "image/png")) is None

    기록 = [r for r in caplog.records if r.name == "app.storage"]
    assert 기록
    for r in 기록:
        assert 비밀 not in r.getMessage()
        assert 비밀 not in str(r.__dict__)
        assert r.exc_type == "RuntimeError"


# ── 로컬 폴백 (R2 가 비었을 때) ─────────────────────────


@pytest.fixture
def 보관함(tmp_path, monkeypatch):
    """실제 `.artworks/` 를 안 건드린다."""
    monkeypatch.setattr(storage, "로컬보관함", tmp_path / ".artworks")
    return tmp_path / ".artworks"


def test_저장소가_비면_로컬에_저장한다(보관함, monkeypatch):
    """**프리테스트가 대표 응답 시각에 안 묶인다** (2026-09-08 PM 결정).
    자격증명이 오면 이 경로를 안 탄다."""
    받은 = _올림(monkeypatch)

    키값 = asyncio.run(올리기("artworks/그림.png", 이미지, "image/png"))

    assert not 받은, "R2 로 올리려 들면 안 된다"
    저장된 = list(보관함.rglob("*.png"))
    assert len(저장된) == 1
    assert 저장된[0].read_bytes() == 이미지
    assert 키값 == f"artworks/{저장된[0].name}"


def test_저장소가_있으면_로컬을_안_쓴다(설정됨, 보관함, monkeypatch):
    _올림(monkeypatch)

    asyncio.run(올리기("artworks/그림.png", 이미지, "image/png"))

    assert not 보관함.exists()


def test_모르는_형식은_저장소든_로컬이든_키가_없다(보관함):
    """형식 검사가 **두 경로 앞**에 있다 — 갈라지면 로컬에서만 되는 코드가 생긴다.

    **검사 자리가 옮겨졌다** (2026-09-09). 예전에는 `올리기` 안이었고 지금은 `조합키`다 —
    키가 안 나오면 부르는 쪽이 아예 안 올린다. **앞에 있다는 성질은 그대로**이고,
    오히려 R2·로컬 갈래보다 더 앞이다.
    """
    assert 조합키("c01", "basic", "image/heic") is None
    assert not 보관함.exists()


def test_보관함_밖을_가리키는_키를_거부한다(보관함):
    """`../` 한 조각이면 서버의 아무 파일이나 읽힌다. **키를 우리가 만들었다는 것에
    기대지 않는다** — 경로가 URL 에서 되돌아 들어오는 순간 그 전제가 깨진다."""
    보관함.mkdir(parents=True)
    (보관함.parent / "비밀.txt").write_text("나가면 안 된다")

    assert storage.로컬경로("../비밀.txt") is None
    assert storage.로컬경로("artworks/없는파일.png") is None


def test_로컬경로가_저장한_파일을_찾는다(보관함, monkeypatch):
    _올림(monkeypatch)
    오브젝트키 = asyncio.run(올리기("artworks/그림.png", 이미지, "image/png"))

    assert storage.로컬경로(오브젝트키).read_bytes() == 이미지


# ── 읽기 (프록시가 쓴다) ─────────────────────────────────


def test_로컬에_저장한_것을_되읽는다(보관함, monkeypatch):
    """**저장한 곳에서 읽는다.** 여기서 갈라지면 자격증명이 온 날 예전 삽화가
    통째로 안 보인다."""
    _올림(monkeypatch)
    오브젝트키 = asyncio.run(올리기("artworks/그림.png", 이미지, "image/png"))

    assert asyncio.run(읽기(오브젝트키)) == 이미지


def test_저장소에_저장한_것을_되읽는다(설정됨, monkeypatch):
    class _가짜:
        def put_object(self, **kw):
            pass

        def get_object(self, **kw):
            assert kw["Bucket"] == "geulmoheom-artworks"
            return {"Body": io.BytesIO(이미지)}

    monkeypatch.setattr(storage, "_클라이언트", lambda: _가짜())

    assert asyncio.run(읽기("artworks/a1-abc.png")) == 이미지


def test_없는_것을_읽으면_None(보관함, monkeypatch):
    _올림(monkeypatch)

    assert asyncio.run(읽기("artworks/없다.png")) is None


def test_보관함_밖은_읽기에서도_막힌다(보관함):
    """`로컬경로()` 를 지나야만 읽는다 — 프록시가 키를 URL 에서 받으므로
    **여기가 실제 관문이다.**"""
    보관함.mkdir(parents=True)
    (보관함.parent / "비밀.txt").write_text("나가면 안 된다")

    assert asyncio.run(읽기("../비밀.txt")) is None


def test_저장소_읽기_실패는_예외를_안_낸다(설정됨, monkeypatch, caplog):
    비밀 = "AKIA-비밀키-가-예외에-실렸다"

    class _가짜:
        def get_object(self, **kw):
            raise RuntimeError(비밀)

    monkeypatch.setattr(storage, "_클라이언트", lambda: _가짜())

    with caplog.at_level(logging.WARNING, logger="app.storage"):
        assert asyncio.run(읽기("artworks/a1-abc.png")) is None

    for r in [r for r in caplog.records if r.name == "app.storage"]:
        assert 비밀 not in str(r.__dict__)


@pytest.mark.parametrize(
    ("키값", "mime"),
    [
        ("artworks/a1-x.png", "image/png"),
        ("artworks/a1-x.jpg", "image/jpeg"),
        ("artworks/a1-x.webp", "image/webp"),
        ("artworks/a1-x.exe", "application/octet-stream"),
    ],
)
def test_mime_을_확장자에서_되돌린다(키값, mime):
    """저장할 때 **우리가 붙인 확장자**라 믿을 수 있다 — 아는 셋 밖은 애초에
    저장되지 않았다."""
    assert mime추측(키값) == mime
