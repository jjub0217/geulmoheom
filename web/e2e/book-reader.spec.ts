import { expect, test, type Page } from "@playwright/test";

import type { components } from "../src/api/types.gen";
import { 티어이름 } from "../src/components/tier-badge";

type Book = components["schemas"]["Book"];

// 모두 지어낸 책이다. 서버 번호는 건너뛰지만 화면 번호는 읽는 면마다 이어진다.
const numbers = [1, 3, 7, 8, 12];
const faceNumbers = [[1, 2], [3, 4], [5], [6, 7], [8, 9]];
const faceLocations = ["1–2쪽", "3–4쪽", "5쪽", "6–7쪽", "8–9쪽"];
const tiers: Book["pages"][number]["tier"][] = ["basic", "rare", "legendary", "rare", "basic"];
const texts = [
  "작은 문 앞에서 나뭇잎을 주웠다.",
  "은빛 나뭇잎이 물 위에 떠 있었다.\n바람이 부는 쪽을 바라보았다.",
  "그림이 도착하기 전에 먼저 이야기를 적었다.\n문 너머로 가느다란 빛이 새어 나왔다.\n손을 뻗자 작은 종소리가 울렸다.",
  Array.from({ length: 9 }, (_, index) => `${index + 1}번째 나무 아래에서 반짝이는 돌을 찾았다.`).join("\n"),
  "마지막 문은 조용히 열렸다.",
];
// 구형 세로·가로 삽화와 정사각 삽화가 섞여도 종이 크기는 같아야 한다.
const imageSizes = [[180, 300], [360, 180], [180, 240], [200, 320], [240, 240]];
const book: Book = {
  book_id: "reader-test-book",
  title: "은빛 숲의 작은 문",
  author: "다온",
  visibility: "private",
  counts: { basic: 2, rare: 2, legendary: 1 },
  pages: numbers.map((page_no, index) => ({
    page_no,
    source: "card",
    source_id: `reader-test-${index}`,
    tier: tiers[index],
    artwork_url: index === 2 ? null : `/api/v1/artworks/reader-${index}/image`,
    text: texts[index],
    achieved_at: "2026-09-18T01:00:00Z",
  })),
};

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page, baseURL }) => {
  const testOrigin = new URL(baseURL!).origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    // API는 아래 장면별 모의가 처리한다. 그 외 외부 요청은 허용하지 않는다.
    return url.origin === testOrigin && !url.pathname.startsWith("/api/")
      ? route.continue()
      : route.abort();
  });
});

async function openBook(page: Page, content = book) {
  // 모든 API를 가로채 실제 계정·책·이미지 API로 요청이 나가지 않게 한다.
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/book" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, json: content });
    } else if (/^\/api\/v1\/artworks\/reader-\d+\/image$/.test(path)) {
      const index = Number(path.match(/reader-(\d+)/)![1]);
      const [width, height] = imageSizes[index];
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#b8c8b0"/></svg>`,
      });
    } else {
      await route.fulfill({ status: 404, json: { detail: "Unmocked test API" } });
    }
  });
  await page.goto("/book");
  await expect(page.locator("[data-책쪽]:visible")).toHaveCount(1);
  const location = page.locator("[data-book-location]");
  await expect(location).toHaveAttribute("role", "status");
  // 쪽 범위는 화면 아래에 다시 쓰지 않고 보조기술의 상태 안내로만 남긴다.
  const box = (await location.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(1);
  expect(box.height).toBeLessThanOrEqual(1);
  await expect(location).toHaveCSS("overflow", "hidden");
}

async function visibleNumbers(page: Page, expected: number[]) {
  await expect(page.locator("[data-책쪽]:visible [data-쪽번호]")).toHaveText(expected.map(String));
  await expect(page.locator('.book-reader-page[data-current="true"]')).toHaveCount(1);
}

async function sceneMatches(page: Page, index: number) {
  const scene = page.locator("[data-책쪽]:visible");
  await expect(scene).toHaveCount(1);
  await expect(scene).toHaveAttribute("data-scene-number", String(numbers[index]));
  await expect(scene.locator(".book-page-writing [data-책문장]")).toHaveText(book.pages[index].text);
  await expect(scene.locator(".book-page-writing [data-티어배지]")).toHaveCount(1);
  await expect(scene.locator(".book-page-writing [data-티어배지]")).toHaveText(티어이름[book.pages[index].tier]);
  await expect(scene.locator(".book-page-writing [data-쪽번호]")).toHaveText(String(faceNumbers[index].at(-1)));
  const artwork = scene.locator(".book-page-artwork img");
  const source = book.pages[index].artwork_url;
  if (source === null) {
    await expect(artwork).toHaveCount(0);
    await expect(scene.locator("[data-쪽번호]")).toHaveCount(1);
    const sceneBox = (await scene.boundingBox())!;
    const writingBox = (await scene.locator(".book-page-writing").boundingBox())!;
    expect(writingBox.width).toBeGreaterThan(sceneBox.width * 0.8);
    return;
  }

  await expect(scene.locator(".book-page-illustration [data-쪽번호]")).toHaveText(String(faceNumbers[index][0]));
  await expect(artwork).toHaveAttribute("src", `${source}?book-layout=square-20260919`);
  await expect(artwork).toHaveCSS("object-fit", "contain");
  await expect(artwork).not.toHaveAttribute("crossorigin", /.*/);
  const artworkBox = (await scene.locator(".book-page-artwork").boundingBox())!;
  const illustrationBox = (await scene.locator(".book-page-illustration").boundingBox())!;
  const writingBox = (await scene.locator(".book-page-writing").boundingBox())!;
  const sceneBox = (await scene.boundingBox())!;
  expect(artworkBox.width / artworkBox.height).toBeCloseTo(1, 2);
  expect(writingBox.width / writingBox.height).toBeCloseTo(1, 2);
  // 원본 전체는 contain으로 남고, 책의 그림 면과 글 면은 같은 정사각 크기다.
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(artworkBox[key] - illustrationBox[key])).toBeLessThanOrEqual(1);
  }
  // 액자는 종이 경계까지 이어지고 구형 이미지도 원본 URL과 contain을 유지한다.
  expect(Math.abs(artworkBox.x - sceneBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(artworkBox.y - sceneBox.y)).toBeLessThanOrEqual(1);
  if (page.viewportSize()!.width >= 896) {
    expect(Math.abs(artworkBox.width - sceneBox.width / 2)).toBeLessThanOrEqual(1);
    expect(artworkBox.x + artworkBox.width).toBeLessThanOrEqual(writingBox.x + 1);
  } else {
    expect(Math.abs(artworkBox.width - sceneBox.width)).toBeLessThanOrEqual(1);
    expect(artworkBox.y + artworkBox.height).toBeLessThanOrEqual(writingBox.y + 1);
  }
}

async function waitForBookArtwork(page: Page) {
  await expect.poll(() => page.locator(".book-reader img").evaluateAll((items) => items.every((item) => {
    const image = item as HTMLImageElement;
    return image.complete && image.naturalWidth > 0;
  }))).toBe(true);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function readerGeometry(page: Page) {
  return page.locator(".book-reader").evaluate((reader) => {
    const pages = Array.from(reader.querySelectorAll<HTMLElement>("[data-책쪽]"));
    const current = pages.filter((item) => item.parentElement?.dataset.current === "true");
    const pagination = reader.querySelector(".book-pagination")!.getBoundingClientRect();
    return {
      heights: current.map((item) => item.getBoundingClientRect().height),
      currentWidths: current.map((item) => item.getBoundingClientRect().width),
      paginationY: pagination.top + window.scrollY,
      // 고정 면 안에서 긴 원문만 키보드로 스크롤한다. 배지와 쪽 번호는 고정 면에 남는다.
      contentFits: current.every((item) => {
        const bounds = item.getBoundingClientRect();
        const content = item.querySelectorAll<HTMLElement>("[data-책문장], .book-page-artwork, .book-page-writing, .book-page-footer");
        // 그림자는 내용 높이에 포함하지 않고 실제 글·그림·글 면·하단 경계를 잰다.
        return Array.from(content).every((child) => {
          const box = child.getBoundingClientRect();
          const overflowY = getComputedStyle(child).overflowY;
          const readableText = child.matches("[data-책문장]");
          return box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1
            && box.left >= bounds.left - 1 && box.right <= bounds.right + 1
            && (readableText
              ? child.tabIndex === 0 && overflowY === "auto"
              : child.scrollHeight <= child.clientHeight + 1 && overflowY !== "auto" && overflowY !== "scroll");
        });
      }),
    };
  });
}

test("넓은 화면은 같은 장면의 그림과 글을 좌우에 놓고 서버 순서대로 하나씩 넘긴다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBook(page);
  await waitForBookArtwork(page);
  const previous = page.locator("[data-book-previous]");
  const next = page.locator("[data-book-next]");
  const location = page.locator("[data-book-location]");

  await visibleNumbers(page, [1, 2]);
  await sceneMatches(page, 0);
  await expect(location).toHaveText("1–2쪽");
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();

  await next.focus();
  await page.keyboard.press("Enter");
  await visibleNumbers(page, [3, 4]);
  await sceneMatches(page, 1);
  await expect(location).toHaveText("3–4쪽");
  await expect(next).toBeFocused();

  for (let index = 2; index < numbers.length; index += 1) {
    await next.click();
    await visibleNumbers(page, faceNumbers[index]);
    await sceneMatches(page, index);
    await expect(location).toHaveText(faceLocations[index]);
  }
  await expect(next).toBeDisabled();
  await expect(previous).toBeFocused();

  for (const faces of faceNumbers.slice(0, -1).reverse()) {
    await previous.click();
    await visibleNumbers(page, faces);
  }
  await expect(previous).toBeDisabled();
  await expect(next).toBeFocused();
  // 화면에서 숨겨진 쪽도 원문 그대로 한 번씩만 남아 인쇄가 사용할 수 있다.
  await expect(page.locator("[data-쪽번호]")).toHaveText(faceNumbers.flat().map(String));
  await expect(page.locator("[data-책문장]")).toHaveText(book.pages.map((item) => item.text));
});

test("좁은 화면은 같은 장면의 그림 아래에서 글을 읽고 앞뒤 경계에서 멈춘다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBook(page);
  await waitForBookArtwork(page);
  await visibleNumbers(page, [1, 2]);
  await sceneMatches(page, 0);
  await expect(page.locator("[data-book-previous]")).toBeDisabled();

  for (let index = 1; index < numbers.length; index += 1) {
    await page.locator("[data-book-next]").click();
    await visibleNumbers(page, faceNumbers[index]);
    await sceneMatches(page, index);
    await expect(page.locator("[data-book-location]")).toHaveText(faceLocations[index]);
  }
  await expect(page.locator("[data-book-next]")).toBeDisabled();
  await page.locator("[data-book-previous]").click();
  await visibleNumbers(page, [6, 7]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("창 폭이 바뀌어도 같은 장면과 양쪽 면 번호를 유지한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBook(page);
  for (let index = 0; index < 3; index += 1) await page.locator("[data-book-next]").click();
  await visibleNumbers(page, [6, 7]);

  await page.setViewportSize({ width: 1280, height: 800 });
  await visibleNumbers(page, [6, 7]);
  await expect(page.locator("[data-book-location]")).toHaveText("6–7쪽");
  await page.setViewportSize({ width: 390, height: 844 });
  await visibleNumbers(page, [6, 7]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator("[data-book-next]").click();
  await visibleNumbers(page, [8, 9]);
  await page.setViewportSize({ width: 390, height: 844 });
  await visibleNumbers(page, [8, 9]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await visibleNumbers(page, [8, 9]);
});

test("혼합 비율의 장면도 같은 정사각 면으로 읽고 긴 원문은 스크롤해 읽는다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBook(page);
  await waitForBookArtwork(page);

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    while (await page.locator("[data-book-previous]").isEnabled()) {
      await page.locator("[data-book-previous]").click();
    }
    await visibleNumbers(page, [1, 2]);
    const sizes: string[] = [];
    for (let index = 0; index < numbers.length; index += 1) {
      await visibleNumbers(page, faceNumbers[index]);
      await sceneMatches(page, index);
      const current = await readerGeometry(page);
      expect(current.heights[0]).toBeGreaterThan(0);
      expect(current.contentFits).toBe(true);
      // 그림 없는 장면은 모바일에서 글 한 면만 차지한다.
      if (book.pages[index].artwork_url !== null) {
        sizes.push(`${Math.round(current.currentWidths[0])}x${Math.round(current.heights[0])}`);
      }
      if (index < numbers.length - 1) await page.locator("[data-book-next]").click();
    }
    expect(new Set(sizes).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("서명 없는 같은 출처 API 이미지만 판형 버전으로 다시 받는다", async ({ page, baseURL }) => {
  const sources = [
    "/api/v1/artworks/reader-0/image",
    "/api/v1/artworks/reader-1/image?signature=keep-this&expires=1234",
    `${new URL(baseURL!).origin}/api/v1/artworks/reader-3/image`,
    "https://signed.example.test/api/v1/artworks/reader-4/image?signature=leave-this&expires=5678",
  ];
  await openBook(page, { ...book, pages: book.pages.slice(0, 4).map((item, index) => ({
    ...item, artwork_url: sources[index],
  })) });
  await waitForBookArtwork(page);
  const images = page.locator(".book-page-artwork img");
  await expect(images.nth(0)).toHaveAttribute("src", `${sources[0]}?book-layout=square-20260919`);
  await expect(images.nth(1)).toHaveAttribute("src", sources[1]);
  await expect(images.nth(2)).toHaveAttribute("src", `${sources[2]}?book-layout=square-20260919`);
  await expect(images.nth(3)).toHaveAttribute("src", sources[3]);
  await expect(images.nth(0)).not.toHaveAttribute("crossorigin", /.*/);
});

test("같은 비율의 그림과 보통 길이의 글은 같은 종이 크기와 이동 위치를 유지한다", async ({ page }) => {
  const shortTexts = ["작은 문을 열었다.", "바람에 잎이 흔들려 나뭇가지를 살폈다.", "종소리를 따라 걸었다."];
  const sameRatioBook: Book = {
    ...book,
    counts: { basic: 1, rare: 1, legendary: 1 },
    pages: book.pages.slice(0, 3).map((item, index) => ({
      ...item,
      artwork_url: book.pages[0].artwork_url,
      text: shortTexts[index],
    })),
  };
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBook(page, sameRatioBook);
  await waitForBookArtwork(page);

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    while (await page.locator("[data-book-previous]").isEnabled()) {
      await page.locator("[data-book-previous]").click();
    }
    await visibleNumbers(page, [1, 2]);
    const first = await readerGeometry(page);
    for (let index = 0; index < sameRatioBook.pages.length; index += 1) {
      const current = await readerGeometry(page);
      expect(Math.abs(current.heights[0] - first.heights[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(current.currentWidths[0] - first.currentWidths[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(current.paginationY - first.paginationY)).toBeLessThanOrEqual(1);
      expect(current.contentFits).toBe(true);
      if (index < sameRatioBook.pages.length - 1) await page.locator("[data-book-next]").click();
    }
  }
});

test("마지막 장면에서도 인쇄는 모든 글과 그림을 원래 순서와 내용 높이로 한 번씩 보존한다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBook(page);
  const images = page.locator(".book-reader img");
  await expect(images).toHaveCount(4);
  await waitForBookArtwork(page);
  for (let index = 1; index < numbers.length; index += 1) {
    await page.locator("[data-book-next]").click();
  }
  await visibleNumbers(page, [8, 9]);

  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-책쪽]:visible [data-쪽번호]")).toHaveText(faceNumbers.flat().map(String));
  await expect(page.locator("[data-책쪽]")).toHaveCount(5);
  await expect(page.locator("[data-책문장]")).toHaveText(book.pages.map((item) => item.text));
  for (let index = 0; index < book.pages.length; index += 1) {
    const scene = page.locator("[data-책쪽]").nth(index);
    await expect(scene.locator("[data-책문장]")).toHaveText(book.pages[index].text);
    await expect(scene).toHaveAttribute("data-scene-number", String(numbers[index]));
    await expect(scene.locator("[data-쪽번호]")).toHaveText(faceNumbers[index].map(String));
    const artwork = scene.locator(".book-page-artwork");
    const source = book.pages[index].artwork_url;
    if (source === null) {
      await expect(artwork).toHaveCount(0);
    } else {
      await expect(artwork.locator("img")).toBeVisible();
      await expect(artwork.locator("img")).toHaveAttribute("src", `${source}?book-layout=square-20260919`);
      const artworkBox = (await artwork.boundingBox())!;
      expect(artworkBox.width / artworkBox.height).toBeCloseTo(imageSizes[index][0] / imageSizes[index][1], 2);
      const writingBox = (await scene.locator(".book-page-writing").boundingBox())!;
      expect(artworkBox.y + artworkBox.height).toBeLessThanOrEqual(writingBox.y + 1);
    }
  }
  await expect(page.locator(".book-pagination")).toBeHidden();
  for (const paragraph of await page.locator("[data-책문장]").all()) {
    await expect(paragraph).toHaveCSS("overflow-y", "visible");
    expect(await paragraph.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  }
  const printed = await page.locator("[data-책쪽]").evaluateAll((items) => items.map((item) => {
    const bounds = item.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, height: bounds.height };
  }));
  for (let index = 1; index < printed.length; index += 1) {
    expect(printed[index].top).toBeGreaterThanOrEqual(printed[index - 1].bottom - 1);
  }
  // 인쇄에서도 모든 쪽에 고정 높이를 강제하지 않고 각 내용에 맞춰 흐르게 한다.
  expect(Math.max(...printed.map((item) => item.height)) - Math.min(...printed.map((item) => item.height))).toBeGreaterThan(20);

  await page.emulateMedia({ media: "screen" });
  await visibleNumbers(page, [8, 9]);
});

test("긴 쪽을 읽다가 넘기면 새 쪽의 처음부터 보이고 키보드 포커스가 남는다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const longBook: Book = {
    ...book,
    pages: book.pages.map((item, index) => index === 0 ? {
      ...item,
      text: Array.from({ length: 30 }, () => "작은 나뭇잎을 따라 천천히 숲길을 걸었다.").join("\n"),
    } : item),
  };
  await openBook(page, longBook);
  const firstText = page.locator("[data-책문장]").first();
  await firstText.focus();
  await page.keyboard.press("End");
  await expect.poll(() => firstText.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await firstText.evaluate((element) => element.scrollIntoView({ block: "end" }));

  const next = page.locator("[data-book-next]");
  await next.click();
  await visibleNumbers(page, [3, 4]);
  await expect(next).toBeFocused();
  await expect.poll(() => page.locator(".book-pages").evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  const previous = page.locator("[data-book-previous]");
  await previous.click();
  await visibleNumbers(page, [1, 2]);
  // 첫 장면에서는 이전 버튼이 비활성화되므로 다음 버튼으로 포커스가 이어진다.
  await expect(next).toBeFocused();
  expect(await firstText.evaluate((element) => element.scrollTop)).toBe(0);
});

test("한 장면짜리 책은 두 면을 표시하고 양쪽 이동 버튼을 비활성화한다", async ({ page }) => {
  await openBook(page, { ...book, pages: book.pages.slice(0, 1), counts: { basic: 1, rare: 0, legendary: 0 } });
  await visibleNumbers(page, [1, 2]);
  await expect(page.locator("[data-book-location]")).toHaveText("1–2쪽");
  await expect(page.locator("[data-book-previous]")).toBeDisabled();
  await expect(page.locator("[data-book-next]")).toBeDisabled();
});
