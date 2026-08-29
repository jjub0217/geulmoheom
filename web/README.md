# web — 글모험 프론트 (Next.js PWA)

대표가 직접 초기화. 아래는 합의된 전제.

- Next.js App Router, TailwindCSS, Zustand. 태블릿 가로 우선
- API 타입: `src/api/types.gen.ts` — `make contracts`로 생성, **수동 편집 금지**
- 캐릭터 에셋: `docs/캐릭터/` PNG를 `public/guide/`로 복사해 사용. `guide.expression` 값 → 파일 매핑
  - `default` → 캐릭터(기본_안내_서사_진행중).png
  - `compass_bright` → 캐릭터(좋은 묘사 썻을때).png
  - `compass_dim` → 캐릭터(묘사부족).png
  - `farewell` → 캐릭터(세션종료).png
- 클라이언트 1차 PII 마스킹 정규식은 `GET /config/pii-patterns`에서 로드 (API 명세 11절)
- 스크립트 이름 고정: `dev`, `build`, `lint`, `test` (Makefile·CI가 이 이름을 호출)

참조: `docs/MVP_PRD.md` 2·3장, `docs/Stage0_API명세.md`
