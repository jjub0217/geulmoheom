import { describe, expect, it } from "vitest";

import { 그림이할말 } from "./chapter-artwork-state";

describe("모험 그림이 할 말 — 2026-09-22 사용자 확정", () => {
  it("이번 글로 개인화 그림이 왔으면 새로 왔다고 말한다", () => {
    expect(그림이할말({ kind: "떴다", url: "/a", fallback: false }, true)).toBe("새로왔다");
  });

  it("앞 턴 그림을 다시 보여 주는 것이면 그렇게 말한다 — 이것이 없어서 오해가 났다", () => {
    // **본편 삽화는 한 챕터에 두 번뿐이다.** 나머지 턴은 직전 그림이 그대로 남는데,
    // 그것이 아이 문장 옆에 붙어 있어 **「내 글로 나온 그림」으로 읽혔다.**
    expect(그림이할말({ kind: "떴다", url: "/a", fallback: false }, false)).toBe("앞에서만든것");
  });

  it("만드는 중이어도 이번 글로 만드는 것일 때만 말한다", () => {
    expect(그림이할말({ kind: "기다림" }, true)).toBe("만드는중");
    // 앞 턴 그림을 다시 확인하는 중일 수 있다. 그때 「중요한 순간」이라고 하면
    // **아이가 안 쓴 것을 자기가 한 일로 읽는다.**
    expect(그림이할말({ kind: "기다림" }, false)).toBe("말없음");
  });

  it("⛔ 기본 그림에는 아무 말도 하지 않는다 — 이번 글로 온 것이어도 그렇다", () => {
    // 「새 그림이 완성됐어!」는 거짓이고(아이 문장으로 만든 것이 아니다),
    // 「기본 그림이야」는 「fallback 을 아이에게 알리지 않는다」를 깬다.
    expect(그림이할말({ kind: "떴다", url: "/a", fallback: true }, true)).toBe("말없음");
    expect(그림이할말({ kind: "떴다", url: "/a", fallback: true }, false)).toBe("말없음");
  });

  it("fallback 을 서버가 안 준 옛 응답은 개인화로 본다 — 없는 것을 기본으로 몰지 않는다", () => {
    expect(그림이할말({ kind: "떴다", url: "/a" }, true)).toBe("새로왔다");
  });

  it("못 받았으면 말할 그림이 없다 — 액자 자리가 통째로 빠지는 상태다", () => {
    expect(그림이할말({ kind: "못받음" }, true)).toBe("말없음");
    expect(그림이할말({ kind: "못받음" }, false)).toBe("말없음");
  });
});
