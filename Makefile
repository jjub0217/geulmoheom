.PHONY: dev db-up db-down docker-있나 certs contracts contracts-check test lint clean

# ── 로컬 인프라 ──────────────────────────────────────────
# -p geulmoheom 을 반드시 붙인다. compose 는 파일의 상위 폴더 이름을 프로젝트로 쓰는데,
# 이 머신의 다른 저장소도 infra/ 를 쓴다. 빼면 두 프로젝트가 하나로 합쳐져
# 같은 서비스 이름(postgres·redis)의 남의 컨테이너를 지운다. 2026-08-30 실제 발생.
COMPOSE = docker compose -p geulmoheom -f infra/docker-compose.yml

# **`docker` 가 PATH 에 없는 것과 데몬이 죽은 것은 다르다.** 증상이 겹쳐서 오진한다 —
# 컨테이너가 healthy 인 채로 `command not found` 가 나고, 그러면 데몬을 다시 띄우려다
# 시간을 쓴다 (2026-09-08 실제 발생 — 백엔드 세션. `pnpm` 과 같은 부류다).
#
# **우회하지 않고 어디 있는지만 알려준다.** `pnpm` 은 corepack 이라는 진짜 대체 실행
# 경로가 있었지만 docker 는 없다 — 없는 것을 있는 척 돌리면 그게 더 나쁘다.
docker-있나:
	@command -v docker >/dev/null 2>&1 || { \
		echo "docker 가 PATH 에 없다. **데몬이 죽은 것과 다르다** — 컨테이너는 떠 있을 수 있다."; \
		echo "   확인: ~/.docker/bin/docker ps"; \
		echo "→ Docker Desktop 은 CLI 를 ~/.docker/bin 에 둔다. 셸 프로필에 넣어라:"; \
		echo '   export PATH="$$HOME/.docker/bin:$$PATH"'; \
		exit 1; }

# ── pnpm ────────────────────────────────────────────────
# **`pnpm` 을 직접 부르지 않는다.** 버전은 `web/package.json` 의 `packageManager` 가
# 핀이고(11.25.0), 그것을 지키는 건 corepack 이다.
#
# corepack 심(`corepack enable pnpm`)이 안 깔린 셸에서 `pnpm` 을 부르면 남는 것은
# `command not found: pnpm` · **종료코드 127** 하나뿐이라, 계약 검사가 「명세가
# 갈렸다」가 아니라 **환경 때문에** 빨개진다. 둘을 구분 못 하면 잘못된 자리를 판다
# (2026-09-08 실제 발생 — 백엔드 세션).
#
# 심이 있으면 그것을 쓰고(CI 는 pnpm/action-setup 이 깔아 둔다), 없으면 corepack 이
# 핀을 보고 받아온다. **corepack 은 Node 에 딸려 오므로 따로 깔 것이 없다.**
PNPM := $(shell command -v pnpm >/dev/null 2>&1 && echo pnpm || echo 'corepack pnpm')

db-up: docker-있나
	$(COMPOSE) up -d

db-down: docker-있나
	$(COMPOSE) down

# 장면 카드를 DB 에 뿌린다 (A0-1). **정본은 docs/장면카드_초안.md 이고 DB 는 사본이다.**
# 배포마다 돌려야 한다 — 검수로 문서가 바뀌면 그다음 배포에 따라와야 하고, 안 뿌리면
# /readyz 가 degraded 로 선다 (api/app/api/system.py).
seed:
	cd api && PYTHONPATH=. uv run python scripts/seed_cards.py

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

# ── 사무실 실행 (아이가 쓸 iPad 가 개발 머신에 붙는다) ──
# 대표 판정으로 도메인을 보류하고 사무실에서 우리 기기로 돈다 (W4 「사무실 실행 준비」).
#
# **아이·학부모 기기에는 절대 안 깐다.** 남의 기기에 우리 루트 CA 를 넣는 것은
# 그 기기의 모든 https 를 우리가 들여다볼 수 있게 만드는 것이고, **프라이버시를
# 지키겠다고 모은 자리에서 정반대를 요구하는 것**이 된다.
#
# **왜 이름을 새로 만드나** — `.test` 는 `/etc/hosts` 로 푸는 것이라 **이 머신 안에서만**
# 듣는다. iPad 에는 아무 효력이 없다. mDNS 이름은 iOS 가 그냥 풀고 **DHCP 로 주소가
# 바뀌어도 안 변한다** — 홈 화면에 설치한 PWA 의 오리진이 고정으로 박히기 때문에
# 그 안정성이 필요하다. **주소가 바뀌면 설치본이 깨지고, 접속 코드는 1회용이라
# 아이가 다시 못 들어온다.**
#
# **`__Host-` 쿠키와 CORS 는 안 건드린다** — 같은 호스트의 다른 포트라 지금
# `.test` 두 이름과 성질이 같다(cross-origin · same-site). 쿠키는 포트를 안 가린다.
# **소문자로 내린다.** `scutil` 은 사람이 맥에 붙인 이름을 그대로 주는데
# (`osejin-ui-MacBookPro`), **브라우저는 `Origin` 헤더의 호스트를 소문자로
# 정규화해서 보낸다.** FastAPI `CORSMiddleware` 는 정확 문자열 비교라 안 맞고,
# **그러면 401 응답이 CORS 헤더 없이 나가 브라우저가 못 읽어 화면이 로딩에서 멈춘다.**
# 2026-09-08 iPad 리허설에서 실제로 밟았다.
#
# **TLS 는 안 건드려도 된다** — 호스트 매칭이 대소문자를 안 가려서 이미 발급된
# SAN 이 소문자 접속에도 그대로 맞는다. 바뀌는 것은 CORS 문자열과 API 주소뿐이다.
#
# **대소문자를 둘 다 넣지 않는다.** 브라우저는 절대 대문자로 안 보내므로
# 안 쓰이는 줄이 남고, **다음 사람이 「대문자도 지원한다」로 읽는다.**
LAN_HOST = $(shell scutil --get LocalHostName 2>/dev/null | tr 'A-Z' 'a-z').local
LAN_IP = $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

certs-lan:
	@test -n "$(LAN_IP)" || { echo "LAN IP 를 못 찾았다. Wi-Fi 에 붙어 있나?"; exit 1; }
	EXTRA_HOSTS="$(LAN_HOST) $(LAN_IP)" bash api/scripts/dev-certs.sh

# api·web 을 LAN 에 연다. **평소 개발은 안 바뀐다** — 기본값이 loopback 그대로다.
# 끝나면 끈다. 개발 DB 에 실제 자녀 계정이 있고, 사무실 망의 아무나 닿을 수 있다.
dev-lan:
	@test -n "$(LAN_IP)" || { echo "LAN IP 를 못 찾았다"; exit 1; }
	@echo "iPad 에서 열 주소 →  https://$(LAN_HOST):3000"
	@echo "                     (mDNS 가 막히면  https://$(LAN_IP):3000)"
	@echo "**끝나면 끈다.** 개발 DB 에 실제 자녀 계정이 있다."
	@$(MAKE) -j2 dev-api dev-web \
		DEV_BIND=0.0.0.0 WEB_BIND=0.0.0.0 \
		API_BASE_URL_OVERRIDE=https://$(LAN_HOST):8000/api/v1 \
		CORS_OVERRIDE='["https://$(LAN_HOST):3000","https://$(LAN_IP):3000","https://$(LAN_HOST):3001","https://$(LAN_IP):3001"]'

# 정적 빌드(`output: "export"`)를 LAN 에 연다 — 사무실 실행 진단용.
# **`next dev` 를 안 내리고 3001 에 나란히 세운다** — 같은 iPad 에서 둘을 번갈아 열어
# **「dev 번들에만 있는 문제인가」**를 가른다. 그래서 `dev-lan` 의 CORS 에 3001 도 들어간다.
# 이유·배경은 `api/scripts/serve_web_out.py` 와 `api/notes/사무실실행_iPad.md`.
build-out:
	@test -n "$(LAN_IP)" || { echo "LAN IP 를 못 찾았다"; exit 1; }
	cd web && NEXT_PUBLIC_API_BASE_URL="https://$(LAN_HOST):8000/api/v1" $(PNPM) build

serve-out:
	@echo "iPad 에서 열 주소 →  https://$(LAN_HOST):3001   (정적 빌드)"
	cd api && uv run python scripts/serve_web_out.py

# ── 개발 서버 (web + api 동시) ───────────────────────────
dev:
	@echo "api → https://$(API_HOST):8000  |  web → https://$(WEB_HOST):3000"
	@$(MAKE) -j2 dev-api dev-web

# `DEV_BIND` 는 `dev-lan` 만 바꾼다. 평소에는 loopback 이라 밖에서 안 닿는다.
DEV_BIND = 127.0.0.1
dev-api:
	@test -f $(CERT) || { echo "인증서가 없다. 먼저 'make certs'"; exit 1; }
	cd api && $(if $(CORS_OVERRIDE),CORS_ORIGINS='$(CORS_OVERRIDE)' ,)uv run uvicorn app.main:app --reload --host $(DEV_BIND) --port 8000 \
		--ssl-certfile ../$(CERT) --ssl-keyfile ../$(KEY)

# next 는 web/ 안의 .env 만 본다 — 저장소 루트 .env 는 안 읽는다. 그래서 여기서 넘긴다.
# **그 한 줄만 넘긴다.** 루트 .env 를 통째로 source 하면 NEXT_PUBLIC_ 이 붙은 값이
# 전부 브라우저 번들에 그대로 실린다.
# 조용한 기본값이 없어서(84c072e) 이 줄이 빠지면 web 은 첫 요청 전에 죽는다.
dev-web:
	@test -f $(CERT) || { echo "인증서가 없다. 먼저 'make certs'"; exit 1; }
	@grep -qE '^NEXT_PUBLIC_API_BASE_URL=.' .env || \
		{ echo "루트 .env 에 NEXT_PUBLIC_API_BASE_URL 이 없다 (.env.example 참조)"; exit 1; }
	cd web && NEXT_PUBLIC_API_BASE_URL="$(or $(API_BASE_URL_OVERRIDE),$(shell sed -n 's/^NEXT_PUBLIC_API_BASE_URL=//p' .env | tail -1))" \
		$(PNPM) dev --hostname $(or $(WEB_BIND),$(WEB_HOST)) --port 3000 --experimental-https \
		--experimental-https-cert ../$(CERT) --experimental-https-key ../$(KEY)

# ── API 계약: api OpenAPI → web 타입 ─────────────────────
# api가 떠 있어야 한다 (make dev-api). CI는 생성 결과가 커밋본과 다르면 실패시킨다.
# --cacert 를 명시한다. mkcert 루트 CA 는 시스템 키체인에 있지만 curl 빌드에 따라
# 그걸 안 보는 경우가 있어, 안 보면 여기서만 조용히 실패한다.
contracts:
	curl -sf --cacert "$$(mkcert -CAROOT)/rootCA.pem" \
		https://$(API_HOST):8000/openapi.json -o /tmp/openapi.json
	cd web && $(PNPM) exec openapi-typescript /tmp/openapi.json -o src/api/types.gen.ts
	@echo "→ web/src/api/types.gen.ts 갱신. 수동 편집 금지."

# 계약 드리프트 검사. CI가 그대로 이 타깃을 부른다 — 로컬에서 먼저 돌려 볼 수 있게.
# **서버를 띄우지 않는다.** app.openapi() 를 직접 뽑는다 (api/scripts/dump_openapi.py).
# 커밋본을 덮어쓰지 않고 임시 파일로 뽑아 비교한다 — 검사가 워킹 트리를 건드리면
# 실패했을 때 무엇이 원래 커밋본이었는지가 사라진다.
contracts-check:
	cd api && PYTHONPATH=. uv run python scripts/dump_openapi.py /tmp/openapi.check.json
	cd web && $(PNPM) exec openapi-typescript /tmp/openapi.check.json -o /tmp/types.check.ts
	@diff -u web/src/api/types.gen.ts /tmp/types.check.ts && echo "계약 일치" || { \
		echo ""; \
		echo "명세가 바뀌었는데 재생성물이 커밋되지 않았다."; \
		echo "→ make dev-api 를 띄운 뒤 make contracts, 그리고 web/src/api/types.gen.ts 를 커밋한다."; \
		exit 1; }

# ── 품질 ────────────────────────────────────────────────
test:
	cd api && uv run pytest
	cd web && $(PNPM) test

lint:
	cd api && uv run ruff check . && uv run ruff format --check .
	cd web && $(PNPM) lint

clean:
	rm -rf web/.next api/.pytest_cache api/.ruff_cache
