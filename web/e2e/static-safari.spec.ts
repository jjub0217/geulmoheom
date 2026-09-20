import { expect, test } from "@playwright/test";

import type { components, paths } from "../src/api/types.gen";
import { 버튼 } from "../src/app/copy";

/**
 * **정적 빌드 · Safari 엔진에서만 갈리는 것** (`playwright.static.config.ts`).
 *
 * **빠른 갈래가 재는 것을 여기서 다시 재지 않는다.** 여기 오는 것은 조건 셋이 겹칠 때만
 * 드러나는 것들이다 — **정적 내보내기 · WebKit · 아이패드 뷰포트**.
 *
 * **왜 생겼나.** 2026-09-09, 같은 정적 빌드를 **Chromium 은 액자 비율 0.579** 로 그렸는데
 * **실기기 Safari 스크린샷은 1.10** 이었다. 「검사가 초록인데 기기가 다르다」를 가르는 데
 * 하루가 갔고, 그 갈래를 **아이패드 없이** 기계가 돌게 만든 것이 이 파일이다.
 *
 * ```
 * NEXT_PUBLIC_API_BASE_URL=/api/v1 pnpm build && pnpm e2e:static
 * ```
 *
 * **`make build-out` 으로 구운 것과 다르다** — 그건 LAN 주소가 박힌 실기기용이다. 섞지 않는다.
 */

type CardResponse =
  paths["/api/v1/cards/next"]["get"]["responses"][200]["content"]["application/json"];
type AttemptResult = components["schemas"]["AttemptResult"];

const ARTWORK = "w1";
const CARD: CardResponse = {
  card_id: "c99",
  type: "discovery",
  situation: "낡은 등대 문이 반쯤 열려 있고 안쪽에서 파란 빛이 새어 나온다.",
  prompt_label: "탐험가는 어떻게 할까?",
  guide: { expression: "default", line: "나침반이 조용하네." },
  today: { cards_done: 0, cap: 5 },
};

/** 1x1 투명 PNG. 그림이 실제로 떴는지 보려면 바이트가 진짜여야 한다. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

for (const [폭, 높이, 모양] of [[200, 200, "정사각형"], [120, 240, "세로"], [240, 120, "가로"]] as const) {
test(`정적 빌드의 사파리도 ${모양} 원본 비율과 그림 전체를 보존한다`, async ({ page, baseURL }) => {
  const 그림주소 = `${baseURL}/api/v1/artworks/${ARTWORK}/image`;

  await page.route("**/api/v1/cards/next", (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route("**/api/v1/attempts", (route) =>
    route.fulfill({
      status: 200,
      json: {
        outcome: "result",
        attempt_id: "a1",
        tier: "rare",
        highlights: [],
        guide: CARD.guide,
        artwork: { artwork_id: ARTWORK, status: "pending", url: null },
        can_retry: false,
        today: { cards_done: 1, cap: 5, locked: false },
      } satisfies AttemptResult,
    }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "ready",
        url: 그림주소,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${폭}" height="${높이}"><rect width="100%" height="100%" fill="#d6e4ed"/><rect width="20" height="20" fill="#c24136"/><rect x="${폭 - 20}" width="20" height="20" fill="#356b3e"/><rect y="${높이 - 20}" width="20" height="20" fill="#305a96"/><rect x="${폭 - 20}" y="${높이 - 20}" width="20" height="20" fill="#8d489c"/></svg>`,
    }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  const 액자 = page.locator("main [data-삽화자리]");
  await expect(액자).toBeVisible();
  const 그림 = 액자.locator("img");
  await expect(그림).toBeVisible();
  await expect(그림).toHaveAttribute("src", 그림주소);
  await expect(그림).not.toHaveAttribute("crossorigin", /.*/);
  await expect(그림).toHaveCSS("object-fit", "contain");
  await expect(그림).toHaveCSS("transform", "none");
  await expect.poll(() => 그림.evaluate((element) => {
    const image = element as HTMLImageElement;
    return [image.naturalWidth, image.naturalHeight];
  })).toEqual([폭, 높이]);
  await expect.poll(async () => {
    const bounds = (await 액자.boundingBox())!;
    return bounds.width / bounds.height;
  }).toBeCloseTo(폭 / 높이, 2);
  const 자리 = (await 액자.boundingBox())!;

  // **높이가 눌리지 않았다.** 액자 안에는 흐름에 있는 것이 없어(`Image fill` 은 절대 배치)
  // 세로 flex 가 꽉 차면 **비율을 이기고 찌그러뜨릴 수 있는** 모양이다 — 그 일이 안 났다는 확인이다.
  //
  // **⛔ 숫자를 박지 않는다** (2026-09-15). 여기 `400` 이 박혀 있었는데 그건 **액자 상한이
  // 60svh 이던 시절의 값**이다. 상한을 **50svh 로 내린 날**(그리고 낮은 화면은 45svh)
  // 이 줄이 낡았고, **`e2e:static` 은 CI 에도 없고 빌드를 새로 구워야 돌아서** 아무도
  // 안 돌린 채 며칠 갔다. **오늘 비율을 고치다 우연히 드러났다.**
  //
  // 원본 비율이 달라도 최대 변의 크기는 유지하고 나머지 변을 줄인다.
  const 화면높이 = page.viewportSize()!.height;
  expect(Math.max(자리.width, 자리.height)).toBeGreaterThan(화면높이 * 0.3);
  expect(Math.max(자리.width, 자리.height)).toBeLessThanOrEqual(화면높이 * 0.5 + 1);
});
}

test("사파리의 낮은 화면에서도 입력 직후 보내기를 한 번 누르면 결과로 간다", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 360, height: 390 });
  const 그림주소 = `${baseURL}/api/v1/artworks/${ARTWORK}/image`;
  const 쓴글 = "등대 계단을 한 칸씩 올라간다";
  let 제출횟수 = 0;

  await page.route("**/api/v1/cards/next", (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route("**/api/v1/attempts", (route) => {
    if (route.request().method() === "POST") 제출횟수 += 1;
    return route.fulfill({
      status: 200,
      json: {
        outcome: "result",
        attempt_id: "a-low-viewport",
        tier: "rare",
        highlights: [],
        guide: CARD.guide,
        artwork: { artwork_id: ARTWORK, status: "pending", url: null },
        can_retry: false,
        today: { cards_done: 1, cap: 5, locked: false },
      } satisfies AttemptResult,
    });
  });
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "ready",
        url: 그림주소,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );

  await page.goto("/");
  const 입력창 = page.getByLabel(CARD.prompt_label);
  await 입력창.fill(쓴글);
  await expect(입력창).toBeFocused();
  const 보내기 = page.getByRole("button", { name: 버튼.보내기, exact: true });
  await expect(보내기).toBeInViewport();

  // Safari는 마우스로 버튼을 눌러도 초점을 옮기지 않는다. 입력 초점이 풀리는 순간
  // 높이가 바뀌면 pointerdown과 pointerup 사이 버튼이 움직여 첫 클릭이 사라졌었다.
  await 보내기.click();

  await expect(page.locator("main [data-삽화자리]")).toBeVisible();
  await expect(page.getByText(쓴글, { exact: true })).toBeVisible();
  await expect(입력창).toHaveCount(0);
  expect(제출횟수).toBe(1);
});
