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

/** **계약이 적은 실측값을 여기 다시 적는다** (`Stage0.md` 5절 — 20/20 장 `784×1353`). */
const 계약비율 = 784 / 1353;

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

test("정적 빌드를 사파리로 열어도 액자가 그림 비율이다", async ({ page, baseURL }) => {
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
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  const 액자 = page.locator("main [data-삽화자리]");
  await expect(액자).toBeVisible();
  const 자리 = (await 액자.boundingBox())!;

  // **실기기 스크린샷은 여기서 260×237(비율 1.10) 이었다.** 같은 조건에서 이 검사가
  // 0.579 를 보면 **엔진 탓이 아니라는 뜻**이고, 그러면 다음에 볼 자리가 달라진다.
  expect(자리.width / 자리.height).toBeCloseTo(계약비율, 2);

  // **높이가 눌리지 않았다.** 액자 안에는 흐름에 있는 것이 없어(`Image fill` 은 절대 배치)
  // 세로 flex 가 꽉 차면 **비율을 이기고 찌그러뜨릴 수 있는** 모양이다 — 그 일이 안 났다는 확인이다.
  expect(자리.height).toBeGreaterThan(400);
});


