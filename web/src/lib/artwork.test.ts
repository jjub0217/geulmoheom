import { describe, expect, it } from "vitest";

import { 첫폴링, 책폴링상한, 폴링간격, 폴링상한 } from "./artwork";

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

  it("카드·본편은 기존 15초 상한을 유지한다", () => {
    expect(폴링간격).toBe(2_000);
    expect(폴링상한).toBe(15_000);
  });

  it("책은 서버의 60초 확정 뒤까지 확인한다", () => {
    expect(책폴링상한).toBe(65_000);
  });

  it("첫 폴링이 상한보다 훨씬 앞이다 — 한 번은 반드시 물어본다", () => {
    // 첫 폴링이 상한을 넘으면 **한 번도 안 물어보고 「못받음」이 된다.**
    expect(첫폴링).toBeLessThan(폴링상한);
    expect(Math.floor((폴링상한 - 첫폴링) / 폴링간격)).toBeGreaterThanOrEqual(1);
    // 책만 60초 확정 뒤에도 한 번 더 묻는다. 그 응답이 기본 삽화까지 돌려준다.
    expect(Math.floor((책폴링상한 - 첫폴링) / 폴링간격)).toBeGreaterThanOrEqual(29);
  });
});
