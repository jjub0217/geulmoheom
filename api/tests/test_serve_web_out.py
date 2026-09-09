"""정적 빌드를 띄우기 전에 **낡았는지 본다** (2026-09-09 프론트 제안).

**오늘 두 번 났고 둘이 거울상이다.**
· PM — **시각은 최신인데 대상이 다른 빌드**(`/api/v1` 상대 경로, e2e 하네스용)
· 프론트 — **대상은 맞는데 시각이 낡은 빌드**(화면을 고치고 안 구웠다)

**둘 다 `out/` 을 열어봐서는 안 갈린다.** 하나는 번들 내용을, 하나는 시각을 봐야 한다.
프론트는 자기 쪽(`e2e:static`)을 막았지만 **`make build-out` → `serve-out` 경로는
그 가드를 안 지난다.** 막을 수 있는 자리가 **띄우는 쪽 하나**다.
"""

from pathlib import Path

from scripts.serve_web_out import 낡았나


def _파일(경로: Path, 시각: float) -> None:
    경로.parent.mkdir(parents=True, exist_ok=True)
    경로.write_text("x")
    import os

    os.utime(경로, (시각, 시각))


def test_소스가_더_새로우면_사유를_돌려준다(tmp_path: Path):
    """**아이가 고치기 전 화면을 본다.** 서버도 주소도 멀쩡해서 겉으로는 아무 문제가 없다."""
    _파일(tmp_path / "out" / "index.html", 1000)
    _파일(tmp_path / "src" / "app" / "page.tsx", 2000)

    assert 낡았나(tmp_path / "out", tmp_path / "src")


def test_빌드가_더_새로우면_통과한다(tmp_path: Path):
    _파일(tmp_path / "out" / "index.html", 2000)
    _파일(tmp_path / "src" / "app" / "page.tsx", 1000)

    assert 낡았나(tmp_path / "out", tmp_path / "src") is None


def test_소스가_없으면_막지_않는다(tmp_path: Path):
    """**없는 것을 근거로 안 막는다.** 여기서 죽으면 띄울 방법이 사라진다."""
    _파일(tmp_path / "out" / "index.html", 1000)

    assert 낡았나(tmp_path / "out", tmp_path / "없는폴더") is None
