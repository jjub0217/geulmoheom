"""Gemini 클라이언트 (docs/adr/0005).

여기는 **연결만** 담당한다. Evaluator 에이전트 자체는 W2 B-1 이다.

`google-genai` SDK 는 인자 없이 만들면 `os.environ` 만 본다. 우리 키는 저장소 루트
`.env` 에 있고 그것을 읽는 건 pydantic-settings 다 — 그래서 **키를 명시적으로 넘긴다.**
안 그러면 `.env` 에 키를 넣어 두고도 "키 없음" 으로 실패한다.
"""

from functools import lru_cache

from google import genai

from app.config import get_settings


@lru_cache
def get_client() -> genai.Client:
    키 = get_settings().gemini_api_key.get_secret_value()
    if not 키:
        raise RuntimeError("GEMINI_API_KEY 가 비어 있다 (.env)")
    return genai.Client(api_key=키)
