# 글모험 (Geul Moheom)

아이가 직접 쓴 문장으로만 움직이는 모험. 그 모험은 아이의 책이 되어 남고, 안전한 울타리 안에서 모두에게 나눠진다.

**처음이라면 `docs/비전.md`부터 읽으세요.** 그다음 아래 문서 지도를 따라가면 됩니다.

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
| 7 | `docs/Stage0_API명세.md` | 개발자 (백·프론트 합의 문서) |
| 8 | `docs/검증가설_성공지표.md` | 백엔드 (로깅 정의), PM |
| 9 | `docs/안전_어휘_기준.md` | 백엔드 |
| 10 | `docs/장면카드_초안.md`, `docs/캐릭터/` | 프론트, PM |
| 참고 | `docs/페르소나정의.md`, `docs/페인_가이드라인정책.md`, `docs/생각해본기능.md` | 기획 근거. 필요할 때 |
| 결정 기록 | `docs/adr/` | 전원 |

## 구조

```
web/       Next.js PWA (프론트)          — web/README.md
api/       FastAPI + LangGraph (백엔드)  — api/README.md
landing/   Fake Door 랜딩 (PM, W1)
infra/     docker-compose (로컬 Postgres·Redis), 배포 설정
docs/      사람이 읽는 문서 전부 (PM 소유)
api-requests/  프론트 → 백엔드 API 수정요청 — open/ 이 비면 대기 중인 요청 없음
```

공유 패키지는 없습니다. 프론트 타입은 `api`의 OpenAPI에서 생성합니다 (`make contracts`).

## 시작하기

```bash
cp .env.example .env        # 키 값 채우기
make db-up                  # Postgres + Redis
make dev                    # web + api 동시 실행
make contracts              # api OpenAPI → web/src/api/types.gen.ts
make test
```

## 규칙 요약 (자세한 건 `docs/비전.md` 7장, `CLAUDE.md`)

- **PR 없이 `main`에 직접 push한다.** 대신 `main`은 항상 돌아가는 상태로 둔다
- 새 기능을 제안·추가할 때는 **비전 4장 질문 5개**에 대한 답을 한 줄씩 적는다
- 아이 화면에 점수·등급·"연습"·"학습"·"채점" 단어를 쓰지 않는다
- 아이 입력 원문은 책 콘텐츠로만 보관하고 로그·APM에는 절대 남기지 않는다 (PRD 1.1b)
- `docs/`는 PM 소유. 프론트는 직접 고치지 않고 `api-requests/`에 올리거나 PM에게 말한다
- 프론트가 API 변경이 필요하면 `api-requests/open/`에 직접 요청을 쓴다
