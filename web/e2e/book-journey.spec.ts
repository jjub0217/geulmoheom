import { expect, test, type Page } from "@playwright/test";

import type { components, paths } from "../src/api/types.gen";
// **문장을 베껴 적지 않는다** — 2026-09-20 에 바뀐 문구를 이 줄만 안 따라와 깨져 있었다.
import { 버튼 } from "../src/app/copy";
import { 챕터보내는중라벨 } from "../src/components/chapter-writing";

type Chapter = paths["/api/v1/chapters/current"]["get"]["responses"][200]["content"]["application/json"];
type Turn = paths["/api/v1/turns"]["post"]["responses"][200]["content"]["application/json"];
type Card = paths["/api/v1/cards/next"]["get"]["responses"][200]["content"]["application/json"];
type Response = { status: number; json: unknown };
type Call = { path: string; method: string; body: unknown; viewPath: string };

// 계정·글·이미지 응답은 모두 지어낸 픽스처다. 실제 API에는 연결하지 않는다.
const chapter: Chapter = {
  chapter_id: "11111111-2222-3333-4444-555555555555",
  chapter_key: "book-journey-test",
  turn: 3,
  beat: "explore",
  narrative: "안개 낀 부두에서 낡은 배의 밧줄을 발견했다.",
  choices: [],
  state: { hero: { hp: 3, items: [] }, location: "부두" },
  turns_left: 7,
  artwork: null,
  guide: { expression: "default", line: "밧줄 매듭을 살펴볼까?" },
};
const nextTurn: Turn = {
  outcome: "result",
  turn: 4,
  beat: "explore",
  scaffold: null,
  narrative: "매듭이 풀리자 배 아래에서 작은 종소리가 들렸다.",
  choices: [],
  state: chapter.state,
  turns_left: 6,
  artwork: null,
  chapter_done: false,
  guide: { expression: "default", line: "작은 종소리가 어디서 나는지 살펴보자." },
};
const card: Card = {
  card_id: "journey-card",
  type: "discovery",
  situation: "작은 문 앞에 은빛 잎이 떨어져 있다.",
  prompt_label: "탐험가는 어떻게 할까?",
  guide: { expression: "default", line: "문 너머를 살펴보자." },
  today: { cards_done: 0, cap: 5 },
};
const book: components["schemas"]["Book"] = {
  book_id: "journey-book",
  title: "부두에서 쓴 이야기",
  author: "다온",
  visibility: "private",
  counts: { basic: 1, rare: 0, legendary: 0 },
  pages: [{
    page_no: 1, source: "card", source_id: "journey-book-page", tier: "basic",
    artwork_url: null, text: "부두에서 작은 밧줄을 주웠다.", achieved_at: "2026-09-20T01:00:00Z",
  }],
};
const original = "나뭇잎을 손바닥에 올려 햇빛에 비춰 보았다.";
const revised = "은빛 잎을 천천히 돌리며 작은 무늬를 살펴보았다.";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/healthz")) return route.fulfill({ status: 200, json: { status: "ok" } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: { detail: "Unmocked journey API" } });
    return url.origin === origin ? route.continue() : route.abort();
  });
});

async function mockJourney(page: Page, baseURL: string) {
  const calls: Call[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) calls.push({ path, method: request.method(), body: request.postDataJSON(), viewPath: new URL(page.url()).pathname });
  });
  let attemptNumber = 0;
  const result = (): components["schemas"]["AttemptResult"] => ({
    outcome: "result", attempt_id: `journey-attempt-${++attemptNumber}`, tier: "rare", highlights: [],
    guide: { expression: "compass_bright", line: "작은 종이 바람에 울렸어." },
    artwork: { artwork_id: "journey-art", status: "ready", url: new URL("/api/v1/artworks/journey-art/image", baseURL).href },
    today: { cards_done: 1, cap: 5, locked: false }, can_retry: true,
  });
  const api = {
    calls,
    current: async (): Promise<Response> => ({ status: 200, json: chapter }),
    open: async (): Promise<Response> => ({ status: 200, json: chapter }),
    me: async (): Promise<Response> => ({ status: 200, json: { child_id: "journey-child-a", nickname: "다온" } }),
    cards: async (): Promise<Response> => ({ status: 200, json: card }),
    turn: async (): Promise<Response> => ({ status: 200, json: nextTurn }),
    attempt: async (): Promise<Response> => ({ status: 200, json: result() }),
    book: async (): Promise<Response> => ({ status: 200, json: book }),
    count: (path: string, method = "GET") => calls.filter((call) => call.path === path && call.method === method).length,
    countFrom: (path: string, viewPath: string, method = "GET") => calls.filter((call) => call.path === path && call.viewPath === viewPath && call.method === method).length,
    posts: (path: string) => calls.filter((call) => call.path === path && call.method === "POST").map((call) => call.body),
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/v1/chapters/current") return route.fulfill(await api.current());
    if (path === "/api/v1/chapters" && request.method() === "POST") return route.fulfill(await api.open());
    if (path === "/api/v1/child/me") return route.fulfill(await api.me());
    if (path === "/api/v1/cards/next") return route.fulfill(await api.cards());
    if (path === "/api/v1/book" && request.method() === "GET") return route.fulfill(await api.book());
    if (path === "/api/v1/turns" && request.method() === "POST") return route.fulfill(await api.turn());
    if (path === "/api/v1/attempts" && request.method() === "POST") return route.fulfill(await api.attempt());
    if (path === "/api/v1/artworks/journey-art/image") return route.fulfill({
      status: 200, contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#a8bcaa"/></svg>',
    });
    if (path === "/api/v1/events") return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, json: { detail: "Unmocked journey API" } });
  });
  return api;
}

async function bookRoundTrip(page: Page, destination: "/" | "/chapter") {
  await page.locator("a.book-link:visible").click();
  await expect(page).toHaveURL(/\/book$/);
  await expect(page.locator("[data-책문장]:visible")).toHaveText(book.pages[0].text);
  const back = page.locator("[data-쓰러가기]");
  await expect(back).toHaveAttribute("href", destination);
  await back.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(destination);
}

async function submitCard(page: Page, text = original) {
  await page.getByRole("textbox").fill(text);
  await page.locator(".writing-actions button").click();
  await expect(page.locator("[data-쓴문장]")).toHaveText(text);
  await expect(page.locator("[data-다시써보기]")).toBeVisible();
}

test("본편에서 책을 두 번 다녀와도 같은 장면과 최신 초안을 바로 이어 쓴다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  await page.goto("/chapter");
  await expect(page.getByText(chapter.narrative!, { exact: true })).toBeVisible();
  const draft = "매듭을 천천히 풀면서 배가 어디로 가는지 물어본다.";
  await page.getByRole("textbox").fill(draft);
  const reads = api.count("/api/v1/chapters/current");
  await bookRoundTrip(page, "/chapter");
  await expect(page.getByRole("textbox")).toHaveValue(draft);
  await expect(page.getByText(chapter.guide!.line, { exact: true })).toBeVisible();
  await page.getByRole("textbox").fill(`${draft}\n작은 종소리에도 귀를 기울인다.`);
  await bookRoundTrip(page, "/chapter");
  await expect(page.getByRole("textbox")).toHaveValue(`${draft}\n작은 종소리에도 귀를 기울인다.`);
  expect(api.count("/api/v1/chapters/current")).toBe(reads);
  expect(api.posts("/api/v1/turns")).toEqual([]);
  expect(api.posts("/api/v1/chapters")).toEqual([]);
  const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join(" "));
  expect(stored).not.toContain(draft);
  expect(page.url()).not.toContain(encodeURIComponent(draft));
});

test("본편 되묻기를 책 왕복 뒤에도 읽고 새 턴으로 진행한 뒤에는 옛 초안이 돌아오지 않는다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  const question = "그 매듭을 어떤 방법으로 풀어 볼까?";
  api.turn = async () => ({ status: 200, json: {
    ...nextTurn, outcome: "scaffold", turn: chapter.turn, narrative: null, scaffold: question,
    guide: { expression: "compass_dim", line: question },
  } });
  await page.goto("/chapter");
  await page.getByRole("textbox").fill(original);
  await page.locator(".writing-actions button").click();
  await expect(page.getByText(question, { exact: true })).toBeVisible();
  const reads = api.count("/api/v1/chapters/current");
  await bookRoundTrip(page, "/chapter");
  await expect(page.getByText(question, { exact: true })).toBeVisible();
  await expect(page.getByText(chapter.narrative!, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue(original);
  expect(api.posts("/api/v1/turns")).toHaveLength(1);
  api.turn = async () => ({ status: 200, json: nextTurn });
  await page.getByRole("textbox").fill(revised);
  await page.locator(".writing-actions button").click();
  await expect(page.getByText(nextTurn.narrative!, { exact: true })).toBeVisible();
  await bookRoundTrip(page, "/chapter");
  await expect(page.getByText(nextTurn.narrative!, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue("");
  expect(api.count("/api/v1/chapters/current")).toBe(reads);
  expect(api.posts("/api/v1/turns")).toEqual([
    { chapter_id: chapter.chapter_id, text: original }, { chapter_id: chapter.chapter_id, text: revised },
  ]);
});

test("카드 초안을 쓰다가 책을 다녀오면 새 카드를 부르지 않고 입력을 보존한다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  await page.goto("/");
  await page.getByRole("textbox").fill(original);
  await expect(page.locator("[data-모험문버튼]")).toHaveCount(0);
  const reads = api.count("/api/v1/cards/next");
  await bookRoundTrip(page, "/");
  await expect(page.getByRole("textbox")).toHaveValue(original);
  await expect(page.getByText(card.situation, { exact: true })).toBeVisible();
  expect(api.count("/api/v1/cards/next")).toBe(reads);
  expect(api.posts("/api/v1/attempts")).toEqual([]);
});

test("카드 결과에서 책을 다녀오면 원문·그림·배지·결과 대사를 추가 제출 없이 다시 읽는다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  await page.goto("/");
  await submitCard(page);
  const reads = api.count("/api/v1/cards/next");
  const artwork = await page.locator("[data-삽화자리] img").getAttribute("src");
  await bookRoundTrip(page, "/");
  await expect(page.locator("[data-쓴문장]")).toHaveText(original);
  await expect(page.locator("[data-삽화자리] img")).toHaveAttribute("src", artwork!);
  await expect(page.locator("main [data-티어배지]")).toHaveText("영웅");
  await expect(page.getByText("작은 종이 바람에 울렸어.", { exact: true })).toBeVisible();
  expect(api.count("/api/v1/cards/next")).toBe(reads);
  expect(api.posts("/api/v1/attempts")).toHaveLength(1);
});

test("다시 쓰기 중 책 왕복과 취소는 앞 결과를 지키고 다시 보낼 때만 앞 시도에 붙인다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  await page.goto("/");
  await submitCard(page);
  const reads = api.count("/api/v1/cards/next");
  await page.locator("[data-다시써보기]").click();
  await page.getByRole("textbox").fill(revised);
  await bookRoundTrip(page, "/");
  await expect(page.getByRole("textbox")).toHaveValue(revised);
  await expect(page.locator("[data-다시쓰기취소]")).toBeVisible();
  await page.locator("[data-다시쓰기취소]").click();
  await expect(page.locator("[data-쓴문장]")).toHaveText(original);
  expect(api.posts("/api/v1/attempts")).toHaveLength(1);
  await page.locator("[data-다시써보기]").click();
  await expect(page.getByRole("textbox")).toHaveValue(original);
  await bookRoundTrip(page, "/");
  await expect(page.getByRole("textbox")).toHaveValue(original);
  await submitCard(page, revised);
  expect(api.posts("/api/v1/attempts")).toEqual([
    { card_id: card.card_id, text: original, retry_of: null, prompted: false },
    { card_id: card.card_id, text: revised, retry_of: "journey-attempt-1", prompted: false },
  ]);
  expect(api.count("/api/v1/cards/next")).toBe(reads);
});

for (const path of ["/chapter", "/"] as const) {
  test(`${path}에서 보내는 동안 책 이동과 중복 제출을 막고 원문을 남긴다`, async ({ page, baseURL }) => {
    const api = await mockJourney(page, baseURL!);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const response = path === "/chapter" ? api.turn : api.attempt;
    const deferred = async () => { await gate; return response(); };
    if (path === "/chapter") api.turn = deferred; else api.attempt = deferred;
    await page.goto(path);
    await page.getByRole("textbox").fill(original);
    await page.locator(".writing-actions button").click();
    try {
      const link = page.locator("a.book-link:visible");
      await expect(link).toHaveAttribute("aria-disabled", "true");
      await expect(link).toHaveAttribute("tabindex", "-1");
      await expect(page.getByRole("textbox")).toHaveAttribute("readonly", "");
      await expect(page.getByRole("textbox")).toHaveValue(original);
      await expect(page.locator(".writing-actions button")).toBeDisabled();
      await expect(page.locator(".writing-actions button")).toHaveText(path === "/chapter" ? 챕터보내는중라벨 : 버튼.그림준비중);
      // aria-disabled인 링크는 기본 탐색이 남을 수 있다. 실제 포인터 클릭도 막혀야 한다.
      await link.click({ force: true });
      await expect.poll(() => new URL(page.url()).pathname).toBe(path);
      expect(api.count("/api/v1/book")).toBe(0);
      expect(api.posts(path === "/chapter" ? "/api/v1/turns" : "/api/v1/attempts")).toHaveLength(1);
    } finally {
      release();
    }
    if (path === "/chapter") await expect(page.getByText(nextTurn.narrative!, { exact: true })).toBeVisible();
    else await expect(page.locator("[data-쓴문장]")).toHaveText(original);
    await expect(page.locator("a.book-link:visible")).not.toHaveAttribute("aria-disabled", "true");
  });
}

for (const kind of ["chapter_done", "TURN_LIMIT", "CHAPTER_DONE_TODAY"] as const) {
  test(`${kind}로 끝난 본편은 책 왕복 후에도 새 모험을 시작하지 않는다`, async ({ page, baseURL }) => {
    const api = await mockJourney(page, baseURL!);
    const line = "오늘 함께 쓴 이야기를 책에서 펼쳐 봐.";
    const guide = { expression: "session_end", line };
    api.turn = async () => kind === "chapter_done"
      ? { status: 200, json: { ...nextTurn, chapter_done: true, guide } }
      : { status: kind === "TURN_LIMIT" ? 429 : 409, json: { error: { code: kind, message: line, detail: { guide } } } };
    await page.goto("/chapter");
    await page.getByRole("textbox").fill(original);
    await page.locator(".writing-actions button").click();
    await expect(page.locator(".chapter-ending")).toContainText(line);
    const reads = api.count("/api/v1/chapters/current");
    await bookRoundTrip(page, "/chapter");
    await expect(page.locator(".chapter-ending")).toContainText(line);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    expect(api.count("/api/v1/chapters/current")).toBe(reads);
    expect(api.posts("/api/v1/turns")).toHaveLength(1);
    expect(api.posts("/api/v1/chapters")).toEqual([]);
  });
}

test("카드 하루 제한 뒤 책을 읽고 돌아오면 배웅을 유지하고 새 카드를 부르지 않는다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  const line = "오늘의 이야기는 여기까지야. 책에서 다시 만나자.";
  api.cards = async () => ({ status: 429, json: { error: {
    code: "DAILY_CAP_REACHED", message: line, detail: { guide: { expression: "session_end", line } },
  } } });
  await page.goto("/");
  await expect(page.getByText(line, { exact: true })).toBeVisible();
  const reads = api.count("/api/v1/cards/next");
  await bookRoundTrip(page, "/");
  await expect(page.getByText(line, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(api.count("/api/v1/cards/next")).toBe(reads);
  expect(api.posts("/api/v1/attempts")).toEqual([]);
});

test("책을 불러오지 못해도 쓰던 본편으로 돌아가 초안을 지킨다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  api.book = async () => ({ status: 503, json: { error: { code: "UNAVAILABLE", message: "검사용 책 연결 실패" } } });
  await page.goto("/chapter");
  await page.getByRole("textbox").fill(original);
  await page.locator("a.book-link:visible").click();
  await expect(page).toHaveURL(/\/book$/);
  const back = page.locator("[data-쓰러가기]");
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("href", "/chapter");
  await back.click();
  await expect(page.getByRole("textbox")).toHaveValue(original);
  await expect(page.getByText(chapter.narrative!, { exact: true })).toBeVisible();
  expect(api.posts("/api/v1/turns")).toEqual([]);
});

for (const path of ["/chapter", "/"] as const) {
  test(`${path} 전송 중 브라우저 뒤로 책을 열어도 돌아와 원래 응답을 받고 잠금이 풀린다`, async ({ page, baseURL }) => {
    const api = await mockJourney(page, baseURL!);
    await page.goto(path);
    await page.getByRole("textbox").fill(original);
    await bookRoundTrip(page, path);
    const reads = api.count(path === "/chapter" ? "/api/v1/chapters/current" : "/api/v1/cards/next");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const respond = path === "/chapter" ? api.turn : api.attempt;
    const deferred = async () => { await gate; return respond(); };
    if (path === "/chapter") api.turn = deferred; else api.attempt = deferred;
    await page.locator(".writing-actions button").click();
    try {
      await expect(page.getByRole("textbox")).toHaveAttribute("readonly", "");
      await page.goBack();
      await expect(page).toHaveURL(/\/book$/);
      await expect(page.locator("[data-책문장]:visible")).toHaveText(book.pages[0].text);
      await page.locator("[data-쓰러가기]").click();
      await expect(page.getByRole("textbox")).toHaveValue(original);
      await expect(page.getByRole("textbox")).toHaveAttribute("readonly", "");
      await expect(page.locator(".writing-actions button")).toBeDisabled();
      expect(api.posts(path === "/chapter" ? "/api/v1/turns" : "/api/v1/attempts")).toHaveLength(1);
      release();
      if (path === "/chapter") {
        await expect(page.getByText(nextTurn.narrative!, { exact: true })).toBeVisible();
        await expect(page.getByRole("textbox")).not.toHaveAttribute("readonly", "");
        await expect(page.getByRole("textbox")).toHaveValue("");
      } else {
        await expect(page.locator("[data-쓴문장]")).toHaveText(original);
        await expect(page.locator("[data-다시써보기]")).toBeVisible();
      }
      expect(api.posts(path === "/chapter" ? "/api/v1/turns" : "/api/v1/attempts")).toHaveLength(1);
      expect(api.count(path === "/chapter" ? "/api/v1/chapters/current" : "/api/v1/cards/next")).toBe(reads);
    } finally {
      release();
    }
  });
}

test("다음 카드를 부르는 중 브라우저 뒤로 책을 열어도 새 카드가 한 번만 도착한다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  await page.goto("/");
  await submitCard(page);
  await bookRoundTrip(page, "/");
  const reads = api.count("/api/v1/cards/next");
  const anotherCard = { ...card, card_id: "journey-card-next", situation: "돌담 위에서 작은 새가 날갯짓한다." };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  api.cards = async () => { await gate; return { status: 200, json: anotherCard }; };
  await page.locator("[data-다음장면]").click();
  try {
    await expect.poll(() => api.count("/api/v1/cards/next")).toBe(reads + 1);
    await page.goBack();
    await expect(page).toHaveURL(/\/book$/);
    await page.locator("[data-쓰러가기]").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect(page.locator("[data-쓴문장]")).toHaveCount(0);
    expect(api.count("/api/v1/cards/next")).toBe(reads + 1);
    release();
    await expect(page.getByText(anotherCard.situation, { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveValue("");
    expect(api.count("/api/v1/cards/next")).toBe(reads + 1);
    expect(api.posts("/api/v1/attempts")).toHaveLength(1);
  } finally {
    release();
  }
});

test("책을 보는 동안 아이가 바뀌면 새 아이 장면을 읽고 이전 아이의 늦은 응답을 버린다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  await page.goto("/chapter");
  await page.getByRole("textbox").fill(original);
  await bookRoundTrip(page, "/chapter");
  const reads = api.count("/api/v1/chapters/current");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  api.turn = async () => { await gate; return { status: 200, json: nextTurn }; };
  await page.locator(".writing-actions button").click();
  try {
    await expect(page.getByRole("textbox")).toHaveAttribute("readonly", "");
    await page.goBack();
    await expect(page).toHaveURL(/\/book$/);
    const anotherChapter = {
      ...chapter,
      chapter_id: "22222222-3333-4444-5555-666666666666",
      narrative: "새 탐험가가 바람 부는 언덕에 도착했다.",
      guide: { expression: "default", line: "언덕 위에서 어떤 길이 보일까?" },
    };
    api.me = async () => ({ status: 200, json: { child_id: "journey-child-b", nickname: "서우" } });
    api.current = async () => ({ status: 200, json: anotherChapter });
    await page.locator("[data-쓰러가기]").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/chapter");
    await expect(page.getByText(anotherChapter.narrative, { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveValue("");
    await expect(page.getByRole("textbox")).not.toHaveAttribute("readonly", "");
    expect(api.count("/api/v1/chapters/current")).toBe(reads + 1);

    const oldResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/turns");
    release();
    await (await oldResponse).finished();
    // 이전 요청의 Promise와 그 뒤 렌더까지 처리한 후에도 새 아이의 화면이어야 한다.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const newDraft = "언덕 위의 풀잎이 어느 쪽으로 흔들리는지 살펴본다.";
    await page.getByRole("textbox").fill(newDraft);
    await expect(page.getByText(anotherChapter.narrative, { exact: true })).toBeVisible();
    await expect(page.getByText(nextTurn.narrative!, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveValue(newDraft);
    expect(api.posts("/api/v1/turns")).toEqual([{ chapter_id: chapter.chapter_id, text: original }]);
  } finally {
    release();
  }
});

test("책을 열지 않은 화면 복귀도 아이 확인 전에는 옛 카드를 노출하지 않는다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  await page.goto("/");
  await expect(page.getByText(card.situation, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toBeVisible();
  await page.locator("[data-모험문버튼]").click();
  await expect(page.getByText(chapter.narrative!, { exact: true })).toBeVisible();
  const cardsRead = api.count("/api/v1/cards/next");
  const identityReads = api.count("/api/v1/child/me");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const anotherCard = { ...card, card_id: "journey-child-b-card", situation: "새 탐험가가 돌계단 아래에서 조개껍데기를 발견했다." };
  api.me = async () => { await gate; return { status: 200, json: { child_id: "journey-child-b", nickname: "서우" } }; };
  api.cards = async () => ({ status: 200, json: anotherCard });
  try {
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect.poll(() => api.count("/api/v1/child/me")).toBeGreaterThan(identityReads);
    await expect(page.getByText(card.situation, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    expect(api.count("/api/v1/cards/next")).toBe(cardsRead);
    release();
    await expect(page.getByText(anotherCard.situation, { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveValue("");
    await expect(page.getByText(card.situation, { exact: true })).toHaveCount(0);
    expect(api.count("/api/v1/cards/next")).toBe(cardsRead + 1);
    expect(api.count("/api/v1/book")).toBe(0);
    expect(api.posts("/api/v1/attempts")).toEqual([]);
    expect(api.posts("/api/v1/turns")).toEqual([]);
  } finally {
    release();
  }
});

test("처음 본편을 여는 요청 중 뒤로 갔다 앞으로 와도 새로 열기를 한 번만 하고 이어 쓴다", async ({ page, baseURL }) => {
  const api = await mockJourney(page, baseURL!);
  api.current = async () => ({ status: 404, json: { error: { code: "NO_ACTIVE_CHAPTER", message: "" } } });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  api.open = async () => { await gate; return { status: 200, json: chapter }; };
  await page.goto("/");
  await expect(page.getByText(card.situation, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toBeVisible();
  await page.locator("[data-모험문버튼]").click();
  try {
    await expect.poll(() => api.posts("/api/v1/chapters").length).toBe(1);
    expect(api.countFrom("/api/v1/chapters/current", "/chapter")).toBe(1);
    await page.goBack();
    await expect(page.getByText(card.situation, { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toBeVisible();
    // 홈 모험문의 별도 조회와 구분해 본편 진입에서 보낸 요청만 센다.
    await page.goForward();
    await expect(page).toHaveURL(/\/chapter$/);
    await expect(page.locator(".chapter-status")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    release();
    await expect(page.getByText(chapter.narrative!, { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveValue("");
    expect(api.countFrom("/api/v1/chapters/current", "/chapter")).toBe(1);
    expect(api.posts("/api/v1/chapters")).toEqual([{}]);
    await page.getByRole("textbox").fill(original);
    await page.locator(".writing-actions button").click();
    await expect(page.getByText(nextTurn.narrative!, { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveValue("");
    expect(api.posts("/api/v1/turns")).toEqual([{ chapter_id: chapter.chapter_id, text: original }]);
    expect(api.countFrom("/api/v1/chapters/current", "/chapter")).toBe(1);
    expect(api.posts("/api/v1/chapters")).toEqual([{}]);
  } finally {
    release();
  }
});
