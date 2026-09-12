"""서버를 **진짜로 태워서** 한 갈래를 통과시킨다 (`주차계획/W5.md` 백엔드 1번).

**이건 「E2E 를 늘리는 것」이 아니다.** 나머지 검사는 `TestClient` 로 앱 객체를 직접
부르고, 프론트 e2e 는 브라우저에서 api 를 가로챈다 — **둘 다 진짜 서버를 안 태운다.**
여기서만 `uvicorn` 이 뜨고, 그래서 **프로세스 경계에서만 나는 것**이 잡힌다:
기동 순서 · 설정 읽기 · 쿠키가 실제 응답 헤더로 나가는 것 · 라우팅 접두사.

**⛔ 돈이 걸린 자리다.** api 를 진짜로 태우면 묘사 평가가 **매 실행마다 유료 호출**이
될 수 있고, **그건 초록으로 지나간다**(응답이 오니까). 그래서 둘을 세웠다.

1. **가짜 앞단으로 주소를 돌린다** (`GEMINI_BASE_URL`). 분기가 아니라 주소다
2. **`GEMINI_API_KEY` 에 못 쓰는 값을 넣는다.** 가짜를 안 지난 호출은 **과금이 아니라
   `400 INVALID_ARGUMENT`(`API_KEY_INVALID`)로 죽는다** (`tests/fake_gemini.못쓰는키`)

**그 둘이 실제로 섰는지는 등급으로 문다.** 가짜는 **G3** 를 주고 폴백은 **G1** 이다 —
`tier == "legendary"` 가 나왔다는 것은 **가짜가 답했다**는 뜻이다. 호출이 진짜 구글로
나갔다면 못 쓰는 키라 거절당하고 폴백 등급이 나온다. **「200 이 왔다」로는 못 가른다.**

**기본 실행에서 빠진다** — `uv run pytest -m 느린`. 서버를 띄우고 기다리는 값이 있어
매 저장마다 돌 것이 아니고, **빠른 잡과 섞으면 그 느림이 다음에 또 미루는 이유**가 된다.
"""

import os
import socket
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

from tests.fake_gemini import 가짜앞단, 못쓰는키

API_ROOT = Path(__file__).resolve().parents[1]

pytestmark = pytest.mark.느린

문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


def _쿠키를_옮긴다(손님: httpx.Client, 응답: httpx.Response) -> None:
    """응답의 `Set-Cookie` 를 클라이언트로 옮긴다. **`Secure` 를 떼고 옮기는 것이 요점**이다.

    우리 인증 쿠키는 `__Host-` 라 **`Secure` 가 강제**인데(`app/auth.py`) 이 검사는
    `http://127.0.0.1` 로 붙는다. 표준 쿠키 항아리는 그 조합에서 **보관은 하고 보내지는
    않아서**, 가입은 201 인데 다음 요청이 401 이 된다. `공통규약.md` 148행이
    「`Secure` 쿠키가 `http://localhost` 에 붙는지는 브라우저마다 갈린다」고 적어 둔 자리다.

    **정책을 푼 항아리를 클라이언트에 넘기는 길은 막혀 있다** — httpx 는 요청을 만들 때
    `Cookies(self.cookies)` 로 **항아리를 새로 만들어 쿠키만 옮겨 담아서** 정책이 버려진다
    (2026-09-12 실측: 정책은 내 것인데 `Cookie` 헤더가 안 붙는다). 그래서 **옮기는 쪽**을
    명시한다 — 브라우저가 보관했다는 사실만 흉내 내고 전송 규칙은 건드리지 않는다.

    **서버에 TLS 를 붙이는 길은 안 골랐다** — mkcert 가 깔린 기계에서만 도는 검사가 되어
    다음 칸(CI 느린 잡)에서 막힌다.

    **`Secure` 를 서버가 실제로 굽는지는 따로 잰다** — 아래 검사가 `set-cookie` 헤더를 본다.
    """
    for 줄 in 응답.headers.get_list("set-cookie"):
        이름, _, 값 = 줄.split(";", 1)[0].partition("=")
        손님.cookies.set(이름.strip(), 값.strip())


def _빈포트() -> int:
    """0 번으로 열어 커널이 준 번호를 받고 닫는다. **고정 포트를 쓰지 않는다** —
    개발 서버(8000)와 부딪히면 **남의 서버를 상대로 검사가 돈다.**"""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture
def 태운서버() -> Iterator[tuple[str, 가짜앞단]]:
    """`uvicorn` 을 자식 프로세스로 띄우고 `/healthz` 가 답할 때까지 기다린다."""
    with 가짜앞단() as 앞단:
        포트 = _빈포트()
        환경 = {
            **os.environ,
            "APP_ENV": "dev",
            # **`conftest` 에서 값을 가져오지 않는다.** `from tests.conftest import ...` 를
            # 쓰면 conftest 가 `conftest` 와 `tests.conftest` **두 이름으로 두 번 실행**되고,
            # 그 두 번째가 이미 `_test` 가 붙은 주소에 `_test` 를 또 붙여
            # `geulmoheom_test_test` 를 문다. 2026-09-12 에 실제로 밟았다.
            # **conftest 가 이미 환경에 세워 둔 값을 그대로 읽는다.**
            "DATABASE_URL": os.environ["DATABASE_URL"],
            "JWT_SECRET": os.environ["JWT_SECRET"],
            # **여기가 이 파일의 핵심 두 줄이다.**
            "GEMINI_BASE_URL": 앞단.base_url,
            "GEMINI_API_KEY": 못쓰는키,
            "EVALUATOR_MODEL": "gemini-3.1-flash-lite",
            # 가짜는 **모델 이름에 `image` 가 드는가**로 갈래를 나눈다 (`adr/0006`).
            "IMAGE_MODEL": "gemini-3.1-flash-lite-image",
            # `[tool.uv] package = false` 라 앱이 설치되지 않는다. 컨테이너와 같은 방식이다.
            "PYTHONPATH": str(API_ROOT),
        }
        서버 = subprocess.Popen(
            ["uv", "run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(포트)],
            cwd=API_ROOT,
            env=환경,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        주소 = f"http://127.0.0.1:{포트}"
        try:
            _기다린다(서버, 주소)
            yield 주소, 앞단
        finally:
            서버.terminate()
            try:
                서버.wait(timeout=10)
            except subprocess.TimeoutExpired:
                서버.kill()


def _기다린다(서버: subprocess.Popen, 주소: str, 초: float = 40) -> None:
    """`/healthz` 가 답할 때까지. **죽었으면 기다리지 않고 이유를 보여준다** —
    안 그러면 「40초 뒤 타임아웃」만 남고 왜 안 떴는지가 사라진다."""
    끝 = time.monotonic() + 초
    while time.monotonic() < 끝:
        if 서버.poll() is not None:
            stderr = 서버.stderr.read().decode() if 서버.stderr else ""
            raise RuntimeError(f"서버가 뜨다 죽었다 (exit {서버.returncode})\n{stderr}")
        try:
            if httpx.get(f"{주소}/healthz", timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    raise RuntimeError("서버가 제한 시간 안에 안 떴다")


def test_가입부터_책까지_한_갈래가_진짜_서버를_지난다(태운서버: tuple[str, 가짜앞단]):
    """가입(E-3) → 카드 → 문장 → 등급(B-2) → 그림(B-3) → 책(A0-4).

    **한 갈래다. 나누지 않는다** — 쪼개면 서버를 두 번 띄우고, 그 느림이 곧
    「다음에 또 미루는 이유」가 된다 (`주차계획/W5.md` 백엔드 1번).
    """
    주소, 앞단 = 태운서버
    이메일 = f"e2e-{os.urandom(6).hex()}@example.test"

    with httpx.Client(base_url=f"{주소}/api/v1", timeout=30) as 손님:
        가입 = 손님.post(
            "/parents/signup", json={"email": 이메일, "password": "비밀번호", "consent": True}
        )
        assert 가입.status_code == 201
        # **쿠키가 진짜 응답 헤더로, 속성까지 붙어 나왔는가.** `TestClient` 로는 이 자리가
        # 안 잡힌다. 아래 `_쿠키를_옮긴다` 가 `Secure` 를 떼고 옮기므로 **여기서 확인한다.**
        구운것 = 가입.headers.get("set-cookie", "")
        assert "__Host-gm_parent" in 구운것
        assert "Secure" in 구운것 and "HttpOnly" in 구운것 and "SameSite=Lax" in 구운것
        _쿠키를_옮긴다(손님, 가입)

        자녀 = 손님.post("/parents/children", json={"nickname": "민준", "age_band": 11})
        assert 자녀.status_code == 201, 자녀.text

        들어감 = 손님.post("/child/auth", json={"access_code": 자녀.json()["access_code"]})
        assert 들어감.status_code == 200, 들어감.text
        _쿠키를_옮긴다(손님, 들어감)

        카드 = 손님.get("/cards/next")
        assert 카드.status_code == 200, 카드.text
        card_id = 카드.json()["card_id"]

        시도 = 손님.post("/attempts", json={"card_id": card_id, "text": 문장})
        assert 시도.status_code == 200, 시도.text
        몸통 = 시도.json()
        assert 몸통["outcome"] == "result"
        # **가짜가 답했다는 증거다.** 진짜 구글로 나갔다면 못 쓰는 키라 거절당하고
        # 폴백 등급(G1 → `basic`)이 나온다. **200 만 보면 그 둘이 같은 초록**이다.
        assert 몸통["tier"] == "legendary"
        assert 앞단.받은경로, "가짜 앞단이 한 번도 안 불렸다 — 유료 호출이 나갔을 수 있다"

        # **그림은 굽지 않는다**(W5 7번) — 캐시에 없으면 기본 에셋으로 확정된다.
        # 여기서 재는 것은 「무슨 그림인가」가 아니라 **주소가 실제로 바이트를 준다**는 것이다.
        주소값 = 몸통["artwork"]["url"]
        assert 주소값.startswith("/api/v1/artworks/"), "상대 경로여야 한다 (`adr/0012`)"
        그림 = 손님.get(주소값.removeprefix("/api/v1"))
        assert 그림.status_code == 200
        assert 그림.headers["content-type"].startswith("image/")
        assert len(그림.content) > 0

        책 = 손님.get("/book")
        assert 책.status_code == 200

    페이지 = 책.json()["pages"]
    assert [p["source_id"] for p in 페이지] == [card_id]
    # **아이 원문 그대로다** (PRD 1.1b).
    assert 페이지[0]["text"] == 문장
