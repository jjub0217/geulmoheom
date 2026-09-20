import { expect, test, type Page } from "@playwright/test";

import type { components, paths } from "../src/api/types.gen";
import { 티어이름 } from "../src/components/tier-badge";
import { 배지안내 } from "../src/components/tier-badge-help";

type Card = paths["/api/v1/cards/next"]["get"]["responses"][200]["content"]["application/json"];
type Book = components["schemas"]["Book"];
type AttemptResult = components["schemas"]["AttemptResult"];

const ARTWORK_URL = "http://localhost:3000/api/v1/artworks/badge-test-image/image";
const card: Card = {
  card_id: "badge-test-card",
  type: "discovery",
  situation: "작은 문 위에서 은빛 나뭇잎이 흔들린다.",
  prompt_label: "탐험가는 어떻게 할까?",
  guide: { expression: "default", line: "문 너머를 살펴보자." },
  today: { cards_done: 0, cap: 5 },
};
const tiers = ["basic", "rare", "legendary"] as const;
// 책·응답·입력 문장은 모두 지어낸 픽스처이며 실제 계정에는 요청하지 않는다.
const book: Book = {
  book_id: "badge-test-book",
  title: "은빛 잎의 모험",
  author: "다온",
  visibility: "private",
  counts: { basic: 1, rare: 1, legendary: 1 },
  pages: tiers.map((tier, index) => ({
    page_no: index + 1,
    source: "card",
    source_id: `badge-test-scene-${index}`,
    tier,
    artwork_url: null,
    text: `${index + 1}번째 나무 아래에서 작은 종을 발견했다.`,
    achieved_at: "2026-09-18T01:00:00Z",
  })),
};

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/healthz")) {
      return route.fulfill({ status: 200, json: { status: "ok" } });
    }
    if (url.pathname.startsWith("/api/v1/")) {
      return route.fulfill({ status: 404, json: { detail: "Unmocked badge request" } });
    }
    if (url.origin !== origin) return route.abort();
    return route.continue();
  });
});

async function mockApi(page: Page) {
  let attempts = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/book" && request.method() === "GET") {
      await route.fulfill({ status: 200, json: book });
    } else if (path === "/api/v1/cards/next") {
      await route.fulfill({ status: 200, json: card });
    } else if (path === "/api/v1/child/me") {
      await route.fulfill({ status: 200, json: { nickname: "다온" } });
    } else if (path === "/api/v1/attempts" && request.method() === "POST") {
      attempts += 1;
      const result: AttemptResult = {
        outcome: "result",
        attempt_id: `badge-test-attempt-${attempts}`,
        tier: "rare",
        highlights: [],
        guide: { expression: "compass_bright", line: "작은 종이 바람에 울렸어." },
        artwork: { artwork_id: "badge-test-image", status: "ready", url: ARTWORK_URL },
        today: { cards_done: 1, cap: 5, locked: false },
        can_retry: true,
      };
      await route.fulfill({ status: 200, json: result });
    } else if (path === "/api/v1/artworks/badge-test-image/image") {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#b8c8b0"/></svg>',
      });
    } else if (path === "/api/v1/events") {
      await route.fulfill({ status: 200, json: { accepted: 0 } });
    } else {
      await route.fulfill({ status: 404, json: { error: { code: "TEST_NO_RESOURCE", message: "테스트 응답" } } });
    }
  });
}

async function submitScene(page: Page, text = "문 앞에 떨어진 나뭇잎을 집어 살펴보았다.") {
  await page.getByLabel(card.prompt_label).fill(text);
  await page.getByRole("button", { name: "내 장면 만들기", exact: true }).click();
  await expect(page.locator("main button[data-티어배지]:visible")).toBeVisible();
}

async function checkDialog(page: Page) {
  const dialog = page.locator("dialog[data-배지설명]");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(배지안내.제목);
  await expect(dialog.locator(".tier-badge-preview .tier-badge")).toHaveText(tiers.map((tier) => 티어이름[tier]));
  for (const text of [배지안내.설명, 배지안내.순서, 배지안내.길이안내, 배지안내.책안내]) {
    await expect(dialog.getByText(text, { exact: true })).toBeVisible();
  }
  const bounds = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  return dialog;
}

test("책 배지에서 설명을 키보드로 열고 Escape와 닫기 모두 원래 배지로 돌아온다", async ({ page }) => {
  await mockApi(page);
  await page.goto("/book");
  const badge = page.locator("main button[data-티어배지]:visible").first();
  await expect(badge).toHaveText(티어이름.basic);
  await expect(badge.locator(".tier-badge-help-icon")).toHaveCount(0);
  await badge.focus();
  await expect(page.getByRole("tooltip")).toHaveText(배지안내.제목);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  await expect(badge).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = await checkDialog(page);
  await expect(page.getByRole("tooltip")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(badge).toBeFocused();

  await badge.click();
  await expect(dialog).toBeVisible();
  await page.locator("[data-배지설명닫기]").click();
  await expect(dialog).toBeHidden();
  await expect(badge).toBeFocused();
});

test("책 배지 툴팁은 마우스로 읽고 Escape나 이탈로 닫으며 인쇄에는 남기지 않는다", async ({ page }) => {
  await mockApi(page);
  await page.goto("/book");
  const badge = page.locator("main button[data-티어배지]:visible").first();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeHidden();
  await badge.hover();
  await expect(tooltip).toHaveText(배지안내.제목);
  await expect(badge).not.toBeFocused();
  // 안내로 포인터를 옮겨 읽을 수 있고, 클릭하지 않아도 Escape로 닫을 수 있다.
  await tooltip.hover();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(page.locator("dialog[data-배지설명]")).toBeHidden();

  await page.mouse.move(0, 0);
  await badge.hover();
  await expect(tooltip).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();

  await badge.hover();
  await expect(tooltip).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(tooltip).toBeHidden();
  await expect(page.locator("main [data-티어배지]:visible")).toHaveText(tiers.map((tier) => 티어이름[tier]));
});

test.describe("터치로 책 배지 읽기", () => {
  test.use({ hasTouch: true });

  test("한 번 탭하면 설명이 열리고 닫은 뒤 배지에 포커스가 남는다", async ({ page }) => {
    await mockApi(page);
    await page.goto("/book");
    const badge = page.locator("main button[data-티어배지]:visible").first();
    await expect(badge.locator(".tier-badge-help-icon")).toHaveCount(0);
    await badge.tap();
    const dialog = await checkDialog(page);
    await expect(page.getByRole("tooltip")).toBeHidden();
    await page.locator("[data-배지설명닫기]").tap();
    await expect(dialog).toBeHidden();
    await expect(badge).toBeFocused();
    await expect(page.getByRole("tooltip")).toBeHidden();
  });
});

test("배지 설명을 연 채 인쇄해도 설명은 빠지고 책의 세 배지 이름은 남는다", async ({ page }) => {
  await mockApi(page);
  await page.goto("/book");
  await page.locator("main button[data-티어배지]:visible").first().click();
  const dialog = await checkDialog(page);
  await page.emulateMedia({ media: "print" });
  await expect(dialog).toBeHidden();
  await expect(page.locator("main [data-티어배지]:visible")).toHaveText(tiers.map((tier) => 티어이름[tier]));
  await expect(page.locator("main [data-책문장]:visible")).toHaveText(book.pages.map((item) => item.text));
  await page.emulateMedia({ media: "screen" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
});

/**
 * **⛔ 첫 안내를 걷어낸 자리의 난간이다** (2026-09-21 사용자 판정).
 *
 * 없애도 된다는 **조건이 「배지에 올리면 툴팁, 누르면 설명 창」이었다.**
 * 책 화면은 위에서 재고 있었지만 **결과 화면을 재는 자리가 없었다** —
 * **조건이 깨지면 아이는 배지의 뜻을 알 길이 아예 없어진다.**
 */
test("결과 화면 배지도 올리면 툴팁, 누르면 설명 창이 열린다", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await submitScene(page);
  const badge = page.locator("main button[data-티어배지]:visible");
  await expect(badge).toHaveText(티어이름.rare);
  await expect(badge.locator(".tier-badge-help-icon")).toHaveCount(0);
  await badge.hover();
  await expect(page.getByRole("tooltip")).toHaveText(배지안내.제목);
  await badge.click();
  const dialog = await checkDialog(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(badge).toBeFocused();
  // **설명은 아이가 열 때만 열린다.** 「저절로 뜨는 줄이 없다」를 재는 자리는 여기가 아니라
  // `card-screen.spec.ts` 의 **결과 화면 줄 목록**이다 — 거기가 화면에 남은 것을 통째로 센다.
});

/** `문구.md` **1.8** — 「저장 기능을 사용할 수 없어도 배지와 설명은 동작한다」. */
test("브라우저 저장소가 막혀도 글쓰기·배지·설명 창이 그대로 돈다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Storage is blocked", "SecurityError"); },
    });
  });
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByLabel(card.prompt_label)).toBeVisible();
  await submitScene(page);
  const badge = page.locator("main button[data-티어배지]:visible");
  await expect(badge).toHaveText(티어이름.rare);
  await badge.click();
  const dialog = await checkDialog(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.locator("[data-다음장면]").click();
  await expect(page.getByLabel(card.prompt_label)).toBeVisible();
  await submitScene(page, "문틈으로 불어오는 바람을 따라 작은 길을 걸었다.");
  await expect(page.locator("main button[data-티어배지]:visible")).toBeVisible();
  expect(errors).toEqual([]);
});

test("320px에서도 새 배지 이름을 같은 크기로 읽고 결과·책·설명에서 같은 이름을 쓴다", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mockApi(page);
  await page.goto("/");
  const names = ["탐험가", "영웅", "전설"];

  await submitScene(page);
  const resultBadge = page.locator("main button[data-티어배지]:visible");
  await expect(resultBadge).toHaveText(names[1]);
  await expect(resultBadge).toHaveAccessibleName(`${names[1]} 배지 알아보기`);
  await resultBadge.click();
  const dialog = await checkDialog(page);
  const dialogSamples = dialog.locator(".tier-badge-preview .tier-badge");
  await expect(dialogSamples).toHaveText(names);
  const dialogSizes = await dialogSamples.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { width: bounds.width, height: bounds.height, font: style.fontSize, weight: style.fontWeight, opacity: style.opacity, fits: element.scrollWidth <= element.clientWidth };
  }));
  // 세 이름은 같은 크기·같은 무게로 읽힌다. 하나만 커지면 그것이 등수가 된다.
  for (const sample of dialogSizes) {
    expect(sample.fits).toBe(true);
    expect(Math.abs(sample.width - dialogSizes[0].width)).toBeLessThan(1);
    expect(Math.abs(sample.height - dialogSizes[0].height)).toBeLessThan(1);
    expect([sample.font, sample.weight, sample.opacity]).toEqual([dialogSizes[0].font, dialogSizes[0].weight, dialogSizes[0].opacity]);
  }
  await page.keyboard.press("Escape");
  await page.goto("/book");
  const bookBadges = page.locator("main button[data-티어배지]");
  await expect(bookBadges).toHaveText(names);
  const bookBadgeSizes = [];
  for (let index = 0; index < names.length; index += 1) {
    // 다른 책장은 접근성 트리에서 숨겨져 있다. 실제로 펼친 뒤 읽을 이름을 확인한다.
    await expect(bookBadges.nth(index)).toBeVisible();
    await expect(bookBadges.nth(index)).toHaveAccessibleName(`${names[index]} 배지 알아보기`);
    bookBadgeSizes.push((await bookBadges.nth(index).boundingBox())!);
    if (index < names.length - 1) await page.locator("[data-book-next]").click();
  }
  for (const size of bookBadgeSizes) {
    expect(Math.abs(size.width - bookBadgeSizes[0].width)).toBeLessThan(1);
    expect(Math.abs(size.height - bookBadgeSizes[0].height)).toBeLessThan(1);
  }
});
