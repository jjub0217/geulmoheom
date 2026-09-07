"""도구 체인이 합의된 전제대로 서 있는지 확인한다 (api/README.md 「합의된 전제」)."""

import sys
import tomllib
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent


def test_런타임이_python_312다():
    """시스템 python(3.13)이 아니라 .python-version 이 지정한 3.12 로 돌아야 한다."""
    pinned = (API_ROOT / ".python-version").read_text().strip()
    assert f"{sys.version_info.major}.{sys.version_info.minor}" == pinned


def test_로깅_f_string_규칙이_켜져_있다():
    """G004 를 끄면 아이 원문이 로그로 새는 것을 막는 장치가 사라진다 (api/CLAUDE.md)."""
    config = tomllib.loads((API_ROOT / "pyproject.toml").read_text())
    lint = config["tool"]["ruff"]["lint"]
    assert "G" in lint["select"]
    assert "G004" not in lint.get("ignore", [])


def test_문서_변경에도_api_테스트가_돈다():
    """**api 코드가 PM 문서를 런타임에 읽는다** — 문서만 바꾼 커밋이 서버를 깨뜨릴 수 있다.

    `docs/**` 를 통째로 넣은 것이 핵심이다. 읽는 문서를 나열하면 코드가 다음 문서를
    읽기 시작하는 날 목록이 조용히 낡는다 — **장치가 자기 밖을 잘못 보는 부류**다.
    좁히려는 시도를 여기서 잡는다.
    """
    ci = (API_ROOT.parent / ".github" / "workflows" / "ci.yml").read_text()
    필터 = next(줄 for 줄 in ci.splitlines() if 줄.strip().startswith("api: ["))

    assert "docs/**" in 필터


def test_런타임에_읽는_문서가_전부_docs_아래에_있다():
    """`docs/**` 하나로 덮이는 것이 전제다. 다른 데 있는 문서를 읽기 시작하면 안 덮인다."""
    앱 = API_ROOT / "app"
    읽는곳 = [
        (경로.relative_to(API_ROOT), 줄.strip())
        for 경로 in 앱.rglob("*.py")
        for 줄 in 경로.read_text(encoding="utf-8").splitlines()
        if "REPO_ROOT /" in 줄 and ".md" in 줄
    ]

    assert 읽는곳, "문서를 읽는 곳을 하나도 못 찾았다. 읽는 방식이 바뀌었는지 본다"
    for 경로, 줄 in 읽는곳:
        assert '"docs"' in 줄, f"{경로}: docs/ 밖의 문서를 읽는다 — CI 필터가 안 덮는다 ({줄})"
