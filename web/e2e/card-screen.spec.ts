import { expect, test, type Page } from "@playwright/test";

import type { paths } from "../src/api/types.gen";

/**
 * 오늘의 모험 화면(A0-2)이 응답 네 가지를 각각 그리는지 본다.
 *
 * **문장은 전부 지어낸 것이다.** 실제 아이 문장을 테스트에 넣지 않는다 —
 * 예시셋과 같은 규칙이다 (`docs/루브릭_예시셋.md`).
 */

/** 계약에서 끌어온다. `make contracts` 로 계약이 갈라지면 **여기서 타입이 깨져 알려준다.** */
type CardResponse =
  paths["/api/v1/cards/next"]["get"]["responses"][200]["content"]["application/json"];

const CARD: CardResponse = {
  card_id: "c99",
  type: "discovery",
  situation: "낡은 등대 문이 반쯤 열려 있고 안쪽에서 파란 빛이 새어 나온다.",
  prompt_label: "탐험가는 어떻게 할까?",
  sketch_url: "https://r2.example/geulmoheom/cards/c99_sketch.webp",
  guide: {
    expression: "default",
    line: "나침반이 조용하네. 네가 뭘 할지 말해주면 움직일 거야!",
  },
  today: { cards_done: 1, cap: 5 },
};

const CARDS_NEXT = "**/api/v1/cards/next";

/** 오류 봉투는 `docs/api/공통규약.md` 형식이다. */
function errorBody(
  code: string,
  message: string,
  detail?: Record<string, unknown>,
) {
  return JSON.stringify({ error: { code, message, detail } });
}

/** 가로 스크롤이 생기면 태블릿 가로·모바일 세로 어느 쪽이든 깨진 것이다. */
async function 가로스크롤없음(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

test("카드가 오면 상황문을 그린다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );

  await page.goto("/");

  await expect(page.getByText(CARD.situation)).toBeVisible();

  // 가이드는 서버가 준 표정·대사 그대로다. 입력 중에는 `default` 이고, 프론트가 바꾸지 않는다.
  await expect(page.getByText(CARD.guide.line)).toBeVisible();
  await expect(page.locator('img[src="/guide/default.png"]')).toBeVisible();

  // 자유 입력창 하나. **선택지 버튼이 없어야 한다** — 있으면 「직접 쓴다」가 무너진다.
  const 입력창 = page.getByLabel(CARD.prompt_label);
  await expect(입력창).toBeVisible();
  await 입력창.fill("등대 문틈으로 손전등을 비춰 안쪽을 살핀다");
  await expect(입력창).toHaveValue("등대 문틈으로 손전등을 비춰 안쪽을 살핀다");
  await expect(page.getByRole("button")).toHaveCount(0);

  await 가로스크롤없음(page);

  // 아이 화면에 나오면 안 되는 말들 (`docs/용어사전.md` 8장).
  // 카드 종류(발견/위기/만남)도 내부 용어라 화면에 없어야 한다.
  const 화면 = await page.locator("main").innerText();
  for (const 금지어 of ["점수", "채점", "연습", "학습", "보스", "앨범", "발견"]) {
    expect(화면).not.toContain(금지어);
  }
});

test("쓸수록 나침반이 밝아진다 — 숫자도 진행바도 없이", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.goto("/");

  // 빛은 그라디언트로 칠한 원 하나다. 밝기는 그 원의 `opacity` 로만 나타난다.
  const 빛 = page.locator('main svg circle[fill^="url("]');
  const 밝기 = async () =>
    Number(await 빛.evaluate((el) => getComputedStyle(el).opacity));

  const 입력창 = page.getByLabel(CARD.prompt_label);

  await 입력창.fill("문을 연다");
  await expect.poll(밝기).toBeGreaterThan(0);
  const 조금 = await 밝기();

  // 30자에서 가득 찬다 (PRD A0-2). 넘겨도 1 에서 멈춘다.
  await 입력창.fill("낡은 등대 문틈으로 손전등을 비추자 계단 위에 젖은 발자국이 이어져 있었다");
  await expect.poll(밝기).toBe(1);

  // 계단이 아니라 연속 변화다 — 적게 썼을 때가 가득 찬 것보다 어두워야 한다.
  expect(조금).toBeLessThan(1);
  expect(조금).toBeGreaterThan(0);

  // **숫자·퍼센트·진행바가 화면에 없다.** 숫자를 지운 자리에 바를 넣으면 같은 것이 된다.
  const 화면 = await page.locator("main").innerText();
  expect(화면).not.toMatch(/[0-9]|%/);
  await expect(page.locator("main progress, main [role='progressbar']")).toHaveCount(0);
});

test("오늘 카드를 다 쓰면 서버가 준 대사를 그대로 보여준다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: errorBody("DAILY_CAP_REACHED", "오늘 카드를 다 썼어요", {
        guide: { expression: "session_end", line: "오늘 모험은 여기까지! 내일 또 보자" },
      }),
    }),
  );

  await page.goto("/");

  await expect(page.getByText("오늘 모험은 여기까지! 내일 또 보자")).toBeVisible();
  await 가로스크롤없음(page);
});

test("서버가 거절하면 빈 화면이 아니라 서버 문구가 뜬다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: errorBody("INTERNAL_ERROR", "지금은 길을 찾을 수 없어요"),
    }),
  );

  await page.goto("/");

  await expect(page.getByText("지금은 길을 찾을 수 없어요")).toBeVisible();
});

test("서버에 닿지 못하면 다시 열 수 있다", async ({ page }) => {
  // 첫 요청은 아예 실패시킨다 — api 를 내리지 않고 「못 닿음」을 만드는 유일한 방법이다.
  await page.route(CARDS_NEXT, (route) => route.abort("failed"));

  await page.goto("/");

  const 다시열기 = page.getByRole("button", { name: "다시 열기" });
  await expect(다시열기).toBeVisible();

  // 두 번째부터는 정상 응답. 다시 열기가 실제로 다시 부르는지까지 본다.
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await 다시열기.click();

  await expect(page.getByText(CARD.situation)).toBeVisible();
});
