import { defineConfig } from "@playwright/test";

/**
 * **브라우저가 진짜 api 를 무는 하네스** (`주차계획/W6.md` 프론트 6번).
 *
 * **왜 세 번째 설정이 필요한가.** 앞의 둘은 **서버를 안 탄다** —
 * 빠른 갈래(`playwright.config.ts`)는 브라우저에서 응답을 가로채고,
 * 정적 갈래(`playwright.static.config.ts`)도 같다. **둘 다 api 가 죽어 있어도 초록이다.**
 * 그래서 **프로세스 경계에서만 나는 것**을 아무도 안 잰다: 쿠키가 실제 응답 헤더로 나가
 * 브라우저가 받고 다음 요청에 싣는 것 · 라우팅 접두사 · 한 오리진 프록시.
 *
 * **백엔드가 같은 갈래를 HTTP 로 이미 잰다** (`api/tests/test_e2e_server.py`).
 * **여기가 더하는 것은 브라우저다** — 화면이 그 응답으로 실제로 무엇을 그리는가.
 *
 * **⛔ 갈래 하나다. 넓히지 않는다.** 계획이 「넓히는 것보다 CI 에서 도는 것이 먼저다」로
 * 정했고, **W3·W4 에서 두 번 미룬 자리**라 무거워지면 또 미룬다.
 *
 * **⚠ 빠른 갈래와 동시에 못 돈다** — `next dev` 는 프로젝트 디렉터리당 하나다.
 * **⚠ DB 가 떠 있어야 한다** — `make db-up`.
 *
 * ```
 * make db-up && pnpm e2e:server
 * ```
 */
export default defineConfig({
  testDir: "./e2e",
  // **이 하네스는 자기 스펙만 돈다.** 나머지를 여기서 돌리면 **가로채기를 전제로 쓴 검사들**이
  // 진짜 서버를 물고 빨개진다 — 정적 하네스가 자기 스펙만 도는 것과 같은 이유다.
  testMatch: "**/server.spec.ts",
  reporter: "list",
  // 진짜 서버·진짜 DB 라 한 걸음이 더 걸린다. **그림은 굽는 시간이 따로 있다.**
  expect: { timeout: 20_000 },
  timeout: 120_000,
  // **갈래가 하나라 병렬이 의미 없다.** 그리고 서버가 하나라 섞이면 서로를 방해한다.
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3003",
    // **여기서는 서비스워커를 막을 이유가 없다** — `sw.js` 를 지웠다 (`adr/0014`).
    // 막아 두면 **없어진 것을 계속 막는 설정**이 남아 다음 사람이 아직 있다고 읽는다.
  },
  projects: [
    // **하나면 된다.** 뷰포트를 가르는 것은 화면을 재는 빠른 갈래의 몫이고,
    // 여기가 재는 것은 **서버까지 닿는가**다.
    { name: "서버까지", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "node e2e/_서버하네스.mjs",
    url: "http://127.0.0.1:3003",
    // **떠 있는 것을 재사용하지 않는다.** 남이 띄운 서버를 조용히 재는 것이
    // 이 저장소가 한 번 겪은 사고다 (`playwright.config.ts` 머리말).
    reuseExistingServer: false,
    // 가짜 앞단 + uvicorn + `next dev` 셋이 순서대로 뜬다. 첫 컴파일까지 있다.
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
