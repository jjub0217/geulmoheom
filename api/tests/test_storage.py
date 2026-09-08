"""삽화 저장 (B-3). **네트워크를 타지 않는다** — boto3 호출을 갈아끼운다.

지키는 것 넷.

1. **자격증명이 없으면 로컬로 떨어진다** — 아이의 플레이가 저장소 설정에 안 묶인다
   (2026-09-08 PM 결정 · 프리테스트가 대표 응답 시각에 묶이면 안 된다)
2. **키가 `artwork_id` 만으로 만들어지지 않는다** — id 는 응답에 실려 나간다
3. **로컬 경로가 보관함 밖으로 못 나간다** — 키를 우리가 만들었다는 것에 안 기댄다
4. **실패 로그에 botocore 예외 문자열이 안 실린다** — 요청 정보가 통째로 들어 있다
"""

import asyncio
import logging

import pytest
from pydantic import SecretStr

from app import storage
from app.config import get_settings
from app.storage import 공개URL, 설정됐나, 올리기, 키

이미지 = b"\x89PNG\r\n\x1a\n" + b"0" * 64


@pytest.fixture
def 설정됨(monkeypatch: pytest.MonkeyPatch):
    """R2 넷을 채운 설정. **`.env` 를 안 건드린다.**"""
    s = get_settings()
    monkeypatch.setattr(s, "r2_account_id", "acct", raising=False)
    monkeypatch.setattr(s, "r2_access_key_id", SecretStr("키"), raising=False)
    monkeypatch.setattr(s, "r2_secret_access_key", SecretStr("비밀"), raising=False)
    monkeypatch.setattr(s, "r2_public_base_url", "https://img.geulmoheom.test/", raising=False)
    monkeypatch.setattr(s, "r2_bucket", "geulmoheom-artworks", raising=False)
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


@pytest.mark.parametrize(
    "빈칸", ["r2_account_id", "r2_access_key_id", "r2_secret_access_key", "r2_public_base_url"]
)
def test_하나라도_비면_안_켜진_것이다(설정됨, monkeypatch, 빈칸):
    """반쯤 설정된 채로 올리려 들면 실패가 업로드 시점까지 미뤄진다 —
    **아이가 6~8초 기다린 뒤에** 드러난다."""
    빈값 = SecretStr("") if "key" in 빈칸 else ""
    monkeypatch.setattr(설정됨, 빈칸, 빈값, raising=False)

    assert not 설정됐나()


# ── 키 ──────────────────────────────────────────────────


def test_키가_artwork_id_만으로_안_만들어진다():
    """`artwork_id` 는 API 응답에 실려 나간다. 그것만으로 키가 되면 **id 를 아는
    사람이 곧 그림을 볼 수 있는 사람**이 된다 (접근 정책 미정, PM 확인 중)."""
    첫, 둘 = 키("a1", "image/png"), 키("a1", "image/png")

    assert 첫 != 둘
    assert 첫.startswith("artworks/a1-") and 첫.endswith(".png")


@pytest.mark.parametrize(
    ("mime", "확"), [("image/png", "png"), ("image/jpeg", "jpg"), ("image/webp", "webp")]
)
def test_확장자는_프로바이더가_준_mime_에서_온다(mime, 확):
    """**짐작하지 않는다.** 목 픽스처가 `.webp` 라고 실제로 webp 가 오는 것은 아니다."""
    assert 키("a1", mime).endswith(f".{확}")


def test_모르는_형식은_저장하지_않는다():
    """확장자가 틀리면 브라우저가 다운로드로 처리해 그림이 안 뜨고, **그 실패는 조용하다.**"""
    assert 키("a1", "image/heic") is None
    assert 키("a1", "") is None


# ── 올리기 ──────────────────────────────────────────────


def test_올리면_공개_URL_을_돌려준다(설정됨, monkeypatch):
    받은 = _올림(monkeypatch)

    url = asyncio.run(올리기("a1", 이미지, "image/png"))

    assert len(받은) == 1
    보낸 = 받은[0]
    assert 보낸["Bucket"] == "geulmoheom-artworks"
    assert 보낸["Body"] == 이미지
    assert 보낸["ContentType"] == "image/png"
    # 슬래시가 겹치지 않는다 — base url 끝의 `/` 를 떼고 붙인다
    assert url == 공개URL(보낸["Key"]) == f"https://img.geulmoheom.test/{보낸['Key']}"


def test_모르는_형식이면_올리지_않는다(설정됨, monkeypatch):
    받은 = _올림(monkeypatch)

    assert asyncio.run(올리기("a1", 이미지, "image/heic")) is None
    assert not 받은


def test_실패하면_None_이고_예외가_안_샌다(설정됨, monkeypatch, caplog):
    """botocore 예외는 **요청 정보를 통째로 문자열에 담는다.** 타입만 남긴다."""
    비밀 = "AKIA-비밀키-가-예외에-실렸다"
    _올림(monkeypatch, 예외=RuntimeError(비밀))

    with caplog.at_level(logging.WARNING, logger="app.storage"):
        assert asyncio.run(올리기("a1", 이미지, "image/png")) is None

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


def test_R2_가_비면_로컬에_저장한다(보관함, monkeypatch):
    """**프리테스트가 대표 응답 시각에 안 묶인다** (2026-09-08 PM 결정).
    자격증명이 오면 이 경로를 안 탄다."""
    받은 = _올림(monkeypatch)

    url = asyncio.run(올리기("a1", 이미지, "image/png"))

    assert not 받은, "R2 로 올리려 들면 안 된다"
    저장된 = list(보관함.rglob("*.png"))
    assert len(저장된) == 1
    assert 저장된[0].read_bytes() == 이미지
    assert url == f"/artworks/files/artworks/{저장된[0].name}"


def test_R2_가_있으면_로컬을_안_쓴다(설정됨, 보관함, monkeypatch):
    _올림(monkeypatch)

    asyncio.run(올리기("a1", 이미지, "image/png"))

    assert not 보관함.exists()


def test_모르는_형식은_로컬에도_안_남는다(보관함):
    """형식 검사가 두 경로 **앞**에 있다 — 갈라지면 로컬에서만 되는 코드가 생긴다."""
    assert asyncio.run(올리기("a1", 이미지, "image/heic")) is None
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
    url = asyncio.run(올리기("a1", 이미지, "image/png"))
    오브젝트키 = url.removeprefix("/artworks/files/")

    assert storage.로컬경로(오브젝트키).read_bytes() == 이미지
