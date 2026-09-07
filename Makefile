.PHONY: dev db-up db-down certs contracts test lint clean

# ── 로컬 인프라 ──────────────────────────────────────────
# -p geulmoheom 을 반드시 붙인다. compose 는 파일의 상위 폴더 이름을 프로젝트로 쓰는데,
# 이 머신의 다른 저장소도 infra/ 를 쓴다. 빼면 두 프로젝트가 하나로 합쳐져
# 같은 서비스 이름(postgres·redis)의 남의 컨테이너를 지운다. 2026-08-30 실제 발생.
COMPOSE = docker compose -p geulmoheom -f infra/docker-compose.yml

db-up:
	$(COMPOSE) up -d

db-down:
	$(COMPOSE) down

# ── 로컬 https (.test) ──────────────────────────────────
# 개발 환경도 https 다 (docs/api/공통규약.md 「인증 쿠키」, 미결 11-2 확정).
# `__Host-` 쿠키는 Secure 를 강제하는데 Secure 쿠키가 http://localhost 에 붙는지가
# 브라우저마다 갈린다. 파일럿이 태블릿이라 Safari 를 건너뛸 수 없다.
# 인증서·/etc/hosts 는 `make certs` 가 한 번만 깔아 준다.
API_HOST = api.geulmoheom.test
WEB_HOST = app.geulmoheom.test
CERT = .certs/geulmoheom.test.pem
KEY = .certs/geulmoheom.test-key.pem

certs:
	bash api/scripts/dev-certs.sh

# ── 개발 서버 (web + api 동시) ───────────────────────────
dev:
	@echo "api → https://$(API_HOST):8000  |  web → https://$(WEB_HOST):3000"
	@$(MAKE) -j2 dev-api dev-web

dev-api:
	@test -f $(CERT) || { echo "인증서가 없다. 먼저 'make certs'"; exit 1; }
	cd api && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 \
		--ssl-certfile ../$(CERT) --ssl-keyfile ../$(KEY)

# next 는 web/ 안의 .env 만 본다 — 저장소 루트 .env 는 안 읽는다. 그래서 여기서 넘긴다.
# **그 한 줄만 넘긴다.** 루트 .env 를 통째로 source 하면 NEXT_PUBLIC_ 이 붙은 값이
# 전부 브라우저 번들에 그대로 실린다.
# 조용한 기본값이 없어서(84c072e) 이 줄이 빠지면 web 은 첫 요청 전에 죽는다.
dev-web:
	@test -f $(CERT) || { echo "인증서가 없다. 먼저 'make certs'"; exit 1; }
	@grep -qE '^NEXT_PUBLIC_API_BASE_URL=.' .env || \
		{ echo "루트 .env 에 NEXT_PUBLIC_API_BASE_URL 이 없다 (.env.example 참조)"; exit 1; }
	cd web && NEXT_PUBLIC_API_BASE_URL="$$(sed -n 's/^NEXT_PUBLIC_API_BASE_URL=//p' ../.env | tail -1)" \
		pnpm dev --hostname $(WEB_HOST) --port 3000 --experimental-https \
		--experimental-https-cert ../$(CERT) --experimental-https-key ../$(KEY)

# ── API 계약: api OpenAPI → web 타입 ─────────────────────
# api가 떠 있어야 한다 (make dev-api). CI는 생성 결과가 커밋본과 다르면 실패시킨다.
# --cacert 를 명시한다. mkcert 루트 CA 는 시스템 키체인에 있지만 curl 빌드에 따라
# 그걸 안 보는 경우가 있어, 안 보면 여기서만 조용히 실패한다.
contracts:
	curl -sf --cacert "$$(mkcert -CAROOT)/rootCA.pem" \
		https://$(API_HOST):8000/openapi.json -o /tmp/openapi.json
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
