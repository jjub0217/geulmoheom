import { describe, expect, it } from "vitest";

import { 티어이름 } from "./tier-badge";

/**
 * `docs/문구.md` **1.8** · `용어사전.md` 36행. **낱말은 여기 적혀 있고 이 검사는 그 낱말이
 * 아이 화면 열을 벗어나는 것**을 막는다.
 */
describe("티어 배지", () => {
  it("셋 다 있다 — 하나가 비면 그 등급에서 배지가 사라진다", () => {
    expect(Object.keys(티어이름).sort()).toEqual([
      "basic",
      "legendary",
      "rare",
    ]);
    for (const 이름 of Object.values(티어이름)) expect(이름).not.toBe("");
  });

  it("「티어」가 낱말에 안 붙는다 — 그건 내부 용어 열이다", () => {
    // 「희귀」는 되고 **「희귀 티어」는 안 된다.** 사전의 열을 넘지 않는다는 규칙이 여기서 갈린다.
    for (const 이름 of Object.values(티어이름)) {
      expect(이름).not.toContain("티어");
      expect(이름).not.toContain("등급");
    }
  });
});
