import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { 빌드대상확인 } from "./_빌드확인";

/**
 * **가드를 재는 검사다.** 이게 없으면 `_빌드확인.ts` 는
 * **「막아 준다고 적혀 있지만 아무것도 안 막는」 파일**이 될 수 있다 — 2026-09-09 하루가
 * 그 모양을 세 번 잡는 데 갔다.
 */
function 가짜빌드(청크들: Record<string, string>): string {
  const 뿌리 = mkdtempSync(join(tmpdir(), "빌드확인-"));
  const 방 = join(뿌리, "_next", "static", "chunks");
  mkdirSync(방, { recursive: true });
  for (const [이름, 내용] of Object.entries(청크들)) {
    writeFileSync(join(방, 이름), 내용);
  }
  return 뿌리;
}

describe("정적 빌드가 무엇을 향해 구워졌나", () => {
  it("상대 경로 빌드는 통과한다 — 정적 하네스가 전제하는 것이다", () => {
    const 뿌리 = 가짜빌드({ "a.js": 'const b="/api/v1";' });
    expect(() => 빌드대상확인(뿌리)).not.toThrow();
  });

  it("실기기용(절대 주소) 빌드는 죽는다 — 어긋난 채 돌면 엉뚱한 실패가 나온다", () => {
    const 뿌리 = 가짜빌드({
      "a.js": 'const b="https://osejin-ui-macbookpro.local:8000/api/v1";',
    });
    expect(() => 빌드대상확인(뿌리)).toThrow(/실기기용/);
  });

  it("둘이 섞여 있어도 죽는다 — 하나라도 절대 주소면 그 빌드다", () => {
    const 뿌리 = 가짜빌드({
      "a.js": 'const b="/api/v1";',
      "b.js": 'const c="https://lan.local:8000/api/v1";',
    });
    expect(() => 빌드대상확인(뿌리)).toThrow(/실기기용/);
  });

  it("주소를 못 찾으면 통과가 아니라 죽는다", () => {
    // **못 찾은 것을 통과로 두면 아무것도 안 재면서 초록**이 된다.
    const 뿌리 = 가짜빌드({ "a.js": "console.log(1);" });
    expect(() => 빌드대상확인(뿌리)).toThrow(/못 찾았다/);
  });

  it("out/ 이 아예 없으면 죽는다 — 낡은 빌드로 도는 것보다 낫다", () => {
    expect(() => 빌드대상확인(join(tmpdir(), "없는방-빌드확인"))).toThrow(/없다/);
  });
});
