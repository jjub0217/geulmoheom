import { expect, test, type Page } from "@playwright/test";

import type { components, paths } from "../src/api/types.gen";
import { 티어이름 } from "../src/components/tier-badge";
import { 배지안내 } from "../src/components/tier-badge-help";
import { 배지쓰기안내, 배지쓰기안내저장키 } from "../src/components/tier-badge-writing-intro";

type Card = paths["/api/v1/cards/next"]["get"]["responses"][200]["content"]["application/json"];
type Book = components["schemas"]["Book"];
type AttemptResult = components["schemas"]["AttemptResult"];

const STORAGE_KEY = "geulmoheom:tier-badge-introduced";
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
  await expect(page.locator("[data-배지첫안내]")).toHaveCount(0);
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

test("첫 결과 안내는 확인하기 전에는 남고 확인 후에는 새 결과와 재접속에서 반복하지 않는다", async ({ page, context }) => {
  await mockApi(page);
  await page.goto("/");
  await submitScene(page);
  const introduction = page.locator("[data-배지첫안내]");
  await expect(introduction).toContainText(배지안내.첫안내);
  await expect(introduction).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  expect(await introduction.evaluate((element) => element.contains(document.activeElement))).toBe(false);

  await page.emulateMedia({ media: "print" });
  await expect(introduction).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(introduction).toBeVisible();

  // 표시만 보고 떠나면 확인한 것으로 기록하지 않는다.
  await page.reload();
  await submitScene(page, "은빛 잎을 손바닥에 올려 햇빛에 비춰 보았다.");
  await expect(introduction).toBeVisible();
  await page.locator("[data-배지안내확인]").click();
  await expect(introduction).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe("true");

  await page.locator("[data-다음장면]").click();
  await submitScene(page, "문틈으로 불어오는 바람을 따라 작은 길을 걸었다.");
  await expect(introduction).toBeHidden();

  // 새 탭은 컴포넌트 메모리를 공유하지 않는다. 같은 브라우저 저장값으로 재접속한다.
  const reopened = await context.newPage();
  await mockApi(reopened);
  await reopened.goto("/");
  await submitScene(reopened);
  await expect(reopened.locator("[data-배지첫안내]")).toBeHidden();
  await reopened.close();
});

test("첫 결과에서 배지 설명을 읽고 닫아도 짧은 안내를 확인한 것으로 기록한다", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await submitScene(page);
  await expect(page.locator("[data-배지첫안내]")).toBeVisible();
  const badge = page.locator("main button[data-티어배지]:visible");
  await expect(badge.locator(".tier-badge-help-icon")).toBeVisible();
  await badge.hover();
  await expect(page.getByRole("tooltip")).toBeHidden();
  await badge.click();
  const dialog = await checkDialog(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(badge).toBeFocused();
  await expect(page.locator("[data-배지첫안내]")).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe("true");
});

test("예전 결과 안내를 확인했어도 쓰기 전에 배지와 예시를 보고 확인 없이 글을 보낼 수 있다", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "true"), STORAGE_KEY);
  await mockApi(page);
  await page.goto("/");
  const introduction = page.locator("[data-배지쓰기안내]");
  await expect(introduction).toBeVisible();
  await expect(introduction).toHaveAccessibleName(배지쓰기안내.제목);
  await expect(introduction).toContainText(배지쓰기안내.설명);
  await expect(introduction.locator(".tier-badge-writing-preview .tier-badge")).toHaveText(tiers.map((tier) => 티어이름[tier]));
  await expect(introduction.locator("[data-티어배지]")).toHaveCount(0);
  expect(await introduction.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  await expect(page.getByLabel(card.prompt_label)).toBeEnabled();

  const example = introduction.locator("[data-배지쓰기예시]");
  await expect(example).not.toHaveAttribute("open", "");
  await expect(example.getByText(배지쓰기안내.자세한예시, { exact: true })).toBeHidden();
  await example.locator("summary").click();
  await expect(example.getByText(배지쓰기안내.처음예시, { exact: true })).toBeVisible();
  await expect(example.getByText(배지쓰기안내.자세한예시, { exact: true })).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(introduction).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(introduction).toBeVisible();

  await submitScene(page);
  expect(await page.evaluate((key) => localStorage.getItem(key), 배지쓰기안내저장키)).toBeNull();
  await expect(page.locator("[data-배지첫안내]")).toHaveCount(0);
  await page.locator("[data-다음장면]").click();
  // 보내기는 확인을 대신하지 않는다. 다음 쓰기에서도 안내를 다시 볼 수 있다.
  await expect(introduction).toBeVisible();
});

test("쓰기 전 안내 확인은 입력을 보존하고 입력칸에 돌아오며 결과 안내와 별도로 기억한다", async ({ page, context }) => {
  await mockApi(page);
  await page.goto("/");
  const introduction = page.locator("[data-배지쓰기안내]");
  await expect(introduction).toBeVisible();
  const input = page.getByLabel(card.prompt_label);
  const text = "조용히 손잡이를 돌려 문 너머의 소리에 귀를 기울였다.";
  await input.fill(text);
  await introduction.locator("[data-배지쓰기확인]").click();
  await expect(introduction).toBeHidden();
  await expect(input).toHaveValue(text);
  await expect(input).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), 배지쓰기안내저장키)).toBe("true");
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  await submitScene(page, text);
  await expect(page.locator("[data-배지첫안내]")).toBeVisible();

  const reopened = await context.newPage();
  await mockApi(reopened);
  await reopened.goto("/");
  await expect(reopened.getByLabel(card.prompt_label)).toBeVisible();
  await expect(reopened.locator("[data-배지쓰기안내]")).toHaveCount(0);
  await reopened.close();
});

test("브라우저 저장소가 막혀도 안내 확인과 글쓰기가 되고 다음 결과 이후 확인을 기억한다", async ({ page }) => {
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
  const introduction = page.locator("[data-배지쓰기안내]");
  await expect(introduction).toBeVisible();
  await introduction.locator("[data-배지쓰기확인]").click();
  await expect(introduction).toBeHidden();
  await submitScene(page);
  await page.locator("[data-다음장면]").click();
  await expect(page.getByLabel(card.prompt_label)).toBeVisible();
  await expect(introduction).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("320px에서도 새 배지 이름을 같은 크기로 읽고 결과·책·설명에서 같은 이름을 쓴다", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mockApi(page);
  await page.goto("/");
  const names = ["탐험가", "영웅", "전설"];
  const introduction = page.locator("[data-배지쓰기안내]");
  await expect(introduction).toBeVisible();
  const samples = introduction.locator(".tier-badge-writing-preview .tier-badge");
  await expect(samples).toHaveText(names);
  const sampleSizes = await samples.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { width: bounds.width, height: bounds.height, font: style.fontSize, weight: style.fontWeight, opacity: style.opacity, fits: element.scrollWidth <= element.clientWidth };
  }));
  for (const sample of sampleSizes) {
    expect(sample.fits).toBe(true);
    expect(Math.abs(sample.width - sampleSizes[0].width)).toBeLessThan(1);
    expect(Math.abs(sample.height - sampleSizes[0].height)).toBeLessThan(1);
    expect([sample.font, sample.weight, sample.opacity]).toEqual([sampleSizes[0].font, sampleSizes[0].weight, sampleSizes[0].opacity]);
  }

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
    return { width: bounds.width, height: bounds.height, fits: element.scrollWidth <= element.clientWidth };
  }));
  for (const sample of dialogSizes) {
    expect(sample.fits).toBe(true);
    expect(Math.abs(sample.width - dialogSizes[0].width)).toBeLessThan(1);
    expect(Math.abs(sample.height - dialogSizes[0].height)).toBeLessThan(1);
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
