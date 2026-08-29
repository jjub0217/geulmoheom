.PHONY: dev db-up db-down contracts test lint clean

# ── 로컬 인프라 ──────────────────────────────────────────
db-up:
	docker compose -f infra/docker-compose.yml up -d

db-down:
	docker compose -f infra/docker-compose.yml down

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
