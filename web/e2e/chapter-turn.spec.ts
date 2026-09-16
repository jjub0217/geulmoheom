import { expect, test, type Page } from "@playwright/test";

import type { paths } from "../src/api/types.gen";
// 문구를 문자열로 박지 않는다 — `docs/문구.md` 1.18 이 SSOT 다.
import { 턴문구 } from "../src/components/turn-copy";
import { 버튼, 못닿음 } from "../src/app/copy";

/**
 * 챕터 턴 화면(A-3 · W7 **7번**)의 완료 조건 둘을 본다 —
 * **선택지를 고르고도, 직접 써서도 턴이 넘어간다.**
 *
 * **문장은 전부 지어낸 것이다.** 실제 아이 문장을 테스트에 넣지 않는다.
 *
 * **⛔ 목의 고정값에 기대지 않는다** — `narrative`·선택지 라벨·`grade` 는 **A-1 이 서면
 * GM 것으로 바뀐다**(백엔드). 여기서는 **우리가 준 값이 화면에 그려지는지**만 본다.
 */
type ChapterView =
  paths["/api/v1/chapters/current"]["get"]["responses"][200]["content"]["application/json"];
type TurnResult =
  paths["/api/v1/turns"]["post"]["responses"][200]["content"]["application/json"];

const CURRENT = "**/api/v1/chapters/current";
const TURNS = "**/api/v1/turns";

/**
 * **경로가 섞인 선택지다** — 「① 싸운다 ② 말을 건다 ③ 살펴본다 ④ 달랜다」로 두지 않는다.
 * **경로를 나열하면 쓰기가 고르기로 바뀐다**(챕터 뼈대). 목이 일부러 그렇게 준다.
 * **개수도 넷이 아니다** — 넷으로 박으면 4칸 그리드가 몰래 들어와도 안 걸린다.
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
  grade: "G2",
  bonus: 0,
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

test("선택지를 골라서 턴이 넘어간다", async ({ page }) => {
  await 장면을띄운다(page);

  let 보낸것: unknown = null;
  await page.route(TURNS, (route) => {
    보낸것 = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: 다음턴 });
  });

  await page.getByRole("button", { name: 장면.choices[1].label }).click();

  await expect(page.getByText(다음턴.narrative!)).toBeVisible();

  // **⛔ `choice_id` 와 `text` 중 정확히 하나다** — 둘 다 보내면 422 다.
  // **라벨이 아니라 `id` 를 보낸다.**
  expect(보낸것).toEqual({
    chapter_id: 장면.chapter_id,
    choice_id: 장면.choices[1].id,
  });
});

test("직접 써서 턴이 넘어간다", async ({ page }) => {
  await 장면을띄운다(page);

  let 보낸것: unknown = null;
  await page.route(TURNS, (route) => {
    보낸것 = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: 다음턴 });
  });

  const 문장 = "밧줄 매듭을 하나씩 만져 보며 어느 쪽이 새것인지 살핀다";
  await page.getByRole("textbox").fill(문장);
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  await expect(page.getByText(다음턴.narrative!)).toBeVisible();

  expect(보낸것).toEqual({ chapter_id: 장면.chapter_id, text: 문장 });
});

/**
 * **1.18 의 급소를 화면에서 잰다.** 문구 파일이 맞아도 **자리가 틀리면 안 고쳐진다** —
 * W6 12번에서 겪은 그대로다(문구를 내렸는데 거절이 폼을 치워 안 보였다).
 */
test("선택지와 직접 쓰기가 같은 무게다 — 자리·크기로 잰다", async ({ page }) => {
  await 장면을띄운다(page);

  // **「아니면」 줄은 선택지 아래다.** 위에 오면 가리킬 것이 아직 없다.
  const 유도 = page.getByText(턴문구.직접쓰기유도);
  await expect(유도).toBeVisible();

  const 마지막선택지 = page.getByRole("button", {
    name: 장면.choices[장면.choices.length - 1].label,
  });
  const 선택지상자 = await 마지막선택지.boundingBox();
  const 유도상자 = await 유도.boundingBox();
  expect(선택지상자!.y).toBeLessThan(유도상자!.y);

  // **선택지를 흐리게·작게 두지 않는다.** 글자 크기가 입력창과 같아야 한다.
  const 글자크기 = (칸: string) =>
    page.evaluate(
      (s) => getComputedStyle(document.querySelector(s)!).fontSize,
      칸,
    );
  expect(await 글자크기("main li button")).toBe(await 글자크기("main textarea"));

  // **4칸 고정 그리드가 아니다.** 선택지가 셋인데 칸이 넷이면 빈 칸이 생긴다.
  await expect(page.locator("main li")).toHaveCount(장면.choices.length);

  // 아이 화면 금지어 (`용어사전.md` 8장).
  const 화면 = await page.locator("main").innerText();
  for (const 금지어 of ["점수", "채점", "연습", "학습", "보스", "앨범", "등급"]) {
    expect(화면).not.toContain(금지어);
  }
});

/** 차단. **200 이고 정상 응답이다** — `outcome` 으로 가른다(2026-09-16 계약 정정). */
const 차단: TurnResult = {
  outcome: "blocked",
  reason: "moderation",
  turn: 장면.turn,
  beat: "intro",
  grade: null,
  bonus: 0,
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
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  // **① 서버가 준 가이드 그대로.** 표정도 대사도 프론트가 안 고른다.
  await expect(page.getByText(차단.guide!.line)).toBeVisible();
  await expect(page.locator(`img[src="/guide/${차단.guide!.expression}.png"]`)).toBeVisible();

  // **② 아이 글이 그대로 남아 있다 — 이 줄이 148행이다.**
  await expect(page.getByRole("textbox")).toHaveValue(문장);

  // **③ 오류 화면이 아니다.** 못 닿음 문구가 뜨면 아이는 서버가 고장 난 줄 안다.
  await expect(page.getByText(못닿음.보내기)).toHaveCount(0);

  // **④ 선택지가 그대로다** — 차단은 턴을 안 먹는다.
  await expect(page.locator("main li")).toHaveCount(장면.choices.length);
});

test("되묻기도 아이 글을 지우지 않는다 — 고쳐 쓰라는 말이다", async ({ page }) => {
  await 장면을띄운다(page);
  const 되묻기: TurnResult = {
    ...차단,
    outcome: "scaffold",
    reason: null,
    grade: "G0",
    scaffold: "그 밧줄은 어떤 모양이야?",
    guide: { expression: "compass_dim", line: "그 밧줄은 어떤 모양이야?" },
  };
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 되묻기 }));

  const 문장 = "밧줄을 본다";
  await page.getByRole("textbox").fill(문장);
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  await expect(page.getByText(되묻기.guide!.line)).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue(문장);
});

/**
 * **⛔ 액자를 비우지 않는다** — 핵심 씬이 1턴·9턴 둘뿐이라 **여덟 턴은 `artwork` 가 없다.**
 * 비우면 **여덟 턴 중 일곱에서 보상이 사라진다.**
 */
test("새 그림이 안 와도 액자가 안 비워진다", async ({ page }) => {
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
  await page.getByRole("button", { name: 장면.choices[0].label }).click();
  await expect(page.getByText(다음턴.narrative!)).toBeVisible();

  // **직전 그림이 그대로 걸려 있다.**
  await expect(액자).toBeVisible();
});

test("완결하면 가이드가 말하고 「이어서 더 하기」가 없다", async ({ page }) => {
  await 장면을띄운다(page);
  const 완결: TurnResult = {
    ...다음턴,
    chapter_done: true,
    guide: { expression: "session_end", line: "여기서 한 장이 끝났어. 네 책에 들어갔어." },
  };
  await page.route(TURNS, (route) => route.fulfill({ status: 200, json: 완결 }));

  await page.getByRole("button", { name: 장면.choices[0].label }).click();

  await expect(page.getByText(완결.guide!.line)).toBeVisible();

  // **⛔ 없는 것이 결정이다** (D-1 · 페르소나 7.1). Auto-play·무한 스크롤 금지.
  const 화면 = await page.locator("main").innerText();
  for (const 금지 of ["이어서", "더 하기", "계속하기", "한 판 더"]) {
    expect(화면).not.toContain(금지);
  }
  // 쓰는 칸도 없다 — 끝났는데 칸이 남으면 **끝난 것으로 안 읽힌다.**
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

/**
 * **⛔ 첫 화면 규칙** (W6 14번 판정 · `주차계획/W7.md` 8번 ④).
 *
 * **「그 화면에 온 사람이 해야 할 일은 첫 화면에 있어야 한다.」**
 * 챕터 화면에서 아이가 해야 할 일은 **고르거나 쓰는 것**이다. 그 둘이 밖에 있으면
 * **아이에게는 없는 것**이다.
 *
 * **⚠ 왜 `toBeVisible()` 로 안 때우나** — `click()` 과 `toBeVisible()` 이 **자동으로
 * 스크롤한다.** 그래서 「있다」는 초록인데 **아이는 스크롤을 안 한다.**
 * W6 에서 `toBeVisible()` **134곳이 「내 책이 화면 밖」을 하나도 못 잡았고**,
 * **아이 셋이 다 못 열고서야** 나왔다. **여기서는 좌표를 재고 `scrollY === 0` 을 같이 본다.**
 *
 * **⛔ 서사를 길게 준다 — 이것이 이 검사의 요점이다.**
 * 목·가짜는 **160자쯤**을 주는데 **실제 GM 은 150~300자**다(PRD 4.1 · 백엔드 확인).
 * **짧은 서사로 자리를 맞추면 긴 서사가 오는 날 입력창이 접힌다** — 그날은
 * **아이가 쓸 칸을 못 찾는 날**이고, 우리는 그때 처음 안다.
 */
const 긴서사 = "".padEnd(0) +
  "시계탑 꼭대기로 오르는 나선 계단은 한 칸씩 높이가 달라서 발끝으로 더듬어야 했다. " +
  "벽을 따라 늘어선 촛대에는 초가 없고, 대신 마른 넝쿨이 손목 굵기로 얽혀 창틀까지 뻗어 있다. " +
  "위쪽 어딘가에서 쇠가 쇠를 긁는 소리가 일정한 간격으로 내려오는데, 그 사이사이에 " +
  "숨을 고르는 것 같은 낮은 소리가 섞인다. 난간을 짚자 손바닥에 서늘한 물기가 묻어났다.";

for (const [폭, 높이, 어디] of [
  [1024, 768, "iPad 가로 — 아이 셋이 이렇게 들었다"],
  [1280, 800, "검사 기본 뷰포트"],
  [390, 844, "폰 세로"],
  // **가장 좁은 것 하나.** 그게 통과하면 위는 따라온다 — W6 에서 이 크기만 빨갰다.
  [360, 640, "작은 안드로이드 — 주소창까지 있으면 이 정도다"],
] as const) {
  test(`쓸 자리가 첫 화면 안에 있다 — 긴 서사에서도 · ${폭}×${높이} (${어디})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 폭, height: 높이 });
    await page.route(CURRENT, (route) =>
      route.fulfill({ status: 200, json: { ...장면, narrative: 긴서사 } }),
    );
    await page.goto("/chapter");
    await expect(page.getByText(긴서사)).toBeVisible();

    // **아이가 안 한 것을 검사도 안 한다.** 이 줄이 없으면 위의 `toBeVisible` 이
    // 이미 스크롤시켜 둔 화면을 재게 된다.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    for (const [이름, 자리] of [
      ["첫 선택지", await page.locator("main li button").first().boundingBox()],
      ["쓰는 칸", await page.locator("main textarea").boundingBox()],
      ["보내기", await page.getByRole("button", { name: 버튼.보내기 }).boundingBox()],
    ] as const) {
      expect(
        Math.round(자리!.y + 자리!.height),
        `${이름}이 첫 화면 밖이다 (${폭}×${높이})`,
      ).toBeLessThanOrEqual(높이);
    }
  });
}
