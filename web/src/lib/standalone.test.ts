import { describe, expect, it } from "vitest";

import { 실행형태판정 } from "./standalone";

/**
 * **이 판정이 틀리는 방향은 대칭이 아니다** (`standalone.ts` 머리 주석).
 * 탭을 홈 화면 앱으로 잘못 보면 아이가 1회용 코드를 써버리고 **학부모가 재발급해야만** 들어온다.
 * 그래서 아래 케이스들은 「맞게 판정하나」보다 **「모를 때 어느 쪽으로 접나」**를 더 많이 본다.
 */
describe("실행형태판정", () => {
  it("서버(정적 빌드)에서는 확인중이다 — 첫 HTML 이 한쪽으로 단정하면 화면이 번쩍인다", () => {
    expect(실행형태판정(undefined)).toBe("확인중");
  });

  it("미디어 질의가 맞으면 홈 화면 앱이다", () => {
    expect(
      실행형태판정({ matchMedia: () => ({ matches: true }) }),
    ).toBe("홈화면앱");
  });

  it("미디어 질의가 아니면 브라우저 탭이다", () => {
    expect(
      실행형태판정({ matchMedia: () => ({ matches: false }) }),
    ).toBe("브라우저탭");
  });

  it("iOS 는 `navigator.standalone` 만 참일 수 있다 — 미디어 질의가 거짓이어도 홈 화면 앱이다", () => {
    // iOS 26 미만에서 실제로 이 조합이다. 미디어 질의만 보면 아이가 설치 안내에 갇힌다.
    expect(
      실행형태판정({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: true },
      }),
    ).toBe("홈화면앱");
  });

  it("`matchMedia` 가 없어도 죽지 않고 브라우저 탭으로 접는다", () => {
    expect(실행형태판정({})).toBe("브라우저탭");
  });

  it("`navigator.standalone` 이 문자열이면 홈 화면 앱으로 보지 않는다 — `\"false\"` 도 참 같은 값이다", () => {
    // `=== true` 로 좁힌 이유가 이것이다. 느슨하게 보면 **위험한 쪽으로** 틀린다.
    expect(
      실행형태판정({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: "false" },
      }),
    ).toBe("브라우저탭");
  });

  it("확인중은 판정을 못 했을 때만이다 — 브라우저에서는 절대 확인중이 안 나온다", () => {
    // 화면이 「확인중」에 걸려 있으면 아이는 아무것도 못 한다. 그 자리를 열어두지 않는다.
    for (const win of [
      {},
      { matchMedia: () => ({ matches: true }) },
      { matchMedia: () => ({ matches: false }) },
      { navigator: { standalone: true } },
      { navigator: {} },
    ]) {
      expect(실행형태판정(win)).not.toBe("확인중");
    }
  });
});
