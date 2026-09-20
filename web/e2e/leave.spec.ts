import { expect, test, type Page } from "@playwright/test";

import type { paths } from "../src/api/types.gen";
// **문구를 문자열로 박지 않는다.** `docs/문구.md` 2.3 이 SSOT 이고 화면도 여기를 읽는다 —
// 박아두면 **문구를 바꾸는 날 테스트가 제품을 붙잡는다** (2026-09-07 `[보안 필터]` 여섯 군데).
import { 나가기문구 } from "../src/components/leave-copy";

/**
 * 나가기 — 아이 로그아웃 (E-3 프론트 짝).
 *
 * **여기 검사들이 지키는 것은 「나갈 수 있다」가 아니라 「잘못 나가지지 않는다」다.**
 * 접속 코드는 **1회용이고 이미 소진됐다**(`api/Stage0.md` 2절) — 아이가 실수로 나가면
 * **학부모가 재발급하기 전까지 아무것도 못 한다.** 되묻기를 나중에 누가 「한 번 덜 누르게
 * 해주자」로 걷어내면 **이 스펙이 막는다.** 규칙을 문서에만 적어두면 아무도 안 막는다.
 */

type CardResponse =
  paths["/api/v1/cards/next"]["get"]["responses"][200]["content"]["application/json"];

const CARD: CardResponse = {
  card_id: "c99",
  type: "discovery",
  situation: "낡은 등대 문이 반쯤 열려 있고 안쪽에서 파란 빛이 새어 나온다.",
  prompt_label: "탐험가는 어떻게 할까?",
  guide: {
    expression: "default",
    line: "나침반이 조용하네. 네가 뭘 할지 말해주면 움직일 거야!",
  },
  today: { cards_done: 1, cap: 5 },
};

const CARDS_NEXT = "**/api/v1/cards/next";
const LOGOUT = "**/api/v1/child/logout";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.endsWith("/healthz")) return route.fulfill({ status: 200, json: { status: "ok" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname.endsWith("/events")) return route.fulfill({ status: 204 });
    if (url.pathname.endsWith("/child/me")) {
      if (new URL(page.url()).pathname === "/child/auth") {
        return route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "검사용 인증 응답" } } });
      }
      return route.fulfill({ status: 200, json: { child_id: "leave-test-child", nickname: "검수탐험가", guide_name: null, today: { cards_done: 1, cap: 5, locked: false } } });
    }
    if (url.pathname.endsWith("/chapters/current")) {
      return route.fulfill({ status: 404, json: { error: { code: "NO_ACTIVE_CHAPTER", message: "검사용 응답" } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "MOCK_ONLY", message: "검사용 응답" } } });
  });
});

/** 모험 화면을 정상 상태로 띄운다. 나가기는 이 화면 맨 아래에 있다. */
async function 모험화면(page: Page) {
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  await page.goto("/");
  await expect(page.getByText(CARD.situation)).toBeVisible();
}

/** `/child/logout` 이 몇 번 불렸는지 센다. **안 불린 것을 확인하는 데 쓴다.** */
async function 로그아웃가로채기(page: Page) {
  const 부른횟수 = { n: 0 };
  await page.route(LOGOUT, (route) => {
    부른횟수.n += 1;
    return route.fulfill({ status: 204, body: "" });
  });
  return 부른횟수;
}

/**
 * **「안 넘어갔다」를 재려면 넘어갈 시간을 먼저 줘야 한다.**
 *
 * 개발 서버는 라우트를 **처음 열 때 컴파일한다.** 그 시간이 아래 `안넘어갔다` 의 창보다 길면
 * **넘어가는 중인 것과 안 넘어간 것이 구분되지 않아, 버그가 있어도 초록**이 된다 —
 * 실제로 그랬다(2026-09-07). 미리 한 번 열어 컴파일을 끝내 둔다.
 */
async function 넘어갈길미리열기(page: Page) {
  await page.goto("/child/auth");
  await expect(page.locator("body")).not.toBeEmpty();
}

/**
 * **없음을 증명하는 자리라 창이 필요하다.** `expect(page).toHaveURL(/\/$/)` 만으로는
 * **첫 폴링에서 바로 통과**해버려 아무것도 안 지킨다 — 넘어가는 중에도 URL 은 아직 `/` 다.
 */
async function 안넘어갔다(page: Page) {
  await page.waitForTimeout(700);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(CARD.situation)).toBeVisible();
}

const 나가기버튼 = (page: Page) =>
  page.getByRole("button", { name: 나가기문구.버튼, exact: true });
const 확인창 = (page: Page) => page.getByRole("dialog");

test("나가기는 `main` 밖에 있다 — 자리로 조용하게 한다", async ({ page }) => {
  await 모험화면(page);

  // **글자를 못 읽게 줄여서가 아니라 자리로 지킨다** (본문 16px 이상이 MUST, PRD 7장).
  // `main` 안 버튼은 「보내기」 하나뿐이어야 한다 — `card-screen.spec.ts` 가 그 개수를 물고 있고,
  // 나가기가 안으로 들어오는 순간 그쪽이 깨진다. 여기서는 반대편을 못 박는다.
  await expect(page.locator("main").getByRole("button", { name: 나가기문구.버튼 })).toHaveCount(0);
  await expect(나가기버튼(page)).toBeVisible();
});

test("눌러도 바로 안 나간다 — 한 번 되묻는다", async ({ page }) => {
  const 부른횟수 = await 로그아웃가로채기(page);
  await 모험화면(page);

  await expect(확인창(page)).toBeHidden();
  await 나가기버튼(page).click();

  await expect(확인창(page)).toBeVisible();
  await expect(page.getByText(나가기문구.확인.제목)).toBeVisible();
  // **무엇이 일어나는지는 버튼 글자가 아니라 이 줄이 말한다** (`문구.md` 2.3).
  await expect(page.getByText(나가기문구.확인.한줄)).toBeVisible();

  // **핵심.** 확인 창이 뜬 것만으로 서버가 불려서는 안 된다 —
  // 불렸다면 이미 쿠키가 지워졌고 되묻기는 장식이 된다.
  expect(부른횟수.n).toBe(0);

  // 「다른 기기는 그대로예요」는 **일부러 안 넣었다.** 만 11세는 기기를 여러 대 떠올리고 있지 않다.
  await expect(확인창(page)).not.toContainText("다른 기기");
});

test("확인 창의 포커스는 머무는 쪽에 앉는다", async ({ page }) => {
  await 모험화면(page);
  await 나가기버튼(page).click();

  // `<dialog>` 는 첫 포커스 가능 요소에 포커스를 준다. **되돌릴 수 없는 쪽이 그 자리에 오면 안 된다** —
  // 스페이스·엔터 한 번에 나가진다.
  await expect(확인창(page).getByRole("button", { name: 나가기문구.확인.머문다 })).toBeFocused();
});

test("`Esc` 는 머무는 쪽이다 — 닫히는 방향이 안전해야 한다", async ({ page }) => {
  const 부른횟수 = await 로그아웃가로채기(page);
  await 모험화면(page);
  await 나가기버튼(page).click();
  await expect(확인창(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(확인창(page)).toBeHidden();
  expect(부른횟수.n).toBe(0);
  // 화면에 그대로 있다. 쓰던 것을 잃지 않는다.
  await expect(page.getByText(CARD.situation)).toBeVisible();
});

test("「계속하기」는 아무 일도 일으키지 않는다", async ({ page }) => {
  const 부른횟수 = await 로그아웃가로채기(page);
  await 모험화면(page);
  await 나가기버튼(page).click();

  await 확인창(page).getByRole("button", { name: 나가기문구.확인.머문다 }).click();

  await expect(확인창(page)).toBeHidden();
  expect(부른횟수.n).toBe(0);
  await expect(page).toHaveURL(/\/$/);
});

test("「나가기」는 서버를 부르고 접속 코드 화면으로 돌아간다", async ({ page }) => {
  const 부른횟수 = await 로그아웃가로채기(page);
  await 모험화면(page);
  await 나가기버튼(page).click();

  await 확인창(page).getByRole("button", { name: 나가기문구.확인.나간다 }).click();

  // **서버를 불러야 한다.** `__Host-` 쿠키는 JS 가 못 지운다 —
  // 로컬 상태만 비우고 나간 척하면 쿠키는 살아 있다.
  await expect.poll(() => 부른횟수.n).toBe(1);

  // **화면을 새로 만들지 않는다. 3.3 으로 돌아간다** (`문구.md` 2.3).
  await expect(page).toHaveURL(/\/child\/auth$/);
});

test("전송 중에는 취소·중복 전송을 막고 실패하면 머물거나 다시 나갈 수 있다", async ({ page }) => {
  let 부른횟수 = 0;
  let 첫응답풀기!: () => void;
  const 첫응답대기 = new Promise<void>((resolve) => { 첫응답풀기 = resolve; });
  await page.route(LOGOUT, async (route) => {
    부른횟수 += 1;
    if (부른횟수 === 1) {
      await 첫응답대기;
      return route.abort("failed");
    }
    return route.fulfill({ status: 204 });
  });
  await 모험화면(page);
  await 나가기버튼(page).click();
  const 머무는쪽 = 확인창(page).getByRole("button", { name: 나가기문구.확인.머문다 });
  const 나가는쪽 = 확인창(page).getByRole("button", { name: 나가기문구.확인.나간다 });

  try {
    // 같은 프레임에 연달아 눌러도 응답을 기다리는 요청은 하나다.
    await 나가는쪽.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => 부른횟수).toBe(1);
    await expect(머무는쪽).toBeDisabled();
    await expect(나가는쪽).toBeDisabled();
    await expect(확인창(page)).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("[data-나가기대기]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(확인창(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(부른횟수).toBe(1);

    첫응답풀기();
    await expect(page.locator("[data-나가기실패]")).toHaveText(나가기문구.못닿음);
    await expect(머무는쪽).toBeEnabled();
    await expect(나가는쪽).toBeEnabled();
    await expect(머무는쪽).toBeFocused();
    await expect(확인창(page)).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("[data-나가기대기]")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(확인창(page)).toBeHidden();

    await 나가기버튼(page).click();
    await expect(page.locator("[data-나가기실패]")).toHaveCount(0);
    await 나가는쪽.click();
    await expect(page).toHaveURL(/\/child\/auth$/);
    expect(부른횟수).toBe(2);
  } finally {
    첫응답풀기();
  }
});

test("서버에 닿지 못하면 나간 척하지 않는다", async ({ page }) => {
  await page.route(LOGOUT, (route) => route.abort("failed"));
  await 넘어갈길미리열기(page);
  await 모험화면(page);
  await 나가기버튼(page).click();
  await 확인창(page).getByRole("button", { name: 나가기문구.확인.나간다 }).click();

  // **쿠키가 그대로 살아 있다.** 창을 닫으면 아이는 나간 줄 알고, 실제로는 들어와 있다 —
  // 다음에 태블릿을 집는 사람이 남의 계정을 그대로 쓴다.
  await expect(page.locator("[data-나가기실패]")).toHaveText(나가기문구.못닿음);
  await expect(확인창(page)).toBeVisible();
  await 안넘어갔다(page);
});

test("서버가 거절하면 서버가 준 문구를 그대로 보여준다", async ({ page }) => {
  // **2.4 못닿음 문구와 뚜렷이 다른 문장을 쓴다.** 비슷하게 두면 「서버가 준 것을 그대로 쓴다」와
  // 「화면이 고른 못닿음 문구」가 눈으로 구분되지 않아, 두 경로가 뒤바뀌어도 사람이 못 본다.
  const 서버문구 = "잠깐 쉬는 중이에요. 조금 뒤에 다시 해볼까요";
  await page.route(LOGOUT, (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "SERVICE_UNAVAILABLE", message: 서버문구 } },
    }),
  );
  await 넘어갈길미리열기(page);
  await 모험화면(page);
  await 나가기버튼(page).click();
  await 확인창(page).getByRole("button", { name: 나가기문구.확인.나간다 }).click();

  // 화면이 다듬거나 덧붙이지 않는다.
  await expect(page.locator("[data-나가기실패]")).toHaveText(서버문구);
  await 안넘어갔다(page);
});

test("아이 화면 금지어가 없다", async ({ page }) => {
  await 모험화면(page);
  await 나가기버튼(page).click();
  await expect(확인창(page)).toBeVisible();

  // `docs/용어사전.md` 8장. 확인 창까지 열어 두고 센다 — 새로 들어온 문장이 여기 있다.
  const 화면 = await page.locator("body").innerText();
  for (const 금지어 of ["점수", "채점", "연습", "학습", "보스", "앨범", "로그아웃"]) {
    expect(화면).not.toContain(금지어);
  }
});
