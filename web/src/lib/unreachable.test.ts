import { describe, expect, it } from "vitest";
import { 못닿음원인 } from "./unreachable";

/**
 * 「서버에 못 닿음」이 원인을 삼킨다 — 2026-09-07 하루에 **같은 화면으로 세 번** 나왔다
 * (한글 토큰 · env 이름 어긋남 · Makefile 배관). 셋 다 브라우저는 아무 말도 안 해준다.
 *
 * **개발 빌드에서만 쓰는 표시다.** 아이 화면은 그대로고, 여기 문구는 개발자용이다 —
 * `docs/용어사전.md` 「아이 화면」 열과 무관하다.
 */
describe("못닿음원인", () => {
  it("페이지가 https 인데 api 가 http 면 mixed content 를 가장 먼저 짚는다", () => {
    const 원인 = 못닿음원인("http://localhost:8000/api/v1", "https://app.geulmoheom.test:3000");
    expect(원인[0]).toContain("mixed content");
  });

  it("오리진이 다르면 CORS 를 짚는다 — 포트가 다른 것도 다른 오리진이다", () => {
    const 원인 = 못닿음원인(
      "https://api.geulmoheom.test:8000/api/v1",
      "https://app.geulmoheom.test:3000",
    );
    expect(원인.join(" ")).toContain("CORS");
    // 같은 https 라 mixed content 는 아니다 — 엉뚱한 곳을 먼저 의심하게 만들지 않는다.
    expect(원인.join(" ")).not.toContain("mixed content");
  });

  it("`.test` 주소면 인증서·hosts 를 짚는다 — `make certs` 를 안 돌렸을 수 있다", () => {
    const 원인 = 못닿음원인("https://api.geulmoheom.test:8000/api/v1", "https://app.geulmoheom.test:3000");
    expect(원인.join(" ")).toContain("make certs");
  });

  it("같은 오리진이면 서버가 떠 있는지만 남는다 — 없는 원인을 지어내지 않는다", () => {
    const 원인 = 못닿음원인("/api/v1", "http://localhost:3000");
    expect(원인.join(" ")).toContain("make dev-api");
    expect(원인.join(" ")).not.toContain("CORS");
    expect(원인.join(" ")).not.toContain("mixed content");
  });

  it("주소를 그대로 보여준다 — 어디를 불렀는지가 첫 단서다", () => {
    expect(못닿음원인("https://api.geulmoheom.test:8000/api/v1", "https://app.geulmoheom.test:3000").join(" "))
      .toContain("https://api.geulmoheom.test:8000/api/v1");
  });
});
