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
    // `src/` 안의 유닛 테스트, 그리고 **`e2e/` 의 하네스 자체를 재는 것**만 가져간다.
    // `e2e/` 의 **스펙**은 Playwright 것이다 — 두 러너가 같은 파일을 집으면
    // vitest 가 브라우저 API 를 못 찾아 죽는다. 그래서 **`.spec.ts` 는 안 집고 `.test.ts` 만** 집는다.
    //
    // **하네스도 재야 한다** (2026-09-09). `e2e/_빌드확인.ts` 는 **「이 빌드가 무엇을 향해
    // 구워졌나」를 막는 가드**인데, 그것 자체를 안 재면 **막아 준다고 적혀 있고 아무것도 안 막는
    // 파일**이 된다. 브라우저가 필요 없는 순수 함수라 vitest 로 잰다.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/**/*.test.ts"],
  },
});
