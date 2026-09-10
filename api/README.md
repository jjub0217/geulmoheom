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

### 8. 배포 (`docs/adr/0012`)

**web=Vercel · api=Render(무료) · 한 오리진.** 브라우저에는 Vercel 호스트 하나만 보이고
`/api/*` 를 Vercel 이 Render 로 넘긴다 — **Render 주소는 노출되지 않는다.**

| 파일 | 무엇 |
|---|---|
| `api/Dockerfile` | 컨테이너. **빌드 컨텍스트가 저장소 루트다** — 런타임이 `docs/` 를 읽는다 |
| `render.yaml` | Render 청사진(api + Postgres + Key Value). 무료 플랜 |
| `web/vercel.json` | Vercel 쪽. `rewrites` 의 `destination` 에 Render 주소를 채운다 (프론트 몫) |

#### 8-1. Web Service 를 만든다 — **한 번에**

**청사진으로 하면 아래 칸이 전부 채워진다** — Render 대시보드 → Blueprints → 이 저장소의
`render.yaml`. 손으로 만든다면 그 값이 이것들이다.

**⚠ Postgres·Key Value 를 이미 대시보드에서 만들었다면 청사진을 그대로 적용하지 않는다** —
**같은 것이 하나 더 생긴다**(청사진은 기존 것을 가져오지 않는다). 그때는 **Web Service 만
손으로 만들고** `render.yaml` 은 **값의 출처로만** 읽는다. **리전은 이미 만든 DB 에 맞춘다.**

| 칸 | 값 | 왜 |
|---|---|---|
| Language | **Docker** | FastAPI 컨테이너다. Postgres·Redis 를 물고 있어 서버리스에 못 올라간다 |
| Root Directory | **비운다** | 빌드 컨텍스트가 저장소 루트다 — `api/` 로 잡으면 `docs/` 가 안 들어간다 |
| Dockerfile Path | `api/Dockerfile` | |
| Build Command | **없음** | Docker 가 빌드다 |
| Start Command | **비운다** | Dockerfile 의 `CMD` 를 쓴다 — 마이그레이션과 `--proxy-headers` 가 거기 박혀 있다 |
| Instance Type | **Free** | 감수하는 것 셋은 `adr/0012` |
| Region | **DB·Key Value 와 같은 리전** | 다르면 사설망으로 못 붙는다 |
| Health Check Path | `/healthz` | 인증도 DB 도 안 본다. **`/readyz` 를 걸지 않는다** — DB 가 잠깐 흔들릴 때 인스턴스가 죽는다 |
| Port | **지정하지 않는다** | `$PORT` 를 읽는다 |

#### 8-2. 환경변수 — **이름과 출처만. 값은 대시보드에서 직접 넣는다**

**⛔ 커밋되는 `.env.pilot.example` 에 값을 적지 않는다.** 2026-09-10 에 두 번 났고
지금은 검사가 막는다 (`tests/test_env_pilot_example.py`).

| 이름 | 출처 · 값 | 비고 |
|---|---|---|
| `APP_ENV` | `pilot` | 이 값이 `.env.pilot` 을 고르고 아래 필수 검사를 켠다 |
| `DATABASE_URL` | Render Postgres 의 **Internal** URL | ⛔ **앞을 `postgresql+asyncpg://` 로 갈아 넣는다.** 그대로 넣으면 기동에서 죽는다 |
| `REDIS_URL` | Render Key Value 의 Internal URL | 청사진이면 자동으로 붙는다 |
| `GEMINI_API_KEY` | Google AI Studio, **유료 티어** | 무료 티어는 아이 원문 동의 게이트를 깬다 (`adr/0005`) |
| `EVALUATOR_MODEL` | `gemini-3.1-flash-lite` | W2 벤치 확정 |
| `IMAGE_MODEL` | `gemini-3.1-flash-lite-image` | W1 벤치 확정. **이번 파일럿엔 호출이 안 나간다**(굽는 자리를 막았다) — 그래도 비면 기동을 막는 값이다 |
| `GM_MODEL` | **비운다** | Stage 1 용이고 **코드 어디서도 안 읽는다**. 필수 목록에도 없다 |
| `JWT_SECRET` | 새로 뽑는다 (예: `openssl rand -hex 32`) | ⛔ **삽화 파일 키가 이 값에서 유도된다**(`app/storage.py` `_조각`). **정한 뒤 파일럿 내내 갈지 않는다** — 갈면 8-4 를 다시 돌려야 하고, 안 돌리면 **그림만 통째로 기본 에셋이 되는데 아무 데도 빨간불이 안 뜬다** |
| `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | Cloudflare R2 (S3 호환 토큰) | 아래 8-4 |
| `CLIENT_IP_HEADER` | `X-Vercel-Forwarded-For` | 아래 8-3 |
| `DAILY_COST_ALERT_USD` | `20` | PRD F-3 |
| ~~`NEXT_PUBLIC_API_BASE_URL`~~ | **Render 에 넣지 않는다** | web 의 **빌드 타임** 값이고 `web/vercel.json` 의 `build.env` 에 있다. api 는 이 이름을 읽지 않는다 |

**필수 여덟이 비면 서버가 안 뜬다** (`app/config.py` `PILOT_REQUIRED`). 조용히 떠서
아이 문장을 받아 놓고 첫 호출에서 터지는 것보다 낫다.

#### 8-3. `CLIENT_IP_HEADER` — **왜 `X-Vercel-Forwarded-For` 인가, 틀리면 무엇이 되나**

`아이 → Vercel → Render → FastAPI` 라 **Render 가 보는 접속자는 아이가 아니라 Vercel** 이다.

- **`X-Forwarded-For` 를 쓰지 않는다.** Render 주소는 비밀이 아니라 **Vercel 을 건너뛰고
  직접 때리면 아무 값이나 넣을 수 있다.** Vercel 이 자기 앞에서 덮어쓰는 것과 별개다
- **`X-Vercel-Forwarded-For` 는 Vercel 이 채우는 값**이고, Vercel 문서가 「`x-forwarded-for`
  는 위에 프록시가 있으면 덮일 수 있어서 이 헤더를 따로 둔다」고 적고 있다
- **⚠ 다만 「외부 rewrite 목적지에도 이 헤더를 보내는가」는 문서에 없다. 실측이 답이다**

**틀렸을 때 무슨 일이 나는지가 중요하다** — 헤더가 없으면 `클라이언트IP()` 가 `None` 을
돌려주고 **②(같은 IP 시간당 30회 제동)만 꺼진다.** **①(같은 기기 5회 → 15분 잠금)은 그대로
돈다** — 그리고 **주는 ①이다**(`app/child_auth_limit.py` 머리말). 즉 **파일럿을 여는 데
막는 값이 아니다.** 반대로 **아이 전부가 한 IP 로 뭉치는 값**을 넣는 것이 나쁘다 — 그건
**아무 잘못 없는 아이가 막히는** 쪽이다.

**실측 방법** — 서버 코드를 고치지 않는다. `vercel.json` 의 `destination` 을 **한 번만**
헤더를 그대로 돌려주는 곳으로 돌려 `curl` 로 보고 되돌린다. **아이 데이터가 없는 요청
하나이고 쿠키를 안 실어 보낸다** — 그래도 **바깥으로 나가는 일이라 사람이 판단할 것**이다.

#### 8-4. 삽화 18장 — R2 에 올린다

**`PILOT_REQUIRED` 에서 R2 를 빼지 않는다.** 빼면 로컬 디스크로 떨어지는데
**Render 무료는 디스크가 인스턴스와 함께 사라진다** — 재기동마다 그림이 사라지고
**아이 화면은 안 멈춘다.** 파일럿에서 삽화를 **굽지 않으므로** R2 는 읽기만 한다.

```bash
# R2 셋과 JWT_SECRET 을 .env.pilot 에 채운 뒤, 로컬에서 한 번 돌린다.
cd api && APP_ENV=pilot PYTHONPATH=. uv run python scripts/install_legendary.py
```

**서버의 `JWT_SECRET` 과 같은 값이어야 한다.** 다르면 키가 전부 어긋나 **60조합이 통째로
기본 에셋**이 된다. 목록은 `docs/삽화_legendary_선정.md` 가 SSOT 다.

#### 8-5. 마이그레이션

**새 DB 는 비어 있다.** 손으로 돌릴 것이 없다 — **`alembic upgrade head` 가 시작 명령에
붙어 있어** 매 기동마다 돈다(같은 상태면 아무것도 안 한다). 확인은 첫 배포 로그에서
`Running upgrade` 줄을 보는 것이다.

#### 8-6. Cold Start 완화 — 계정 하나 더

**15분 무요청이면 잠들고 다음 아이가 30~50초를 기다린다.** 외부 무료 모니터링
(UptimeRobot · cron-job.org 급)이 **5~14분 간격으로 `https://<서비스>.onrender.com/healthz`**
를 때린다. **Vercel 주소로 때리면 안 된다** — `/api/*` 만 넘어가서 `/healthz` 는 안 간다.
**GitHub Actions 로 하지 않는다** — CI 가 결제 문제로 2026-09-09 부터 안 돈다.

#### 8-7. 올리고 나서 보는 것

1. `/healthz` 가 200 · 첫 배포 로그에 `Running upgrade`
2. 아이가 **인터넷 주소로 들어와 한 판**을 끝낸다 (가입 → 카드 → 문장 → 등급 → 그림 → 책)
3. **삽화가 실기기에서 뜬다** — 안 뜨면 `vercel.json` 의 `destination` 과 8-4 를 먼저 본다
4. iPad 쿠키 `Expires` 실측 · `CLIENT_IP_HEADER` 실측(8-3)

---

## 합의된 전제

- Python 3.12, `uv`, 엔트리 `app.main:app`
- LLM: **Google Gemini** (`google-genai`, **유료 티어** — `docs/adr/0005`). Evaluator 는
  `gemini-3.1-flash-lite`(W2 벤치 확정, `benchmarks/W2-evaluator-bench.md`) · **thinking 끔** ·
  few-shot 예시셋은 `app/rubric.py` 가 `docs/루브릭_예시셋.md` 에서 **읽는다**(코드에 안 박는다).
  **이미지도 같은 키**로 Gemini 네이티브다 (`gemini-3.1-flash-lite-image` · `adr/0006`)
  - **종전 「Anthropic SDK · `claude-opus-5` · effort low + 프롬프트 캐싱」은 0005·0006 이전 것이다.**
    **프롬프트 캐싱은 코드에 없다** — 붙이는 날 이 줄을 고친다
- **목 응답 서버는 W1 에 섰다.** 규칙은 그대로 산다 — `docs/api/Stage0.md` 대로 응답하고
  `outcome` 3분기를 **`X-Mock-Outcome` 헤더로 강제**할 수 있다 (화면 작업이 쓴다)
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
