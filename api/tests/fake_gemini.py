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

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 평가 응답 기본값. 등급을 **G3 로 둔다** — 폴백 등급(G1)과 달라야
# 「가짜가 답했다」와 「호출이 실패해 폴백했다」가 구분된다.
기본판정 = {"grade": "G3", "signals": ["색", "소리"], "descriptors": ["은빛", "살금살금"]}


def _본문(응답: dict) -> bytes:
    return json.dumps(응답).encode()


def 평가응답(판정: dict | None = None) -> dict:
    """`generateContent` 가 구조화 출력을 돌려주는 모양 그대로."""
    안 = json.dumps(판정 if 판정 is not None else 기본판정, ensure_ascii=False)
    return {
        "candidates": [
            {"content": {"role": "model", "parts": [{"text": 안}]}, "finishReason": "STOP"}
        ],
        "usageMetadata": {"promptTokenCount": 1, "candidatesTokenCount": 1, "totalTokenCount": 2},
    }


class 가짜앞단:
    """`with 가짜앞단() as 앞단:` 안에서만 산다. `앞단.base_url` 을 설정에 넣는다."""

    def __init__(self, 응답: dict | None = None) -> None:
        self._응답 = 응답 if 응답 is not None else 평가응답()
        self.받은경로: list[str] = []

    def __enter__(self) -> 가짜앞단:
        받은경로 = self.받은경로
        본문 = _본문(self._응답)

        class 핸들러(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # http.server 가 정한 이름이다
                받은경로.append(self.path)
                # 요청 본문은 읽고 **버린다.** 안 읽으면 클라이언트가 연결을 못 닫는다
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
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
