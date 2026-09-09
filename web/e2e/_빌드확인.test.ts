import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { 낡았나확인, 빌드대상확인 } from "./_빌드확인";

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
        // **진짜 번들의 모양이다** — 번들러가 백틱 템플릿으로 인라인한다.
    // 큰따옴표만 찾다가 2026-09-09 실제 빌드에서 못 찾고 죽었다.
    const 뿌리 = 가짜빌드({ "a.js": "let i=`/api/v1${e}`;" });
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
      "a.js": "let i=`/api/v1${e}`;",
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

describe("빌드가 소스보다 낡았나", () => {
  /** 파일 하나를 만들고 손댄 시각을 못 박는다. */
  function 파일(이름: string, 초: number): string {
    const 뿌리 = mkdtempSync(join(tmpdir(), "낡음-"));
    const 길 = join(뿌리, 이름);
    writeFileSync(길, "x");
    utimesSync(길, 초, 초);
    return 뿌리;
  }

  it("빌드가 더 새로우면 통과한다", () => {
    expect(() => 낡았나확인(파일("a.js", 2_000), 파일("b.ts", 1_000))).not.toThrow();
  });

  it("소스가 더 새로우면 죽는다 — 고친 것을 안 재고 옛 코드를 잰다", () => {
    // 2026-09-09 에 실제로 그랬다: `out/` 17:39, 커밋 18:15 — **36분 낡은 화면이 기기로 나갔다.**
    expect(() => 낡았나확인(파일("a.js", 1_000), 파일("b.ts", 2_000))).toThrow(/낡았다/);
  });

  it("한쪽이 비어 있으면 아무 말도 안 한다 — 대상 검사가 이미 죽인다", () => {
    // 여기서 또 죽이면 **같은 사실에 두 곳이 말하게 되고**, 고칠 때 한쪽만 고쳐진다.
    expect(() => 낡았나확인(join(tmpdir(), "없는방-낡음"), 파일("b.ts", 1_000))).not.toThrow();
  });
});
