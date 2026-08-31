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
{ "parent_id": "...", "token": "<parent_jwt>", "consent_at": "2026-09-01T00:00:00Z" }
```
- `consent: true`가 아니면 422. 동의 문구 버전은 서버가 `consent_version`으로 기록
- 라벨링 동의(아이 문장을 Evaluator 개선용 라벨링에 활용, 파일럿 종료 시 사본 파기)는 **별도 체크박스** → `labeling_consent: bool`. 거부해도 서비스 이용 가능, 책에는 원문이 그대로 남음

### POST `/parents/login` → `{ token }`

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

### POST `/parents/children/{child_id}/access-code` → 재발급 `{ access_code, access_code_expires_at }`

### PATCH `/parents/children/{child_id}` → `{ daily_cap }` (SHOULD, 10~20)

### DELETE `/parents/children/{child_id}` → 204. 자녀 데이터 즉시 파기 (attempts, books, artworks, events, Redis)

---

## 2. 자녀 인증 (Child Auth)

### POST `/child/auth`
```json
// req
{ "access_code": "482913" }
// res
{ "token": "<child_jwt>", "child": { "child_id": "...", "nickname": "...", "guide_name": null } }
```
- 코드 소진 후 재사용 불가. 토큰 30일, 기기 쿠키(HttpOnly)에 보관

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
  "situation": "안개 낀 숲에서 나무 사이로 거대한 그림자가 천천히 다가온다. 발밑에서 나뭇가지가 툭 부러진다.",
  "prompt_label": "탐험가는 어떻게 할까?",
  "sketch_url": "https://r2/.../c01_sketch.webp",
  "guide": { "expression": "default", "line": "나침반이 조용하네. 네가 뭘 할지 말해주면 움직일 거야!" },
  "today": { "cards_done": 2, "cap": 5 }
}
```
- 소진 시 409 `DAILY_CAP_REACHED` + body에 `guide.line`("내일 또 보자") 포함
- `guide.line`은 서버 템플릿 치환 결과 (PRD 4.0). 프론트는 그대로 표시

### GET `/cards/{card_id}` → 단일 카드 (재시도 화면 복귀용)

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
- `reason` ∈ `moderation | pii`. 카테고리는 **응답에 포함하지 않음** (아이에게 "나쁜 말" 피드백 금지). 로그에만 기록
- 카드 미소모

### GET `/attempts/{attempt_id}` → (a) 형식 재조회 (새로고침 복구)

---

## 5. 삽화 (Artworks)

### GET `/artworks/{artwork_id}`
```json
{ "artwork_id": "...", "status": "ready", "url": "https://r2/.../a.webp", "tier": "rare", "fallback": false }
```
- `status` ∈ `pending | ready | failed`
- 프론트: 2초 간격 폴링, **15초 초과 시** 폴링 중단하고 `placeholder_url` 유지. 서버도 15초 초과 시 `status = ready, fallback = true, url = 캐시 기본 에셋`으로 확정 (B-3)
- SHOULD: `GET /attempts/{id}/stream` (SSE) — `artwork_ready` 이벤트 1회. 폴링 대체

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

---

## 8. Fake Door (F-2) — 별도 정적 사이트, 이 API 사용 안 함

랜딩은 정적 호스팅 + 폼 서비스(예: 서버리스 함수 1개)로 분리. 이벤트 4종(`visit`, `signup`, `report_optin`, `pricing_click`)은 분석 툴로 직접 수집. 본 백엔드와 DB를 공유하지 않음.

---

## 9. 서버 내부 처리 순서 (POST /attempts)

```
1. 토큰·역할 검증, rate limit
2. 일일 카운트 확인 (retry_of 없으면) → 소진 시 409
3. PII 2차 검사 (NER) → 감지 시 outcome=blocked(pii), pii_masked 로그
4. 입력 Moderation → 차단 시 outcome=blocked(moderation), moderation_blocked 로그
5. Evaluator 호출 (Gemini, thinking budget 최소, 예시셋 context caching — 모델명 미정, `adr/0005`) → grade, signals
   - 타임아웃 3초 → 재시도 1회 → 실패 시 grade=G1 폴백 + 로그 (아이를 막지 않음)
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
| `children` | 1·2절. `guide_name`, `access_code_hash`, `daily_cap`, `timezone` 추가 |
| `cards` | 3절. `type`, `situation`, `noun_tags[]`, `sketch_r2_key` |
| `card_attempts` | 4절. `grade`, `tier`, `signals JSON`, `scaffold_count`, `retry_of`, `prompted`, `text` (항상 보관, 책 콘텐츠) |
| `books` / `book_pages` | 6절. 자녀당 1권 자동 생성, 카드 최고 티어 시도 → 페이지 upsert |
| `parents.labeling_consent` | 1절. 라벨링 셋 추출 시 필터 |
| `artworks` | 5절. `status`, `r2_key`, `tier`, `fallback` |
| `events` | 7절 + 서버 자동 기록 |
| Redis | `daily:{child_id}:{date}` 카운터, `scaffold:{child_id}:{card_id}:{date}` 횟수, 이미지 큐 |
