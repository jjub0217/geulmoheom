import { defineConfig } from "@playwright/test";


/**
 * 브라우저에서 화면을 확인한다. **로컬과 CI 에서 같은 명령으로 돈다** (`.github/workflows/ci.yml`
 * `web` 잡 — 2026-09-08 에 붙었다. **W3·W4 에서 두 번 미룬 자리다**).
 *
 * **서버를 타지 않는다.** api 응답은 스펙이 브라우저에서 가로채 고정 JSON 으로 돌려준다.
 * 이유는 셋 — ① 「서버에 못 닿음」 화면은 api 를 내려야 만들어지는데 그러면 테스트가 자기 전제를 부순다
 * ② 묘사 평가는 실제 유료 호출이라 매번 태우면 돈이 나가고 결과가 흔들린다
 * ③ 목 픽스처(`api/app/api/v1/_fixtures.py`)의 문장이 정본으로 고쳐질 때 스펙이 같이 깨지면 안 된다.
 * **서버까지 붙는 진짜 E2E 는 W5 이고 CI 의 다른 잡이다** — Postgres·Redis 와 진짜 api 가 필요해
 * 느리다. **여기 섞으면 매 push 가 느려지고, 느려지면 다음에 또 미루는 이유가 된다.**
 *
 * 뷰포트 둘은 PRD 비기능 접근성의 MUST 를 숫자로 박은 것이다 — 태블릿 가로가 기준 폭이고,
 * 매니페스트에 `orientation` 을 두지 않았으므로 **모바일 세로는 실제로 들어온다.**
 */
export default defineConfig({
  testDir: "./e2e",
  // **정적·Safari 하네스의 스펙은 여기서 안 돈다** (`playwright.static.config.ts`).
  // 이름이 「정적 빌드를 사파리로」인 검사가 **dev 번들 · Chromium 에서 초록이면 그게 거짓말**이다 —
  // 재는 조건이 제목과 다른 검사는 **있는 것만 못하다.**
  // 정적·Safari 하네스의 스펙과, **하네스 자체를 재는 단위 검사**는 여기서 안 돈다.
  // 후자는 vitest 몫이다 — Playwright 가 집으면 **테스트가 없는 파일**로 읽는다.
  testIgnore: ["**/static-safari.spec.ts", "**/server.spec.ts", "**/*.test.ts"],
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
  //
  // **떠 있는 서버를 재사용하지 않는다. 2026-09-08 에 재사용으로 바꿨다가 되돌렸다.**
  // 그날 백엔드가 실기기 확인용으로 `next dev` 를 띄워 둬서 검사가 아예 못 돌았고(**Next 16 은
  // 프로젝트 디렉터리당 dev 서버 하나만 허용한다 — 포트를 바꿔도 안 된다**), 재사용으로 뚫으려 했다.
  // **그러면 남이 띄운 서버를 조용히 재게 된다** — 그 서버는 https 였고 환경 변수도 달랐다.
  // **오늘 하루가 정확히 그 부류의 사고였다**(dev 번들과 정적 빌드가 다르게 동작한 것).
  // **막히는 것이 맞다. 막히면 사람이 조율한다** — 조용히 다른 것을 재는 것보다 낫다.
  webServer: {
    command: "pnpm dev --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    // **CI 러너가 노트북보다 느리다.** 이 값은 「얼마나 기다리나」의 상한이지 고정 대기가
    // 아니라서, 늘려도 로컬이 느려지지 않는다. 짧으면 **첫 컴파일이 안 끝난 채로 죽는다.**
    timeout: 120_000,
    env: {
      // **api 를 같은 오리진으로 부르게 만든다.** 코드에 기본값이 없으므로 여기서 안 주면
      // 요청 전에 죽고, 진짜 주소(`https://api.geulmoheom.test:8000`)를 주면 cross-origin 이 되어
      // `POST /attempts` 의 `Content-Type: application/json` 때문에 브라우저가
      // **preflight(OPTIONS)** 를 먼저 보낸다.
      // Playwright 의 `page.route` 는 그 preflight 를 가로채지 못해서, 가로채기가 걸리기도 전에
      // 요청이 죽고 화면이 통째로 「못 닿음」으로 떨어진다 — 실제로 그렇게 8개가 한 번에 실패했다.
      // 여기서는 서버를 안 타므로 오리진이 어디든 상관없다. 진짜 api 를 태우는 것은 W3 다.
      NEXT_PUBLIC_API_BASE_URL: "/api/v1",
    },
  },
});
