"""OpenAPI 스펙을 파일로 뽑는다. **서버를 띄우지 않는다.**

`make contracts` 는 뜬 서버의 `/openapi.json` 을 받아오지만, CI 는 그러지 않는다.
계약 드리프트 검사 하나 때문에 postgres·redis·인증서까지 세우면 검사가 인프라 상태에
따라 빨개진다 — 스펙은 라우터 정의만으로 결정되므로 `app.openapi()` 를 직접 부른다.
(서버까지 붙는 E2E 는 W4 몫이다.)

FastAPI 의 `/openapi.json` 은 이 `app.openapi()` 결과를 그대로 JSON 으로 내보낸다.
같은 dict 이므로 여기서 뽑은 파일과 서버에서 받은 파일은 같은 타입을 만든다.

실행: `PYTHONPATH=. uv run python scripts/dump_openapi.py <출력경로>`
(`[tool.uv] package = false` 라 프로젝트가 설치되지 않는다 — `app` 을 찾으려면 필요하다)
"""

import json
import sys
from pathlib import Path

from app.main import app


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("사용법: python scripts/dump_openapi.py <출력경로>")

    출력 = Path(sys.argv[1])
    # `ensure_ascii=False` 를 쓰지 않는다. FastAPI 의 `JSONResponse` 가 ASCII 로 이스케이프해
    # 내보내므로, 서버에서 받은 파일과 바이트까지 같게 두려면 기본값 그대로여야 한다.
    출력.write_text(json.dumps(app.openapi()), encoding="utf-8")
    # 표준출력은 비워 둔다 — 파이프로 받는 쪽이 생기면 이 줄이 스펙에 섞인다.
    print(f"→ {출력}", file=sys.stderr)


if __name__ == "__main__":
    main()
