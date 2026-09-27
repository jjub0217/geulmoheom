import { expect, test, type Locator, type Page } from "@playwright/test";

import type { components } from "../src/api/types.gen";
import { 글쓰기질문, 소개와질문, 챕터동료소개 } from "../src/components/chapter-writing";
// **문장을 여기 베껴 적지 않는다.** 2026-09-20 에 문구가 바뀌었는데 이 파일만 옛말을 들고
// 10건이 깨져 있었다 — 검사가 제품을 붙잡은 것이 아니라 **검사가 낡은 것**이었다.
import { 버튼 } from "../src/app/copy";
import { 모험문 } from "../src/app/chapter-door-copy";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/healthz")) return route.fulfill({ status: 200, json: { status: "ok" } });
    if (url.pathname === "/api/v1/chapters/current") return route.fulfill({ status: 404, json: {
      error: { code: "NO_ACTIVE_CHAPTER", message: "검사용 응답" },
    } });
    if (url.pathname === "/api/v1/events") return route.fulfill({ status: 204 });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: { error: {
      code: "UNMOCKED_API", message: "검사용 응답",
    } } });
    return url.origin === origin ? route.continue() : route.abort();
  });
});

// 제품 문구를 바꾸지 않고 사용자가 지정한 대사를 서버 응답으로 건넨다.
const 소개앞말 = "여기 이 나침반,";
/**
 * **⛔ 문장을 베껴 적지 않는다** (2026-09-22). 종전에는 여기에 **옛 소개 문장**
 * (「… 탐험가는 이제 어떻게 할까?」)이 박혀 있었고, `문구.md` 1.4b 에서 그 뒷문장을
 * 걷어낸 뒤에도 **이 파일만 옛 문장으로 화면을 띄웠다.** 그러면 제품이 「소개를
 * 되풀이하지 않는다」를 판단할 때 **글자가 달라 안 걸린다** — 검사가 **없는 결함**을
 * 만든 셈이다. **`chapter-writing.ts` 가 SSOT 이고 여기는 그것을 읽는다.**
 */
const 소개대사 = 챕터동료소개;
/**
 * **화면에 실제로 서는 말** (2026-09-23). 서버가 주는 것은 `소개대사` 하나인데,
 * **소개를 보이는 화면에서는 화면이 뒤에 행동 질문을 붙인다**(`문구.md` 1.4b).
 * **여기서 다시 잇지 않고 제품이 쓰는 값을 그대로 읽는다** — 위 주석과 같은 이유다.
 */
const 화면에서는 = 소개와질문;
const 카드: components["schemas"]["Card"] = {
  card_id: "intro-card",
  type: "discovery",
  situation: "낡은 등대 문이 반쯤 열려 있고 안쪽에서 파란 빛이 새어 나온다.",
  prompt_label: "탐험가는 어떻게 할까?",
  guide: { expression: "default", line: 소개대사 },
  today: { cards_done: 0, cap: 5 },
};
/**
 * **이 파일이 재는 것은 「처음 보는 아이」의 소개 연출**이다.
 *
 * **⛔ `first_experience_complete` 를 `false` 로 못 박는다** (2026-09-22 사용자 결정).
 * 나침반 소개는 **아이에게 한 번만** 나가고, 그 판단을 **서버가 아이별로 주는 이 값**으로
 * 한다(`문구.md` 1.4b · `app/page.tsx` `소개를보인다`). **비워 두면 「이미 끝낸 아이」로
 * 읽혀** 소개가 아예 안 나오고, 그러면 **이 파일이 재려는 것이 화면에 없다.**
 */
const 아이: components["schemas"]["ChildMe"] = {
  child_id: "intro-child",
  nickname: "등대지기",
  guide_name: null,
  first_experience_complete: false,
  today: { cards_done: 0, cap: 5, locked: false, resets_at: "2026-09-18T00:00:00+09:00" },
};

const 무대 = (page: Page) => page.locator("[data-introduction-phase]");
const 가이드 = (page: Page) => page.locator("[data-guide-phase]");
const 보이는대사 = (page: Page) => page.locator("[data-guide-typed]");
const 보이는상황 = (page: Page) => page.locator("[data-scene-typed]");
const 나침반 = (page: Page) => page.locator("[data-compass-introducing]");

/**
 * **배치된 자리.** `boundingBox()` 를 쓰지 않는다 — 그건 `transform` 까지 더해서 재기 때문이다.
 *
 * ⛔ 2026-09-21 에 이것 때문에 네 건이 깨져 있었다. 나침반이 움직인 게 아니라
 * **동료가 들어오는 연출이 아직 돌고 있었다** — `.guide-figure` 에
 * `translateY(6.83px → 1.61px)` 가 걸려 있고, 같은 조상 아래 있는 나침반의
 * `boundingBox()` 가 그 값을 같이 물고 왔다.
 *
 * ⭐ 바로 아래 주석이 재려던 것은 **「레이아웃 자리」**다. 연출로 잠깐 밀리는 것은
 * 의도된 움직임이고, 배치가 바뀌는 것은 결함이다. 둘을 가르는 것이 `offset*` 이다.
 */
const 배치자리 = (요소: Locator) =>
  요소.evaluate((e: HTMLElement) => ({
    x: e.offsetLeft, y: e.offsetTop, width: e.offsetWidth, height: e.offsetHeight,
  }));
const 응답 = (page: Page) => page.locator(".game-response");
const 입력 = (page: Page) => page.getByLabel(카드.prompt_label);

/**
 * ⚠ **아이 정보를 인자로 받는다** (2026-09-22). Playwright 는 **나중에 등록한 경로가 먼저
 * 걸리므로**, 부르는 쪽이 `/child/me` 를 먼저 덮어써도 **여기서 다시 덮여** 소용이 없었다.
 */
async function 준비(page: Page, card = 카드, 아이정보: components["schemas"]["ChildMe"] = 아이) {
  const 시작 = new Date("2026-09-17T12:00:00Z");
  await page.clock.install({ time: 시작 });
  await page.clock.pauseAt(시작);
  await page.route("**/api/v1/cards/next", (route) => route.fulfill({ status: 200, json: card }));
  await page.route("**/api/v1/child/me", (route) => route.fulfill({ status: 200, json: 아이정보 }));
  await page.goto("/");
  await expect(page.locator(".scene-card")).toBeVisible();
  await page.clock.runFor(1);
}

async function 차례까지(page: Page, phase: "prefix" | "pause" | "compass" | "rest" | "complete") {
  for (let i = 0; i < 200; i += 1) {
    if ((await 무대(page).getAttribute("data-introduction-phase")) === phase) return;
    await page.clock.runFor(50);
  }
  await expect(무대(page)).toHaveAttribute("data-introduction-phase", phase);
}

async function 글자끝까지(page: Page, target: Locator, text: string) {
  for (let i = 0; i < 200; i += 1) {
    if ((await target.textContent()) === text) return;
    await page.clock.runFor(50);
  }
  await expect(target).toHaveText(text);
}

async function 입력아직없음(page: Page) {
  await expect(응답(page)).toHaveAttribute("data-response-visible", "false");
  await expect(응답(page)).toHaveAttribute("inert", "");
  await expect(응답(page)).toHaveAttribute("aria-hidden", "true");
  await expect(입력(page)).toBeHidden();
}

async function 첫화면안(page: Page) {
  const 화면 = page.viewportSize()!;
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(화면.width);
  for (const 요소 of [
    page.locator(".scene-card"), 가이드(page), 나침반(page), 입력(page),
    page.getByRole("button", { name: 버튼.그림으로보기, exact: true }),
  ]) {
    const 자리 = (await 요소.boundingBox())!;
    expect(자리.x).toBeGreaterThanOrEqual(0);
    expect(자리.y).toBeGreaterThanOrEqual(0);
    expect(자리.x + 자리.width).toBeLessThanOrEqual(화면.width + 1);
    expect(자리.y + 자리.height).toBeLessThanOrEqual(화면.height + 1);
  }
}

for (const 하던이야기 of [false, true]) {
  test(`모험 입구는 상황 소개부터 왼쪽 위에 있고 이름과 겹치지 않는다 — ${하던이야기 ? "하던 이야기" : "새 이야기"}`, async ({ page }) => {
    await page.route("**/api/v1/chapters/current", (route) => route.fulfill(
      하던이야기
        ? { status: 200, json: { chapter_id: "intro-chapter" } }
        : { status: 404, json: { error: { code: "NO_ACTIVE_CHAPTER", message: "지금 이어갈 이야기가 없어요", detail: null } } },
    ));
    // **모험 입구는 카드를 한 번 끝낸 아이에게만 열린다** (`app/page.tsx` `첫경험완료`).
    // 이 파일의 기본 아이는 **처음 보는 아이**라 그 문이 없다 — 여기서만 끝낸 아이로 바꾼다.
    await 준비(page, 카드, { ...아이, first_experience_complete: true });
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "narrative");
    await 입력아직없음(page);

    const 문 = page.locator("[data-모험문]");
    const 이동 = 문.locator("[data-모험문버튼]");
    const 이름 = page.locator("[data-탐험가이름]");
    await expect(문).toBeVisible();
    await expect(이동).toHaveText(하던이야기 ? 모험문.하던이야기로 : 모험문.떠나기);
    await expect(이동).toHaveAttribute("href", "/chapter");
    await expect(문).toBeInViewport({ ratio: 1 });
    await expect(이름).toBeInViewport({ ratio: 1 });

    const 화면 = page.viewportSize()!;
    const 문자리 = (await 문.boundingBox())!;
    const 이름자리 = (await 이름.boundingBox())!;
    expect(문자리.x).toBeGreaterThanOrEqual(0);
    expect(문자리.x).toBeLessThan(화면.width * 0.2);
    expect(문자리.y).toBeLessThan(화면.height * 0.2);
    expect(문자리.x + 문자리.width).toBeLessThanOrEqual(이름자리.x);

    await page.clock.runFor(150);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "narrative");
    await expect(문).toBeVisible();
    await 차례까지(page, "complete");
    await page.clock.runFor(500);
    await expect(문).toBeVisible();
    await 첫화면안(page);
  });
}

for (const [width, height] of [[360, 640], [1280, 800]] as const) {
  test(`상황 소개 다음 동료가 나타나고 말을 마쳐야 글쓰기가 나타난다 — ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await 준비(page);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "narrative");
    await expect(가이드(page)).toBeHidden();
    await expect(나침반(page)).toBeHidden();
    await 입력아직없음(page);
    await expect(보이는상황(page)).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("button", { name: 카드.situation, exact: true })).toHaveAccessibleName(카드.situation);

    await page.clock.runFor(150);
    const 상황몇글자 = (await 보이는상황(page).textContent())!;
    expect(상황몇글자.length).toBeGreaterThan(0);
    expect(상황몇글자.length).toBeLessThan(카드.situation.length);
    expect(카드.situation.startsWith(상황몇글자)).toBe(true);
    await expect(가이드(page)).toBeHidden();

    await 글자끝까지(page, 보이는상황(page), 카드.situation);
    await page.clock.runFor(400);
    // 마지막 글자 직후에도 상황을 읽을 시간이 남아 있다.
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "narrative");
    await expect(가이드(page)).toBeHidden();
    await 차례까지(page, "prefix");
    await expect(가이드(page)).toBeVisible();
    await expect(나침반(page)).toBeVisible();
    await 입력아직없음(page);
    await page.evaluate(() => document.fonts.ready);
    const 말풍선 = page.locator(".game-stage__world .guide-line");
    const 처음높이 = (await 말풍선.boundingBox())!.height;
    const 높이유지 = async () => {
      expect(Math.abs((await 말풍선.boundingBox())!.height - 처음높이)).toBeLessThanOrEqual(1);
    };
    const 대화창 = page.getByRole("button", { name: 화면에서는, exact: true });
    await expect(대화창).toHaveAccessibleName(화면에서는);
    await expect(보이는대사(page)).toHaveAttribute("aria-hidden", "true");
    await page.clock.runFor(150);
    const 앞말몇글자 = (await 보이는대사(page).textContent())!;
    expect(앞말몇글자.length).toBeGreaterThan(0);
    expect(앞말몇글자.length).toBeLessThan(소개앞말.length);
    expect(소개앞말.startsWith(앞말몇글자)).toBe(true);
    await 높이유지();

    await 차례까지(page, "compass");
    await expect(보이는대사(page)).toHaveText(소개앞말);
    await expect(나침반(page)).toHaveAttribute("data-compass-introducing", "true");
    const 도착나침반 = page.locator("[data-compass-destination]");
    await expect(도착나침반).toHaveAttribute("data-compass-arrival-pending", "true");
    const 도착전자리 = await 배치자리(도착나침반);
    await page.clock.runFor(50);
    await expect(page.locator("[data-compass-arrival]")).toBeVisible();
    await page.clock.runFor(500);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "compass");
    await expect(보이는대사(page)).toHaveText(소개앞말);
    await 입력아직없음(page);
    // 복제본만 화면 위에서 움직인다. 최종 나침반의 레이아웃 자리는 전혀 바뀌지 않는다.
    expect(await 배치자리(도착나침반)).toEqual(도착전자리);
    await 높이유지();

    await 차례까지(page, "rest");
    await expect(나침반(page)).toHaveAttribute("data-compass-introducing", "false");
    await expect(도착나침반).toHaveAttribute("data-compass-arrival-pending", "false");
    await expect(page.locator("[data-compass-arrival]")).toHaveCount(0);
    await page.clock.runFor(150);
    const 뒷말몇글자 = (await 보이는대사(page).textContent())!;
    expect(뒷말몇글자.length).toBeGreaterThan(소개앞말.length);
    expect(뒷말몇글자.length).toBeLessThan(화면에서는.length);
    await 높이유지();
    await 글자끝까지(page, 보이는대사(page), 화면에서는);
    // 단락을 나눠도 공백·문장부호를 포함한 서버 문자열은 그대로 한 번만 남는다.
    expect(await 보이는대사(page).textContent()).toBe(화면에서는);
    await page.clock.runFor(400);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "rest");
    await 입력아직없음(page);
    await 높이유지();
    await 차례까지(page, "complete");
    await expect(응답(page)).toHaveAttribute("data-response-visible", "true");
    await expect(응답(page)).not.toHaveAttribute("inert", "");
    await expect(입력(page)).toBeVisible();
    await expect(입력(page)).toBeEditable();
    await page.clock.runFor(500);
    await 높이유지();
    await 첫화면안(page);
  });
}

for (const 방식 of ["click", "Enter", "Space"] as const) {
  test(`${방식}으로 현재 차례를 마쳐도 다음 차례를 건너뛰지 않는다`, async ({ page }) => {
    await 준비(page);
    const 누르기 = async (target: Locator) => {
      if (방식 === "click") await target.click();
      else {
        await target.focus();
        await target.press(방식);
      }
    };
    await page.clock.runFor(150);
    await 누르기(page.getByRole("button", { name: 카드.situation, exact: true }));
    await expect(보이는상황(page)).toHaveText(카드.situation);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "prefix");
    await 입력아직없음(page);
    const 대화창 = page.getByRole("button", { name: 화면에서는, exact: true });
    await 누르기(대화창);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "pause");
    await expect(보이는대사(page)).toHaveText(소개앞말);
    await 입력아직없음(page);
    await 누르기(대화창);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "rest");
    await 입력아직없음(page);
    await 누르기(대화창);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "complete");
    await expect(보이는대사(page)).toHaveText(화면에서는);
    await expect(입력(page)).toBeVisible();
    await page.clock.runFor(10_000);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "complete");
    await expect(나침반(page)).toHaveAttribute("data-compass-introducing", "false");
  });
}

test("글쓰기 차례가 된 뒤에는 입력과 되묻기에도 소개를 다시 시작하지 않는다", async ({ page }) => {
  await 준비(page);
  await 차례까지(page, "complete");
  await page.evaluate(() => {
    const stage = document.querySelector("[data-introduction-phase]")!;
    new MutationObserver(() => {
      if (stage.getAttribute("data-introduction-phase") !== "complete") stage.setAttribute("data-test-restarted", "true");
    }).observe(stage, { attributes: true, attributeFilter: ["data-introduction-phase"] });
  });
  await 입력(page).fill("문을 연다");
  await expect(입력(page)).toBeFocused();
  const 빛 = page.locator("[data-compass-glow]");
  const 밝기 = () => 빛.evaluate((element) => Number((element as SVGElement).style.opacity));
  const 조금 = await 밝기();
  expect(조금).toBeGreaterThan(0.3);
  await 입력(page).fill("낡은 등대 문틈으로 손전등을 비추자 계단이 보였다".repeat(3));
  expect(await 밝기()).toBeGreaterThan(조금);
  const 쓴글 = await 입력(page).inputValue();
  const 되묻기 = "문을 열 때 무엇이 보였어?";
  await page.route("**/api/v1/attempts", (route) => route.fulfill({
    status: 200,
    json: {
      outcome: "scaffold", attempt_id: "intro-scaffold", scaffold_count: 1,
      guide: { expression: "compass_dim", line: 되묻기 },
      today: { cards_done: 0, cap: 5, locked: false },
    } satisfies components["schemas"]["AttemptScaffold"],
  }));
  await page.getByRole("button", { name: 버튼.그림으로보기, exact: true }).click();
  await expect(보이는대사(page)).toHaveText(되묻기);
  await expect(입력(page)).toHaveValue(쓴글);
  await expect(입력(page)).toBeEditable();
  await expect(무대(page)).not.toHaveAttribute("data-test-restarted", "true");
  await page.clock.runFor(10_000);
  await expect(무대(page)).toHaveAttribute("data-introduction-phase", "complete");
});

test("새로고침하면 같은 장면도 상황 소개부터 다시 보여준다", async ({ page }) => {
  await 준비(page);
  await 차례까지(page, "complete");
  await page.reload();
  await expect(page.locator(".scene-card")).toBeVisible();
  await page.clock.runFor(1);
  await expect(무대(page)).toHaveAttribute("data-introduction-phase", "narrative");
  await expect(가이드(page)).toBeHidden();
  await 입력아직없음(page);
  await 차례까지(page, "compass");
  await expect(보이는상황(page)).toHaveText(카드.situation);
  await expect(보이는대사(page)).toHaveText(소개앞말);
});

/**
 * ## ⛔ 나침반 소개는 아이에게 한 번만 나간다 (2026-09-22 사용자 결정)
 *
 * **종전에는 새 카드마다 소개를 다시 보여줬다.** 서버가 **카드를 줄 때마다** 같은 첫 말을
 * 싣기 때문이다(`문구.md` 1.4b). 실기기 영상에서 **둘째·셋째 카드가 같은 소개를 되풀이**했다.
 *
 * **⭐ 새 장면 글은 그대로 한 글자씩 나온다** — 없앤 것은 **소개 말풍선**이지 장면 연출이 아니다.
 */
/**
 * ## ⛔ 나침반 소개는 아이에게 한 번만 (2026-09-22 사용자 결정 · `문구.md` 1.4b)
 *
 * **첫 카드에만 나오고 다음 카드에는 안 나온다.** 이 검사가 그 둘을 **한 판에서** 잰다.
 *
 * ⚠ **이 검사만 진짜 시계로 돈다.** 이 파일의 나머지는 `page.clock` 으로 시간을 멈춰
 * 놓고 연출 차례를 한 칸씩 밟는데, **여기서 재는 것은 연출이 아니라 「누가 무슨 말을
 * 하나」**다. 멈춘 시계에서는 `/child/me` 응답이 화면에 반영되지 않아
 * **첫 응답이 그대로 남는다**(2026-09-22 실측으로 잡았다).
 */
test("첫 카드에는 나침반 소개가 나온다", async ({ page }) => {
  await 준비(page, 카드, { ...아이, first_experience_complete: false });
  await 차례까지(page, "complete");
  await expect(page.locator(".guide-line")).toContainText(소개앞말);
});

/**
 * ## ⛔ 나침반 소개는 아이에게 한 번만 (2026-09-22 사용자 결정 · `문구.md` 1.4b)
 *
 * **위 검사와 짝이다** — 첫 카드에는 나오고, 여기서는 안 나온다.
 *
 * ⚠ **판을 하나만 쓰고 화면도 한 번만 연다.** 같은 판에서 첫 화면을 열었다 다시 열면
 * **앞 화면의 연출 상태가 말풍선에 남는다**(2026-09-22 실측). 브라우저로 직접 열면
 * 안 그렇다 — **검사가 만든 상태**이지 제품이 아니다. 그래서 **두 경우를 검사 둘로 갈랐다.**
 */
test("카드를 한 번 끝낸 아이에게는 소개 대신 질문을 한다", async ({ page }) => {
  const 다음카드 = { ...카드, card_id: "intro-next", situation: "등대 꼭대기 창문에서 바다가 보인다." };
  await 준비(page, 다음카드, { ...아이, first_experience_complete: true });
  await 차례까지(page, "complete");

  // **소개는 되풀이되지 않고**, 그 자리를 질문이 채운다.
  // ⛔ 말풍선 없는 래서판다를 만들지 않는다 (사용자 지시).
  await expect(page.locator(".guide-line")).toHaveText(글쓰기질문);
  await expect(page.locator(".guide-line")).not.toContainText(소개앞말);
  await expect(page.locator("[data-guide-phase]")).toBeVisible();
});

/**
 * **⛔ 2026-09-23 에 기대를 바꿨다** (사용자 지시). 종전 이름은 **「움직임 줄이기는 글자를
 * 즉시 보여주되 화면 등장 순서를 지킨다」**였고, **단계마다 기다리는 것**을 확인했다 —
 * 서사 뒤 600ms · 나침반 앞뒤 600+200+220ms · 말풍선 뒤 800ms.
 *
 * **왜 바꿨나** — 사용자가 **「등장 순서만 논리적으로 유지하고, 단계 사이의 인위적인
 * 대기시간은 두지 말라」**고 정했다. **글자 효과만 끄고 기다림을 남겨 두면**, 움직임에
 * 예민한 아이가 얻는 것이 없다. 실측으로 **첫 튜토리얼 2,420ms · 본편 1,400ms** 였다.
 *
 * **⛔ 기대를 약하게 만들지 않았다.** 종전이 확인하던 **순서**를 그대로 확인한다 —
 * 다만 **시계를 돌려 가며 보는 대신 단계가 바뀐 자취를 남겨서** 본다. 0 지연이라
 * 세 단계가 **같은 시각에** 지나가므로, 시계로는 원래 볼 수 없는 것이 됐다.
 * **더해진 기대 둘** — ① 자취가 정확히 `narrative → rest → complete` 일 것
 * (**`prefix` 를 안 거친다** = 말풍선이 반쯤 찬 채로는 안 보인다)
 * ② **시계를 1 밀리초만 돌려도 입력칸까지 온다** (= 인위적 대기 0).
 */
test("움직임 줄이기는 기다림 없이 서사 → 래서판다·말풍선 → 입력 순서로 지난다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // **⛔ `준비` 를 안 쓴다.** 그 도우미는 **마지막에 시계를 1 밀리초 민다.** 0 지연이라
  // 그 한 번에 첫 단계가 지나가 버려서, **`narrative` 를 볼 기회가 사라진다.**
  // 여기서는 **시계를 직접 한 칸씩** 밀며 단계를 읽는 것이 검사의 내용 자체다.
  const 시작 = new Date("2026-09-17T12:00:00Z");
  await page.clock.install({ time: 시작 });
  await page.clock.pauseAt(시작);
  await page.route("**/api/v1/cards/next", (route) => route.fulfill({ status: 200, json: 카드 }));
  await page.route("**/api/v1/child/me", (route) => route.fulfill({ status: 200, json: 아이 }));
  await page.goto("/");
  await expect(page.locator(".scene-card")).toBeVisible();

  // **시계를 1 밀리초씩 밀며 지나간 단계를 모은다.**
  // **가짜 시계에서는 0 밀리초 타이머가 한 번에 한 칸씩** 풀리므로, 세는 것은
  // **「몇 칸인가」이지 「몇 밀리초를 기다리나」가 아니다.**
  // **종전 코드였다면 2,420 밀리초를 밀어야 했다.**
  const 자취: string[] = [];
  let 민밀리초 = 0;
  for (; 민밀리초 < 20; 민밀리초 += 1) {
    const 단계 = await 무대(page).getAttribute("data-introduction-phase");
    if (단계 !== null && 자취[자취.length - 1] !== 단계) 자취.push(단계);
    if (단계 === "complete") break;
    await page.clock.runFor(1);
  }

  // **① 순서는 그대로다.** 서사 → (래서판다·완성된 말풍선) → 입력칸.
  // **`prefix` 가 없다** — 그 단계는 **말풍선의 앞부분만** 보여 주는 자리인데,
  // 사용자가 정한 순서는 **「완성된 말풍선」**이다 (2026-09-23).
  expect(자취).toEqual(["narrative", "rest", "complete"]);

  // **② 기다림이 없다.**
  expect(민밀리초, "움직임을 줄였는데 단계 사이에 기다림이 남아 있다").toBeLessThanOrEqual(5);

  // **③ 세 가지가 다 제자리에 있다.**
  await expect(보이는상황(page)).toHaveText(카드.situation);
  await expect(보이는대사(page)).toHaveText(화면에서는);
  await expect(가이드(page)).toBeVisible();
  await expect(입력(page)).toBeVisible();

  // **④ 글자와 나침반에 움직임이 없다.**
  expect(await page.locator(".compass-intro-light, .compass-needle").evaluateAll((elements) =>
    elements.every((element) => getComputedStyle(element).animationName === "none"),
  )).toBe(true);
});

test("완료 뒤 움직임 설정을 바꿔도 소개를 다시 시작하지 않는다", async ({ page }) => {
  await 준비(page);
  await 차례까지(page, "complete");
  await 입력(page).fill("등대로 간다");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.runFor(2_000);
  await expect(무대(page)).toHaveAttribute("data-introduction-phase", "complete");
  await expect(입력(page)).toHaveValue("등대로 간다");
  await expect(입력(page)).toBeFocused();
});

test("예전에 저장된 소개 기록이 있어도 화면의 차례를 생략하지 않는다", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("geulmoheom:compass-introduction:v1", "seen");
    sessionStorage.setItem("geulmoheom:compass-introduction:v2", "seen");
    sessionStorage.setItem("geulmoheom:scene-introduction:v2", '["intro-card"]');
  });
  await 준비(page);
  await expect(무대(page)).toHaveAttribute("data-introduction-phase", "narrative");
  await expect(가이드(page)).toBeHidden();
  await 입력아직없음(page);
  await 차례까지(page, "compass");
  await expect(보이는대사(page)).toHaveText(소개앞말);
});

test("다른 서버 대사는 상황 뒤 그대로 읽고 나침반 소개를 끼워 넣지 않는다", async ({ page }) => {
  const 다른대사 = "나침반이 조용하네. 네가 뭘 할지 말해주면 움직일 거야!";
  await 준비(page, { ...카드, guide: { expression: "default", line: 다른대사 } });
  await page.getByRole("button", { name: 카드.situation, exact: true }).click();
  await expect(무대(page)).toHaveAttribute("data-introduction-phase", "rest");
  await expect(가이드(page)).toBeVisible();
  await 입력아직없음(page);
  await page.clock.runFor(150);
  const 일부 = (await 보이는대사(page).textContent())!;
  expect(일부.length).toBeGreaterThan(0);
  expect(일부.length).toBeLessThan(다른대사.length);
  expect(다른대사.startsWith(일부)).toBe(true);
  await expect(나침반(page)).toHaveAttribute("data-compass-introducing", "false");
  await 차례까지(page, "complete");
  await expect(보이는대사(page)).toHaveText(다른대사);
  expect(await 보이는대사(page).textContent()).toBe(다른대사);
  await expect(입력(page)).toBeVisible();
});
