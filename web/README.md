# web — 글모험 프론트 (Next.js PWA)

담당: `@jjub0217`(프론트 모자). 아직 초기화 전이다 — 아래 「개발환경 구축」부터 시작한다.
작업 규칙(금지 사항 포함)은 **`web/CLAUDE.md`**, 이번 주 할 일은 **`docs/주차계획/`**.

---

## 개발환경 구축

### 1. 도구

| 도구 | 버전 | 확인 |
|---|---|---|
| Node.js | **24.x** | `node --version` |
| pnpm | **11.x** | `pnpm --version` |
| Docker Desktop | 실행 중이어야 함 | `docker info` |
| Git | — | `git --version` |

```bash
brew install node pnpm        # 이미 있으면 건너뛴다
```

> **버전을 임의로 낮추지 않는다.** CI가 같은 버전을 쓴다(`.github/workflows/ci.yml`).
> 스캐폴딩할 때 `web/.nvmrc`(`24`)와 `package.json`의 `"packageManager": "pnpm@11.x"`를 함께 만들고,
> 바꿔야 하면 **CI도 같은 커밋에서** 바꾼다. 어긋나면 로컬은 되는데 CI만 깨진다.

### 2. 저장소

```bash
git clone git@github.com:jinioh88/geulmoheom.git
cd geulmoheom
```

GitHub 계정이 여러 개면 `~/.ssh/config` 별칭을 쓴다. 자세한 건 `docs/작업흐름.md` 2장.

### 3. 환경 변수

```bash
cp .env.example .env
```

프론트가 쓰는 값은 `NEXT_PUBLIC_API_BASE_URL` 하나다(`https://api.geulmoheom.test:8000/api/v1`).
나머지 키(LLM·이미지·R2)는 백엔드용이라 비워도 프론트 개발에 지장 없다.

**`web/` 에 두 번째 `.env` 를 만들지 않는다.** Next 는 저장소 루트 `.env` 를 읽지 않지만,
`make dev-web` 이 **그 한 줄만** 넘겨준다 — 파일을 하나 더 만들면 값이 갈린다.
**코드에 기본값이 없다.** 값이 없으면 요청을 보내기 전에 그 자리에서 죽는다 (`src/lib/api.ts`).

### 4. 로컬 DB (필요할 때만)

프론트는 대개 필요 없다. 목 서버를 직접 띄울 때만.

```bash
make db-up      # Postgres 5433 · Redis 6381
```

> ⚠️ **`docker compose -f infra/...` 를 직접 치지 않는다.** 반드시 `make db-up`.
> Makefile이 `-p geulmoheom`을 붙인다. 빼면 이 머신의 다른 저장소(`PopupReady-mobile/infra/`)와
> 같은 프로젝트로 합쳐져 **남의 컨테이너를 지운다.** 2026-08-30에 실제로 발생했다.
> 포트가 5433·6381인 이유도 같다 — 기본 포트는 이 머신에서 이미 점유돼 있다.

### 5. 프로젝트 초기화 (W1 첫 작업)

```bash
cd web && claude
> /my-week W1
> 1번 web 스캐폴딩을 해줘.
```

만들 때 지킬 것:

- **Next.js App Router · TailwindCSS · Zustand · PWA**, 태블릿 가로 우선 레이아웃
- **스크립트 이름 고정** — `dev` `build` `lint` `test`. Makefile과 CI가 이 이름을 호출한다
- `.nvmrc`(`24`)와 `packageManager` 필드
- 워크스페이스 루트에서 설치한다(`pnpm-workspace.yaml`이 `web`·`landing`을 잡고 있다)

### 6. 실행

```bash
make dev-web            # web 만 (https://app.geulmoheom.test:3000)
make dev                # web + api 동시 — 백엔드 세션에서만 띄운다
pnpm lint && pnpm test  # 커밋 전. CI 기다리지 않는다
```

### 7. API 타입 생성

```bash
make dev-api      # 목 서버가 떠 있어야 한다 (백엔드 담당)
make contracts    # /openapi.json → web/src/api/types.gen.ts
```

**`src/api/types.gen.ts`를 손으로 고치지 않는다.** 타입이 안 맞으면 이 파일이 아니라 API가 틀린 것이고, `api-requests/open/`에 요청을 올린다.

---

## 배포 (준비만 — 아직 안 올린다)

**「배포는 개발을 마친 뒤에」가 규칙이다** (루트 `CLAUDE.md`, 2026-09-09 사용자 결정).
여기 있는 것은 **올리는 것이 아니라 올릴 수 있게 세워 두는 것**이다.

### 형태 — api 를 같은 오리진으로 프록시한다

`web` 은 Vercel, `api` 는 다른 곳(Fly/Railway 등)에 서는데, **브라우저에는 Vercel 주소 하나만 보인다.**
`vercel.json` 의 `rewrites` 가 `/api/*` 를 api 호스트로 넘긴다.

**왜 이 형태인가** (`docs/주차계획/W5.md` 「배포 형태 — 검토한 것」)
- **web 버셀 · api 딴 곳**을 그냥 두면 **`vercel.app` 이 Public Suffix List 에 있어 cross-site** 가 되고
  **`__Host-` 쿠키가 깨진다.** 프록시하면 **한 오리진**이라 그 문제가 통째로 사라진다
- **삽화 `<img>` 에 쿠키가 실린다** — 「배포 뒤에만 되는 것」 중 제일 무서웠던 것이 자동으로 풀린다
- `adr/0007` 을 뒤집는 것이 아니라 **더 세게 만족한다** — 0007 이 원한 것이 「같은 사이트」인데 이건 **한 오리진**이다

### 사람이 해야 하는 것 (내가 못 하는 것)

1. **Vercel 프로젝트를 만든다.** **Root Directory 를 `web` 으로** 잡는다 — 저장소 루트가 아니다
2. **`vercel.json` 의 `destination` 을 채운다.** 지금은 `API_HOST_를_아직_안_정했다` 라는 **일부러 안 도는 값**이다.
   **api 호스트는 백엔드가 고른다** — 정해지면 그 한 줄만 바꾸면 된다.
   **빈 문자열이나 그럴듯한 가짜 주소를 넣지 않았다** — 그러면 **안 채운 채로 배포돼도 조용히 지나간다**

### ⚠ 배포 첫날 이것부터 확인한다 — 삽화 주소

**서버가 `artwork.url` 을 절대 주소로 준다** (`docs/api/Stage0.md` 5절). 화면은 **그 값을 `<img src>` 에 그대로** 넣는다.
**그 절대 주소가 api 호스트를 가리키면 이 형태가 깨진다** — 쿠키는 **Vercel 오리진에 붙어 있어서**
api 호스트로 가는 `<img>` 요청에는 **안 실린다.** 그러면 **그림이 0%** 다.

**다만 아마 그대로 산다** (2026-09-09 백엔드 정정). 서버가 주소를 만들 때 쓰는 것은
**들어온 요청의 `Host` 헤더**라, **앞단이 `Host` 를 보존하면 공개 오리진이 나온다.**
**즉 「절대냐 상대냐」가 아니라 「앞단이 무엇이냐」의 문제다.**

**그래서 「반드시 깨진다」가 아니라 「배포 첫날 이것부터 본다」다.**
`vercel.json` 의 `rewrites` 가 `Host` 를 어떻게 넘기는지는 **문서로 믿지 말고 실물에서 한 번 본다** —
**틀렸을 때 그림이 0% 이고, 배포 전에는 잴 방법이 없다.**

### 확인해야 이 절이 닫힌다

- 아이가 **인터넷 주소로 들어와 한 판을 끝낸다**
- **삽화가 실기기에서 뜬다** (쿠키가 `<img>` 에 실린다)
- iPad 쿠키 `Expires` 실측 · `--proxy-headers` 로 scheme 이 https 로 잡힌다

## 합의된 전제

- API 타입: `src/api/types.gen.ts` — `make contracts`로 생성, **수동 편집 금지**
- 캐릭터 에셋: `docs/캐릭터/` PNG를 `public/guide/`로 복사. `guide.expression` → 파일 매핑
  - `default` → 캐릭터(기본_안내_서사_진행중).png
  - `compass_bright` → 캐릭터(좋은 묘사 썻을때).png
  - `compass_dim` → 캐릭터(묘사부족).png
  - `farewell` → 캐릭터(세션종료).png
- 클라이언트 1차 PII 마스킹 정규식의 배급 방식은 **아직 미결**이다 — `docs/api/미결.md` 11-3. W3에 정한다
- `POST /attempts`의 `outcome` 3분기(`result`/`scaffold`/`blocked`)를 모두 화면으로 처리한다

## 막혔을 때

| 증상 | 어디를 본다 |
|---|---|
| `make contracts` 실패 | 목 서버가 떴는가 (`make dev-api`). 안 떴으면 백엔드에게 말한다 |
| 필요한 필드가 API에 없다 | `api-requests/open/`에 요청 → **백엔드에게 직접 말한다** (알림 없음) |
| 명세가 틀린 것 같다 | `docs/`는 고치지 않는다. `api-requests/`에 올리거나 PM에게 말한다 |
| 아직 안 정해진 설계 결정 | `docs/api/미결.md`. 언제 정하는지는 주차 계획이 정한다 |
| 지금 뭘 해야 하지 | `/my-week W1` → `web/tasks/W1.md` |
| 상대가 뭘 했지 | `/api-check`, `git log -p --since=yesterday` |

## 참조

`docs/작업흐름.md`(전체 흐름) · `web/CLAUDE.md`(작업 규칙) · `docs/api/`(계약) · `docs/MVP_PRD.md` 2·3장
