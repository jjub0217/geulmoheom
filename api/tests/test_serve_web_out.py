"""정적 빌드를 띄우기 전에 **낡았는지 본다** (2026-09-09 프론트 제안).

**오늘 두 번 났고 둘이 거울상이다.**
· PM — **시각은 최신인데 대상이 다른 빌드**(`/api/v1` 상대 경로, e2e 하네스용)
· 프론트 — **대상은 맞는데 시각이 낡은 빌드**(화면을 고치고 안 구웠다)

**둘 다 `out/` 을 열어봐서는 안 갈린다.** 하나는 번들 내용을, 하나는 시각을 봐야 한다.
프론트는 자기 쪽(`e2e:static`)을 막았지만 **`make build-out` → `serve-out` 경로는
그 가드를 안 지난다.** 막을 수 있는 자리가 **띄우는 쪽 하나**다.
"""

from pathlib import Path

from scripts.serve_web_out import 낡았나, 대상이맞나


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


# ── 대상 검사 — 낡음과 정반대 방향이다 ──────────────────
#
# 2026-09-09 프론트 지적. **「같은 검사를 양쪽에 두면 한쪽이 틀린다」가 여기엔 안 맞는다** —
# 두 검사가 **정반대**다. e2e 하네스는 **상대 경로여야** 하고(같은 오리진에서 가로챈다),
# 여기는 **절대 주소여야** 한다(정적 서버에 api 가 없다).
# 상대 경로 빌드를 이 서버에 올리면 **자기 오리진으로 `/api/v1` 을 불러 전부 404** 다 —
# **화면은 뜨는데 아무것도 안 되는** 상태이고 「JS 가 안 산다」와 증상이 겹친다.


def test_상대_경로로_구운_빌드는_막는다(tmp_path: Path):
    """번들러가 **백틱 템플릿**으로 인라인한다 — `"/api/v1"` 로만 찾으면 못 찾는다."""
    _파일(tmp_path / "chunks" / "a.js", 1000)
    (tmp_path / "chunks" / "a.js").write_text("async function l(e,r){let i=`/api/v1${e}`;}")

    assert 대상이맞나(tmp_path)


def test_절대_주소로_구운_빌드는_통과한다(tmp_path: Path):
    _파일(tmp_path / "chunks" / "a.js", 1000)
    (tmp_path / "chunks" / "a.js").write_text(
        "let i=`https://osejin-ui-macbookpro.local:8000/api/v1${e}`;"
    )

    assert 대상이맞나(tmp_path) is None


def test_주소를_아예_못_찾으면_막는다(tmp_path: Path):
    """**조용히 통과시키지 않는다.** 못 찾았다는 것은 빌드 모양이 바뀌었다는 뜻이고,
    그때 통과시키면 이 검사가 그날부터 아무것도 안 잰다."""
    _파일(tmp_path / "chunks" / "a.js", 1000)
    (tmp_path / "chunks" / "a.js").write_text("console.log(1)")

    assert 대상이맞나(tmp_path)
