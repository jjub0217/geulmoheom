# api — 글모험 백엔드 (FastAPI + LangGraph)

대표가 직접 초기화. 아래는 합의된 전제.

- Python 3.12, `uv`로 의존성 관리, 엔트리 `app.main:app` (Makefile이 이 경로를 호출)
- SQLAlchemy(async) + Alembic, Redis. 연결 문자열은 `.env` (`DATABASE_URL`, `REDIS_URL`)
- `/openapi.json`이 곧 프론트 계약. 응답 스키마를 바꾸면 `docs/Stage0_API명세.md`도 같은 PR에서 수정
- LLM: Anthropic SDK, `claude-opus-5`. Evaluator는 effort low + few-shot 예시셋 프롬프트 캐싱 (PRD 9장)
- **W1 3일차까지 목 응답 서버** 제공 — `docs/Stage0_API명세.md` 그대로 (프론트 병렬 개발용)
- 로깅·APM·오류 리포트에 아이 입력 원문 금지. body 마스킹 미들웨어 필수 (PRD 1.1b)
- `ruff`, `pytest` (Makefile·CI가 호출)

참조: `docs/MVP_PRD.md` 3~6장, `docs/Stage0_API명세.md` 9절, `docs/안전_어휘_기준.md`
