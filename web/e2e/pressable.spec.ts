import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * **누를 수 있는 것에 마우스·키보드 표시가 있는가** (`adr/0014` 결정 6).
 *
 * **2026-09-14 이전에는 저장소 전체에 `hover:` 0개 · `focus-visible:` 0개였다.**
 * 터치 전제로 만들어졌다는 증거다 — **손가락은 올려놓을 수가 없어서 「올렸을 때」라는
 * 상태 자체가 없었다.** 웹으로 열면서 생겼다.
 *
 * **⛔ 「초점이 잡히는가」를 재지 않는다.** 계획의 초안이 `:focus-visible` 의 개수를 세는
 * 것이었는데, **그건 브라우저 기본 outline 으로 우연히 통과한다** — 계획 자신이 그렇게 적어 뒀다.
 * **우연히 통과하는 검사는 우리가 정한 것을 하나도 안 지킨다.** 그래서 여기서는
 * **`pressable` 이 정한 값**(2px · offset 2px · 황동색)을 본다. 유틸을 떼면 빨간불이다.
 */

/** `globals.css` 의 `--color-brass`. **여기 다시 적는다** — 토큰에서 읽어오면 토큰을 바꿔도 따라간다. */
const 황동 = "rgb(194, 155, 89)";

/** 초점이 간 곳의 계산된 값. */
async function 초점표시(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return null;
    const s = getComputedStyle(el);
    return {
      width: s.outlineWidth,
      offset: s.outlineOffset,
      color: s.outlineColor,
      style: s.outlineStyle,
    };
  });
}

/**
 * `main` 안에서 키보드로 **누를 수 있는 것**(`button`·`a`)까지 간다.
 *
 * **⛔ 「첫 초점」이 아니라 「누를 수 있는 것」을 찾는다.** 모험 화면의 첫 초점은 **입력창**인데
 * 거기는 **일부러 `outline-none`** 이다 — 표시를 **감싸개가 `focus-within` 으로** 낸다
 * (`attempt-input.tsx`: 「테두리가 이 덩어리를 감싼다 … 초점 표시도 여기로 올라온다」).
 * **그 자리를 재면 `pressable` 이 아니라 남의 규칙을 재게 된다.**
 *
 * **`.focus()` 로 대신하지 않는다** — `:focus-visible` 은 **키보드로 왔는지**를 보므로
 * 프로그램으로 초점을 주면 표시가 안 뜬다. **재려는 것이 바로 그 구분**이다.
 */
async function 누를수있는것까지(page: Page) {
  // **여덟 번이면 어느 화면이든 닿는다.** 못 닿으면 아래 단언이 `null` 로 떨어져
  // **조용히 통과하지 않는다.**
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    const 닿았나 = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el.closest("main") === null) return false;
      return el.tagName === "BUTTON" || el.tagName === "A";
    });
    if (닿았나) return;
  }
}

test("키보드로 옮겨 다니면 지금 어디인지 보인다 — 브라우저 기본이 아니라 우리 표시다", async ({
  page,
}) => {
  await page.route("**/api/v1/cards/next", (route) =>
    route.fulfill({
      status: 200,
      json: {
        card_id: "c99",
        type: "discovery",
        situation: "낡은 등대 문이 반쯤 열려 있다.",
        prompt_label: "탐험가는 어떻게 할까?",
        guide: { expression: "default", line: "나침반이 조용하네." },
        today: { cards_done: 1, cap: 5 },
      },
    }),
  );
  await page.goto("/");

  // **먼저 쓴다.** 빈 입력일 때 「보내기」는 `disabled` 라 **초점이 안 간다** —
  // 그러면 `main` 안에 누를 수 있는 것이 하나도 없다(「나가기」는 `<main>` 밖이다).
  // **아이가 실제로 지나는 순서**이기도 하다: 쓰고 → 보내기로 간다.
  const 입력창 = page.getByLabel("탐험가는 어떻게 할까?");
  await 입력창.fill("등대 계단을 한 칸씩 올라간다");
  await 입력창.focus();

  await 누를수있는것까지(page);

  // **`null` 이면 누를 수 있는 것에 못 닿았다는 뜻이다** — 그때도 빨간불이어야 한다.
  await expect.poll(() => 초점표시(page)).not.toBeNull();

  // **⚠ 한 번 읽으면 안 된다.** `pressable` 에 `transition-colors` 가 있고 **그 목록에
  // `outline-color` 가 들어 있다** — Tab 직후에 읽으면 **전이 시작값인 `currentColor`**,
  // 즉 버튼 글자색이 잡힌다. 2026-09-14 에 그걸로 한참 헤맸다:
  // **CSS 는 맞는데 재는 시점이 틀렸고, 증상은 「색만 안 먹는다」로 보였다.**
  await expect
    .poll(async () => (await 초점표시(page))?.color)
    .toBe(황동);

  const 표시 = await 초점표시(page);
  // **우리가 정한 값이다.** 브라우저 기본은 offset 이 0 이고 색도 다르다 —
  // 그래서 이 셋이 `pressable` 이 붙었는지를 실제로 가른다.
  expect(표시?.style).not.toBe("none");
  expect(표시?.offset).toBe("2px");
});

test("마우스를 올리면 바탕이 바뀐다 — 올려도 아무 일이 없으면 누를 수 있는 건지 모른다", async ({
  page,
}) => {
  await page.route("**/api/v1/book", (route) =>
    route.fulfill({
      status: 200,
      json: {
        book_id: "b1",
        title: "불꽃탐험가의 모험",
        author: "민준",
        visibility: "private",
        pages: [],
        counts: { basic: 0, rare: 0, legendary: 0 },
      },
    }),
  );
  await page.goto("/book");

  const 문: Locator = page.getByRole("link").first();
  await expect(문).toBeVisible();

  const 바탕 = () => 문.evaluate((el) => getComputedStyle(el).backgroundColor);
  const 올리기전 = await 바탕();
  await 문.hover();
  // **바뀌는 데 시간이 걸린다** — `transition-colors` 가 붙어 있다.
  await expect.poll(바탕).not.toBe(올리기전);
});

test("홈 화면 앱으로 열리지 않는다 — 매니페스트도 서비스워커도 없다", async ({ page }) => {
  // **⭐ 셋 중 `appleWebApp` 이 핵심이다** (`adr/0014` 결정 1).
  // **홈 화면 추가 자체는 못 막는다** — Safari 공유 메뉴는 무엇을 지우든 거기 있다.
  // **막을 수 있는 것은 「그것이 격리된 컨텍스트로 열리는 것」**이고, 그 스위치가 이 메타다.
  // 없으면 iOS 가 홈 화면 아이콘을 **Safari 탭으로 열어** 쿠키가 공유되고,
  // **1회용 코드 함정이 존재하지 않게 된다.** 아이가 추가해도 **아무 일도 안 일어나는 상태**가 목표다.
  await page.goto("/");

  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveCount(0);
  // **`mobile-web-app-capable` 도 본다** — Next 가 `appleWebApp` 과 함께 내던 짝이고,
  // 하나만 지우면 **안드로이드 쪽에서 같은 일이 남는다.**
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveCount(0);
  expect((await page.request.get("/sw.js")).status()).toBe(404);
});
