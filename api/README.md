# api — 글모험 백엔드 (FastAPI + LangGraph)

담당: `@jjub0217`(백엔드 모자). 아직 초기화 전이다 — 아래 「개발환경 구축」부터 시작한다.
작업 규칙(**아이 원문 로깅 금지** 등)은 **`api/CLAUDE.md`**, 이번 주 할 일은 **`docs/주차계획/`**.

---

## 개발환경 구축

### 1. 도구

| 도구 | 버전 | 확인 |
|---|---|---|
| Python | **3.12** (`uv`가 관리한다) | `uv python list` |
| `uv` | 최신 | `uv --version` |
| Docker Desktop | 실행 중이어야 함 | `docker info` |
| `mkcert` | 최신 | `mkcert -version` |

```bash
brew install uv docker mkcert nss
```

> `nss` 는 Firefox 용이다. 없어도 Chrome·Safari 는 된다.

> 시스템 Python 을 직접 쓰지 않는다. `uv` 가 `.python-version` 대로 받아 쓴다.
> 이 머신의 시스템 Python 은 3.13 이라 그대로 쓰면 사람마다 다른 버전으로 돌게 된다.
> **3.12 는 PRD 결정이 아니라 이 패키지의 전제다.** 바꾸려면 여기와 `.python-version` 을 함께 고친다.

### 2. 저장소 · 환경 변수

```bash
git clone git@github.com:jinioh88/geulmoheom.git      # 계정이 여러 개면 SSH 별칭 (작업흐름 2장)
cd geulmoheom
cp .env.example .env
```

**채워야 하는 키** — `GEMINI_API_KEY`, `R2_*`. **키 하나로 글과 그림을 다 부른다** — 이미지도 Gemini
네이티브다(`adr/0006`). 모델 이름은 `EVALUATOR_MODEL`·`IMAGE_MODEL` 에 넣고 **둘 다 확정됐다**
(`gemini-3.1-flash-lite` · `gemini-3.1-flash-lite-image`). 확정본은 `.env.example` 에 있다.
**⚠ 키는 ASCII 여야 한다** — 헤더로 나가서 한글을 넣으면 `UnicodeEncodeError` 로 죽는다(2026-09-09 실측).
**⛔ `ANTHROPIC_API_KEY` 는 없다** — 2026-08-31 에 Gemini 로 교체됐다(`adr/0005`). 이 줄이 낡아 있어
**새 머신 세팅이 그 자리에서 막혔다**(2026-09-10 대표 점검).
`JWT_SECRET` 은 임의의 긴 난수. `DATABASE_URL`·`REDIS_URL` 은 아래 포트에 맞춰져 있다.

### 3. 로컬 DB

```bash
make db-up      # Postgres 5433 · Redis 6381
make db-down
```

> ⚠️ **`docker compose -f infra/...` 를 직접 치지 않는다. 반드시 `make db-up`.**
> Makefile 이 `-p geulmoheom` 을 붙인다. 빼면 compose 가 폴더명 `infra` 를 프로젝트로 쓰는데,
> 이 머신의 `PopupReady-mobile/infra/` 와 같은 프로젝트로 합쳐져 **남의 컨테이너를 지운다.**
> 2026-08-30 에 실제로 발생했다.
>
> ⚠️ **포트가 5433 · 6381 이다.** 기본 포트는 이 머신에서 이미 점유돼 있다 —
> 5432 `popupready-postgres`, 6379 `mvno-backoffice-redis`, 6380 `popupready-redis`.
> 되돌리면 우리 컨테이너가 `Created` 상태로 조용히 멈추고 **앱이 남의 DB·Redis 에 붙는다.**

연결 확인:
```bash
docker exec geulmoheom-postgres pg_isready -U geulmoheom
docker exec geulmoheom-redis redis-cli ping        # PONG
```

### 4. 프로젝트 초기화 (W1 첫 작업) — **이미 끝났다. 기록이다**

**⛔ 새로 들어온 사람이 이 절을 실행하지 않는다.** W1 에 한 번 한 일이고, **오늘 할 일은
`/my-week <이번 주차>`** 다(아래 「자주 막히는 자리」 표). 아래 `W1` 은 그때의 숫자다.

```bash
cd api && claude                # ← 반드시 api 안에서. api/CLAUDE.md 가 함께 읽힌다
> /my-week W1
> 1번 스캐폴딩의 첫 하위 항목을 해줘.
```

만들 때 지킬 것:

- **`uv`** 로 의존성 관리, 엔트리 **`app.main:app`** (Makefile 이 이 경로를 호출한다)
- **SQLAlchemy(async) + Alembic**, Redis. 연결 문자열은 `.env`
- **`ruff`, `pytest`** — Makefile·CI 가 호출한다. 스크립트 이름을 바꾸지 않는다
- `.python-version` 에 `3.12`
- **body 마스킹 미들웨어를 처음부터 넣는다.** 나중에 얹으면 그전에 쌓인 로그에 원문이 남는다 (PRD 1.1b)

### 5. 로컬 https (`.test`) — **한 번만**

```bash
make certs      # mkcert 루트 CA + 인증서 + /etc/hosts. sudo 를 두 번 묻는다
```

> ⚠️ **별도 터미널에서 돌린다. Claude 세션 안에서는 sudo 프롬프트에 입력이 안 들어간다.**
> 그러면 **인증서 발급(sudo 불필요)만 되고** 키체인 등록과 `/etc/hosts` 가 통째로
> 건너뛰어져 **조용히 절반만 된 상태**로 끝난다 — `mkcert -install` 이 프롬프트를 못 받아도
> 0 을 반환해서 `set -e` 가 안 잡는다. 2026-09-07 에 실제로 그렇게 멈췄다.
> 지금은 스크립트가 **끝에서 셋을 실제로 검사하고** 안 되어 있으면 죽는다.

`https://api.geulmoheom.test:8000` ↔ `https://app.geulmoheom.test:3000` 으로 옮겼다
(`docs/api/공통규약.md` 「인증 쿠키 · 개발 환경도 https다」, 미결 11-2 확정).

> ⚠️ **`localhost` 로 되돌리지 않는다.** `__Host-` 쿠키는 `Secure` 를 강제하는데,
> `Secure` 쿠키가 `http://localhost` 에 붙는지가 **브라우저마다 갈린다**
> (Chromium 허용, Safari 불확실 — WebKit #281149 REOPENED). **파일럿이 태블릿이라
> Safari 를 건너뛸 수 없다.** 대안이었던 「dev 만 `__Host-` 제외」는 쿠키 이름이
> 환경마다 달라져 **환경별로만 재현되는 버그**를 만든다 — 채택하지 않았다.
>
> 인증서(`.certs/`)는 개인 키다. `.gitignore` 에 있고 **커밋하지 않는다.**
> 머신을 옮기거나 인증서가 만료되면 `make certs` 를 다시 돌린다.

### 6. 실행 · 검사

```bash
make dev-api                              # https://api.geulmoheom.test:8000
uv run ruff check . && uv run pytest      # 커밋 전. CI 기다리지 않는다
```

**`make dev`(web+api 동시)는 백엔드 세션에서만 띄운다.** PM 세션에서 같이 띄우면 포트 8000 이 충돌한다.

### 7. 프론트에게 계약을 넘긴다

```bash
make dev-api
make contracts        # /openapi.json → web/src/api/types.gen.ts
```

**`/openapi.json` 이 곧 프론트 계약이자 스키마 SSOT** 다. 응답 스키마를 바꾸면
커밋 메시지에 `명세 변경:` 줄을 남긴다 — 문서 반영은 PM 모자를 쓴 **별도 커밋**으로.

---

## 합의된 전제

- Python 3.12, `uv`, 엔트리 `app.main:app`
- LLM: Anthropic SDK, `claude-opus-5`. Evaluator 는 effort low + few-shot 예시셋 프롬프트 캐싱 (PRD 9장)
- **W1 목 응답 서버가 최우선.** `docs/api/Stage0.md` 그대로, `outcome` 3분기를 파라미터로 강제 가능하게.
  이게 늦으면 프론트가 멈춘다
- **로깅·APM·오류 리포트에 아이 입력 원문 금지.** 원문이 가도 되는 곳은 `card_attempts.text` 하나뿐이다 (PRD 1.1b)
- 안전 어휘 판정 기준은 `docs/안전_어휘_기준.md` — **코드에 화이트리스트를 복사하지 않는다**

## 막혔을 때

| 증상 | 어디를 본다 |
|---|---|
| 포트 충돌 / 컨테이너가 안 뜬다 | 위 3번 경고. `docker ps -a` 로 `Created` 상태인지 확인 |
| 프론트가 뭘 기다리는가 | **`api-requests/` 는 휴면이다**(2026-09-06~, `adr/0008`). 같은 사람이라 왕복이 없다 — `api/CLAUDE.md` 「api-requests」 |
| 아직 안 정해진 설계 결정 | `docs/api/미결.md`. 언제 정하는지는 주차 계획이 정한다 |
| 명세를 고쳐야 한다 | 코드 커밋에 섞지 않는다. `명세 변경:` 줄 → PM 모자로 별도 커밋 |
| 지금 뭘 해야 하지 | `/my-week W<n>` → `api/tasks/W<n>.md`. **`<n>` 은 `docs/주차계획/` 의 최신 주차다** — 예시 숫자를 그대로 돌리지 않는다 |
| 한 세션이 길어진다 | 하위 체크박스 하나 = 세션 하나. 커밋하고 새로 띄운다 (`작업흐름.md` 3-3) |

## 참조

`docs/작업흐름.md`(전체 흐름) · `api/CLAUDE.md`(작업 규칙) · `docs/api/`(계약) ·
`docs/MVP_PRD.md` 3~6장 · `docs/안전_어휘_기준.md` · `docs/검증가설_성공지표.md`(F-1 로깅 정의) ·
**`docs/용어사전.md`(낱말) · `docs/문구.md`(문장 — 화면에 그대로 나가는 것의 SSOT)**
