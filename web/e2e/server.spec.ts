import { expect, test } from "@playwright/test";

import { 빈책, 내책라벨 } from "../src/app/book/copy";
import { 버튼 } from "../src/app/copy";
import { 코드입력 } from "../src/app/child/auth/copy";
import { 만들기, 접속코드 } from "../src/components/children-copy";
import { 폼 } from "../src/app/parents/signup/copy";

/**
 * **브라우저가 진짜 api 를 무는 단 하나의 갈래** (`주차계획/W6.md` 프론트 6번).
 *
 * **여기 도는 것은 `playwright.server.config.ts` 뿐이다** — 빠른 갈래는 이 파일을 안 집는다.
 *
 * **⛔ `page.route` 를 한 번도 안 쓴다.** 그게 이 파일의 존재 이유다 —
 * 나머지 e2e 200개는 **전부 브라우저에서 응답을 가로채므로 api 가 죽어 있어도 초록**이다.
 * 여기서 가로채는 순간 **다른 파일과 같은 것을 재게 되고, 이 파일은 값이 0 이 된다.**
 *
 * **재는 것** — 아이가 들어와(E-3) 카드를 받고 문장을 보내 등급을 받고(B-2)
 * 그림이 구워져(B-3) 책에 쌓이는 것(A0-4)까지 **한 줄로.**
 *
 * **⛔ 나누지 않는다.** 쪼개면 서버를 여러 번 띄우고, **그 느림이 곧 「다음에 또 미루는 이유」**가
 * 된다 — W3·W4 에서 두 번 미룬 자리다. 백엔드가 같은 판단으로 자기 갈래를 하나로 뒀다.
 *
 * **문구를 박지 않는다** — `copy.ts` 를 import 한다. 다만 **서버가 주는 것**(상황문·물음·대사)은
 * 반대다: **그건 픽스처가 아니라 진짜 응답**이라 글자를 모른다. **모르는 채로 재는 것이 맞다.**
 */

/** 매 실행마다 새로 만든다. **같은 이메일을 재사용하면 두 번째 실행이 409 로 죽는다.** */
const 이메일 = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
const 비밀번호 = "pw12345678";
const 별명 = "은빛나침반";
const 쓸문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다";

test("가입부터 책까지 한 갈래가 진짜 서버를 지난다", async ({ page }) => {
  // **콘솔 오류를 모은다.** 진짜 서버를 물면 **화면은 그럴듯한데 안에서 깨지는** 것이 생긴다 —
  // 가로채는 갈래에서는 응답이 늘 반듯해서 안 나는 종류다.
  const 오류: string[] = [];
  page.on("pageerror", (e) => 오류.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // **브라우저는 2xx 가 아닌 응답마다 콘솔에 한 줄을 찍는다.** 그건 **앱이 말한 것이 아니라
    // 브라우저가 말한 것**이고, 이 갈래에는 **정상 갈래인 401·403 이 네 번 지난다** —
    // 아직 안 들어왔는지 물어보는 자리들이다. 그걸 세면 **정상 동작이 빨간불로 온다.**
    // **앱이 낸 것만 센다.**
    if (m.text().startsWith("Failed to load resource")) return;
    오류.push(`[console] ${m.text()}`);
  });

  // ── ① 학부모 가입 (E-4) ────────────────────────────────────────────
  await page.goto("/parents/signup");
  await page.getByLabel(폼.이메일).fill(이메일);
  await page.getByLabel(폼.비밀번호).fill(비밀번호);
  // **필수만 체크한다.** 라벨링은 거부한 채로 간다 — 거부해도 그대로 쓸 수 있어야 한다(PRD 1.1b).
  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: 폼.가입하기 }).click();

  // **쿠키가 실제로 왕복했다는 첫 증거다.** 가입 응답의 `Set-Cookie` 를 브라우저가 받아
  // 다음 요청에 실어야 이 화면이 나온다 — `__Host-` + `Secure` 가 `http://127.0.0.1` 에서
  // 사는지가 여기서 갈린다.
  await expect(page.getByRole("button", { name: 만들기.버튼 })).toBeVisible();

  // ── ② 자녀 추가 → 접속 코드 (E-4) ──────────────────────────────────
  await page.getByLabel(만들기.별명).fill(별명);
  await page.getByLabel(만들기.나이).selectOption("11");
  await page.getByRole("button", { name: 만들기.버튼 }).click();

  const 코드칸 = page.locator("[data-접속코드]");
  await expect(코드칸).toContainText(접속코드.제목);
  // **평문 코드는 이 응답 한 번에만 실린다.** 서버는 해시만 저장한다 —
  // **그래서 여기서 읽어야 하고, 그 사실 자체가 이 갈래가 진짜 서버를 물었다는 증거**다.
  const 코드 = ((await 코드칸.innerText()).match(/\b\d{6}\b/) ?? [])[0];
  expect(코드, "접속 코드 6자리를 화면에서 못 읽었다").toMatch(/^\d{6}$/);

  // ── ③ 아이가 들어온다 (E-3) ────────────────────────────────────────
  await page.goto("/child/auth");
  await page.getByLabel(코드입력.라벨).fill(코드!);
  await page.getByRole("button", { name: 코드입력.버튼 }).click();

  // **아이 쿠키가 서고 부모 쿠키가 끊긴다** (`adr/0014` 결정 3, 공용 브라우저).
  await expect(page).toHaveURL(/\/$/);

  // ── ④ 카드를 받는다 (A0-2) ─────────────────────────────────────────
  // **물음을 서버가 준다** (`prompt_label`). 글자를 모르므로 **역할로 잡는다** —
  // 여기에 픽스처 문자열을 박으면 **진짜 응답을 재는 것이 아니게 된다.**
  const 입력창 = page.locator("#attempt");
  await expect(입력창).toBeVisible();

  // ── ⑤ 문장을 보내고 등급을 받는다 (B-2) ────────────────────────────
  await 입력창.fill(쓸문장);
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  // ── ⑥ 그림이 구워진다 (B-3) ────────────────────────────────────────
  // **가짜 앞단이 답했는지를 등급으로 문다** (백엔드가 세운 잣대 그대로).
  // 가짜는 **G3(`legendary`)** 를 주고 **폴백은 G1** 이다 — 호출이 진짜 구글로 나갔다면
  // 못 쓰는 키라 거절당해 폴백 등급이 나온다. **「200 이 왔다」로는 못 가른다.**
  const 배지 = page.locator("main [data-티어배지]");
  await expect(배지).toBeVisible({ timeout: 60_000 });

  // 그림 자리가 서고 실제 이미지가 붙는다. **폴링이 진짜로 돌아야 여기 닿는다.**
  const 삽화 = page.locator("main [data-삽화자리] img");
  await expect(삽화).toBeVisible({ timeout: 60_000 });
  // **쿠키가 `<img>` 에도 실렸다는 뜻이다** — 안 실리면 그림이 0% 다(`adr/0012`).
  // 깨진 이미지는 `naturalWidth` 가 0 이라 **「보인다」로는 못 가른다.**
  await expect
    .poll(() => 삽화.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // 아이가 쓴 문장이 그대로 있다. **요약도 교정도 없다** (비전 2장).
  await expect(page.locator("main [data-쓴문장], main [data-책문장]").first()).toContainText(쓸문장);

  // ── ⑦ 책에 쌓인다 (A0-4) ───────────────────────────────────────────
  await page.getByRole("link", { name: 내책라벨 }).click();
  await expect(page).toHaveURL(/\/book$/);

  // **빈 책 문구가 아니라 페이지가 있어야 한다.**
  await expect(page.getByText(빈책.줄1)).toHaveCount(0);
  await expect(page.locator("main [data-책문장]")).toContainText(쓸문장);
  // **지은이가 그 아이다** (A0-6). 서버가 `book.author` 로 준다.
  await expect(page.locator("[data-지은이]")).toContainText(별명);

  // **한 줄이 다 지나는 동안 화면이 안 깨졌다.**
  expect(오류, `콘솔 오류: ${오류.join(" | ")}`).toEqual([]);
});
