import { expect, test, type Page } from "@playwright/test";

import { 못닿음, 학부모오류문구 } from "../src/app/parents/signup/copy";
import { 로그인 } from "../src/app/parents/login/copy";
import { 아이입장으로보낼곳 } from "../src/lib/parent-kicked";

/**
 * 학부모 로그인 화면 (`문구.md` **3.10** · `adr/0014` 결정 5).
 *
 * **⛔ 이 화면이 없어서 운영에 구멍이 열려 있었다.** 부모 세션이 **30일에서 2시간**으로
 * 짧아졌는데(`4becf54`, 운영 배포됨) **다시 들어갈 화면이 없었다** — 화면이
 * `/parents/signup` 하나뿐이라 **같은 이메일로는 못 들어가고**, 그러면
 * **접속 코드 재발급도 자녀 삭제도 못 한다.** 아이가 끊기면 복구할 길이 없다.
 *
 * **짧게 만드는 결정은 다시 들어올 길이 있어야 성립한다** — ADR 이 그렇게 적었는데
 * **구현 계획의 Task 번호가 그 순서를 거슬렀다.** 「선행」을 표에 적는 것만으로는 안 지켜진다.
 *
 * **문구를 문자열로 박지 않는다** — `copy.ts` 를 import 한다.
 */

const LOGIN = "**/api/v1/parents/login";

/**
 * **ASCII 로 둔다.** 한글 로컬파트(`부모@…`)는 **브라우저의 네이티브 `type="email"` 검증에
 * 걸려 폼이 아예 제출되지 않는다** — 2026-09-14 에 그걸로 검사 넷이 죽었고, 증상이
 * **「요청이 한 건도 안 나간다」**라 화면 코드를 한참 뒤졌다. **검사가 제품이 아니라
 * 브라우저 검증을 잰 것**이다. 가입 화면 검사도 같은 이유로 ASCII 를 쓴다.
 */
const 이메일 = "parent@example.com";

/** 서버가 받아준다. **토큰은 쿠키로만 가고 프론트가 아는 것은 200 그 자체다.** */
async function 받아준다(page: Page, 받은것: { value: unknown } = { value: null }) {
  await page.route(LOGIN, (route) => {
    받은것.value = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: { parent_id: "p1" } });
  });
}

test("로그인하면 자녀 관리로 간다", async ({ page }) => {
  const 받은것: { value: unknown } = { value: null };
  await 받아준다(page, 받은것);
  // 넘어간 뒤 그 화면이 자기 일을 하도록 — 여기서 재는 것은 **넘어갔는가**다.
  await page.route("**/api/v1/parents/me", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "다시 로그인해 주세요." } },
    }),
  );

  await page.goto("/parents/login");
  await page.getByLabel(로그인.이메일).fill(이메일);
  await page.getByLabel(로그인.비밀번호).fill("올바른비밀번호");
  await page.getByRole("button", { name: 로그인.버튼 }).click();

  // **⛔ 주소만 보지 않는다.** `/parents` 로 보내도 **주소는 맞고 화면은 404** 다 —
  // 2026-09-14 에 실제로 그랬고 **URL 단언만 있어서 통과했다.**
  // **도착한 화면이 부모가 하러 온 일을 하는지**까지 본다.
  await expect(page).toHaveURL(/\/parents\/signup$/);
  await expect(page.locator("body")).not.toContainText("404");
  // **보낸 것이 계약 모양이다.** 필드 이름이 어긋나면 서버는 422 를 주는데
  // 화면에서는 「비밀번호가 틀렸나」로 보인다.
  expect(받은것.value).toEqual({ email: 이메일, password: "올바른비밀번호" });
});

/**
 * **⚠ 이 검사는 지금 구성에서 `credentials` 를 못 지킨다. 알고 둔다.**
 *
 * 계획이 **「`credentials: "include"` 가 빠지면 200 인데 로그인이 안 된 상태가 된다」**고
 * 경고했고 그 말은 맞다 — **다만 그것은 api 가 다른 오리진일 때다.** 운영은
 * **한 오리진 프록시**(`adr/0012`)라 요청이 same-origin 이고, `fetch` 의 기본값이
 * **`same-origin`** 이라 **`credentials` 를 빼도 쿠키가 그대로 실린다.**
 *
 * **뒤집어 보고 알았다** — `apiPost` 를 `credentials` 없는 맨 `fetch` 로 바꿔도 **통과했다.**
 *
 * **그래도 둔다.** 재는 것이 **「로그인 요청에 쿠키가 실린다」**이고 그 사실은 지켜져야 한다.
 * **`NEXT_PUBLIC_API_BASE_URL` 을 절대 주소로 되돌리는 날 이 검사가 진짜 관문이 된다** —
 * 그때는 cross-origin 이 되어 `credentials` 가 실제로 갈린다.
 */
test("로그인 요청에 쿠키가 실린다", async ({ page }) => {
  let 자격증명: string | undefined;
  await page.route(LOGIN, (route) => {
    자격증명 = route.request().headers()["cookie"];
    return route.fulfill({
      status: 200,
      headers: { "set-cookie": "__Host-gm_parent=t; Path=/; HttpOnly; Secure; SameSite=Lax" },
      json: { parent_id: "p1" },
    });
  });
  await page.route("**/api/v1/parents/me", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "다시 로그인해 주세요." } },
    }),
  );

  // 먼저 쿠키를 심어 둔다 — **요청에 실려 나가는지**를 봐야 하므로 있을 것이 있어야 한다.
  await page.context().addCookies([
    { name: "gm_probe", value: "1", url: "http://localhost:3000" },
  ]);

  await page.goto("/parents/login");
  await page.getByLabel(로그인.이메일).fill(이메일);
  await page.getByLabel(로그인.비밀번호).fill("올바른비밀번호");
  await page.getByRole("button", { name: 로그인.버튼 }).click();
  await expect(page).toHaveURL(/\/parents\/signup$/);
  await expect(page.locator("body")).not.toContainText("404");

  expect(자격증명).toContain("gm_probe=1");
});

test("틀려도 무엇이 틀렸는지 말하지 않는다", async ({ page }) => {
  // **계정 유무가 새면 남의 이메일을 넣어 확인할 수 있다** (`문구.md` 3.10).
  // **서버가 이미 안 나누고, 화면도 안 나눈다.**
  await page.route(LOGIN, (route) =>
    route.fulfill({
      status: 401,
      // **⚠ 서버 문구를 매핑 문구와 다른 글자로 둔다.** 둘이 같으면
      // **`e.서버문구` 를 그대로 써도 검사가 통과한다** — 2026-09-14 에 실제로 그랬다.
      // 그리고 이 값이 **아이 목소리인 것이 요점**이다(`errors.py` 의 `CHILD_MESSAGE`):
      // 학부모 화면이 그걸 그대로 쓰면 **읽는 사람이 그 부모인데 아이에게 하는 말**이 나간다.
      json: { error: { code: "UNAUTHORIZED", message: "다시 들어와 줄래?" } },
    }),
  );

  await page.goto("/parents/login");
  await page.getByLabel(로그인.이메일).fill("nobody@example.com");
  await page.getByLabel(로그인.비밀번호).fill("아무거나");
  await page.getByRole("button", { name: 로그인.버튼 }).click();

  // **화면에 머문다.** 넘어가면 로그인한 척하는 것이다.
  await expect(page).toHaveURL(/\/parents\/login$/);
  // **이 화면에서만 `UNAUTHORIZED` 를 다르게 받는다** (`문구.md` 3.10, 2026-09-14).
  // 3.8 표의 「다시 로그인해 주세요.」는 **방금 로그인을 시도한 사람에게 아무 말도 아니다.**
  await expect(page.locator("[data-오류]")).toHaveText(로그인.실패);

  const 화면 = await page.locator("main").innerText();
  for (const 새면안되는말 of ["없는 계정", "가입되지", "비밀번호가 틀", "이메일이 없"]) {
    expect(화면).not.toContain(새면안되는말);
  }
  // **동어반복으로 되돌아가지 않는다.** 한 줄만 되돌리면 언제든 돌아오고,
  // **그때 화면은 멀쩡해 보인다** — 문장이 뜨긴 뜨니까.
  expect(화면).not.toContain(학부모오류문구("UNAUTHORIZED"));
});

/**
 * **`UNAUTHORIZED` 만 갈라 받는다.** 3.8 표를 이 화면이 통째로 버리면
 * **새 코드가 생길 때마다 학부모가 「이메일 또는 비밀번호」를 의심한다** —
 * 실제로는 요청이 많아서 막힌 것인데도.
 */
test("로그인 실패가 아닌 오류는 3.8 표를 그대로 쓴다", async ({ page }) => {
  // **`errors.py` 의 `CHILD_MESSAGE` 그대로다** (`문구.md` 2.1). **아이 목소리인 것이 요점**이라
  // 학부모 화면에 그대로 나오면 안 된다.
  const 아이목소리 = "지금은 코드를 넣을 수 없어요. 15분 뒤에 다시 해볼까요";
  await page.route(LOGIN, (route) =>
    route.fulfill({
      status: 429,
      json: { error: { code: "RATE_LIMITED", message: "지금은 코드를 넣을 수 없어요. 15분 뒤에 다시 해볼까요" } },
    }),
  );

  await page.goto("/parents/login");
  await page.getByLabel(로그인.이메일).fill(이메일);
  await page.getByLabel(로그인.비밀번호).fill("올바른비밀번호");
  await page.getByRole("button", { name: 로그인.버튼 }).click();

  await expect(page.locator("[data-오류]")).toHaveText(학부모오류문구("RATE_LIMITED"));
  // **비밀번호 탓으로 말하지 않는다.** 부모가 맞는 비밀번호를 계속 고쳐 넣게 된다.
  await expect(page.locator("[data-오류]")).not.toHaveText(로그인.실패);
  // **아이 목소리가 새지 않는다** (`문구.md` 3.8).
  expect(await page.locator("main").innerText()).not.toContain(아이목소리);
});

test("못 닿으면 로그인한 척하지 않는다 — 비밀번호 탓으로 말하지도 않는다", async ({
  page,
}) => {
  await page.route(LOGIN, (route) => route.abort());

  await page.goto("/parents/login");
  await page.getByLabel(로그인.이메일).fill(이메일);
  await page.getByLabel(로그인.비밀번호).fill("올바른비밀번호");
  await page.getByRole("button", { name: 로그인.버튼 }).click();

  await expect(page).toHaveURL(/\/parents\/login$/);
  // **서버가 아무 말도 못 한 경우다.** 401 문구와 섞으면 **부모가 비밀번호를 의심하며
  // 계속 고쳐 넣는다** — 실제로는 네트워크가 끊긴 것인데도.
  await expect(page.locator("[data-오류]")).toHaveText(못닿음.로그인);
});

test("왜 로그아웃되는지 먼저 말하고, 전문 용어를 쓰지 않는다", async ({ page }) => {
  await page.goto("/parents/login");

  // **제목과 버튼이 둘 다 「로그인」이다** (`문구.md` 3.10). 역할로 가른다 —
  // 글자로 잡으면 둘을 물어 **화면이 아니라 검사가 깨진다.**
  await expect(page.getByRole("heading", { name: 로그인.제목 })).toBeVisible();
  await expect(page.getByText(로그인.안내)).toBeVisible();

  const 화면 = await page.locator("main").innerText();
  // **「세션이 만료되었습니다」류를 쓰지 않는다** (`용어사전.md` 9장).
  // **「다시 로그인해 주세요」도 제목에 없다** — 처음 오는 사람에게는 거짓이다.
  for (const 안쓰는말 of ["세션", "만료", "토큰", "쿠키", "다시 로그인해"]) {
    expect(화면).not.toContain(안쓰는말);
  }
  // **아이 화면으로 가는 길을 여기 두지 않는다** — 아이는 접속 코드로 들어온다.
  for (const 안쓰는말 of ["탐험가", "나침반", "모험", "접속 코드"]) {
    expect(화면).not.toContain(안쓰는말);
  }

  // **나가는 길은 가입 하나뿐이다.**
  await expect(page.getByRole("link", { name: 로그인.가입으로 })).toBeVisible();
});

/**
 * **⛔ 2026-09-14 회차 준비에서 나왔다** (`프리테스트_결과_2026-09-14.md` 3장 ⑩ · `문구.md` 3.11).
 *
 * **아이가 같은 기기로 들어오면 서버가 보호자 쿠키를 지운다**(`adr/0014` 결정 3). 그런데
 * **열려 있던 학부모 화면은 그것을 모른다** — 사용자가 **되돌릴 수 없는 자녀 삭제 확인창을
 * 다 띄우고 나서야** 403 을 만났고, **왜 안 되는지도 아이 때문이라는 것도 화면에 없었다.**
 */
test("아이가 들어와서 풀렸으면 시간 탓을 하지 않는다", async ({ page }) => {
  await page.goto(아이입장으로보낼곳);

  await expect(page.locator("[data-안내]")).toHaveText(로그인.아이가들어왔다);

  const 화면 = await page.locator("main").innerText();
  // **⛔ 기본 안내가 남아 있으면 화면이 거짓을 말한다** — 이 경우 원인은 시간이 아니다.
  // 부모가 「2시간이 지났나 보다」로 읽으면 **다음에 또 같은 일을 겪는다.**
  expect(화면).not.toContain(로그인.안내);
  // **아이를 탓하지 않는다.** 부모가 아이에게 화내는 문장을 우리가 쓰지 않는다.
  for (const 안쓰는말 of ["때문에", "잘못", "주의"]) {
    expect(화면).not.toContain(안쓰는말);
  }
  // **전문 용어를 쓰지 않는다** (`용어사전.md` 9장).
  for (const 안쓰는말 of ["세션", "쿠키", "권한", "토큰"]) {
    expect(화면).not.toContain(안쓰는말);
  }
  // **다시 들어갈 길이 그대로 있다** — 이 화면이 곧 그 길이다.
  await expect(page.getByRole("button", { name: 로그인.버튼 })).toBeVisible();
});

test("표식이 없으면 기본 안내 그대로다 — 아무 데서나 아이 탓을 하지 않는다", async ({
  page,
}) => {
  await page.goto("/parents/login");

  // **만료돼서 온 사람과 처음 오는 사람이 같은 화면에 온다.** 표식이 없으면 원인을 모른다 —
  // 모르면서 「아이가 들어왔다」고 말하면 **없는 일을 지어내는 것**이다.
  await expect(page.locator("[data-안내]")).toHaveText(로그인.안내);
  expect(await page.locator("main").innerText()).not.toContain(로그인.아이가들어왔다);
});
