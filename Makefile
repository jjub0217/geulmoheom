.PHONY: dev db-up db-down contracts test lint clean

# ── 로컬 인프라 ──────────────────────────────────────────
# -p geulmoheom 을 반드시 붙인다. compose 는 파일의 상위 폴더 이름을 프로젝트로 쓰는데,
# 이 머신의 다른 저장소도 infra/ 를 쓴다. 빼면 두 프로젝트가 하나로 합쳐져
# 같은 서비스 이름(postgres·redis)의 남의 컨테이너를 지운다. 2026-08-30 실제 발생.
COMPOSE = docker compose -p geulmoheom -f infra/docker-compose.yml

db-up:
	$(COMPOSE) up -d

db-down:
	$(COMPOSE) down

# ── 개발 서버 (web + api 동시) ───────────────────────────
dev:
	@echo "api → http://localhost:8000  |  web → http://localhost:3000"
	@$(MAKE) -j2 dev-api dev-web

dev-api:
	cd api && uv run uvicorn app.main:app --reload --port 8000

dev-web:
	cd web && pnpm dev

# ── API 계약: api OpenAPI → web 타입 ─────────────────────
# api가 떠 있어야 한다 (make dev-api). CI는 생성 결과가 커밋본과 다르면 실패시킨다.
contracts:
	curl -sf http://localhost:8000/openapi.json -o /tmp/openapi.json
	cd web && pnpm exec openapi-typescript /tmp/openapi.json -o src/api/types.gen.ts
	@echo "→ web/src/api/types.gen.ts 갱신. 수동 편집 금지."

# ── 품질 ────────────────────────────────────────────────
test:
	cd api && uv run pytest
	cd web && pnpm test

lint:
	cd api && uv run ruff check . && uv run ruff format --check .
	cd web && pnpm lint

clean:
	rm -rf web/.next api/.pytest_cache api/.ruff_cache
