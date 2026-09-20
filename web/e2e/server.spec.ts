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

/**
 * **챕터 한 판이 진짜 서버를 지난다** (`주차계획/W7.md` **8번 ⑤**).
 *
 * **⛔ `page.route` 를 한 번도 안 쓴다** — 이 파일의 존재 이유다.
 * 위 갈래와 **서버를 같이 쓴다**(`workers: 1`) — 쪼개서 또 띄우면 느려지고,
 * **느려지면 다음에 또 미룬다.**
 *
 * **재는 것 — 가로채는 갈래가 원리적으로 못 보는 것들이다.**
 * ① **GM 이 실제로 답한다**(가짜 앞단을 지난 서사) ② **선택지가 서버에서 온다** —
 * 라벨을 **우리가 모르는 채로** 잡는다 ③ **턴이 DB 에 쌓여 새로고침해도 안 잃는다**
 * ④ **선택지로 보낸 턴이 같은 엔드포인트를 지난다** — 몸이 달라 틀리면 422 다.
 *
 * **⛔ 차단은 여기서 못 잰다** — 가짜 앞단이 「본문을 뜯지 않는다」라 요청마다 판정을
 * 못 바꾼다. 아래 ⑤ 에 왜인지와 **어디서 재는지**를 적어 뒀다.
 *
 * **⛔ 문장을 박지 않는다.** 서버가 주는 것(서사·선택지·대사)은 **글자를 모른다.**
 * **모르는 채로 재는 것이 맞다** — 박는 순간 픽스처를 재게 된다.
 */
const 챕터별명 = "푸른나침반";
const 챕터문장 = "낡은 밧줄의 매듭을 하나씩 만져 보며 어느 쪽이 새것인지 살핀다";

test("챕터 한 판이 진짜 서버를 지난다 — GM·자유 묘사·이어하기·선택지", async ({ page }) => {
  const 오류: string[] = [];
  page.on("pageerror", (e) => 오류.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().startsWith("Failed to load resource")) return;
    오류.push(`[console] ${m.text()}`);
  });

  // ── ① 새 아이를 만든다 ─────────────────────────────────────────────
  // **위 갈래의 아이를 재사용하지 않는다** — 그 아이는 오늘 몫을 이미 썼고,
  // **일일 제한에 걸리면 이 갈래가 「서버가 틀렸다」가 아니라 「어제 것이 남았다」로 죽는다.**
  const 메일 = `e2e-ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto("/parents/signup");
  await page.getByLabel(폼.이메일).fill(메일);
  await page.getByLabel(폼.비밀번호).fill(비밀번호);
  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: 폼.가입하기 }).click();

  await page.getByLabel(만들기.별명).fill(챕터별명);
  await page.getByLabel(만들기.나이).selectOption("11");
  await page.getByRole("button", { name: 만들기.버튼 }).click();

  const 코드칸 = page.locator("[data-접속코드]");
  await expect(코드칸).toContainText(접속코드.제목);
  const 코드 = ((await 코드칸.innerText()).match(/\b\d{6}\b/) ?? [])[0];
  expect(코드, "접속 코드 6자리를 화면에서 못 읽었다").toMatch(/^\d{6}$/);

  await page.goto("/child/auth");
  await page.getByLabel(코드입력.라벨).fill(코드!);
  await page.getByRole("button", { name: 코드입력.버튼 }).click();
  await expect(page).toHaveURL(/\/$/);

  // ── ② 챕터가 열린다 (A-1) ──────────────────────────────────────────
  await page.goto("/chapter");

  // **서사가 온다. 글자를 모르므로 「비어 있지 않다」로 잰다** — GM 이 매번 다르게 쓴다.
  const 서사 = page.locator("main p").first();
  await expect(서사).toBeVisible({ timeout: 60_000 });
  expect((await 서사.innerText()).trim().length).toBeGreaterThan(0);

  // **선택지는 없다.** 새로 들어왔을 때도 직접 쓴 글로만 이야기를 진행한다.
  await expect(page.locator("main li button, .turn-choices")).toHaveCount(0);

  // ── ③ 직접 써서 턴이 넘어간다 (A-3) ────────────────────────────────
  const 입력창 = page.locator("main textarea");
  await 입력창.fill(챕터문장);
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  // **⛔ 「서사가 바뀌었다」를 잣대로 쓰지 않는다.**
  // ① **가짜 앞단은 매번 같은 서사를 준다** — 고정 픽스처라 영영 안 바뀐다
  // ② **진짜 GM 이 와도 못 쓴다** — 같은 문장이 두 번 나올 수 있고, 그러면
  //    **제품이 멀쩡한데 검사가 빨개진다.** 무작위에 기대는 단언은 잣대가 아니다
  //
  // **잣대는 입력창이다.** 화면이 칸을 비우는 것은 **`outcome === "result"` 일 때뿐**이고
  // (되묻기·차단은 아이 글을 남긴다 — `Stage0.md` 148행), 그래서 **빈 칸 = 턴이 갔다**이다.
  // 턴 수·등급은 화면에 없다 — **숫자로 안 그리는 것이 규칙**이라 셀 수 없다.
  await expect(입력창).toHaveValue("", { timeout: 90_000 });

  // ── ④ 새로고침해도 이야기를 안 잃는다 (A-2) ────────────────────────
  //
  // **⛔ 서사가 같은지로 재면 안 된다** — 가짜가 고정값이라 **상태를 안 지켜도 통과한다.**
  // **아무것도 안 하고 통과하는 검사**가 가장 나쁘다.
  //
  // **그래서 응답을 본다.** 상태가 DB 에 있으면 `GET /chapters/current` 가 **200**,
  // 없으면 **404** 이고 화면이 새 판을 연다. **`page.route` 가 아니라 `page.on` 이다** —
  // 가로채지 않고 **지나가는 것을 볼 뿐**이라 이 파일의 원칙을 안 깬다.
  const 이어하기응답: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/v1/chapters/current")) 이어하기응답.push(r.status());
  });

  await page.reload();
  await expect(서사).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => 이어하기응답.at(-1), { timeout: 30_000 })
    .toBe(200);

  // ── ⑤ 돌아온 뒤에도 직접 쓴 글로 다음 턴을 보낸다 (A-3) ────────────
  // 사용자 승인(2026-09-19): 선택지는 없고 `text`만 진짜 서버로 보낸다.
  // 응답을 가로채지 않고 요청의 필드와 가상 문장 일치 여부만 확인한다.
  await expect(page.locator("main li button, .turn-choices")).toHaveCount(0);
  await 입력창.fill(챕터문장);
  const 다음응답대기 = page.waitForResponse((r) =>
    r.url().includes("/api/v1/turns") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: 버튼.보내기 }).click();
  const 다음응답 = await 다음응답대기;
  const 보낸몸 = 다음응답.request().postDataJSON();
  expect(Object.keys(보낸몸).sort()).toEqual(["chapter_id", "text"]);
  expect(보낸몸.text === 챕터문장).toBe(true);
  expect(다음응답.status()).toBe(200);
  expect((await 다음응답.json()).outcome).toBe("result");
  await expect(입력창).toHaveValue("", { timeout: 90_000 });

  // **⛔ 차단 갈래는 여기서 안 잰다 — 못 재는 것이지 안 중요해서가 아니다.**
  //
  // 가짜 앞단은 **「본문을 뜯지 않는다」**가 원칙이다(`api/tests/fake_gemini.py`) —
  // 뜯으면 **아이 문장을 읽어야** 하고, 그게 이 제품이 하지 않기로 한 일이다.
  // 그래서 **요청마다 판정을 바꿀 수 없고**, 한 실행 안에서 「이 문장은 막힌다」를 만들 수 없다.
  //
  // **⚠ 그리고 「막힐 문장」을 우리가 고르는 것 자체가 위험하다** — `안전_어휘_기준.md` 가
  // **판타지 전투를 허용**한다. 2026-09-16 에 「칼로 목을 베어서…」로 썼다가
  // **제품이 일부러 허용하는 문장**을 골랐다는 것을 알았다. **무엇이 막히는지는 안전 정책이지
  // 검사가 정할 것이 아니다.**
  //
  // **어디서 재나** — ① 화면 갈래는 `e2e/chapter-turn.spec.ts` 가 **`outcome: "blocked"` 를
  // 받아 아이 글이 남는지**를 잰다 ② 서버 갈래는 **백엔드 `pytest` 몫**이다. 거기서는
  // `가짜앞단(글=...)` 으로 **차단 응답을 만들어 넣을 수 있다.**

  expect(오류, `콘솔 오류: ${오류.join(" | ")}`).toEqual([]);
});
