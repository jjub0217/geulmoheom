import { describe, expect, it } from "vitest";

import { 액자에둘것, 챕터가바뀌었나 } from "@/lib/chapter-artwork";

const 그림 = (id: string) => ({ artwork_id: id, status: "ready" as const, url: `/i/${id}` });

/**
 * **재는 것은 「비우지 않는다」 하나다** (`api/Stage1.md` · W7 8번).
 * 핵심 씬이 1턴·9턴 둘뿐이라 **여덟 턴은 `artwork` 가 `null`** 로 온다.
 */
describe("액자에둘것 — null 은 「없다」가 아니라 「그대로」다", () => {
  it("새 그림이 오면 갈아 끼운다", () => {
    expect(액자에둘것(그림("a"), 그림("b"))).toEqual(그림("b"));
  });

  it("⛔ null 이 와도 직전 그림을 그대로 둔다 — 여기가 8번의 전부다", () => {
    // 비우면 **여덟 턴 중 일곱에서 보상이 사라진다.**
    expect(액자에둘것(그림("a"), null)).toEqual(그림("a"));
  });

  it("`undefined`(필드 자체가 없음)도 같게 다룬다", () => {
    // 계약에서 `artwork?: ArtworkRef | null` 이라 **둘 다 온다.**
    // 하나만 막으면 **다른 하나로 새고, 새는 쪽이 조용하다.**
    expect(액자에둘것(그림("a"), undefined)).toEqual(그림("a"));
  });

  it("첫 턴 전에는 비어 있다 — 없는 것을 지어내지 않는다", () => {
    expect(액자에둘것(null, null)).toBeNull();
  });
});

describe("챕터가바뀌었나 — 남의 장면 그림을 안 보여준다", () => {
  it("다른 챕터면 버린다", () => {
    expect(챕터가바뀌었나("ch-1", "ch-2")).toBe(true);
  });

  it("⛔ 같은 챕터를 이어하면 안 버린다 — 새로고침으로 돌아온 아이다", () => {
    expect(챕터가바뀌었나("ch-1", "ch-1")).toBe(false);
  });

  it("첫 챕터는 버릴 것이 없다", () => {
    expect(챕터가바뀌었나(null, "ch-1")).toBe(false);
  });
});
