import { expect, test, type Locator, type Page } from "@playwright/test";

import type { components } from "../src/api/types.gen";

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
const 소개대사 = `${소개앞말} 네가 이야기를 쓰면 반짝여. 탐험가는 이제 어떻게 할까?`;
const 카드: components["schemas"]["Card"] = {
  card_id: "intro-card",
  type: "discovery",
  situation: "낡은 등대 문이 반쯤 열려 있고 안쪽에서 파란 빛이 새어 나온다.",
  prompt_label: "탐험가는 어떻게 할까?",
  guide: { expression: "default", line: 소개대사 },
  today: { cards_done: 0, cap: 5 },
};
const 아이: components["schemas"]["ChildMe"] = {
  child_id: "intro-child",
  nickname: "등대지기",
  guide_name: null,
  today: { cards_done: 0, cap: 5, locked: false, resets_at: "2026-09-18T00:00:00+09:00" },
};

const 무대 = (page: Page) => page.locator("[data-introduction-phase]");
const 가이드 = (page: Page) => page.locator("[data-guide-phase]");
const 보이는대사 = (page: Page) => page.locator("[data-guide-typed]");
const 보이는상황 = (page: Page) => page.locator("[data-scene-typed]");
const 나침반 = (page: Page) => page.locator("[data-compass-introducing]");
const 응답 = (page: Page) => page.locator(".game-response");
const 입력 = (page: Page) => page.getByLabel(카드.prompt_label);

async function 준비(page: Page, card = 카드) {
  const 시작 = new Date("2026-09-17T12:00:00Z");
  await page.clock.install({ time: 시작 });
  await page.clock.pauseAt(시작);
  await page.route("**/api/v1/cards/next", (route) => route.fulfill({ status: 200, json: card }));
  await page.route("**/api/v1/child/me", (route) => route.fulfill({ status: 200, json: 아이 }));
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
    page.getByRole("button", { name: "보내기", exact: true }),
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
    await 준비(page);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "narrative");
    await 입력아직없음(page);

    const 문 = page.locator("[data-모험문]");
    const 이동 = 문.locator("[data-모험문버튼]");
    const 이름 = page.locator("[data-탐험가이름]");
    await expect(문).toBeVisible();
    await expect(이동).toHaveText(하던이야기 ? "계속하기" : "모험 떠나기");
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
    const 대화창 = page.getByRole("button", { name: 소개대사, exact: true });
    await expect(대화창).toHaveAccessibleName(소개대사);
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
    const 도착전자리 = await 도착나침반.boundingBox();
    await page.clock.runFor(50);
    await expect(page.locator("[data-compass-arrival]")).toBeVisible();
    await page.clock.runFor(500);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "compass");
    await expect(보이는대사(page)).toHaveText(소개앞말);
    await 입력아직없음(page);
    // 복제본만 화면 위에서 움직인다. 최종 나침반의 레이아웃 자리는 전혀 바뀌지 않는다.
    expect(await 도착나침반.boundingBox()).toEqual(도착전자리);
    await 높이유지();

    await 차례까지(page, "rest");
    await expect(나침반(page)).toHaveAttribute("data-compass-introducing", "false");
    await expect(도착나침반).toHaveAttribute("data-compass-arrival-pending", "false");
    await expect(page.locator("[data-compass-arrival]")).toHaveCount(0);
    await page.clock.runFor(150);
    const 뒷말몇글자 = (await 보이는대사(page).textContent())!;
    expect(뒷말몇글자.length).toBeGreaterThan(소개앞말.length);
    expect(뒷말몇글자.length).toBeLessThan(소개대사.length);
    await 높이유지();
    await 글자끝까지(page, 보이는대사(page), 소개대사);
    // 단락을 나눠도 공백·문장부호를 포함한 서버 문자열은 그대로 한 번만 남는다.
    expect(await 보이는대사(page).textContent()).toBe(소개대사);
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
    const 대화창 = page.getByRole("button", { name: 소개대사, exact: true });
    await 누르기(대화창);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "pause");
    await expect(보이는대사(page)).toHaveText(소개앞말);
    await 입력아직없음(page);
    await 누르기(대화창);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "rest");
    await 입력아직없음(page);
    await 누르기(대화창);
    await expect(무대(page)).toHaveAttribute("data-introduction-phase", "complete");
    await expect(보이는대사(page)).toHaveText(소개대사);
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
  await page.getByRole("button", { name: "보내기", exact: true }).click();
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

test("새 장면에서는 상황과 나침반 소개를 다시 차례대로 보여준다", async ({ page }) => {
  await 준비(page);
  await 차례까지(page, "complete");
  const 다음카드 = { ...카드, card_id: "intro-next", situation: "등대 꼭대기 창문에서 바다가 보인다." };
  await page.route("**/api/v1/cards/next", (route) => route.fulfill({ status: 200, json: 다음카드 }));
  await page.reload();
  await expect(page.locator(".scene-card")).toBeVisible();
  await page.clock.runFor(1);
  await expect(무대(page)).toHaveAttribute("data-introduction-phase", "narrative");
  await 입력아직없음(page);
  await 차례까지(page, "compass");
  await expect(보이는상황(page)).toHaveText(다음카드.situation);
  await expect(보이는대사(page)).toHaveText(소개앞말);
  await expect(나침반(page)).toHaveAttribute("data-compass-introducing", "true");
});

test("움직임 줄이기는 글자를 즉시 보여주되 화면 등장 순서를 지킨다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await 준비(page);
  await expect(보이는상황(page)).toHaveText(카드.situation);
  await expect(무대(page)).toHaveAttribute("data-introduction-phase", "narrative");
  await expect(가이드(page)).toBeHidden();
  await 입력아직없음(page);
  await 차례까지(page, "prefix");
  await expect(가이드(page)).toBeVisible();
  await expect(보이는대사(page)).toHaveText(소개앞말);
  await 입력아직없음(page);
  await 차례까지(page, "compass");
  expect(await page.locator(".compass-intro-light, .compass-needle").evaluateAll((elements) =>
    elements.every((element) => getComputedStyle(element).animationName === "none"),
  )).toBe(true);
  await 차례까지(page, "rest");
  await expect(보이는대사(page)).toHaveText(소개대사);
  await 입력아직없음(page);
  await 차례까지(page, "complete");
  await expect(입력(page)).toBeVisible();
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
