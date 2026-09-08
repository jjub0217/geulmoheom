import { describe, expect, it } from "vitest";

import { 첫폴링, 폴링간격, 폴링상한 } from "./artwork";

/**
 * `docs/api/Stage0.md` 5절. **숫자 셋이 실측에서 나온 것**이라 여기서 값을 못 박는다
 * (`api/benchmarks/W1-image-bench.md` 평균 6.2초·최대 8.1초).
 *
 * **훅 자체는 E2E 가 본다** — 여기서는 **규약이 조용히 바뀌는 것**을 막는다.
 */
describe("폴링 규약 숫자", () => {
  it("첫 폴링을 3초 미룬다 — 즉시 시작하면 헛도는 요청이 3회다", () => {
    // 실측 최소가 6초대라 3초는 안전하다. 0 으로 바꾸면 **평균 6.2초 동안 확실히 헛돈다.**
    expect(첫폴링).toBe(3_000);
  });

  it("간격 2초 · 상한 15초", () => {
    expect(폴링간격).toBe(2_000);
    expect(폴링상한).toBe(15_000);
  });

  it("첫 폴링이 상한보다 훨씬 앞이다 — 한 번은 반드시 물어본다", () => {
    // 첫 폴링이 상한을 넘으면 **한 번도 안 물어보고 「못받음」이 된다.**
    expect(첫폴링).toBeLessThan(폴링상한);
    // 상한 안에 최소 다섯 번은 들어간다 — 실측 최대(8.1초)를 넉넉히 덮는다.
    expect(Math.floor((폴링상한 - 첫폴링) / 폴링간격)).toBeGreaterThanOrEqual(5);
  });
});
