# Stage 0 「나침반 퀘스트」 — 엔드포인트

작성일: 2026-08-29 (v2: 내 책·원문 보관 원칙 반영) · 기준: `MVP_PRD.md` 1.1b·2.1·2.2·5·6장

**Base URL·인증·오류 코드·원문 취급은 `공통규약.md`.** 아직 안 정한 것은 `미결.md`.
읽는 순서와 문서 성격은 `README.md`.

---

## 1. 학부모 (Parent)

### POST `/parents/signup`
```json
// req
{ "email": "a@b.c", "password": "...", "consent": true }
// res 201
{ "parent_id": "...", "consent_at": "2026-09-01T00:00:00Z" }
```
- **토큰은 body에 없다.** `Set-Cookie: __Host-gm_parent=...`로 내려간다 (`공통규약.md` 「인증 쿠키」)
- `consent: true`가 아니면 422. 동의 문구 버전은 서버가 `consent_version`으로 기록
- 라벨링 동의(아이 문장을 Evaluator 개선용 라벨링에 활용, 파일럿 종료 시 사본 파기)는 **별도 체크박스** → `labeling_consent: bool`. 거부해도 서비스 이용 가능, 책에는 원문이 그대로 남음

### POST `/parents/login` → `{ "parent_id": "..." }` + `Set-Cookie: __Host-gm_parent`
- **없는 이메일과 틀린 비밀번호를 같은 401 로 준다** (2026-09-07 추가). 구분하면 로그인 화면이 **「이 이메일이 우리 서비스에 있는지」를 묻는 도구**가 된다 — 아동 서비스라 **가입 사실 자체가 알려지면 안 된다.** 응답 시간도 갈리지 않게 한다

### POST `/parents/logout` → 204
- `Set-Cookie: __Host-gm_parent=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax` — **이름·`Path`·`Domain` 유무가 발급 때와 하나라도 다르면 안 지워진다**
- HttpOnly라 클라이언트가 스스로 지울 수 없다. 로컬 상태만 비우면 쿠키는 살아 있다
- **인증을 요구하지 않는다. 쿠키가 없어도 204** (2026-09-07). 만료·손상된 쿠키를 지우려는 것이 로그아웃인데 인증을 걸면 **정작 지워야 할 상태에서만 401 로 막힌다.** 지우는 것 말고 하는 일이 없어 열어 둬도 잃을 것이 없고, cross-site POST 는 `SameSite=Lax` 가 막는다
- **자녀 쿠키는 건드리지 않는다** — 가족 태블릿에 둘이 함께 앉아 있다

### GET `/parents/me`
```json
{ "parent_id": "...", "email": "...", "consent_at": "...", "children": [ { "child_id": "...", "nickname": "...", "age_band": 11, "daily_cap": 5, "played_today": true, "last_active_at": "..." } ] }
```
- **성장 데이터·등급·입력 내용은 반환하지 않음** (P1 대시보드 범위)

### POST `/parents/children`
```json
// req
{ "nickname": "불꽃탐험가", "age_band": 11 }
// res 201
{ "child_id": "...", "nickname": "...", "access_code": "482913", "access_code_expires_at": "..." }
```
- `nickname`은 PII 검사(E-2 서버 2차) 통과 필수. 실패 시 422 `detail.reason = "PII_DETECTED"`
- `age_band` ∈ {10, 11, 12}
- `access_code` 6자리, 24시간 유효, 1회 사용. 서버는 해시만 저장

> **`{child_id}` 가 붙는 모든 경로 공통 — 남의 자녀 ID 는 404 다** (2026-09-07 추가). 403 으로 가르면 **「그 ID 는 존재한다」가 샌다.** 자녀 ID 는 난수라 찍기 어렵지만, **존재 여부를 알려주는 순간 난수의 값이 절반으로 준다.** 없는 ID 와 남의 ID 를 구분하지 않는다

### POST `/parents/children/{child_id}/access-code` → 재발급 `{ access_code, access_code_expires_at }`
- **`children.token_version`을 1 올린다 → 이전 기기의 자녀 토큰이 즉시 401이 된다** (`공통규약.md` 「폐기」)

### PATCH `/parents/children/{child_id}` → `{ daily_cap }` (SHOULD, 10~20)

### DELETE `/parents/children/{child_id}` → 204. 자녀 데이터 즉시 파기 (attempts, books, artworks, events, Redis)
- 파기 대상에 **자녀 토큰도 포함**된다. `token_version`을 올려 남아 있는 기기를 끊는다

---

## 2. 자녀 인증 (Child Auth)

### POST `/child/auth`
```json
// req
{ "access_code": "482913" }
// res
{ "child": { "child_id": "...", "nickname": "...", "guide_name": null } }
```
- **토큰은 body에 없다.** `Set-Cookie: __Host-gm_child=...` (`공통규약.md` 「인증 쿠키」)
- 코드 소진 후 재사용 불가. JWT는 **절대 30일**이고 쿠키 만료만 슬라이딩한다
- **이 화면은 standalone(홈 화면 실행)에서만 연다.** iOS 홈 화면 앱은 Safari와 쿠키를 공유하지 않는데 코드는 1회 사용이라, 브라우저 탭에서 교환하면 홈 화면 앱에서 **재발급 없이는 못 들어온다**

### POST `/child/logout` → 204
- `Set-Cookie: __Host-gm_child=; Max-Age=0; ...` — 가족 공용 태블릿에서 아이가 내려오는 경로
- **인증을 요구하지 않는다. 쿠키가 없어도 204** — `/parents/logout` 과 같은 이유다
- **학부모 쿠키는 건드리지 않는다**
- **아이 화면의 「나가기」 버튼은 아직 없다** (2026-09-07). 접속 코드 화면(E-3)이 서기 전에 나갈 문만 만들면 **아이가 스스로를 가둔다** — 둘을 같이 세운다

### GET `/child/me`
```json
{ "child_id": "...", "nickname": "...", "guide_name": "나침이", "today": { "cards_done": 2, "cap": 5, "locked": false, "resets_at": "2026-09-02T00:00:00+09:00" } }
```
- `locked`가 true면 프론트는 세션 종료 화면만 표시 (A0-5)
- `resets_at`은 **기기 로컬 자정**. 클라이언트가 `X-Timezone: Asia/Seoul` 헤더를 보내고 서버가 계산

### PATCH `/child/guide` → `{ "guide_name": "나침이" }` (C-1 이름 짓기, 1회. PII 검사)

---

## 3. 카드 (Cards)

### GET `/cards/next`
오늘 아직 안 한 카드 중 하나를 아이별 랜덤 순서로 반환.
```json
{
  "card_id": "c01",
  "type": "crisis",
  "situation": "안개 낀 숲에서 나무 사이로 거대한 그림자가 천천히 다가온다. 그런데 그림자는 자꾸 같은 자리에서 넘어지고 있다.",
  "prompt_label": "탐험가는 어떻게 할까?",
  "sketch_url": "https://r2/.../c01_sketch.webp",
  "guide": { "expression": "default", "line": "나침반이 조용하네. 네가 뭘 할지 말해주면 움직일 거야!" },
  "today": { "cards_done": 2, "cap": 5 }
}
```
- 소진 시 409 `DAILY_CAP_REACHED` + body에 `guide.line`("내일 또 보자") 포함
- `guide.line`은 서버 템플릿 치환 결과 (PRD 4.0). 프론트는 그대로 표시
- **표정 4종(`expression`)은 서버가 정한다. 프론트가 고르지 않는다.** 값은 `default` `compass_bright` `compass_dim` `session_end`
- **제출 전(입력 중) 화면 상태는 서버 응답이 없으므로 프론트가 정한다. 단 표정 4종을 쓰지 않는다** (2026-09-07 추가).
  입력 중 캐릭터는 **`default` 고정**이고, 글자 수 격려 같은 제출 전 연출은 **표정이 아닌 다른 수단**(나침반 빛 등)으로 한다.
  `compass_bright`·`compass_dim` 은 **평가 결과**를 뜻하므로, 제출 전에 쓰면 서버가 아직 판정하지 않은 것을 그림이 먼저 약속하게 된다

### GET `/cards/{card_id}` → 단일 카드 (재시도 화면 복귀용)
- 응답 모양은 `/cards/next` 와 같다
- **모르는 카드와 튜토리얼 카드(T1~T3)는 404** (2026-09-07 추가). 튜토리얼은 노출 경로가 따로 있다 (Stage 1 A-6)

---

## 4. 시도 (Attempts) — 핵심 엔드포인트

### POST `/attempts`
```json
// req
{ "card_id": "c01", "text": "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다", "retry_of": null, "prompted": false }
```
- `retry_of`: 같은 카드 재시도면 이전 `attempt_id`. 재시도는 일일 카운트 미소모
- `prompted`: 캐릭터 권유로 인한 재시도면 true (Stage 1 튜토리얼 T2용. Stage 0은 항상 false)
- `text` 1~500자. 클라이언트 1차 PII 마스킹 후 전송. 서버는 마스킹된 텍스트를 책 콘텐츠로 저장

**`retry_of` 를 언제 채우나 — 되묻기 뒤 재입력은 채우지 않는다** (2026-09-07 확정, 프론트 질문)

- **되묻기(`outcome=scaffold`) 뒤 고쳐 보낼 때 `retry_of: null`.** 되묻기는 **시도가 끝난 것이 아니라 같은 시도의 연장**이다
  - **일일 카운트가 이 값에 걸려 있다** (아래 「서버 처리 순서」 2·10). `retry_of` 를 채우면 카운트가 안 늘어, **되묻기를 거친 카드만 하루 5장에서 빠지지 않는다.** 카드를 하나 푼 것은 맞으므로 틀린 셈이 된다
  - **H2 도 갈린다.** 되묻기 전 짧은 입력을 별도 회차로 세면 **되묻기가 잘 작동할수록 「회당 평균 글자 수」가 내려간다** — 아이를 더 쓰게 만들려고 넣은 장치가 지표를 깎는다. 되묻기 전후는 `scaffold_triggered` 의 `next_char_len` 이 따로 잡는다
- **`retry_of` 는 결과(a)를 받은 뒤 같은 카드를 다시 풀 때만 채운다.** 그것이 `card_retry` 이벤트가 재는 재시도율이고, 그때는 일일 카운트를 다시 쓰지 않는다 (A0-3, W4)

**차단(`outcome=blocked`) 시 아이가 쓴 문장을 지우지 않는다** (2026-09-07 확정). 입력창에 그대로 남긴다 — 되묻기·전송 중과 같은 규칙이다. **이유도 모른 채 공들여 쓴 글이 사라지면 그것 자체가 벌로 읽힌다.** 같은 문장을 다시 보내면 서버가 다시 막으면 되고, PII 는 클라이언트 마스킹(E-2)이 붙으면 애초에 여기까지 오지 않는다.

**서버에 닿지 못했을 때도 같다** (2026-09-08 추가). **화면을 넘기지 않고 카드 자리에 머문다.** 위 규칙이 되묻기·차단·전송 중만 덮고 **못닿음이 빠져 있었다** — 실제로 화면을 넘기고 있었고, 넘어간 화면의 「다시 열기」는 **다른 카드**를 불러오므로 **입력칸에 남은 문장이 앞 장면에 쓴 글인 채로 새 장면에 붙는다.** 아이는 **자기 글을 잃고, 잃은 줄도 모른다.** 문구는 `문구.md` 2.4.

**응답은 `outcome`에 따라 세 형태** (HTTP 200 공통)

**(a) 정상 — 결과 연출**
```json
{
  "outcome": "result",
  "attempt_id": "...",
  "tier": "rare",
  "highlights": [ { "text": "은빛", "kind": "adj" }, { "text": "살금살금", "kind": "adv" } ],
  "guide": { "expression": "compass_bright", "line": "'살금살금'이 나침반을 움직였어!" },
  "artwork": { "artwork_id": "...", "status": "pending", "url": null, "placeholder_url": "https://r2/.../c01_sketch.webp" },
  "today": { "cards_done": 3, "cap": 5, "locked": false },
  "can_retry": true
}
```
- `tier` ∈ `basic | rare | legendary`. **등급 문자(G0~G3)는 절대 응답에 넣지 않음** (로그 전용)
- `highlights`는 Evaluator가 감지한 묘사어. 프론트는 입력문 위에 하이라이트
- **서버는 `highlights[].text` 가 아이 입력문에 그대로 있는 것만 내려보낸다** (2026-09-07 추가). Evaluator 는 LLM 이라 **활용형을 바꾸거나 원형으로 돌려줄 수 있다**(「살금살금거리며」 → 「살금살금」). 원문에 없는 것을 그대로 내보내면 **프론트에서 하이라이트가 조용히 사라진다** — 화면은 멀쩡해 보이고 보상만 없어진다.
  **서버가 원문 대조로 걸러낸다.** 위치(offset)를 주지 않는 이유는 한글 조합·이모지에서 인덱스가 어긋나기 쉽고, 계약이 커지기 때문이다.
- **프론트는 그래도 못 찾으면 조용히 건너뛴다.** 서버 보장 위에 서되 **없으면 화면이 죽지 않아야 한다** — 하이라이트는 보상이지 필수 정보가 아니다
- `artwork.status = pending` → 5절로 폴링/구독

**(b) 스캐폴딩 — G0 되묻기**
```json
{
  "outcome": "scaffold",
  "attempt_id": "...",
  "guide": { "expression": "compass_dim", "line": "나침반이 안 움직이네. 그림자를 어떻게 할 건지 조금만 더 말해줄래?" },
  "scaffold_count": 1,
  "today": { "cards_done": 2, "cap": 5, "locked": false }
}
```
- 카드 미소모. 프론트는 입력창 유지, 기존 텍스트 보존
- `scaffold_count` 2 이후 같은 카드 재제출은 서버가 G1 취급으로 (a) 반환

**(c) 차단 — Moderation / PII**
```json
{
  "outcome": "blocked",
  "reason": "moderation",
  "guide": { "expression": "compass_dim", "line": "나침반이 그 말은 못 알아듣네. 다르게 말해줄래?" },
  "today": { "cards_done": 2, "cap": 5, "locked": false }
}
```
- **`reason` 은 `moderation` 하나다** (2026-09-08 정정, 대표 판정). 종전 `moderation | pii` 에서 **`pii` 를 뺐다** — **PII 는 막지 않고 가린 뒤 진행하므로 차단 응답이 나오지 않는다** (미결 11-5 확정). 카테고리는 **응답에 포함하지 않음** (아이에게 "나쁜 말" 피드백 금지). 로그에만 기록
- 카드 미소모

### GET `/attempts/{attempt_id}` → (a) 형식 재조회 (새로고침 복구)

---

## 5. 삽화 (Artworks)

### GET `/artworks/{artwork_id}`
```json
{ "artwork_id": "...", "status": "ready", "url": "https://r2/.../a.webp", "tier": "rare", "fallback": false }
```
- `status` ∈ `pending | ready | failed`

**통지 방식: 폴링.** 미결 11-1 확정 (2026-09-06, 근거 `api/benchmarks/W1-image-bench.md` 실측 평균 6.2초·최대 8.1초).
**SSE는 Stage 0에서 만들지 않는다** — 이벤트 1회를 위해 연결 유지·프록시 타임아웃·재연결·모바일 백그라운드 전환을 다 얹을 값이 없다. Stage 1 GM 서사 스트리밍과 함께 판단한다.

| 항목 | 값 |
|---|---|
| **첫 폴링** | `POST /attempts` 응답(`artwork.status = pending`) 후 **3초 뒤** |
| 이후 간격 | 2초 |
| 타임아웃 | 15초 |

**첫 폴링을 3초 미룬다.** 즉시 시작하면 평균 6.2초 동안 확실히 헛도는 요청이 3회 나간다. 요청 수가 7~8회 → 4~5회로 준다. 실측 최소가 6초대라 3초는 안전하다.

**폴링 중단 조건 — 생성 실패와 네트워크 실패를 구분한다**

| 상황 | 처리 |
|---|---|
| 네트워크 오류·5xx | 같은 간격으로 계속. **별도 재시도 카운터를 두지 않는다** — 15초 타임아웃이 이미 상한이다 |
| `status = failed` | **즉시 중단.** `placeholder_url` 유지 |
| 15초 초과 | 중단. 서버도 15초 초과 시 `status = ready, fallback = true, url = 캐시 기본 에셋`으로 확정하므로 마지막 응답이 기본 에셋을 준다 (B-3) |

**기다리는 6~8초는 가이드 대사로 메운다** — C-1 대사 세트에 「삽화 대기」가 MUST로 추가됐다 (W2).

---

## 6. 내 책 (Book)

### GET `/book`
```json
{
  "book_id": "...",
  "title": "불꽃탐험가의 모험",
  "visibility": "private",
  "pages": [
    { "page_no": 1, "source": "card", "source_id": "c01", "tier": "legendary",
      "artwork_url": "...", "text": "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다", "achieved_at": "..." }
  ],
  "counts": { "basic": 3, "rare": 5, "legendary": 2 }
}
```
- 자녀 1명 = 책 1권 (Stage 0). 카드별 **최고 티어 시도 1건**이 한 페이지. 재시도로 티어가 오르면 페이지 교체
- `text`는 항상 반환 (아이의 책 콘텐츠, PRD 1.1b). 맞춤법·AI 보정 없음
- `visibility`는 Stage 0에서 항상 `private`. 필드만 선반영 (P1 공유 서재)
- 프론트: 삽화 위·문장 아래·페이지 번호의 책 페이지 프레임으로 렌더

### GET `/book/today` → 세션 종료 화면용. 오늘 추가·교체된 페이지만

### PATCH `/book` → `{ "title": "..." }` (SHOULD, PII 검사)

---

## 7. 이벤트 (Events) — 클라이언트 발생분

서버 측 이벤트(`turn_input`, `eval_result`, `scaffold_triggered`, `moderation_blocked`, `pii_masked`, `daily_cap_reached`)는 백엔드가 자동 기록. 아래는 **클라이언트만 아는 이벤트**.

### POST `/events`
```json
{ "events": [
  { "event": "session_start", "ts": "...", "locked": false },
  { "event": "card_shown", "ts": "...", "card_id": "c01" },
  { "event": "pii_masked", "ts": "...", "layer": "client", "kind": "phone" }
] }
```
- 배치 전송 (최대 50건). 원문 필드 없음. 204

**서버 몫 이벤트는 거절한다** (2026-09-08 명세 추가). 받는 것은 `session_start` · `card_shown` · `pii_masked` **셋뿐**이다.

- 나머지(`turn_input` · `eval_result` · `scaffold_triggered` · `moderation_blocked` · `daily_cap_reached`)가 실려 오면 **버린다.** 받아 주면 **H2 가 통째로 위조된다** — **글자 수와 등급이 곧 합격선**이라, 클라이언트가 그 둘을 직접 써넣을 수 있으면 파일럿 판정이 성립하지 않는다
- **배치 전체를 물리지 않는다.** 어긋난 건만 버리고 **204** 를 준다. 한 건 때문에 되돌리면 **화면이 재전송을 반복한다**
- **`pii_masked` 의 `layer` 는 서버가 `client` 로 덮는다.** 클라이언트가 `server` 라고 보내도 그렇다 — **어느 층이 잡았는지를 클라이언트 말로 정하지 않는다.** 서버측 2차 마스킹(E-2)이 남기는 `layer: server` 와 섞이면 **두 층의 실측이 한 값으로 뭉개진다**
- 목록에 없는 키는 **화이트리스트(`EVENT_FIELDS`)에서 예외로 죽는다.** **목록에 없는 것이 곧 차단**이다

---

## 8. Fake Door (F-2) — 별도 정적 사이트, 이 API 사용 안 함

랜딩은 정적 호스팅 + 폼 서비스(예: 서버리스 함수 1개)로 분리. 이벤트 4종(`visit`, `signup`, `report_optin`, `pricing_click`)은 분석 툴로 직접 수집. 본 백엔드와 DB를 공유하지 않음.

---

## 9. 서버 내부 처리 순서 (POST /attempts)

```
1. 쿠키(`__Host-gm_child`)·역할 검증, **`token_version` DB 대조**(다르면 401), rate limit
2. 일일 카운트 확인 (retry_of 없으면) → 소진 시 409
3. PII 2차 검사 (NER) → **감지 시 마스킹 후 진행**(막지 않는다), `pii_masked`(`layer: server`) 로그
   - **2026-09-08 대표 판정** (미결 11-5). 종전 「`outcome=blocked(pii)`」를 뒤집은 것이 아니라 **어긋나 있던 한 줄을 맞춘 것**이다 — PRD E-2 는 처음부터 「감지 시 **마스킹 후 처리**」였고, 클라이언트 층은 **2026-09-07 대표 판정으로 이미 「가리되 막지 않는다」**였다
   - **막으면 아이에게 이유를 말해줄 수 없다.** 위 (c) 가 종류를 응답에 안 싣기 때문이다 — 아이는 영문을 모른 채 같은 문장을 다시 보낸다
   - **NER 이 잡는 것은 실명이다**(학교명은 서버 정규식 몫, 미결 11-6). 실명은 **아이가 지은 가이드 이름·괴물 이름과 가장 헷갈린다.** 막기였으면 **오탐 하나가 아이를 그 카드에서 못 나가게 했다**
   - **마스킹된 텍스트가 그대로 아래 10번의 `card_attempts.text` 로 가고 책 콘텐츠가 된다.** `○○○` 가 책에 인쇄되는 것을 **판정과 함께 받아들였다**
4·5. **입력 Moderation 과 Evaluator 를 동시에 던진다** (`adr/0009`, 2026-09-07 대표 판정)
   - **순차로 두면 +875ms 라 1.5초 예산을 깬다.** 동시면 +13ms 다. 검사 결과가 평가의 입력이 아니므로 순서를 강제할 이유가 없다
   - **차단이면 평가 결과를 버리고 `eval_result` 도 남기지 않는다.** 남기면 화면에 보여주지도 않은 판정이 **등급 분포·폴백 비율을 오염**시킨다. 차단 건의 평가 비용은 수용한다
   - **Moderation** — 별도 단계다(내장 필터 아님). 차단 시 outcome=blocked(moderation), moderation_blocked 로그
   - **자해·자살 카테고리만 뒤 처리가 다르다** — `category: self_harm` 으로 남기고, 아이에게는 「어른에게 말해줘」 한 줄만 준다. **더 대화하지 않는다.** 원문은 안 남긴다 (`MVP_PRD.md` E-1 「자해·자살 신호 처리」)
   - **Evaluator** — Gemini, thinking budget 최소, 예시셋 context caching (`adr/0005`) → grade, signals. 타임아웃 3초 → 재시도 1회 → 실패 시 grade=G1 폴백 + 로그 (아이를 막지 않음)
6. grade == G0 && scaffold_count < 2 → outcome=scaffold, scaffold_triggered 로그
7. grade → tier 매핑 (G0/G1 basic, G2 rare, G3 legendary)
8. 캐릭터 대사 템플릿 치환 (카드 명사 태그 + signals)
9. artworks 행 생성(pending) → 이미지 생성 큐 (티어별 프롬프트 + 고정 태그 + 시드)
10. card_attempts 저장(text 포함), 일일 카운트 증가 (retry_of 없을 때만), turn_input·eval_result 로그
10b. 해당 카드의 최고 티어면 book_pages upsert (삽화 ready 시 artwork_id 갱신)
11. outcome=result 응답
```

---

## 10. 데이터 모델 대응 (PRD 6장)

| 테이블 | 이 명세에서 쓰는 곳 |
|---|---|
| `parents` | 1절 |
| `children` | 1·2절. `guide_name`, `access_code_hash`, `daily_cap`, `timezone`, **`token_version INTEGER NOT NULL DEFAULT 1`** 추가 |
| `cards` | 3절. `type`, `situation`, `noun_tags[]`, `sketch_r2_key` |
| `card_attempts` | 4절. `grade`, `tier`, `signals JSON`, `scaffold_count`, `retry_of`, `prompted`, `text` (항상 보관, 책 콘텐츠) |
| `books` / `book_pages` | 6절. 자녀당 1권 자동 생성, 카드 최고 티어 시도 → 페이지 upsert |
| `parents.labeling_consent` | 1절. 라벨링 셋 추출 시 필터 |
| `artworks` | 5절. `status`, `r2_key`, `tier`, `fallback` |
| `events` | 7절 + 서버 자동 기록 |
| Redis | `daily:{child_id}:{date}` 카운터, `scaffold:{child_id}:{card_id}:{date}` 횟수, 이미지 큐 |
