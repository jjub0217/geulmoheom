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
