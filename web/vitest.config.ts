import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `src/` 안의 유닛 테스트만 vitest 가 가져간다.
    // `e2e/` 는 Playwright 것이다 — 두 러너가 같은 파일을 집으면 vitest 가 브라우저 API 를 못 찾아 죽는다.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
