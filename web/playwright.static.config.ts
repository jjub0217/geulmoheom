import { defineConfig } from "@playwright/test";

/**
 * **정적 빌드를 Safari 엔진으로 재는 하네스** (2026-09-09).
 *
 * **왜 따로 있나.** 기본 설정(`playwright.config.ts`)은 **`next dev` 를 Chromium 으로** 잰다.
 * 그런데 **배포되는 것은 정적 빌드**이고(`output: "export"`, `adr/0007`) **아이가 쓰는 것은 Safari** 다.
 * 2026-09-08~09 에 **그 둘이 실제로 다르게 동작**했다 —
 * ① 실기기에서 **dev 번들은 눌러도 안 돌고 정적 빌드는 돈다**
 * ② 같은 정적 빌드를 **Chromium 은 액자 비율 0.579 로, 실기기 Safari 는 1.10** 으로 그렸다.
 * **하루가 그 둘을 가르는 데 갔다.** 이 파일은 그 갈래를 **아이패드 없이** 기계가 가르게 한다.
 *
 * **⚠ 한계 — 「사파리로 잰다」가 「그 기기의 사파리로 잰다」는 아니다.**
 * 여기 도는 WebKit 은 **Playwright 가 받아 오는 최신 빌드**(2026-09-09 기준 26.6)이고,
 * 프리테스트에 쓰는 **iPad 6세대는 iPadOS 17 이 마지막이라 영원히 17.7** 이다.
 * **그래서 이 갈래는 「배포 형태에서만 갈리는 것」은 잡지만 「그 기기에서만 갈리는 것」은 못 잡는다** —
 * 2026-09-09 의 액자 건(여기서 0.579, 실기기에서 1.10)이 정확히 후자였다.
 * **여기가 초록인 것을 「기기에서도 된다」로 읽지 않는다.**
 *
 * **기본 검사를 대체하지 않는다.** 빠른 갈래는 그대로 `next dev`·Chromium 이다 —
 * 이건 **배포 형태를 재는 두 번째 자리**이고, 돌리려면 **먼저 구워야 한다.**
 *
 * ```
 * NEXT_PUBLIC_API_BASE_URL=/api/v1 pnpm build
 * pnpm e2e:static
 * ```
 *
 * **`NEXT_PUBLIC_API_BASE_URL` 을 상대 경로로 굽는 이유** — 정적 서버와 api 를 같은 오리진으로
 * 보게 만들어 **브라우저가 preflight 를 안 보내게** 한다. `page.route` 는 preflight 를 못 가로챈다.
 * **실기기용 빌드는 이것과 다르다** (`make build-out` 이 LAN 주소를 박는다). **섞지 않는다.**
 */
export default defineConfig({
  testDir: "./e2e",
  // **이 하네스는 자기 스펙만 돈다.** 기본 스펙 전부를 여기서 돌리면
  // 서비스워커 검사(`pwa.spec.ts`)처럼 **여기서 일부러 끈 것을 재는 검사**가 빨개진다.
  // **여기 있는 것은 「배포 형태에서만 갈리는 것」뿐**이고, 나머지는 빠른 갈래가 이미 잰다.
  testMatch: "**/static-safari.spec.ts",
  reporter: "list",
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3002",
    // **서비스워커를 막는다.** 정적 빌드는 `sw.js` 를 등록하는데(`public/sw.js`),
    // **서비스워커가 낸 요청은 `page.route` 가 못 가로챈다** — 첫 GET 은 등록 전이라 잡히고
    // 그 뒤 POST 는 빠져나가 정적 서버로 가서 **501 로 죽는다.**
    // 그러면 화면이 「서버가 거절했다」로 떨어지는데, **제품이 아니라 하네스가 만든 실패**다.
    // 서비스워커 자체를 재는 것은 `e2e/pwa.spec.ts` 의 몫이다.
    serviceWorkers: "block",
  },

  projects: [
    // **아이패드 6 가로.** 실기기가 그 값이고(1024×768, 크롬 제외 약 748) 잘림이 거기서 나왔다.
    {
      name: "아이패드 사파리",
      use: { browserName: "webkit", viewport: { width: 1024, height: 748 } },
    },
  ],

  // **구운 것을 그대로 낸다.** `next start` 가 아니다 — 정적 내보내기라 Node 서버가 없고,
  // **있는 척하면 이 하네스가 재려는 것(배포 형태)이 아니게 된다.**
  webServer: {
    command: "python3 -m http.server 3002 --directory out",
    url: "http://localhost:3002",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
