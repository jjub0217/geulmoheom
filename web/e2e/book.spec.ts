import { expect, test, type Page } from "@playwright/test";

import type { components, paths } from "../src/api/types.gen";
// 문구는 박지 않는다 — `docs/문구.md` 1.13·1.16·2.4·2.5 가 SSOT 다.
import { 빈책, 책이름 } from "../src/app/book/copy";
import { 버튼, 못닿음 } from "../src/app/copy";
import { 상태표시 } from "../src/app/status-copy";
import { 티어이름 } from "../src/components/tier-badge";
// 가림 안내는 **1.1 하나뿐**이다 — 카드 화면과 책 이름이 같은 문장을 쓴다 (1.16).
import { 가림안내 } from "../src/lib/pii";

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
  const 책내용 = 책([페이지(), 페이지({ page_no: 2, tier: "basic", text: "낡은 문을 밀었다" })]);
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

// ── 책 이름 바꾸기 (A0-4 후속 · `문구.md` 1.16) ───────────────────────────

const 책이름칸 = (page: Page) => page.locator("[data-책이름칸]");
const 보내기 = (page: Page) => page.locator("[data-책이름보내기]");

/** 열어 둔 상태로 시작한다. 여는 것 자체는 아래 첫 검사가 따로 잰다. */
async function 이름고치기를연다(page: Page, 책내용 = 책([페이지()])) {
  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책내용 }));
  await page.goto("/book");
  await page.locator("[data-책이름바꾸기]").click();
  await expect(책이름칸(page)).toBeVisible();
  return 책내용;
}

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
  await 보내기(page).click();

  expect(보낸것).toEqual({ title: "달빛 호수의 밤" });
  // **표지가 바뀐다.** 문자열을 박지 않는다 — 서버가 준 값과 대조한다.
  await expect(page.locator("main h1")).toHaveText("달빛 호수의 밤");
  // **바꾼 뒤 한 줄이 반드시 있다** (1.16). 없으면 성공과 실패가 화면에서 안 갈린다.
  await expect(page.locator("[data-책이름알림]")).toBeVisible();
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

  await expect(page).toHaveURL(/\/child\/auth$/);
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
  await expect(page.locator("[data-쓰러가기]")).toBeVisible();
  await page.locator("[data-쓰러가기]").click();
  await expect(page).toHaveURL(/\/$/);
});

test("두 자리의 문은 같은 낱말을 쓴다 — 빈 책이든 쌓였든 모험으로 가는 것은 하나다", async ({
  page,
}) => {
  // **1.13 재사용이다** (1.17 이 그렇게 정했다). 같은 화면·같은 동작이라 새 낱말을 안 만든다.
  // **`빈책.버튼` 을 두 자리가 같이 쓴다** — 갈라지면 아이가 화면마다 다른 말을 배운다.
  await page.route(BOOK, (route) =>
    route.fulfill({ status: 200, json: 책([페이지()]) }),
  );
  await page.goto("/book");
  await expect(page.locator("[data-쓰러가기]")).toHaveText(빈책.버튼);

  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책([]) }));
  await page.goto("/book");
  await expect(page.getByRole("link", { name: 빈책.버튼 })).toBeVisible();
});
