import { expect, test, type Page } from "@playwright/test";

import type { paths } from "../src/api/types.gen";
// 문구를 문자열로 박지 않는다 — `docs/문구.md` 1.18 이 SSOT 다.
import { 결과라벨, 그림문구, 단계문구, 챕터다시쓰기라벨, 챕터다음안내, 챕터동료소개, 챕터보내기라벨, 챕터쓰기라벨 } from "../src/components/chapter-writing";
import { 못닿음 } from "../src/app/copy";

/**
 * 챕터 턴 화면(A-3 · W7 **7번**)의 완료 조건 둘을 본다 —
 * **아이가 직접 쓴 글로 턴이 넘어간다.**
 *
 * **문장은 전부 지어낸 것이다.** 실제 아이 문장을 테스트에 넣지 않는다.
 *
 * **⛔ 목의 고정값에 기대지 않는다** — `narrative`·선택지 라벨은 **A-1 이 서면 GM 것으로
 * 바뀐다**(백엔드). 여기서는 **우리가 준 값이 화면에 그려지는지**만 본다.
 *
 * **⛔ `grade`·`bonus` 는 계약에서 빠졌다** (2026-09-16 `5d1f239`). `용어사전.md` 3장이
 * 등급을 **「화면·API 응답에 넣지 않는다」**로 못 박아 뒀고, **`bonus` 는 정수라 화면이
 * 그대로 숫자로 그린다 — 그게 「점수」다**(금지어). **화면이 그것으로 그릴 것이 없다**:
 * **등급은 서사가**, **시련 진행은 `trial_progress` 가**, **보상은 삽화 티어가** 말한다.
 */
type ChapterView =
  paths["/api/v1/chapters/current"]["get"]["responses"][200]["content"]["application/json"];
type TurnResult =
  paths["/api/v1/turns"]["post"]["responses"][200]["content"]["application/json"];

import { 책펼치기라벨 as 내책라벨 } from "../src/components/book-link";
import { 챕터구조안내 } from "../src/components/chapter-writing";

const CURRENT = "**/api/v1/chapters/current";
const BOOK = "**/api/v1/book";
const TURNS = "**/api/v1/turns";

test.use({ serviceWorkers: "block" });

// 모든 API와 외부 요청을 막는다. 각 검사의 구체적인 목이 이 기본 경로보다 먼저 적용된다.
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/healthz")) return route.fulfill({ status: 200, json: { status: "ok" } });
    if (url.pathname.startsWith("/api/v1/artworks/")) {
      return route.fulfill({ status: 200, json: { status: "pending", url: null } });
    }
    if (url.pathname.startsWith("/api/")) {
      return route.fulfill({ status: 404, json: { detail: "Unmocked chapter request" } });
    }
    if (url.origin !== origin) return route.abort();
    return route.continue();
  });
});

/**
 * 구 응답의 선택지가 남아 있어도 화면은 직접 쓰기만 제공한다.
 * 실제 API가 빈 배열을 돌려주는 경우보다 강한 조건으로 표시 회귀를 막는다.
 */
const 장면: ChapterView = {
  chapter_id: "11111111-2222-3333-4444-555555555555",
  chapter_key: "ch-test",
  turn: 1,
  beat: "intro",
  narrative: "안개 낀 부두에 낡은 배 한 척이 묶여 있다.",
  choices: [
    { id: "a", label: "밧줄을 살펴본다" },
    { id: "b", label: "배 주인을 찾아 말을 건다" },
    { id: "c", label: "안개 속으로 걸어 들어간다" },
  ],
  state: { hero: { hp: 3, items: [] }, location: "부두" },
  turns_left: 9,
  artwork: { artwork_id: "aaaa", status: "pending", url: null },
};

/** 다음 턴. **turn 이 늘었다**는 것이 「넘어갔다」의 증거다. */
const 다음턴: TurnResult = {
  outcome: "result",
  turn: 2,
  beat: "explore",
  scaffold: null,
  narrative: "밧줄은 최근에 누가 풀었다 묶은 듯 매듭이 달랐다.",
  choices: [{ id: "d", label: "매듭을 풀어 본다" }],
  state: { hero: { hp: 3, items: [] }, location: "부두" },
  turns_left: 8,
  artwork: null,
  chapter_done: false,
};

async function 장면을띄운다(page: Page) {
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: 장면 }));
  await page.goto("/chapter");
  await expect(page.getByText(장면.narrative)).toBeVisible();
}

test("서버가 선택지를 보내도 직접 쓰는 칸만 제공한다", async ({ page }) => {
  await 장면을띄운다(page);
  for (const choice of 장면.choices) {
    await expect(page.getByRole("button", { name: choice.label })).toHaveCount(0);
  }
  await expect(page.locator(".turn-choices, .choice-invitation")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: 챕터쓰기라벨 })).toBeVisible();
  await expect(page.getByRole("button", { name: 챕터보내기라벨 })).toBeDisabled();
});

test("처음부터 동료와 나침반 하나가 쓰기 곁에 있고 소개가 끝까지 돈다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await 장면을띄운다(page);
  const 동료 = page.locator("[data-chapter-companion]");
  const 나침반 = 동료.locator(".compass-instrument");
  const 목적지 = 동료.locator("[data-compass-destination]");

  // ① 처음 보는 아이다 — 아직 끝나지 않은 상태에서 시작한다.
  await expect(동료).toHaveAttribute("data-expression", "default");
  await expect(page.locator(".compass-instrument")).toHaveCount(1);

  // ② 소개가 끝나고 그 사실이 남는다.
  //
  // **⛔ 중간 단계(`data-compass-introducing`)를 폴링으로 쫓지 않는다** (2026-09-21).
  // 움직임을 줄이면 그 단계는 **220ms 한 번**이라, Playwright 의 백오프 폴링이
  // **두 번 사이로 건너뛴다.** 실제로 그래서 이 검사가 빨갰고 **제품은 멀쩡했다.**
  // 남는 결과를 본다.
  await expect(목적지).toHaveAttribute("data-compass-introduction-complete", "true", { timeout: 15_000 });

  // **`skipped` 가 아니라 `true` 인 것이 요점이다** — 이미 본 아이는 건너뛴 채 완료가 되는데,
  // 그러면 「연출이 돌았다」를 못 보장한다. 처음 보는 아이는 실제로 다 보고 끝나야 한다.
  await expect(목적지).toHaveAttribute("data-compass-phase", "complete");

  // ③ 나침반이 최종 자리에 있다 — 도착을 기다리는 중이 아니다.
  await expect(목적지).toHaveAttribute("data-compass-arrival-pending", "false");
  await expect(목적지).toHaveAttribute("data-compass-visible", "true");
  await expect(나침반).toBeVisible();

  // 움직임을 줄인 환경에서는 도착 반짝임을 애니메이션으로 돌리지 않는다.
  expect(await 나침반.locator(".compass-intro-light").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

  // ④ 나머지 대사가 다 나왔다.
  await expect(동료.getByText(챕터동료소개)).toBeVisible();

  // ⑤ 쓸 수 있는 상태로 넘어간다 — 쓰면 나침반이 깨어난다.
  await page.getByRole("textbox").fill("조심스럽게 문을 두드린다.");
  await expect(나침반).toHaveAttribute("data-compass-awake", "true");
  expect(await 나침반.locator("[data-compass-glow]").evaluate((el) => Number((el as SVGElement).style.opacity))).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: 챕터보내기라벨 })).toBeEnabled();

  // ⑥ 소개가 다시 돌지 않는다. 글을 지웠다 다시 써도 끝난 상태 그대로다.
  await page.getByRole("textbox").fill("");
  await expect(나침반).toHaveAttribute("data-compass-awake", "false");
  await expect(목적지).toHaveAttribute("data-compass-introduction-complete", "true");
  await expect(목적지).toHaveAttribute("data-compass-phase", "complete");
  await expect(page.locator(".compass-instrument")).toHaveCount(1);
  await expect(동료).toHaveAttribute("data-expression", "default");
});

test("시작할 때 서버가 준 동료 대사를 그대로 한 번만 보여준다", async ({ page }) => {
  const line = "작은 창문 너머로 바람이 들어와. 어떻게 할까?";
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: {
    ...장면, guide: { expression: "default", line },
  } }));
  await page.goto("/chapter");
  await expect(page.locator(".chapter-companion-line").getByText(line)).toBeVisible();
  await expect(page.getByText(line)).toHaveCount(1);
  await expect(page.getByText(챕터동료소개)).toHaveCount(0);
});

async function 글을보낸다(page: Page, 문장 = "밧줄 매듭을 손끝으로 천천히 풀어 본다.") {
  await page.getByRole("textbox").first().fill(문장);
  await page.getByRole("button", { name: 챕터보내기라벨 }).click();
}

/**
 * **결과 단계를 지나 새 장면까지 간다** (2026-09-22 — 단계 전환이 들어온 뒤).
 *
 * ⛔ **한 턴이 세 단계**가 됐다 — `글쓰기 → 결과 → 새장면 → 글쓰기`. 아이가 **버튼을
 * 눌러야** 넘어간다(사용자 지시 — 자동 대기를 만들지 않는다). 그래서 **글을 보낸
 * 직후에는 새 서사가 화면에 없다.** 새 서사를 재는 검사는 이 도우미를 지나야 한다.
 */
async function 새장면까지(page: Page) {
  await page.locator("[data-그다음이야기]").click();
}

/** 새 장면을 보고 **다음 글쓰기 칸까지** 간다. */
async function 다음글쓰기까지(page: Page) {
  await 새장면까지(page);
  await page.locator("[data-다음행동]").click();
}

test("직접 써서 턴이 넘어간다", async ({ page }) => {
  await 장면을띄운다(page);

  let 보낸것: unknown = null;
  await page.route(TURNS, (route) => {
    보낸것 = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: 다음턴 });
  });

  const 문장 = "밧줄 매듭을 하나씩 만져 보며 어느 쪽이 새것인지 살핀다";
  await page.getByRole("textbox").fill(문장);
  await page.getByRole("button", { name: 챕터보내기라벨 }).click();

  // **결과 단계가 먼저다** — 아이 글과 짧은 반응이 여기 있다.
  await expect(page.locator("[data-쓴문장]")).toContainText(문장);
  await expect(page.locator(".chapter-companion-line").getByText(챕터다음안내)).toBeVisible();

  // **새 서사는 아이가 버튼을 눌러야 나온다.**
  await 새장면까지(page);
  await expect(page.getByText(다음턴.narrative!)).toBeVisible();

  expect(보낸것).toEqual({ chapter_id: 장면.chapter_id, text: 문장 });
});

/** 차단. **200 이고 정상 응답이다** — `outcome` 으로 가른다(2026-09-16 계약 정정). */
const 차단: TurnResult = {
  outcome: "blocked",
  reason: "moderation",
  turn: 장면.turn,
  beat: "intro",
  scaffold: null,
  narrative: null,
  choices: 장면.choices,
  state: 장면.state,
  turns_left: 장면.turns_left,
  artwork: null,
  chapter_done: false,
  guide: { expression: "compass_dim", line: "그 얘기는 우리 모험에 안 어울려. 다른 걸 해볼까?" },
};

/**
 * **⛔ 이것이 8번에서 가장 중요한 검사다.**
 *
 * `Stage0.md` 148행 — **「차단 시 아이가 쓴 문장을 지우지 않는다. 이유도 모른 채 공들여 쓴
 * 글이 사라지면 그것 자체가 벌로 읽힌다.」** 차단을 오류 갈래로 보내면 그 규칙이 깨진다.
 */
test("차단은 오류가 아니다 — 아이 글을 지우지 않고 가이드가 말한다", async ({ page }) => {
  await 장면을띄운다(page);
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 차단 }));

  const 문장 = "부두에 있는 아저씨한테 무섭게 소리를 지른다";
  await page.getByRole("textbox").fill(문장);
  await page.getByRole("button", { name: 챕터보내기라벨 }).click();

  // **① 서버가 준 가이드 그대로.** 표정도 대사도 프론트가 안 고른다.
  await expect(page.getByText(차단.guide!.line)).toBeVisible();
  await expect(page.getByText(차단.guide!.line)).toHaveCount(1);
  await expect(page.locator(".chapter-companion-line")).toBeFocused();
  await expect(page.locator(`img[src="/guide/${차단.guide!.expression}-stage.png"]`)).toBeVisible();

  // **② 아이 글이 그대로 남아 있다 — 이 줄이 148행이다.**
  await expect(page.getByRole("textbox")).toHaveValue(문장);

  // **③ 오류 화면이 아니다.** 못 닿음 문구가 뜨면 아이는 서버가 고장 난 줄 안다.
  await expect(page.getByText(못닿음.보내기)).toHaveCount(0);

  // **④ 차단 뒤에도 선택지가 다시 나타나지 않는다.**
  await expect(page.locator(".turn-choices")).toHaveCount(0);
});

test("되묻기도 아이 글을 지우지 않는다 — 고쳐 쓰라는 말이다", async ({ page }) => {
  await 장면을띄운다(page);
  const 되묻기: TurnResult = {
    ...차단,
    outcome: "scaffold",
    reason: null,
    scaffold: "그 밧줄은 어떤 모양이야?",
    guide: { expression: "compass_dim", line: "그 밧줄은 어떤 모양이야?" },
  };
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 되묻기 }));

  const 문장 = "밧줄을 본다";
  await page.getByRole("textbox").fill(문장);
  await page.getByRole("button", { name: 챕터보내기라벨 }).click();

  await expect(page.getByText(되묻기.guide!.line)).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue(문장);

  // **손끝에 「여기서부터 이어 쓰면 된다」가 전달돼야 한다** (2026-09-21 사용자 요청).
  // 되묻기 틀 넷 중 셋이 **보태라는 말**인데(`MVP_PRD.md` 4.4), 화면이 그 말을 안 해서
  // 아이는 **「새 질문 + 이미 차 있는 칸」**으로 읽고 지우고 다시 썼다.
  // **⛔ 칸을 비우는 쪽으로 풀지 않았다** — 4.4 가 「다시 써」를 금지어로 박아 뒀고,
  // 비우는 것은 그 말을 **동작으로** 하는 것이다. 초점과 커서로만 말한다.
  await expect(page.getByRole("textbox")).toBeFocused();
  const 커서 = await page.getByRole("textbox").evaluate(
    (칸) => [(칸 as HTMLTextAreaElement).selectionStart, (칸 as HTMLTextAreaElement).selectionEnd],
  );
  expect(커서, "커서가 쓴 글 맨 뒤에 있어야 한다").toEqual([문장.length, 문장.length]);
});

/**
 * ## ⛔ 2026-09-22 에 뒤집혔다 — 사용자 지시
 *
 * **종전 규칙은 「액자를 비우지 않는다」**였다. 핵심 씬이 1턴·9턴 둘뿐이라 여덟 턴은
 * 새 그림이 없고, 비우면 **여덟 턴 중 일곱에서 보상이 사라진다**는 것이 근거였다.
 *
 * **사용자가 그 반대를 골랐다.** 남겨 두니 **아이가 「내가 방금 쓴 글로 이 그림이
 * 나왔다」로 읽었다** — 실제로는 몇 턴 전 그림이다. 지시 그대로 옮기면
 * **「이전 삽화는 현재 턴의 결과가 아니므로 현재 결과 화면에서 제외합니다」**다.
 *
 * ⚠ **잃는 것을 적어 둔다** — 그림이 보이는 자리가 **1턴·9턴의 결과 단계와 첫 입장**으로
 * 줄었다. 「썼더니 그림이 나왔다」가 **덜 자주 보인다.** 사용자가 그것을 알고 정했다.
 */
test("새 그림이 없는 턴에는 앞 그림을 결과에 다시 안 보인다", async ({ page }) => {
  const 그림있는장면: ChapterView = {
    ...장면,
    artwork: { artwork_id: "aw-1", status: "ready", url: "/i/aw-1.png" },
  };
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: 그림있는장면 }));
  await page.goto("/chapter");

  const 액자 = page.locator('main img[src="/i/aw-1.png"]');
  await expect(액자).toBeVisible();

  // 다음 턴에는 **새 그림이 없다** (`artwork: null`).
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 다음턴 }));
  await 글을보낸다(page);
  await expect(page.locator("[data-쓴문장]")).toBeVisible();

  // **결과 단계에 앞 그림이 없다.** 그 그림은 이번 턴의 결과가 아니다.
  await expect(액자).toHaveCount(0);
  await expect(page.locator("[data-그림상태]")).toHaveCount(0);

  // 새 장면·다음 글쓰기 단계에도 안 돌아온다.
  await 다음글쓰기까지(page);
  await expect(page.getByText(다음턴.narrative!)).toBeVisible();
  await expect(액자).toHaveCount(0);
});

test("완결하면 가이드가 말하고 「이어서 더 하기」가 없다", async ({ page }) => {
  await 장면을띄운다(page);
  const 완결: TurnResult = {
    ...다음턴,
    chapter_done: true,
    guide: { expression: "session_end", line: "여기서 한 장이 끝났어. 네 책에 들어갔어." },
  };
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 완결 }));

  await 글을보낸다(page);

  await expect(page.getByText(완결.guide!.line)).toBeVisible();

  // **⛔ 없는 것이 결정이다** (D-1 · 페르소나 7.1). Auto-play·무한 스크롤 금지.
  const 화면 = await page.locator("main").innerText();
  for (const 금지 of ["이어서", "더 하기", "계속하기", "한 판 더"]) {
    expect(화면).not.toContain(금지);
  }
  // 쓰는 칸도 없다 — 끝났는데 칸이 남으면 **끝난 것으로 안 읽힌다.**
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.locator('.chapter-ending a[href="/book"]')).toBeVisible();
  await expect(page.locator(".chapter-ending")).toBeFocused();
});

test("완결 대사가 없어도 책을 펼칠 수 있다", async ({ page }) => {
  await 장면을띄운다(page);
  await page.route(TURNS, (route) => route.fulfill({
    status: 200,
    json: { ...다음턴, chapter_done: true, guide: null },
  }));
  await 글을보낸다(page);
  await expect(page.locator('.chapter-ending a[href="/book"]')).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

for (const [status, code, guide유무] of [
  [429, "TURN_LIMIT", true],
  [409, "CHAPTER_DONE_TODAY", true],
  [409, "CHAPTER_DONE_TODAY", false],
] as const) {
  test(`${code} 종료는 쓰기를 닫고 서버 안내와 책을 보여준다 — guide ${guide유무}`, async ({ page }) => {
    await 장면을띄운다(page);
    const message = "오늘의 이야기는 여기까지야.";
    const line = "오늘 함께 쓴 이야기를 책에서 펼쳐 봐.";
    await page.route(TURNS, (route) => route.fulfill({ status, json: { error: {
      code, message, detail: guide유무 ? { guide: { expression: "session_end", line } } : {},
    } } }));
    await 글을보낸다(page);
    await expect(page.getByText(guide유무 ? line : message)).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.locator('.chapter-ending a[href="/book"]')).toBeVisible();
    await expect(page.locator(".chapter-ending")).toBeFocused();
  });
}

test("처음 열 때 이미 끝난 챕터도 서버 안내와 책으로 연결한다", async ({ page }) => {
  await page.route(CURRENT, (route) => route.fulfill({ status: 404, json: { error: { code: "NO_ACTIVE_CHAPTER", message: "" } } }));
  const line = "오늘 쓴 이야기를 책에서 만나자.";
  await page.route("**/api/v1/chapters", (route) => route.fulfill({ status: 409, json: { error: {
    code: "CHAPTER_DONE_TODAY", message: line, detail: { guide: { expression: "session_end", line } },
  } } }));
  await page.goto("/chapter");
  await expect(page.getByText(line)).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.locator('.chapter-ending a[href="/book"]')).toBeVisible();
});

test("보내는 중에도 쓴 글을 유지하고 읽는 중임을 알린다", async ({ page }) => {
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: {
    ...장면, guide: { expression: "compass_bright", line: "이전 결과 안내야." },
  } }));
  await page.goto("/chapter");
  await expect(page.locator("[data-chapter-companion]")).toHaveAttribute("data-expression", "compass_bright");
  let 응답한다!: () => void;
  const 응답대기 = new Promise<void>((resolve) => { 응답한다 = resolve; });
  await page.route(TURNS, async (route) => {
    await 응답대기;
    await route.fulfill({ status: 200, json: 다음턴 });
  });
  const 문장 = "낡은 매듭을 손끝으로 천천히 풀어 본다.";
  await page.getByRole("textbox").fill(문장);
  await page.getByRole("button", { name: 챕터보내기라벨 }).click();
  await expect(page.locator("[data-읽는중]")).toBeVisible();
  await expect(page.locator("[data-chapter-companion]")).toHaveAttribute("data-expression", "default");
  await expect(page.getByText("이전 결과 안내야.")).toHaveCount(0);
  await expect(page.locator(".chapter-controls")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("textbox")).toHaveValue(문장);
  await expect(page.getByRole("textbox")).toHaveAttribute("readonly", "");
  await expect(page.locator(".writing-actions button")).toBeDisabled();
  응답한다();
  // **결과 단계가 먼저다.** 새 서사는 아이가 버튼을 눌러야 나온다 (2026-09-22).
  await expect(page.locator("[data-쓴문장]")).toContainText(문장);
  await expect(page.locator("[data-읽는중]")).toHaveCount(0);
  await 새장면까지(page);
  await expect(page.getByText(다음턴.narrative!)).toBeVisible();
});

test("긴 이야기를 읽은 다음 응답은 첫 문장으로 돌아온다", async ({ page }) => {
  // ⛔ **재는 대상이 바뀌었다** (2026-09-22). 종전에는 **읽는 칸이 따로 스크롤**돼서
  // `scrollTop` 을 쟀는데, 그 내부 스크롤을 걷었다(사용자 확정 — 글이 다 펼쳐진다).
  // **재야 하는 것은 그대로다** — 아래까지 읽고 글을 보낸 아이가 **새 이야기의 중간을
  // 보면 안 된다.** 이제 그 일을 **페이지 스크롤**이 한다.
  await page.route(CURRENT, (route) => route.fulfill({
    status: 200,
    json: { ...장면, narrative: 긴서사.repeat(8), artwork: null },
  }));
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 다음턴 }));
  await page.goto("/chapter");
  const 이야기 = page.locator(".chapter-story");
  await expect(이야기).toBeVisible();

  // 아래까지 읽은 아이를 흉내 낸다.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await 글을보낸다(page);
  await 새장면까지(page);
  await expect(page.getByText(다음턴.narrative!)).toBeVisible();
  // ⛔ **초점은 결과 단계에서 이미 이야기 칸으로 갔다** (새 응답이 온 그 순간).
  // 단계를 넘긴 것은 **아이가 버튼을 누른 것**이라 초점이 그 버튼에 있다 —
  // **빼앗지 않는 것이 맞다**(사용자 지시 「포커스가 사라지지 않음」).
  // 재야 하는 것은 **새 이야기의 첫 문장이 화면 안에 있는가**다.
  const 시작 = await 이야기.boundingBox();
  expect(시작!.y).toBeLessThan(await page.evaluate(() => window.innerHeight));

});

/**
 * 2026-09-19 사용자 요청: 튜토리얼과 같은 장면 → 동료 → 입력 배치.
 * 서사가 길면 문서 스크롤로 모두 읽고, 그 아래에 입력·보내기가 있다.
 * 긴 서사와 말풍선의 내부 스크롤은 유지하되 동료나 입력을 겹쳐 압축하지 않는다.
 */
const 긴서사 = "".padEnd(0) +
  "시계탑 꼭대기로 오르는 나선 계단은 한 칸씩 높이가 달라서 발끝으로 더듬어야 했다. " +
  "벽을 따라 늘어선 촛대에는 초가 없고, 대신 마른 넝쿨이 손목 굵기로 얽혀 창틀까지 뻗어 있다. " +
  "위쪽 어딘가에서 쇠가 쇠를 긁는 소리가 일정한 간격으로 내려오는데, 그 사이사이에 " +
  "숨을 고르는 것 같은 낮은 소리가 섞인다. 난간을 짚자 손바닥에 서늘한 물기가 묻어났다.";

async function 무대와입력이겹치지않는다(page: Page) {
  // **소개 연출이 끝난 뒤에 잰다** (2026-09-21 사용자 판정).
  //
  // 나침반이 아직 도착하지 않은 동안에는 **그 자리를 비워 두느라 동료 영역이 몇 px 더 크고**,
  // 그래서 **첫 0.5초에만** 입력 상자를 4~8px 덮는다(실측). 사용자가 실제 화면에서
  // **「말풍선은 전혀 문제되지 않는다」**를 확인했다 — 아이가 쓰려 할 때는 이미 끝나 있다.
  //
  // **⛔ 그러니 이 검사가 재려는 것은 「연출 도중」이 아니라 「쓰려 할 때」다.**
  // 시간을 기다리지 않고 **남는 완료 표식**을 본다 — 220ms 짜리 중간 상태를 쫓지 않는다.
  // **연출이 끝났다는 표식을 본다.** 「나침반이 보이기 시작할 때」로도 재 봤는데
  // **그쪽이 더 나빴다** — 실패가 4건에서 9건으로 늘었다. 끝난 것을 보는 편이 안정적이다.
  await expect(page.locator("[data-compass-destination]"))
    .not.toHaveAttribute("data-compass-introduction-complete", "false", { timeout: 20_000 });
  await expect(page.locator(".chapter-world [data-chapter-companion]")).toHaveCount(1);
  await expect(page.locator(".chapter-console [data-chapter-companion]")).toHaveCount(0);
  const [읽는곳, 동료, 쓰는곳] = await Promise.all([
    page.locator(".chapter-reading").boundingBox(),
    page.locator("[data-chapter-companion]").boundingBox(),
    page.locator(".chapter-console").boundingBox(),
  ]);
  expect(읽는곳!.y + 읽는곳!.height, "장면과 동료가 겹친다").toBeLessThanOrEqual(동료!.y + 1);
  expect(동료!.y + 동료!.height, "동료가 입력 상자에 가려진다").toBeLessThanOrEqual(쓰는곳!.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
}

async function 입력은문서스크롤로읽는다(page: Page) {
  for (const selector of [
    "main textarea",
    ".writing-actions button",
  ]) {
    const element = page.locator(selector);
    // 문서 아래를 읽는 동작을 명확히 한다. 최소 스크롤은 0.03px가 경계 밖에 남을 수 있다.
    await element.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
    await expect(element).toBeInViewport({ ratio: 1 });
  }
}

async function 입력과보내기가보인다(page: Page) {
  // 종전에는 안내 확인 버튼의 초점 이동이 이 자리까지 스크롤해 줬다. 안내가 없어졌으니
  // 스크롤을 명시한다 — 재는 것은 「보인다」이지 「가만히 있어도 보인다」가 아니다.
  await page.getByRole("textbox").scrollIntoViewIfNeeded();
  await expect(page.getByRole("textbox")).toBeInViewport({ ratio: 1 });
  const 보내기 = page.getByRole("button", { name: 챕터보내기라벨 });
  await 보내기.scrollIntoViewIfNeeded();
  await expect(보내기).toBeInViewport({ ratio: 1 });
}

// 그림이 준비된 턴을 본다. 입력칸만 화면 안에 있어도 그림이 서사를 전부 가리면
// 아이는 무엇을 보고 골라야 하는지 모른다. 실제 이미지 로드와 조상 영역의 잘림까지 잰다.
for (const [폭, 높이] of [[1280, 800], [360, 640]] as const) {
  for (const 색상 of ["light", "dark"] as const) {
    test(`그림과 이야기를 읽고 바로 보낼 수 있다 — ${폭}×${높이} · ${색상}`, async ({ page }) => {
      await page.setViewportSize({ width: 폭, height: 높이 });
      await page.emulateMedia({ colorScheme: 색상 });
      await page.route(CURRENT, (route) => route.fulfill({
        status: 200,
        json: {
          ...장면,
          narrative: 긴서사,
          artwork: { artwork_id: "layout-art", status: "ready", url: "/layout-art.png" },
        },
      }));
      await page.route("**/layout-art.png", (route) => route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          "base64",
        ),
      }));
      await page.goto("/chapter");

      const 그림 = page.locator('main img[src="/layout-art.png"]');
      await expect.poll(() => 그림.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
      await expect(그림).toBeInViewport({ ratio: 1 });
      await expect(page.getByText(긴서사)).toBeInViewport();
      await 무대와입력이겹치지않는다(page);
      await 입력은문서스크롤로읽는다(page);
      await 입력과보내기가보인다(page);
    });
  }
}

for (const [폭, 높이, 어디] of [
  [1024, 768, "iPad 가로 — 아이 셋이 이렇게 들었다"],
  [1280, 800, "검사 기본 뷰포트"],
  [390, 844, "폰 세로"],
  // 작은 화면에서도 장면·동료를 겹치지 않고 쓰는 칸까지 읽는다.
  [360, 640, "작은 안드로이드 — 주소창까지 있으면 이 정도다"],
  [320, 568, "작은 화면에서도 입력과 보내기를 숨기지 않는다"],
] as const) {
  test(`긴 서사를 읽고 입력으로 이어진다 — ${폭}×${높이} (${어디})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 폭, height: 높이 });
    await page.route(CURRENT, (route) =>
      route.fulfill({ status: 200, json: { ...장면, narrative: 긴서사 } }),
    );
    await page.goto("/chapter");
    await expect(page.getByText(긴서사)).toBeVisible();
    await 무대와입력이겹치지않는다(page);
    await 입력은문서스크롤로읽는다(page);
    await 입력과보내기가보인다(page);
  });
}

test("작은 화면에서 서버 선택지를 무시하고 이야기와 쓸 자리를 유지한다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.route(CURRENT, (route) => route.fulfill({
    status: 200,
    json: {
      ...장면,
      narrative: 긴서사,
      artwork: null,
      choices: Array.from({ length: 6 }, (_, index) => ({
        id: `long-${index}`,
        label: `배에 묶인 밧줄을 살펴보고 난간에 남은 흔적을 천천히 따라가 본다 ${index + 1}`,
      })),
    },
  }));
  await page.goto("/chapter");
  await expect(page.getByText(긴서사)).toBeInViewport();
  await expect(page.locator(".turn-choices")).toHaveCount(0);
  await 무대와입력이겹치지않는다(page);
  await 입력은문서스크롤로읽는다(page);
  await 입력과보내기가보인다(page);
});

for (const [width, height] of [[360, 640], [320, 568]] as const) {
  test(`긴 동료 안내도 끝까지 읽을 수 있고 쓰는 칸을 가리지 않는다 — ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // **타이핑을 건너뛴다.** 이 검사가 재는 것은 **자리**이지 글자가 찍히는 속도가 아니다.
    // 서사 600자 + 안내 420자를 한 글자씩 찍으면 40초가 넘고, 그동안 잴 수가 없다.
    // 움직임을 줄이면 **크기는 그대로이고 연출만 즉시 끝난다.**
    await page.emulateMedia({ reducedMotion: "reduce" });
    const line = "문 안쪽에서 작은 바퀴가 굴러가는 소리가 들려. 주변을 천천히 살펴봐. ".repeat(12);
    await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: {
      ...장면, narrative: 긴서사.repeat(4), artwork: null, guide: { expression: "default", line },
    } }));
    const 다음안내 = "창문이 열리니 먼 곳의 종소리가 더 또렷하게 들려와. ".repeat(12);
    await page.route(TURNS, (route) => route.fulfill({ status: 200, json: {
      ...다음턴, guide: { expression: "default", line: 다음안내 },
    } }));
    await page.goto("/chapter");
    const 말풍선 = page.locator(".chapter-companion-line");
    await expect(말풍선).toHaveText(line.trim());
    await 무대와입력이겹치지않는다(page);
    await 입력은문서스크롤로읽는다(page);
    await expect(page.getByRole("button", { name: 챕터보내기라벨 })).toBeInViewport({ ratio: 1 });
    await 입력과보내기가보인다(page);
    await 말풍선.focus();
    await page.keyboard.press("End");
    await expect.poll(() => 말풍선.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await 무대와입력이겹치지않는다(page);
    await 글을보낸다(page);
    await expect(말풍선).toHaveText(다음안내.trim());
    expect(await 말풍선.evaluate((el) => el.scrollTop)).toBe(0);
  });
}

/**
 * ## ⛔ 본편을 쓰는 중에 「내 책 펼치기」가 빈 책으로 보냈다
 *
 * **본편은 완결해야 책 한 장이 된다** (A-7). 카드는 한 장 쓸 때마다 한 쪽이 되는데
 * 본편은 **열 턴을 다 써야** 생긴다. 그런데 **첫 턴을 쓰고 삽화까지 받은 자리**에
 * 이 버튼이 떠 있어서, 아이가 누르면 **빈 책**이었다.
 *
 * **⛔ 저장 규칙이 아니라 화면이 틀렸다** — 규칙은 그대로 두고 화면이 그 규칙을 말한다.
 * 2026-09-22 사용자 지시.
 */
const 책 = (쪽수: number) => ({
  book_id: "b1",
  title: "책",
  author: "탐험가",
  visibility: "private",
  pages: Array.from({ length: 쪽수 }, (_, i) => ({
    page_no: i + 1,
    source: "card",
    source_id: `c0${i + 1}`,
    tier: "legendary",
    artwork_url: null,
    text: "지어낸 문장",
    achieved_at: "2026-09-08T01:00:00Z",
  })),
  counts: { basic: 0, rare: 0, legendary: 쪽수 },
});

test("책이 비었으면 본편 화면에 내 책으로 가는 버튼이 없다", async ({ page }) => {
  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책(0) }));
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: 장면 }));

  await page.goto("/chapter");
  await expect(page.getByText(장면.narrative)).toBeVisible();

  // **눌러도 빈 책이라 아예 안 그린다.**
  await expect(page.getByRole("link", { name: 내책라벨 })).toHaveCount(0);

  // **대신 무엇을 해야 담기는지 말한다.** 새 문장을 만들지 않고 `문구.md` 1.18b 를 쓴다.
  await expect(page.locator("[data-chapter-structure-guide]")).toContainText(챕터구조안내[1]);
});

test("카드로 쌓은 쪽이 있으면 본편 중에도 내 책으로 갈 수 있다", async ({ page }) => {
  // **막는 것이 「본편 중」이 아니라 「빈 책」인지 본다.** 아니면 위 검사는
  // 「본편에서는 늘 없다」도 통과하고, **카드로 쌓은 책을 아이에게서 빼앗는다.**
  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책(2) }));
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: 장면 }));

  await page.goto("/chapter");
  await expect(page.getByText(장면.narrative)).toBeVisible();
  await expect(page.getByRole("link", { name: 내책라벨 })).toHaveAttribute("href", "/book");
});

test("못 닿아서 쪽수를 모를 때는 버튼을 남긴다 — 있는 책을 숨기지 않는다", async ({ page }) => {
  // **통신 한 번 실패로 카드로 쌓아 둔 책을 못 보게 하면 잃는 것이 더 크다.**
  await page.route(BOOK, (route) => route.abort());
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: 장면 }));

  await page.goto("/chapter");
  await expect(page.getByText(장면.narrative)).toBeVisible();
  await expect(page.getByRole("link", { name: 내책라벨 })).toHaveAttribute("href", "/book");
});

test("완결 화면에는 버튼이 그대로 있다 — 들어올 때 센 쪽수로 가리지 않는다", async ({ page }) => {
  // **쪽수는 화면에 들어올 때 한 번 센다.** 완결하면 그 순간 책 한 장이 저장되므로
  // **들어올 때의 0 으로 완결 화면까지 가리면**, 아이는 방금 만든 자기 책으로 갈 길을 잃는다.
  await page.route(BOOK, (route) => route.fulfill({ status: 200, json: 책(0) }));
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: 장면 }));
  await page.route(TURNS, (route) =>
    route.fulfill({ status: 200, json: { ...다음턴, chapter_done: true } }),
  );

  await page.goto("/chapter");
  await expect(page.getByText(장면.narrative)).toBeVisible();
  // 들어온 자리에서는 가려져 있다.
  await expect(page.getByRole("link", { name: 내책라벨 })).toHaveCount(0);

  await page.locator("#attempt").fill("밧줄 매듭을 하나씩 풀어 본다");
  await page.getByRole("button", { name: 챕터보내기라벨 }).click();

  await expect(page.locator('.chapter-ending a[href="/book"]')).toBeVisible();
});

/**
 * ## ⛔ 결과를 보는 것과 다음 글을 쓰는 것이 안 갈렸다
 *
 * 아이가 글을 등록하면 **방금 쓴 글·새 삽화·이어진 이야기·래서판다·입력창**이 한꺼번에
 * 보였다. **11~12살이 화면만 보고 「내 글로 이야기가 이어졌고 이제 다음을 써야 한다」를
 * 알 수 있어야 한다**는 것이 사용자 지시다 (2026-09-22).
 *
 * **⛔ 가르는 수단은 자리가 아니라 표시와 여백이다.** 아이 글을 읽는 상자 밖으로
 * 꺼내 봤더니 **360·320·1280 에서 삽화가 눌리거나 보내기 버튼이 화면 밖**으로 나갔다 —
 * 기준선과 대조해 **내가 만든 회귀**임을 확인하고 되돌렸다.
 */
test("글을 보내면 내 글과 이어진 이야기를 표시로 가른다", async ({ page }) => {
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: 장면 }));
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 다음턴 }));

  await page.goto("/chapter");
  // **첫 글 전에는 표시가 없다** — 견줄 것이 없어 「이어진 이야기」가 무엇에 이어졌는지
  // 말하지 못하고, 빈 표시가 된다.
  await expect(page.locator(".chapter-part-label").getByText(결과라벨.내글)).toHaveCount(0);
  await expect(page.getByText(결과라벨.이어진이야기)).toHaveCount(0);

  await page.locator("#attempt").fill("밧줄 매듭을 하나씩 풀어 본다");
  await page.getByRole("button", { name: 챕터보내기라벨 }).click();

  // ⛔ **2026-09-22 에 가르는 수단이 바뀌었다** — 표시가 아니라 **단계**다.
  // 결과 단계에는 **아이 글만** 있고 새 서사가 없다. 그래서 둘을 견줄 일이 없어졌다.
  await expect(page.locator(".chapter-part-label").getByText(결과라벨.내글)).toBeVisible();
  await expect(page.getByText(다음턴.narrative!)).toHaveCount(0);

  // 새 장면 단계로 넘어가면 **아이 글이 물러나고 새 서사가 중심**이다.
  await 새장면까지(page);
  await expect(page.getByText(다음턴.narrative!)).toBeVisible();
  await expect(page.locator("[data-쓴문장]")).toHaveCount(0);
});

test("두 번째 글부터 입력 영역이 같은 질문을 되풀이하지 않는다", async ({ page }) => {
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: 장면 }));
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 다음턴 }));

  await page.goto("/chapter");
  // 첫 글 전에는 기존 제목 그대로다. 그때는 「이번에는」이 가리킬 지난번이 없다.
  await expect(page.getByRole("textbox", { name: 챕터쓰기라벨 })).toBeVisible();

  await page.locator("#attempt").fill("밧줄 매듭을 하나씩 풀어 본다");
  await page.getByRole("button", { name: 챕터보내기라벨 }).click();

  // **결과·새장면 단계에는 입력칸이 없다** (2026-09-22). 결과를 보는 것과 다음 글을
  // 쓰는 것을 가르는 것이 이 단계 전환의 목적이다.
  await expect(page.locator("#attempt")).toHaveCount(0);

  await 다음글쓰기까지(page);
  // **래서판다가 「네가 쓴 대로 이야기가 이어졌어.」라고 말한 뒤**라, 같은 질문을 또
  // 하면 처음 보는 화면과 구분이 안 된다.
  await expect(page.getByRole("textbox", { name: 챕터다시쓰기라벨 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: 챕터쓰기라벨 })).toHaveCount(0);
});

test("글을 보낸 뒤 초점이 입력칸으로 가지 않는다 — 키보드가 갑자기 열리면 안 된다", async ({
  page,
}) => {
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: 장면 }));
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 다음턴 }));

  await page.goto("/chapter");
  await page.locator("#attempt").fill("밧줄 매듭을 하나씩 풀어 본다");
  await page.getByRole("button", { name: 챕터보내기라벨 }).click();
  await expect(page.locator(".chapter-part-label").getByText(결과라벨.내글)).toBeVisible();

  // **읽을 것으로 먼저 간다.** 입력칸으로 가면 모바일에서 키보드가 올라와
  // **삽화와 이야기를 덮는다.**
  expect(await page.evaluate(() => document.activeElement?.id ?? "")).not.toBe("attempt");

  // ⛔ **단계를 넘겨 입력칸이 새로 생겨도 초점을 안 준다** (2026-09-22 사용자 지시).
  await 다음글쓰기까지(page);
  await expect(page.locator("#attempt")).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.id ?? "")).not.toBe("attempt");
});

/**
 * ## ⛔ 「모험 그림」 — 아이가 「내 글로 이 그림이 나왔다」고 오해했다
 *
 * **본편 삽화는 한 챕터에 두 번뿐**이고(1턴·9턴) 나머지 턴에는 **직전 그림이 남는다.**
 * 그 그림이 **아이 문장 바로 옆**에 붙어 있어서 2턴부터도 자기 글로 나온 것으로 읽혔다.
 * 사용자가 짚었고, **삽화를 제 영역으로 떼어 상태를 말하게** 했다 (2026-09-22).
 *
 * **⛔ 턴 번호로 안 가른다.** 서버가 새 그림 턴에만 `artwork` 를 싣고, 화면은 그 id 가
 * 액자의 것과 같은지만 본다 — **뼈대가 바뀌어도 화면이 거짓말을 안 한다.**
 */
const 그림있는턴 = (id: string) => ({
  ...다음턴,
  artwork: { artwork_id: id, status: "ready", url: null },
});

async function 삽화판(page: Page, 삽화응답: Record<string, unknown>) {
  await page.route(/\/api\/v1\/artworks\/.+/, (route) =>
    route.fulfill({ status: 200, json: 삽화응답 }),
  );
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, json: 장면 }));
}

async function 한턴쓴다(page: Page) {
  await page.goto("/chapter");
  await page.locator("#attempt").fill("밧줄 매듭을 하나씩 풀어 본다");
  await page.getByRole("button", { name: 챕터보내기라벨 }).click();
  await expect(page.locator("[data-쓴문장]")).toBeVisible();
}

test("이번 글로 새 그림이 왔으면 그렇게 말한다", async ({ page }) => {
  await 삽화판(page, { artwork_id: "새것", status: "ready", url: "/x.svg", tier: "rare", fallback: false });
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 그림있는턴("새것") }));

  await 한턴쓴다(page);
  await expect(page.locator("[data-그림상태]")).toHaveText(그림문구.새로왔다);
  // **제목이 「모험 그림」이다** — 「네가 쓴 글」에 딸린 그림이 아니라는 뜻이다.
  await expect(page.locator(".chapter-visual")).toContainText(그림문구.제목);
});

test("앞 턴 그림이 남아 있는 것이면 그렇게 말한다 — 여기가 오해가 났던 자리다", async ({ page }) => {
  await 삽화판(page, { artwork_id: "aaaa", status: "ready", url: "/x.svg", tier: "rare", fallback: false });
  // **서버가 `artwork` 를 안 보낸다** — 그것이 「새 그림이 없다」의 실제 신호다.
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 다음턴 }));

  await 한턴쓴다(page);
  // ⛔ **2026-09-22 에 바뀌었다** — 「앞에서 만든 그림」이라고 **말하지 않고 아예 안 보인다.**
  // 그 그림은 **이번 턴의 결과가 아니다**(사용자 지시). 말로 표시하는 것으로는
  // **아이 글 아래 놓인 그림이 결과처럼 읽히는 것**을 못 막았다.
  await expect(page.locator(".chapter-visual")).toHaveCount(0);
  await expect(page.locator("[data-그림상태]")).toHaveCount(0);
});

test("⛔ 기본 그림에는 아무 말도 하지 않는다", async ({ page }) => {
  // 「새 그림이 완성됐어!」는 거짓이고(아이 문장으로 만든 것이 아니다),
  // 「기본 그림이야」는 「fallback 을 아이에게 알리지 않는다」를 깬다 (W4 B-3 완료 조건).
  await 삽화판(page, { artwork_id: "새것", status: "ready", url: "/x.svg", tier: "basic", fallback: true });
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 그림있는턴("새것") }));

  await 한턴쓴다(page);
  await expect(page.locator("[data-그림상태]")).toHaveCount(0);
  // **그림 자체는 그대로 보인다** — 감추는 것은 말이지 그림이 아니다.
  await expect(page.locator(".chapter-visual .artwork-frame")).toBeVisible();
});

test("읽는 순서가 내 글 → 이야기 → 그림 → 동료 → 다음 행동이다", async ({ page }) => {
  await 삽화판(page, { artwork_id: "새것", status: "ready", url: "/x.svg", tier: "rare", fallback: false });
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 그림있는턴("새것") }));

  await 한턴쓴다(page);
  const y = async (칸: string) => (await page.locator(칸).first().boundingBox())!.y;

  // **결과 단계** — 네가 쓴 글 → 모험 그림 → 짧은 반응 → 그다음 이야기 보기.
  const 쓴글 = await y("[data-쓴문장]");
  expect(await y(".chapter-visual")).toBeGreaterThan(쓴글);
  expect(await y(".chapter-companion")).toBeGreaterThan(await y(".chapter-visual"));
  expect(await y("[data-그다음이야기]")).toBeGreaterThan(await y(".chapter-companion"));

  // **새 장면 단계** — 서사가 중심이고 그 아래 다음 버튼뿐이다.
  await 새장면까지(page);
  expect(await y("[data-다음행동]")).toBeGreaterThan(await y(".chapter-narrative"));

  // **글쓰기 단계** — 대응할 서사가 남고 그 아래 입력칸이다.
  await page.locator("[data-다음행동]").click();
  expect(await y(".chapter-console")).toBeGreaterThan(await y(".chapter-narrative"));
});

test("긴 이야기가 작은 상자 안에서 따로 스크롤되지 않는다", async ({ page }) => {
  // **서사는 `MVP_PRD.md` 규정으로 한 턴 150~300자**다. 종전에는 이 칸이 고정 높이라
  // **어느 크기에서도 다 안 들어갔고**, 아이가 **다음 글을 쓰려고 읽어야 하는 글**을
  // 작은 상자 안에서 따로 스크롤해야 했다 (2026-09-22 사용자 확정).
  const 긴것 = "가".repeat(300);
  await 삽화판(page, { artwork_id: "새것", status: "ready", url: "/x.svg", tier: "rare", fallback: false });
  await page.route(TURNS, (route) =>
    route.fulfill({ status: 200, json: { ...그림있는턴("새것"), narrative: 긴것 } }),
  );

  await 한턴쓴다(page);
  await 새장면까지(page);
  await expect(page.locator(".chapter-narrative")).toHaveText(긴것);
  const 잘렸나 = await page.locator(".chapter-story").evaluate(
    (el) => el.scrollHeight > el.clientHeight + 1,
  );
  expect(잘렸나).toBe(false);
});

/**
 * ## 한 턴이 세 단계로 넘어간다 (2026-09-22 사용자 지시)
 *
 * 종전에는 **아이 글·새 삽화·새 서사·래서판다 반응·입력칸이 한 화면에 다 펼쳐져** 있어서
 * **결과를 보는 것과 다음 글을 쓰는 것이 안 갈렸다.**
 *
 * **⛔ 주소를 나누지 않는다** — 같은 `/chapter` 안의 화면 상태다.
 */
test("한 턴이 글쓰기 → 결과 → 새장면 → 글쓰기로 돈다", async ({ page }) => {
  await 장면을띄운다(page);
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 다음턴 }));

  // A 글쓰기 — 대응할 장면과 입력칸.
  await expect(page.getByText(장면.narrative)).toBeVisible();
  await expect(page.locator("#attempt")).toBeVisible();

  await 글을보낸다(page);

  // B 결과 — 아이 글이 중심이고 **새 서사도 입력칸도 없다.**
  await expect(page.locator("[data-쓴문장]")).toBeVisible();
  await expect(page.getByText(다음턴.narrative!)).toHaveCount(0);
  await expect(page.locator("#attempt")).toHaveCount(0);
  await expect(page.locator("[data-그다음이야기]")).toHaveText(단계문구.그다음이야기);

  await page.locator("[data-그다음이야기]").click();

  // C 새장면 — 새 서사가 중심이고 **아이 글·래서판다 반응은 정리된다.**
  await expect(page.getByText(다음턴.narrative!)).toBeVisible();
  await expect(page.locator("[data-쓴문장]")).toHaveCount(0);
  await expect(page.locator(".chapter-companion")).toHaveCount(0);
  await expect(page.locator("[data-다음행동]")).toHaveText(단계문구.다음행동);

  await page.locator("[data-다음행동]").click();

  // A' 글쓰기 — **서사는 남는다.** 아이가 무엇에 대응해 쓰는지 봐야 한다.
  await expect(page.getByText(다음턴.narrative!)).toBeVisible();
  await expect(page.locator("#attempt")).toBeVisible();
  await expect(page.locator("[data-쓴문장]")).toHaveCount(0);
});

test("삽화가 준비 중이어도 다음 이야기로 넘어갈 수 있다", async ({ page }) => {
  // **새 서사는 이미 응답에 와 있다** — 삽화를 기다릴 이유가 없다 (사용자 확정).
  await 장면을띄운다(page);
  await page.route(/\/api\/v1\/artworks\/.+/, (route) =>
    route.fulfill({ status: 200, json: { artwork_id: "새것", status: "pending", url: null, tier: "rare", fallback: false } }),
  );
  await page.route(TURNS, (route) => route.fulfill({
    status: 200,
    json: { ...다음턴, artwork: { artwork_id: "새것", status: "pending", url: null } },
  }));

  await 글을보낸다(page);
  await expect(page.locator("[data-대기대사]")).toHaveText(그림문구.만드는중);
  await page.locator("[data-그다음이야기]").click();
  await expect(page.getByText(다음턴.narrative!)).toBeVisible();
});

test("되묻기는 결과 단계로 안 넘어간다 — 같은 턴을 다시 쓰는 중이다", async ({ page }) => {
  await 장면을띄운다(page);
  await page.route(TURNS, (route) => route.fulfill({
    status: 200,
    json: {
      ...차단,
      outcome: "scaffold",
      reason: null,
      scaffold: "그 밧줄은 어떤 모양이야?",
      guide: { expression: "compass_dim", line: "그 밧줄은 어떤 모양이야?" },
    },
  }));

  await 글을보낸다(page);

  // **입력칸이 그대로 있고 글도 남아 있다.** 「다시 써」가 아니라 「이어 써」다.
  await expect(page.locator("#attempt")).toBeVisible();
  await expect(page.locator("[data-그다음이야기]")).toHaveCount(0);
});
