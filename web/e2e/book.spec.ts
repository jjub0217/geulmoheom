import { expect, test, type Page } from "@playwright/test";

import type { components, paths } from "../src/api/types.gen";
// 문구는 박지 않는다 — `docs/문구.md` 1.13·1.16·1.17·2.4·2.5 가 SSOT 다.
import { 빈책, 책이름 } from "../src/app/book/copy";
import { 버튼, 못닿음 } from "../src/app/copy";
import { 상태표시 } from "../src/app/status-copy";
import { 모험복귀라벨, 책인쇄라벨 } from "../src/components/book-actions";
import { 티어이름 } from "../src/components/tier-badge";
// 가림 안내는 **1.1 하나뿐**이다 — 카드 화면과 책 이름이 같은 문장을 쓴다 (1.16).
import { 가림안내 } from "../src/lib/pii";

/**
 * 내 책 (A0-4). **문장은 전부 지어낸 것이다** — 실제 아이 문장을 테스트에 넣지 않는다
 * (`docs/루브릭_예시셋.md` 와 같은 규칙).
 */
type Book = paths["/api/v1/book"]["get"]["responses"][200]["content"]["application/json"];

const BOOK = "**/api/v1/book";
const 그림 = "/api/v1/artworks/w1/image";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page, baseURL }) => {
  const testOrigin = new URL(baseURL!).origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    // 실제 그림·계정 API를 부르지 않는다. 개별 /book 모의는 각 검사에서 덮어쓴다.
    if (url.pathname === "/api/v1/artworks/w1/image") {
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#b8c8b0"/></svg>',
      });
    }
    if (url.pathname.startsWith("/api/")) {
      return route.fulfill({ status: 404, json: { detail: "Unmocked test API" } });
    }
    return url.origin === testOrigin ? route.continue() : route.abort();
  });
});

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

const 책 = (
  pages: components["schemas"]["BookPage"][],
  over: Partial<Book> = {},
): Book => ({
  book_id: "b1",
  title: "불꽃탐험가의 모험",
  // **아이 이름이다** (A0-6). 이제 실명이 그대로 남으므로 **사람 이름 모양**으로 둔다 —
  // 지어낸 이름이고 실제 아이 이름을 검사에 넣지 않는다 (`루브릭_예시셋.md` 와 같은 규칙).
  author: "민준",
  visibility: "private",
  pages,
  counts: { basic: 0, rare: 0, legendary: pages.length },
  ...over,
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
  const 책내용 = 책([페이지({ page_no: 3 }), 페이지({ page_no: 8, tier: "basic", text: "낡은 문을 밀었다" })]);
  await page.route(BOOK, (route) =>
    route.fulfill({ status: 200, json: 책내용 }),
  );

  // **어디를 부르는지 센다.** 아래 지은이 검사가 **값이 아니라 출처**를 재는 데 쓴다.
  const 부른곳: string[] = [];
  page.on("request", (req) => 부른곳.push(req.url()));

  await page.goto("/book");

  // 제목은 **서버가 준 것 그대로**다. 프론트가 짓지 않는다.
  await expect(page.getByText(책내용.title)).toBeVisible();

  // **지은이는 제목 아래 한 줄** (A0-6 · `문구.md` 1.15).
  // **문자열을 박지 않는다** — 아이 이름은 계정마다 다르다. `data-*` 표식으로 잡고
  // **값은 서버가 준 것과 대조한다** (W4 에서 네 번 밟은 그것).
  const 지은이줄 = page.locator("[data-지은이]");
  await expect(지은이줄).toContainText(책내용.author);

  // **`GET /child/me` 의 `nickname` 이 아니라 `book.author` 다** — **지금은 두 값이 같아서
  // 바꿔 그려도 화면이 똑같아 보인다.** 그래서 **값이 아니라 출처를 잰다**: 이 화면은
  // `/child/me` 를 **아예 안 부른다.** 부르기 시작하면 여기가 빨간불이고, 그때 누군가
  // `nickname` 으로 갈아탄 것이다. **공유가 열리면 그 차이가 「남의 책에 보는 사람 이름」**이 된다.
  expect(부른곳.filter((u) => u.includes("/child/me"))).toEqual([]);

  // **꾸미는 말을 붙이지 않는다** (`문구.md` 1.15). 칭찬은 가이드가 하고 표지는 사실을 적는다.
  const 지은이글자 = await 지은이줄.innerText();
  for (const 안쓰는말 of ["멋진", "작가님", "우리", "훌륭", "대단"]) {
    expect(지은이글자).not.toContain(안쓰는말);
  }

  // **문장은 아이 원문 그대로**다 — 요약도 교정도 없다 (비전 2장).
  const 문장들 = page.locator("main [data-책문장]");
  await expect(문장들).toHaveText(책내용.pages.map((p) => p.text));

  // 티어 배지는 결과 화면과 **같은 것**이다 (`문구.md` 1.8).
  await expect(page.locator("main [data-티어배지]")).toHaveText([
    티어이름.legendary,
    티어이름.basic,
  ]);

  // 화면 번호는 그림 면과 글 면 순서로 이어지고, 서버 장면 번호는 별도로 보존한다.
  await expect(page.locator("main [data-쪽번호]")).toHaveText(["1", "2", "3", "4"]);
  await expect(page.locator("[data-책쪽]").nth(0)).toHaveAttribute("data-scene-number", "3");
  await expect(page.locator("[data-책쪽]").nth(1)).toHaveAttribute("data-scene-number", "8");

  // 같은 출처의 그림에는 판형 개정 버전만 붙인다. **`crossOrigin` 을 붙이지 않는다.**
  const 삽화 = page.locator("main .book-page-artwork img").first();
  await expect(삽화).toBeVisible();
  await expect(삽화).toHaveAttribute("src", `${그림}?book-layout=square-20260919`);
  await expect(삽화).not.toHaveAttribute("crossorigin", /.*/);

  // **날짜를 안 그린다** (`문구.md` 1.14). 아이는 그림으로 찾고,
  // 날짜가 보이면 **「안 쓴 날」도 보인다.**
  const 화면 = await page.locator("main").innerText();
  expect(화면).not.toContain("9월");
  expect(화면).not.toContain("2026");

  await 가로스크롤없음(page);
});

test("굽는 중인 그림도 같은 책 면에서 완성된다", async ({ page }) => {
  // `artwork_url` 은 ready 인 것만 온다. 참조가 있으면 그 id를 확인해 같은 면을 유지한다.
  let 확인횟수 = 0;
  await page.route(BOOK, (route) =>
    route.fulfill({
      status: 200,
      json: 책([페이지({
        artwork_url: null,
        artwork: { artwork_id: "w1", status: "pending", url: null },
      })]),
    }),
  );
  await page.route("**/api/v1/artworks/w1", (route) => {
    확인횟수 += 1;
    return route.fulfill({
      status: 200,
      json: 확인횟수 === 1
        ? { artwork_id: "w1", status: "pending", url: null, tier: "legendary", fallback: false }
        : { artwork_id: "w1", status: "ready", url: 그림, tier: "legendary", fallback: false },
    });
  });
  await page.goto("/book");

  await expect(page.locator("main [data-책문장]")).toHaveCount(1);
  await expect(page.getByText("그림을 준비하고 있어.")).toBeVisible();
  // 굽는 동안에도 삽화 면이 남아 두 면으로 읽힌다.
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.locator("main [data-쪽번호]")).toHaveText(["1", "2"]);
  await expect(page.locator("[data-book-location]")).toHaveText("1–2쪽");

  // 첫 요청은 3초 뒤, 다음 확인은 2초 뒤다. 준비되면 같은 면에 실제 그림을 넣는다.
  await expect(page.locator("main .book-page-artwork img")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("그림을 준비하고 있어.")).toHaveCount(0);
});

test("빈 책은 없다고 말하지 않는다 — 앞으로 생길 것을 말한다", async ({ page }) => {
  // **지은이를 다른 이름으로 준다.** 위 검사 하나만으로는 **컴포넌트가 이름을 박아 둬도
  // 통과한다** — 픽스처의 이름과 화면의 이름이 우연히 같기만 하면 되기 때문이다.
  // **두 번째 이름이 그 우연을 없앤다.** 아이 이름은 계정마다 다르다.
  const 책내용 = 책([], { author: "서윤" });
  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책내용 }));
  await page.goto("/book");

  // **빈 책에도 표지는 선다.** 아직 한 장도 안 썼어도 **그 책은 이 아이 것**이다.
  await expect(page.locator("[data-지은이]")).toContainText(책내용.author);

  await expect(page.getByText(빈책.줄1)).toBeVisible();
  await expect(page.getByText(빈책.줄2)).toBeVisible();
  // **못 한 것을 세지 않는다** — 「아직」·「없」으로 시작하면 아이가 자기가 못 한 것으로 읽는다.
  const 화면 = await page.locator("main").innerText();
  for (const 금지어 of ["아직", "없어", "0"]) expect(화면).not.toContain(금지어);

  // 빈 책 안내 아래에 귀환 버튼 하나를 둔다. 인쇄할 내용이 없으면 인쇄 버튼은 없다.
  const 돌아가기 = page.getByRole("link", { name: 모험복귀라벨, exact: true });
  await expect(돌아가기).toHaveCount(1);
  await expect(page.locator(".book-actions [data-쓰러가기]")).toHaveCount(1);
  await expect(page.locator("[data-보내기]")).toHaveCount(0);
  const 안내위치 = (await page.locator(".book-empty").boundingBox())!;
  const 귀환위치 = (await 돌아가기.boundingBox())!;
  expect(귀환위치.y).toBeGreaterThanOrEqual(안내위치.y + 안내위치.height);
  await 돌아가기.click();
  await expect(page).toHaveURL(/\/$/);
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
  // 로딩은 한 줄로만 알린다. 책장을 흉내 낸 큰 종이 박스는 표시하지 않는다.
  await expect(page.getByRole("status")).toHaveCSS("box-shadow", "none");
  await expect(page.getByRole("status")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(상태표시.책펼치는중).not.toBe(상태표시.확인중);
});

test("책 화면은 정사각 판형을 유지하고 세로 삽화도 빈 여백 없이 채운다", async ({ page }) => {
  // 원본 비율과 판형이 다른 경우를 재야 정사각 면과 삽화 보존을 함께 확인할 수 있다.
  await page.route("**/api/v1/artworks/w1/image*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="784" height="1353"><rect width="784" height="1353" fill="#b8c8b0"/></svg>',
    }),
  );
  await page.route(BOOK, (route) =>
    route.fulfill({ status: 200, json: 책([페이지({})]) }),
  );
  await page.goto("/book");

  const 삽화 = page.locator("main .book-page-artwork img").first();
  await expect(삽화).toBeVisible();
  await expect(삽화).toHaveAttribute("src", `${그림}?book-layout=square-20260919`);
  await expect.poll(() => 삽화.evaluate((image: HTMLImageElement) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }))).toEqual({ width: 784, height: 1353 });

  // 화면의 한쪽 면은 1:1이고, 세로 원본도 빈 여백 없이 책장을 채운다.
  const 액자 = (await 삽화.locator("..").boundingBox())!;
  expect(액자.width / 액자.height).toBeCloseTo(1, 2);
  await expect(삽화).toHaveCSS("object-fit", "cover");
  await expect(삽화).not.toHaveAttribute("crossorigin", /.*/);
});

// ── 책 이름 바꾸기 (A0-4 후속 · `문구.md` 1.16) ───────────────────────────

const 책이름칸 = (page: Page) => page.locator("[data-책이름칸]");
const 보내기 = (page: Page) => page.locator("[data-책이름보내기]");

/** 열어 둔 상태로 시작한다. 여는 것 자체는 아래 첫 검사가 따로 잰다. */
async function 이름고치기를연다(page: Page, 책내용 = 책([페이지()])) {
  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책내용 }));
  await page.goto("/book");
  await page.locator("[data-책이름바꾸기]").click();
  await expect(책이름칸(page)).toBeVisible();
  await expect(책이름칸(page)).toBeFocused();
  return 책내용;
}

test("책 이름 자체가 연필 아이콘과 함께 편집 버튼이며 키보드로도 열린다", async ({ page }) => {
  const 책내용 = 책([페이지()]);
  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책내용 }));
  await page.goto("/book");

  const 표지이름 = page.locator("main h1");
  const 이름버튼 = 표지이름.getByRole("button", { name: `${책내용.title}: ${책이름.바꾸기}`, exact: true });
  await expect(표지이름).toHaveText(책내용.title);
  await expect(이름버튼).toHaveAttribute("data-책이름바꾸기", "true");
  await expect(이름버튼).toHaveText(책내용.title);
  await expect(이름버튼.locator('svg[aria-hidden="true"]')).toBeVisible();
  await expect(page.locator("[data-책이름바꾸기]")).toHaveCount(1);
  await expect(이름버튼).toHaveAttribute("aria-expanded", "false");

  await 이름버튼.focus();
  await page.keyboard.press("Enter");
  await expect(책이름칸(page)).toBeFocused();
  await expect(책이름칸(page)).toHaveValue(책내용.title);
  await expect(이름버튼).toHaveAttribute("aria-expanded", "true");
});

test("책 이름 편집을 취소하거나 Escape를 누르면 원래 이름과 편집 버튼으로 돌아온다", async ({ page }) => {
  const 책내용 = await 이름고치기를연다(page);
  let 보낸횟수 = 0;
  await page.route(BOOK, (route) => {
    if (route.request().method() === "PATCH") 보낸횟수 += 1;
    return route.fallback();
  });
  const 이름버튼 = page.locator("[data-책이름바꾸기]");
  const 취소 = page.getByRole("button", { name: "취소", exact: true });

  await 책이름칸(page).fill("쓰다가 그만둔 이름");
  await 취소.click();
  await expect(책이름칸(page)).toHaveCount(0);
  await expect(page.locator("main h1")).toHaveText(책내용.title);
  await expect(이름버튼).toBeFocused();
  await expect(이름버튼).toHaveAttribute("aria-expanded", "false");
  await 이름버튼.press("Enter");
  await expect(책이름칸(page)).toHaveValue(책내용.title);

  // 빈 이름이어도 취소할 수 있고, 그 안내를 닫힌 표지에 남기지 않는다.
  await 책이름칸(page).fill("");
  await expect(취소).toBeEnabled();
  await 책이름칸(page).press("Escape");
  await expect(책이름칸(page)).toHaveCount(0);
  await expect(page.locator("[data-책이름비었다], [data-책이름알림]")).toHaveCount(0);
  await expect(이름버튼).toBeFocused();
  await 이름버튼.press("Enter");
  await expect(책이름칸(page)).toHaveValue(책내용.title);
  expect(보낸횟수).toBe(0);
});

test("한글 조합 중 Escape는 책 이름 편집을 취소하지 않는다", async ({ page }) => {
  await 이름고치기를연다(page);
  const 입력칸 = 책이름칸(page);
  await 입력칸.fill("새로운 이름");
  await 입력칸.dispatchEvent("compositionstart");
  await 입력칸.press("Escape");
  await expect(입력칸).toBeVisible();
  await expect(입력칸).toHaveValue("새로운 이름");
  await 입력칸.dispatchEvent("compositionend");
  await 입력칸.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(입력칸).toBeVisible();
  await 입력칸.press("Escape");
  await expect(입력칸).toHaveCount(0);
  await expect(page.locator("[data-책이름바꾸기]")).toBeFocused();
});

test("책 이름을 보내는 동안은 고치거나 취소하지 않고 서버 응답을 기다린다", async ({ page }) => {
  const 책내용 = await 이름고치기를연다(page);
  let 보낸횟수 = 0;
  let 응답한다!: () => void;
  const 응답대기 = new Promise<void>((resolve) => { 응답한다 = resolve; });
  await page.route(BOOK, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    보낸횟수 += 1;
    expect(route.request().postDataJSON()).toEqual({ title: "새로 지은 이름" });
    await 응답대기;
    return route.fulfill({ status: 200, json: { title: "서버가 저장한 이름" } });
  });
  const 입력칸 = 책이름칸(page);
  const 취소 = page.locator("[data-책이름취소]");
  await 입력칸.fill("새로 지은 이름");
  await 보내기(page).click();
  await expect.poll(() => 보낸횟수).toBe(1);
  await expect(입력칸).toHaveAttribute("readonly", "");
  await expect(보내기(page)).toBeDisabled();
  await expect(취소).toBeDisabled();
  await expect(page.locator(".book-title-editor")).toHaveAttribute("aria-busy", "true");
  await 입력칸.focus();
  await 입력칸.press("End");
  await 입력칸.press("Backspace");
  await 입력칸.press("Escape");
  await 입력칸.press("Enter");
  await expect(입력칸).toHaveValue("새로 지은 이름");
  await expect(page.locator("main h1")).toHaveText(책내용.title);
  expect(보낸횟수).toBe(1);

  응답한다();
  await expect(page.locator("main h1")).toHaveText("서버가 저장한 이름");
  await expect(입력칸).toHaveCount(0);
  await expect(page.locator("[data-책이름바꾸기]")).toBeFocused();
  await page.locator("[data-책이름바꾸기]").press("Enter");
  await expect(책이름칸(page)).toBeEditable();
  await expect(취소).toBeEnabled();
});

test("책 이름을 바꾸면 표지가 그 자리에서 바뀐다 — 다시 열지 않는다", async ({ page }) => {
  const 책내용 = await 이름고치기를연다(page);

  let 보낸것: unknown = null;
  await page.route(BOOK, async (route) => {
    if (route.request().method() !== "PATCH") {
      return route.fulfill({ status: 200, json: 책내용 });
    }
    보낸것 = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: { title: "달빛 호수의 밤" } });
  });

  await 책이름칸(page).fill("달빛 호수의 밤");
  await 책이름칸(page).press("Enter");

  expect(보낸것).toEqual({ title: "달빛 호수의 밤" });
  // **표지가 바뀐다.** 문자열을 박지 않는다 — 서버가 준 값과 대조한다.
  await expect(page.locator("main h1")).toHaveText("달빛 호수의 밤");
  // **바꾼 뒤 한 줄이 반드시 있다** (1.16). 없으면 성공과 실패가 화면에서 안 갈린다.
  await expect(page.locator("[data-책이름알림]")).toBeVisible();
  // 폼이 사라진 뒤에도 키보드 포커스는 책 이름 도구에 남는다.
  await expect(page.locator("[data-책이름바꾸기]")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(책이름칸(page)).toBeFocused();
  await expect(책이름칸(page)).toHaveValue("달빛 호수의 밤");
});

test("서버가 돌려준 이름을 그린다 — 내가 보낸 값이 아니다", async ({ page }) => {
  await 이름고치기를연다(page);

  // 서버도 본문과 같은 자리에서 가리고 120자에서 자른다 — **응답이 실제로 저장된 값**이고
  // 표지에 인쇄되는 것도 그것이다. 내 값을 그리면 **화면과 책이 갈린다.**
  await page.route(BOOK, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 200, json: { title: "서버가 고친 이름" } })
      : route.fallback(),
  );

  await 책이름칸(page).fill("내가 보낸 이름");
  await 보내기(page).click();

  await expect(page.locator("main h1")).toHaveText("서버가 고친 이름");
  await expect(page.locator("main h1")).not.toHaveText("내가 보낸 이름");
});

test("다 지우면 못 보낸다 — 무슨 일인지 말한다", async ({ page }) => {
  await 이름고치기를연다(page);

  let PATCH가나갔나 = false;
  await page.route(BOOK, (route) => {
    if (route.request().method() === "PATCH") PATCH가나갔나 = true;
    return route.fallback();
  });

  await 책이름칸(page).fill("");

  // **버튼을 막는 것만으로는 왜 안 눌리는지를 안 말한다** (1.16).
  await expect(보내기(page)).toBeDisabled();
  await expect(page.locator("[data-책이름비었다]")).toBeVisible();

  // **`Enter` 로도 안 나간다.**
  //
  // **⚠ 이 단언이 무엇을 재는지 정확히 적는다** — **막는 것은 위 `disabled` 이고**
  // 컴포넌트 안의 `if (비었다) return;` 이 아니다. 기본 버튼이 `disabled` 면
  // **HTML 이 암묵 제출 자체를 안 일으킨다.** 그 줄만 떼고 돌리면 **여기는 그대로 초록**이다
  // (2026-09-12 뒤집어 확인). **그 줄은 「지금 안 도는 갈래」로 코드에 적어 뒀다.**
  //
  // **그래도 이 단언을 둔다** — 재는 것이 「아이가 빈 이름으로 보낼 길이 없다」이지
  // 「어느 줄이 막았나」가 아니다. **막는 주체가 바뀌어도 이 사실은 지켜져야 한다.**
  await 책이름칸(page).press("Enter");
  expect(PATCH가나갔나).toBe(false);
});

test("입력칸이 30자에서 더 안 써진다 — 넘었다고 혼내지 않는다", async ({ page }) => {
  await 이름고치기를연다(page);

  // **계약이 아니라 우리가 정한 값이라 `문구.md` 6.y 를 여기 다시 적는다.**
  // `책이름상한` 을 import 하면 그 상수를 120 으로 바꿔도 검사가 따라가 초록이다 (축 ⑭).
  const 상한 = 30;
  await 책이름칸(page).fill("가".repeat(상한 + 20));
  expect((await 책이름칸(page).inputValue()).length).toBe(상한);

  // **넘었을 때 문구를 두지 않는다** (6.y) — 「30자까지만」을 띄우면 그것이 혼내는 말이 된다.
  const 화면 = await page.locator("main").innerText();
  for (const 안쓰는말 of ["30자", "글자", "너무", "최대", "까지만"]) {
    expect(화면).not.toContain(안쓰는말);
  }
});

test("책 이름에도 개인정보를 가린다 — 카드 화면과 같은 문장이다", async ({ page }) => {
  await 이름고치기를연다(page);

  await 책이름칸(page).fill("010-1234-5678 의 모험");

  // **가린 뒤 값이 그대로 보인다** — 지우지 않고 자리에 남긴다.
  await expect(책이름칸(page)).toHaveValue(/○○○/);
  // **1.1 을 그대로 쓴다.** 여기서 새 분기를 만들지 않는다 — 문구를 import 로 잡는다.
  await expect(page.locator("[data-책이름가림]")).toHaveText(가림안내.phone);
});

test("못 닿으면 바꾼 척하지 않는다 — 「바꿨어」를 말하지 않는다", async ({ page }) => {
  const 책내용 = await 이름고치기를연다(page);
  const 원래이름 = 책내용.title;

  await page.route(BOOK, (route) =>
    route.request().method() === "PATCH" ? route.abort() : route.fallback(),
  );

  await 책이름칸(page).fill("안 닿을 이름");
  await 보내기(page).click();

  // **표지는 안 바뀐다.**
  await expect(page.locator("main h1")).toHaveText(원래이름);
  // **그 한 줄이 성공과 실패를 가르는 유일한 표시라, 실패에 붙으면 거짓말이 된다.**
  await expect(page.locator("[data-책이름알림]")).not.toHaveText(책이름.바꿨다);
  await expect(page.locator("[data-책이름알림]")).toHaveText(못닿음.책이름);
});

test("이름을 바꾸다 인증이 풀리면 인증 화면으로 보낸다", async ({ page }) => {
  await 이름고치기를연다(page);

  await page.route(BOOK, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "다시 들어와 줄래?" } },
        })
      : route.fallback(),
  );

  await 책이름칸(page).fill("바꾸다 끊긴 이름");
  await 보내기(page).click();

  // **표식을 달고 간다** (`문구.md` 3.3 · `lib/kicked.ts`). 내 책을 열었다는 것은
  // **들어와 있었다**는 뜻이라, 인증 화면이 「부모님이 새 접속 코드를 받으셨어요」를 말해도 된다.
  // **마운트 401 에는 안 단다** — `start_url` 이 `/` 라 처음 온 아이도 그리로 온다.
  await expect(page).toHaveURL(/\/child\/auth\?kicked=1$/);
});

test("아이 화면에 「제목」을 쓰지 않는다 — 낱말은 「책 이름」이다", async ({ page }) => {
  await 이름고치기를연다(page);

  // `용어사전.md` 1장: 「제목」은 어른 말이고 이 자리는 아이가 자기 책에 이름을 붙이는 곳이다.
  // **금지어 검사와 같은 모양**이다 — 다른 화면 어휘가 새는 것을 글자로 막는다.
  const 화면 = await page.locator("main").innerText();
  for (const 안쓰는말 of ["제목", "저장", "확인", "점수", "앨범", "연습"]) {
    expect(화면).not.toContain(안쓰는말);
  }
});

test("책이 쌓였을 때도 모험으로 가는 문이 있다", async ({ page }) => {
  await page.route(BOOK, (route) =>
    route.fulfill({ status: 200, json: 책([페이지()]) }),
  );
  await page.goto("/book");

  // **빈 책에만 있었다** (`문구.md` 1.17, 2026-09-12 실기기) — 한 장이라도 쌓이는 순간
  // 그 문이 사라지고 **페이지 목록만 남았다.** 아이는 책을 보고 나서 나갈 길이 없었다.
  const 돌아가기 = page.locator("[data-쓰러가기]");
  await expect(돌아가기).toHaveCount(1);
  await expect(돌아가기).toBeVisible();
  await 돌아가기.click();
  await expect(page).toHaveURL(/\/$/);
});

test("빈 책이든 쌓였든 같은 낱말을 쓴 귀환 버튼 하나만 있다", async ({
  page,
}) => {
  // 1.13·1.17의 공통 귀환 라벨이다. 일일 종료 뒤에도 바로 쓰기를 약속하지 않는다.
  await page.route(BOOK, (route) =>
    route.fulfill({ status: 200, json: 책([페이지()]) }),
  );
  await page.goto("/book");
  const 돌아가기 = page.locator("[data-쓰러가기]");
  await expect(돌아가기).toHaveCount(1);
  await expect(돌아가기).toHaveText(모험복귀라벨);
  await expect(돌아가기).toHaveAttribute("href", "/");

  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책([]) }));
  await page.goto("/book");
  await expect(돌아가기).toHaveCount(1);
  await expect(돌아가기).toHaveText(모험복귀라벨);
  await expect(돌아가기).toHaveAttribute("href", "/");
});

/**
 * **챕터 완결이 책 한 장으로 온다** (A-7 · `주차계획/W7.md` **9번**).
 *
 * **⛔ 화면이 `source` 를 안 본다 — 그게 맞다.** 카드 한 장이든 챕터 한 판이든
 * **아이에게는 「내 책의 한 쪽」**이다(`api/Stage1.md` 5절 「챕터 완결 = 책 한 장」).
 * **갈라 그리면 「이건 진짜 책, 저건 연습」처럼 읽힌다** — 그건 `용어사전.md` 8장이
 * 금지한 낱말을 **레이아웃으로 말하는 것**이다.
 *
 * **그래서 여기서 재는 것은 「안 갈라 그린다」**다. 추측이 아니라 검사로 박아 둔다 —
 * 지금 안 갈라져 있는 것이 **그렇게 정해서**인지 **아직 안 해서**인지는 코드만 봐서는 모른다.
 *
 * **⚠ 두 모양이 섞여 쌓이는 것이 이 검사의 자리다** (W6 25번의 액자 판정과 같은 이유) —
 * 카드 장은 `0.58` 짜리 조합 파일이 오고 챕터 장은 갓 구운 `1:1` 이 온다.
 */
test("챕터 한 판과 카드 한 장이 같은 책에 나란히 쌓인다", async ({ page }) => {
  const 챕터문장 = "낡은 밧줄의 매듭을 하나씩 만져 보며 어느 쪽이 새것인지 살폈다";
  const 카드문장 = "은빛 물고기가 살금살금 지나갔다";
  const 책내용 = 책([
    페이지({ page_no: 1, source: "card", source_id: "c01", text: 카드문장 }),
    페이지({
      page_no: 2,
      source: "chapter",
      source_id: "11111111-2222-3333-4444-555555555555",
      text: 챕터문장,
    }),
  ]);
  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책내용 }));

  await page.goto("/book");

  // **둘 다 아이 원문 그대로** — 요약도 교정도 없다 (비전 2장).
  //
  // ⛔ `getByText` 로 찾지 않는다. 책장을 넘기는 동안 **넘김 연출이 종이 앞뒤 면을 그리는데**
  // 거기에도 같은 문장이 들어간다 — 그건 연출에 필요한 복제본이고 `aria-hidden` 으로
  // 가려져 있다. 그런데 `getByText` 는 그걸 가리지 않아서 **둘이 잡혀 죽는다.**
  // 재려는 것은 **책장에 실린 문장**이고, 그 표식이 바로 아랫줄이 쓰는 `data-책문장` 이다.
  const 책문장 = (문장: string) => page.locator("[data-책문장]").filter({ hasText: 문장 });
  await expect(책문장(카드문장)).toBeVisible();
  await page.locator("[data-book-next]").click();
  await expect(책문장(챕터문장)).toBeVisible();

  // **쪽 수가 둘이다.** 챕터 장이 빠지거나 두 번 들어가면 여기서 걸린다.
  await expect(page.locator("[data-책문장]")).toHaveCount(2);

  // **⛔ 출처를 아이에게 말하지 않는다.** 내부 용어가 화면에 새면 안 된다
  // (`용어사전.md` 8장). `chapter`·`card` 는 코드 식별자이지 아이 화면 낱말이 아니다.
  const 화면 = await page.locator("main").innerText();
  for (const 금지 of ["chapter", "card", "챕터", "점수", "연습", "학습", "보스", "앨범"]) {
    expect(화면, `「${금지}」가 아이 화면에 보인다`).not.toContain(금지);
  }
});

/**
 * **책을 종이로 내보낸다** (백로그 A-7 · `주차계획/W7.md` **9번** · 2026-09-16 PM 판정 ㉡).
 *
 * **서버가 PDF 를 굽지 않는다** — 계약에서 `GET /books/{id}/pdf` 를 지웠다(`e2736f4`).
 * **화면에 있는 것을 그대로 찍는다.** A-7 이 규모 `S` 라 그 안에 드는 길이 이것이다.
 *
 * **⚠ 여기서 재는 것은 「인쇄를 부른다」와 「종이에 남을 것만 남는다」**다.
 * **실제 종이는 검사가 못 본다** — 대화상자 너머는 브라우저·OS 몫이다.
 * **그래서 못 재는 것을 안 재는 척하지 않는다**: 아래 단언은 **버튼이 인쇄를 부르는지**와
 * **숨기기로 한 것에 `print:hidden` 이 붙었는지**까지다.
 */
test("「책 인쇄하기」는 한 번만 표시하고, 인쇄한 종이에는 아이 것만 남는다", async ({ page }) => {
  const 문장 = "낡은 밧줄의 매듭을 하나씩 만져 보며 어느 쪽이 새것인지 살폈다";
  await page.route(BOOK, (route) =>
    route.fulfill({
      status: 200,
      json: 책([페이지({ source: "chapter", source_id: "ch-1", text: 문장 })]),
    }),
  );

  await page.goto("/book");

  // **`window.print()` 를 가로챈다** — 진짜로 부르면 대화상자가 떠서 검사가 멈춘다.
  const 불렀나 = await page.evaluate(() => {
    (window as unknown as { __printed?: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed?: number }).__printed! += 1;
    };
    return true;
  });
  expect(불렀나).toBe(true);

  // 책과 쪽 넘기기 아래에 귀환·인쇄 도구를 한 번씩 둔다. 표지는 이름과 지은이만 남긴다.
  const 인쇄버튼 = page.getByRole("button", { name: 책인쇄라벨, exact: true });
  await expect(인쇄버튼).toHaveCount(1);
  await expect(page.locator("[data-보내기]")).toHaveCount(1);
  await expect(page.locator("[data-쓰러가기]")).toHaveCount(1);
  await expect(page.locator(".book-heading [data-보내기], .book-heading [data-쓰러가기]")).toHaveCount(0);
  await expect(page.locator(".book-actions [data-보내기], .book-actions [data-쓰러가기]")).toHaveCount(2);
  const 배치 = await page.evaluate(() => {
    const 펼침 = document.querySelector("[data-책쪽]")!.getBoundingClientRect();
    const 쪽넘김 = document.querySelector(".book-pagination")!.getBoundingClientRect();
    const 보조버튼 = document.querySelector(".book-actions")!.getBoundingClientRect();
    return { 책아래: 펼침.bottom, 쪽넘김위: 쪽넘김.top, 쪽넘김아래: 쪽넘김.bottom, 보조버튼위: 보조버튼.top };
  });
  expect(배치.쪽넘김위).toBeGreaterThanOrEqual(배치.책아래);
  expect(배치.보조버튼위).toBeGreaterThanOrEqual(배치.쪽넘김아래);
  await 인쇄버튼.click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __printed?: number }).__printed,
    ),
  ).toBe(1);

  // **종이에 남을 것** — 아이 문장은 `print:hidden` 이 아니다.
  const 숨나 = (로케이터: ReturnType<typeof page.locator>) =>
    로케이터.evaluate((el: Element) => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (n.className?.toString().includes("print:hidden")) return true;
      }
      return false;
    });
  expect(await 숨나(page.locator("[data-책문장]").first())).toBe(false);

  // **⛔ 안 남을 것 — 버튼과 나가는 문.** 안 숨기면 **종이에 버튼이 찍힌다.**
  for (const 버튼 of await page.locator("[data-보내기], [data-쓰러가기]").all()) {
    expect(await 숨나(버튼)).toBe(true);
  }

  // **한 쪽이 두 장으로 갈리지 않게 표식이 붙어 있다** — 그림과 그 아래 문장이
  // 다른 종이에 있으면 그건 책이 아니다.
  await expect(page.locator("[data-책쪽]")).toHaveCount(1);

  // 제목 자체가 버튼이어도 인쇄에는 이름만 남고 연필·밑줄·포커스 테두리는 남지 않는다.
  const 이름버튼 = page.locator("[data-책이름바꾸기]");
  const 인쇄이름 = await page.locator("main h1").textContent();
  await 이름버튼.focus();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".book-actions")).toBeHidden();
  await expect(page.locator("[data-쪽번호]:visible")).toHaveText(["1", "2"]);
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator("main h1")).toHaveText(인쇄이름!);
  await expect(이름버튼.locator("svg")).toBeHidden();
  await expect(이름버튼).toHaveCSS("outline-style", "none");
  await expect(이름버튼.locator(".book-title-label")).toHaveCSS("text-decoration-line", "none");
});
