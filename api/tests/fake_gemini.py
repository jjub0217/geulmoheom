"""가짜 Gemini 앞단 — **서버 안에서 유료 호출을 끊는 자리**.

E2E 가 api 를 진짜로 태우면 묘사 평가·이미지 생성이 **매 실행마다 돈을 쓴다.**
그래서 그 둘만 여기로 보낸다 (`주차계획/W5.md` 백엔드 1번).

**분기가 아니라 주소다.** 제품 코드에는 `if TESTING:` 이 없고, 설정의 base URL 이
비어 있으면 오늘과 완전히 같은 곳으로 간다 — R2 를 안 채우면 로컬 디스크로
떨어지는 것과 같은 자리다.

**아이 원문을 기록하지 않는다.** 받은 요청 본문을 보관하지 않고 경로만 센다 —
테스트 픽스처라도 원문이 파일에 남으면 그건 로그다 (`api/CLAUDE.md`).
"""

from __future__ import annotations

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# **E2E 환경이 쓰는 「못 쓰는 키」.** 가짜 앞단을 안 지난 호출이 **과금이 아니라 거절로
# 죽게** 만드는 것이 이 값의 전부다 (`주차계획/W5.md` 완료 판정 1).
#
# **ASCII 여야 한다.** 키는 헤더로 나가서 한글을 넣으면 `UnicodeEncodeError` 로 죽고,
# 그러면 **호출이 나갔는지 아닌지가 안 보인다** (2026-09-09 실측).
#
# **여기 한 군데에만 적는다** — 테스트와 E2E 환경이 같은 값을 써야 「이 값이 못 쓰는
# 값임을 쟀다」가 E2E 에도 걸린다. 두 벌이면 한쪽만 바뀌고 그 사실이 조용하다.
못쓰는키 = "fake-key-not-valid-anywhere"

# 글 응답 기본값. **셋을 한 덩어리로 돌려준다** — 묘사 평가(`판정`)·입력 검사(`검사`)·
# 실명 NER(`실명들`)이 **같은 모델을 부르고** 스키마만 다르다. pydantic 이 모르는 키를
# 무시하므로 한 덩어리가 셋 다 통과한다. **요청 본문을 뜯어 갈래를 나누지 않는다** —
# 그러려면 아이 문장을 읽어야 하고, 픽스처라도 그건 읽지 않는다.
#
# 등급을 **G3 로 둔다** — 폴백 등급(G1)과 달라야 「가짜가 답했다」와 「호출이 실패해
# 폴백했다」가 구분된다.
기본글 = {
    "grade": "G3",
    "signals": ["색", "소리"],
    "descriptors": ["은빛", "살금살금"],
    "block": False,
    "category": "",
    "names": [],
}

# 1x1 PNG. **진짜 이미지 바이트여야 한다** — 제품이 `Pillow` 로 열어 보는 자리가 있다.
_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _본문(응답: dict) -> bytes:
    return json.dumps(응답).encode()


def 글응답(값: dict | None = None) -> dict:
    """`generateContent` 가 구조화 출력을 돌려주는 모양 그대로."""
    안 = json.dumps(값 if 값 is not None else 기본글, ensure_ascii=False)
    return {
        "candidates": [
            {"content": {"role": "model", "parts": [{"text": 안}]}, "finishReason": "STOP"}
        ],
        "usageMetadata": {"promptTokenCount": 1, "candidatesTokenCount": 1, "totalTokenCount": 2},
    }


def 그림응답(바이트: bytes | None = None, mime: str = "image/png") -> dict:
    """이미지 생성 응답. **`inlineData` 로 온다** (`app/artwork.py` 가 그것을 읽는다)."""
    안 = base64.b64encode(바이트 if 바이트 is not None else _PNG).decode()
    return {
        "candidates": [
            {
                "content": {
                    "role": "model",
                    "parts": [{"inlineData": {"mimeType": mime, "data": 안}}],
                },
                "finishReason": "STOP",
            }
        ],
        "usageMetadata": {"promptTokenCount": 1, "candidatesTokenCount": 1, "totalTokenCount": 2},
    }


class 가짜앞단:
    """`with 가짜앞단() as 앞단:` 안에서만 산다. `앞단.base_url` 을 설정에 넣는다.

    **갈래는 주소로 나눈다** — 요청 경로에 모델명이 실려 있고, 이미지 모델 이름에는
    `image` 가 들어간다(`gemini-3.1-flash-lite-image`, `adr/0006`). **본문을 뜯지 않는다** —
    뜯으려면 아이 문장을 읽어야 한다.
    """

    def __init__(self, 글: dict | None = None, 그림: dict | None = None) -> None:
        self._글 = _본문(글 if 글 is not None else 글응답())
        self._그림 = _본문(그림 if 그림 is not None else 그림응답())
        self.받은경로: list[str] = []

    def __enter__(self) -> 가짜앞단:
        받은경로 = self.받은경로
        글본문, 그림본문 = self._글, self._그림

        class 핸들러(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # http.server 가 정한 이름이다
                받은경로.append(self.path)
                # 요청 본문은 읽고 **버린다.** 안 읽으면 클라이언트가 연결을 못 닫는다
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                본문 = 그림본문 if "image" in self.path else 글본문
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(본문)))
                self.end_headers()
                self.wfile.write(본문)

            def log_message(self, *args: object) -> None:
                """테스트 출력에 요청 줄을 찍지 않는다 — 경로에 모델명이 실린다."""

        self._서버 = ThreadingHTTPServer(("127.0.0.1", 0), 핸들러)
        self._스레드 = threading.Thread(target=self._서버.serve_forever, daemon=True)
        self._스레드.start()
        return self

    def __exit__(self, *_예외: object) -> None:
        self._서버.shutdown()
        self._서버.server_close()
        self._스레드.join(timeout=5)

    @property
    def base_url(self) -> str:
        호스트, 포트 = self._서버.server_address[:2]
        return f"http://{호스트}:{포트}"
