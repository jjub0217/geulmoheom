"""모델과 마이그레이션이 갈라졌는지 본다 (`주차계획/W6.md` 백엔드 2번, 축 ③ 잔여).

**다른 검사가 못 잡는 종류 하나를 잡는다** — `app/models.py` 만 고치고 마이그레이션을
안 남기는 것. `conftest` 가 `create_all` 대신 **마이그레이션을 실제로 돌리기** 때문에
그런 커밋은 「모델에는 있고 DB 에는 없는 열」을 만들고, **그 열을 건드리는 코드가
아직 없으면 450여 개가 전부 초록**이다. 2026-09-07 에 실제로 갈라진 자리가 있었다
(`char_len` 주석).

**CI 가 아니라 여기에 먼저 놓은 이유** — CI 는 2026-09-09 부터 결제로 안 돈다
(`주차계획/W6.md` 「막힌 것」). CI 에만 붙이면 **결제가 풀릴 때까지 아무것도 안 막는다.**
기본 실행에 놓으면 커밋 전 `uv run pytest` 가 그대로 관문이 된다.
**CI 쪽은 따로 선다 — 이 초록으로 그 설정을 때우지 않는다.**

**`alembic check` 을 자식 프로세스로 부른다.** `alembic.command.check()` 를 직접 부르면
`migrations/env.py` 가 그 안에서 `asyncio.run()` 을 돌려, 세션 루프 하나로 고정된
이 하네스와 부딪힌다(`pyproject.toml` `asyncio_default_*_loop_scope`).
`conftest` 의 `alembic upgrade head` 도 같은 이유로 자식 프로세스다.
"""

import os
import subprocess
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]


def test_모델과_마이그레이션이_안_갈린다() -> None:
    """`_스키마` 픽스처가 이미 테스트 DB 를 head 까지 올려 뒀다. 그 위에서 본다.

    **`conftest` 에서 주소를 import 하지 않는다** — `tests.conftest` 를 이름으로 import
    하면 conftest 가 두 번 돌아 `_test` 가 두 번 붙는다(`test_e2e_server.py` 81행).
    **conftest 가 환경에 세워 둔 값을 그대로 읽는다.**
    """
    결과 = subprocess.run(
        ["uv", "run", "alembic", "check"],
        cwd=API_ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, "DATABASE_URL": os.environ["DATABASE_URL"]},
    )
    # **실패 이유를 그대로 보여준다.** `alembic check` 은 갈라진 열·표를 stderr 에
    # 나열하는데, `returncode` 만 보면 「갈라졌다」만 남고 **어디가**가 사라진다.
    assert 결과.returncode == 0, (
        "모델과 마이그레이션이 갈라졌다. "
        "`uv run alembic revision --autogenerate -m '...'` 으로 남기고 커밋한다.\n"
        f"{결과.stdout}\n{결과.stderr}"
    )
