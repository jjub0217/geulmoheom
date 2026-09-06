# 글모험 (Geul Moheom)

아이가 직접 쓴 문장으로만 움직이는 모험. 그 모험은 아이의 책이 되어 남고, 안전한 울타리 안에서 모두에게 나눠진다.

**아래 순서대로 읽으세요.** 시간이 없다면 **`docs/비전.md`** 하나라도 먼저.
문서끼리 어긋나 보이면 **루트 `CLAUDE.md`의 「문서 층위」**를 본다 — 나중에 쓰인 쪽이 맞는 게 아니다.

## 문서 지도

| 읽는 순서 | 문서 | 누가 |
|---|---|---|
| 1 | `docs/비전.md` | 전원 |
| 2 | `docs/용어사전.md` | 전원 — 요청·PR·대화에서 같은 말을 쓰기 위해 |
| 3 | `docs/작업흐름.md` | 전원 — 어디서 `claude`를 띄우고 무엇을 치는지 |
| 4 | `docs/MVP_PRD.md` | 전원 |
| 4-1 | `docs/주차계획/` | 전원 — 이번 주에 실제로 무엇을 하는가 |
| 5 | `docs/백로그.md` | 전원 |
| 6 | `docs/아키텍처 및 구현난의도.md` | 개발자 |
| 7 | `docs/api/` | 개발자 — 계약 사양. `README.md`부터 |
| 8 | `docs/검증가설_성공지표.md` | 백엔드 (로깅 정의), PM |
| 9 | `docs/안전_어휘_기준.md` | 백엔드 |
| 9-1 | `docs/루브릭_예시셋.md` | 백엔드 (Evaluator 프롬프트), PM |
| 10 | `docs/장면카드_초안.md`, `docs/캐릭터/` | 프론트, PM |
| 참고 | `docs/페르소나정의.md`, `docs/페인_가이드라인정책.md` | 기획 근거. 필요할 때 (`docs/archive/`는 보관 문서 — 현재 기준이 아니다) |
| 결정 기록 | `docs/adr/` | 전원 |

## 구조

```
web/       Next.js PWA (프론트)          — web/README.md · tasks/ 는 주차 진척
api/       FastAPI + LangGraph (백엔드)  — api/README.md · tasks/ 는 주차 진척
landing/   랜딩페이지 (PM, W1 → W2 이월 — 도메인 미등록)
infra/     docker-compose (로컬 Postgres·Redis), 배포 설정
docs/      사람이 읽는 문서 전부 (PM 소유)
api-requests/  프론트가 개발 중 올리는 API 수정요청 — open/ 이 비면 대기 없음
```

공유 패키지는 없습니다. 프론트 타입은 `api`의 OpenAPI에서 생성합니다 (`make contracts`).

## 시작하기

**한 번 하는 것과 매번 하는 것이 섞여 있으면 순서대로 치게 된다.** 나눠 둔다.
패키지별 도구 설치·초기화는 `api/README.md`·`web/README.md`의 「개발환경 구축」에 있다. 여기는 저장소 전체 몫만.

### 처음 한 번 — 머신당

```bash
cp .env.example .env        # 키를 채운다
```

- **`.env`가 없어도 목 응답 서버는 뜬다.** `app_env` 기본값이 `dev`라 필수 키 검사를 건너뛴다. 막히는 것은 **Gemini 키가 필요한 것**(Evaluator 스모크·이미지 생성)과 파일럿 설정뿐이다
- 파일럿용은 `.env.pilot.example` → `.env.pilot`. **`APP_ENV`만은 파일이 아니라 프로세스 환경 변수로 준다** — 어느 파일을 읽을지 정하는 값이라 파일 안에 적으면 늦다

### 필요할 때

```bash
make db-up                  # Postgres + Redis. Docker Desktop이 떠 있어야 한다
```

**DB 없이 되는 작업이 많다.** 목 응답 서버와 타입 생성은 Postgres·Redis 없이 돈다. 화면 작업만 할 거면 안 띄워도 된다.

### 개발 중 — 터미널을 따로 연다

```bash
make dev-api                # 터미널 1 · 백엔드 세션에서만 (포트 8000 충돌)
make dev-web                # 터미널 2 · 프론트 세션
```

**`make dev`는 둘을 한꺼번에 띄우고 끝나지 않는다.** 아래 명령을 그 뒤에 이어 치면 영원히 실행되지 않는다.
세션 셋을 나눠 쓰는 지금 체제(`adr/0008`)에서는 `dev-api`·`dev-web`을 각자 세션에서 따로 띄운다. `make dev`는 혼자 한 터미널로 다 볼 때만 쓴다.

```bash
make contracts              # api OpenAPI → web/src/api/types.gen.ts
make lint                   # 커밋 전
make test                   # 커밋 전
```

- **`make contracts`는 api가 떠 있어야 한다.** `localhost:8000/openapi.json`을 읽는다. **명세가 바뀐 뒤에만** 돌리면 되고, 생성물(`types.gen.ts`)은 손으로 고치지 않는다
- **`lint`·`test`는 커밋 전에 로컬에서 돌린다.** CI는 `main` push 후에 도는 사후 통보라, 깨진 코드가 이미 들어간 다음 빨간불이 뜬다

## 규칙 요약 (자세한 건 `docs/비전.md` 7장, `CLAUDE.md`)

- **PR 없이 `main`에 직접 push한다.** 대신 `main`은 항상 돌아가는 상태로 둔다
- 새 기능을 제안·추가할 때는 **비전 4장 질문 5개**에 대한 답을 한 줄씩 적는다
- 아이 화면에 점수·등급·"연습"·"학습"·"채점" 단어를 쓰지 않는다
- 아이 입력 원문은 책 콘텐츠로만 보관하고 로그·APM에는 절대 남기지 않는다 (PRD 1.1b)
- `docs/`는 PM 소유. 프론트는 직접 고치지 않고 `api-requests/`에 올리거나 PM에게 말한다
- 프론트가 API 변경이 필요하면 `api-requests/open/`에 직접 요청을 쓴다
