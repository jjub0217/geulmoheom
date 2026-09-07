import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // **`tsconfig.json` 의 `@/*` 와 같은 자리를 가리켜야 한다.** 여기 없으면 `tsc` 와 eslint 는
    // 통과하는데 vitest 만 「패키지를 못 찾겠다」로 죽는다 — 코드가 아니라 러너 설정 문제인데
    // 오류는 import 줄을 가리켜서 엉뚱한 데를 뜯게 된다.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // `src/` 안의 유닛 테스트만 vitest 가 가져간다.
    // `e2e/` 는 Playwright 것이다 — 두 러너가 같은 파일을 집으면 vitest 가 브라우저 API 를 못 찾아 죽는다.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
