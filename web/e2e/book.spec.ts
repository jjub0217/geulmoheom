import { expect, test, type Page } from "@playwright/test";

import type { components, paths } from "../src/api/types.gen";
// 문구는 박지 않는다 — `docs/문구.md` 1.13·2.4·2.5 가 SSOT 다.
import { 빈책 } from "../src/app/book/copy";
import { 버튼, 못닿음 } from "../src/app/copy";
import { 상태표시 } from "../src/app/status-copy";
import { 티어이름 } from "../src/components/tier-badge";

/**
 * 내 책 (A0-4). **문장은 전부 지어낸 것이다** — 실제 아이 문장을 테스트에 넣지 않는다
 * (`docs/루브릭_예시셋.md` 와 같은 규칙).
 */
type Book = paths["/api/v1/book"]["get"]["responses"][200]["content"]["application/json"];

const BOOK = "**/api/v1/book";
const 그림 = "http://localhost:3000/api/v1/artworks/w1/image";

const 페이지 = (
  over: Partial<components["schemas"]["BookPage"]> = {},
): components["schemas"]["BookPage"] => ({
  page_no: 1,
  source: "card",
  source_id: "c01",
  tier: "legendary",
  artwork_url: 그림,
  text: "은빛 물고기가 살금살금 지나갔다",
  achieved_at: "2026-09-08T01:00:00Z",
  ...over,
});

const 책 = (pages: components["schemas"]["BookPage"][]): Book => ({
  book_id: "b1",
  title: "불꽃탐험가의 모험",
  visibility: "private",
  pages,
  counts: { basic: 0, rare: 0, legendary: pages.length },
});

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

test("쓴 문장과 그림이 책 페이지로 다시 열린다", async ({ page }) => {
  const 책내용 = 책([페이지(), 페이지({ page_no: 2, tier: "basic", text: "낡은 문을 밀었다" })]);
  await page.route(BOOK, (route) =>
    route.fulfill({ status: 200, json: 책내용 }),
  );
  await page.goto("/book");

  // 제목은 **서버가 준 것 그대로**다. 프론트가 짓지 않는다.
  await expect(page.getByText(책내용.title)).toBeVisible();

  // **문장은 아이 원문 그대로**다 — 요약도 교정도 없다 (비전 2장).
  const 문장들 = page.locator("main [data-책문장]");
  await expect(문장들).toHaveText(책내용.pages.map((p) => p.text));

  // 티어 배지는 결과 화면과 **같은 것**이다 (`문구.md` 1.8).
  await expect(page.locator("main [data-티어배지]")).toHaveText([
    티어이름.legendary,
    티어이름.basic,
  ]);

  // **번호는 서버가 준 `page_no`** 다 — 목록의 몇 번째가 아니다.
  await expect(page.locator("main [data-쪽번호]")).toHaveText(["1", "2"]);

  // 그림은 서버가 준 주소 그대로. **`crossOrigin` 을 붙이지 않는다.**
  const 삽화 = page.locator(`main img[src="${그림}"]`).first();
  await expect(삽화).toBeVisible();
  await expect(삽화).not.toHaveAttribute("crossorigin", /.*/);

  // **날짜를 안 그린다** (`문구.md` 1.14). 아이는 그림으로 찾고,
  // 날짜가 보이면 **「안 쓴 날」도 보인다.**
  const 화면 = await page.locator("main").innerText();
  expect(화면).not.toContain("9월");
  expect(화면).not.toContain("2026");

  await 가로스크롤없음(page);
});

test("굽는 중이라 그림이 없어도 페이지는 선다 — 자리를 비운다", async ({ page }) => {
  // `artwork_url` 은 `ready` 인 것만 온다. **폴링이 끝나기 전에 책을 열 수 있다.**
  await page.route(BOOK, (route) =>
    route.fulfill({ status: 200, json: 책([페이지({ artwork_url: null })]) }),
  );
  await page.goto("/book");

  await expect(page.locator("main [data-책문장]")).toHaveCount(1);
  // 깨진 그림을 세우면 **아이는 자기 그림이 사라진 줄 안다.**
  await expect(page.locator("main img")).toHaveCount(0);
});

test("빈 책은 없다고 말하지 않는다 — 앞으로 생길 것을 말한다", async ({ page }) => {
  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책([]) }));
  await page.goto("/book");

  await expect(page.getByText(빈책.줄1)).toBeVisible();
  await expect(page.getByText(빈책.줄2)).toBeVisible();
  // **여기가 「내 책」이 뭔지 알려주는 유일한 자리다.** 나가는 곳은 모험 화면 하나뿐이다.
  await page.getByRole("link", { name: 빈책.버튼 }).click();
  await expect(page).toHaveURL(/\/$/);

  // **못 한 것을 세지 않는다** — 「아직」·「없」으로 시작하면 아이가 자기가 못 한 것으로 읽는다.
  const 화면 = await page.locator("main").innerText();
  for (const 금지어 of ["아직", "없어", "0"]) expect(화면).not.toContain(금지어);
});

test("책을 못 불러오면 빈 화면이 아니라 이유가 뜬다", async ({ page }) => {
  await page.route(BOOK, (route) => route.abort());
  await page.goto("/book");

  await expect(page.getByText(못닿음.내책)).toBeVisible();
  await expect(page.getByRole("button", { name: 버튼.다시열기 })).toBeVisible();
  // **앱 목소리라 캐릭터를 세우지 않는다** (`문구.md` 0장).
  await expect(page.locator('main img[src^="/guide/"]')).toHaveCount(0);
});

test("여는 동안 무엇을 하고 있는지 말한다 — 「확인하는 중」을 돌려 쓰지 않는다", async ({
  page,
}) => {
  await page.route(BOOK, async (route) => {
    await new Promise((r) => setTimeout(r, 1_500));
    return route.fulfill({ status: 200, json: 책([]) });
  });
  await page.goto("/book");

  await expect(page.getByText(상태표시.책펼치는중)).toBeVisible();
  expect(상태표시.책펼치는중).not.toBe(상태표시.확인중);
});

/**
 * **계약이 적은 실측값을 여기 다시 적는다** (`docs/api/Stage0.md` 5절 — 20/20 장 `784×1353`).
 *
 * **`lib/artwork-frame.ts` 의 상수를 읽어오지 않는다.** 읽어오면 그 상수를 4:3 으로 바꿔도
 * 검사가 같이 따라가서 **초록으로 지나간다** — 2026-09-08 에 실제로 그랬다.
 * **검사가 자기가 재려는 것을 자기한테서 가져오면 아무것도 안 재는 것이다.**
 */
const 계약비율 = 784 / 1353;

test("책 액자도 그림 비율이다 — 한 번 잘리면 잘린 채로 쌓인다", async ({ page }) => {
  await page.route(BOOK, (route) =>
    route.fulfill({ status: 200, json: 책([페이지({})]) }),
  );
  await page.goto("/book");

  const 삽화 = page.locator(`main img[src="${그림}"]`).first();
  await expect(삽화).toBeVisible();

  // **결과 화면과 같은 액자다** (`lib/artwork-frame.ts`). 한때 여기도 `aspect-4/3` 에
  // `object-cover` 라 **위아래 각 28% 가 잘렸다** — 책은 아이 창작물을 두는 자리다.
  const 액자 = (await 삽화.locator("..").boundingBox())!;
  expect(액자.width / 액자.height).toBeCloseTo(계약비율, 2);
  await expect(삽화).toHaveCSS("object-fit", "contain");
});
