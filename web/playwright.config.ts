import { defineConfig } from "@playwright/test";

/**
 * 브라우저에서 화면을 확인한다. `pnpm e2e` 로 로컬에서만 돈다 — **CI 에는 아직 안 붙인다.**
 *
 * **서버를 타지 않는다.** api 응답은 스펙이 브라우저에서 가로채 고정 JSON 으로 돌려준다.
 * 이유는 셋 — ① 「서버에 못 닿음」 화면은 api 를 내려야 만들어지는데 그러면 테스트가 자기 전제를 부순다
 * ② 묘사 평가는 실제 유료 호출이라 매번 태우면 돈이 나가고 결과가 흔들린다
 * ③ 목 픽스처(`api/app/api/v1/_fixtures.py`)의 문장이 정본으로 고쳐질 때 스펙이 같이 깨지면 안 된다.
 * **서버까지 붙는 진짜 E2E 는 W3 에 `ci.yml` 계약 검증과 같이 붙인다** (`web/tasks/W2.md` 메모).
 *
 * 뷰포트 둘은 PRD 비기능 접근성의 MUST 를 숫자로 박은 것이다 — 태블릿 가로가 기준 폭이고,
 * 매니페스트에 `orientation` 을 두지 않았으므로 **모바일 세로는 실제로 들어온다.**
 */
export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  // 코드를 고친 뒤 첫 실행은 Next 가 그 화면을 처음 컴파일하는 시간과 겹친다 —
  // 기본 5초로는 첫 한두 개가 애매하게 실패한다. 진짜 실패와 구분하기 위해 여유를 준다.
  expect: { timeout: 10_000 },
  use: { baseURL: "http://localhost:3000" },

  projects: [
    { name: "태블릿 가로", use: { viewport: { width: 1280, height: 800 } } },
    { name: "모바일 세로", use: { viewport: { width: 390, height: 844 } } },
  ],

  // 서버는 Playwright 가 띄우고 끝나면 내린다 — 사람이 쓰던 3000 을 뺏지 않기 위한 것이다.
  webServer: {
    command: "pnpm dev --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      // **api 를 같은 오리진으로 부르게 만든다.** 코드에 기본값이 없으므로 여기서 안 주면
      // 요청 전에 죽고, 진짜 주소(`https://api.geulmoheom.test:8000`)를 주면 cross-origin 이 되어
      // 개발용 `Authorization` 헤더 때문에 브라우저가 **preflight(OPTIONS)** 를 먼저 보낸다.
      // Playwright 의 `page.route` 는 그 preflight 를 가로채지 못해서, 가로채기가 걸리기도 전에
      // 요청이 죽고 화면이 통째로 「못 닿음」으로 떨어진다 — 실제로 그렇게 8개가 한 번에 실패했다.
      // 여기서는 서버를 안 타므로 오리진이 어디든 상관없다. 진짜 api 를 태우는 것은 W3 다.
      NEXT_PUBLIC_API_BASE_URL: "/api/v1",
    },
  },
});
