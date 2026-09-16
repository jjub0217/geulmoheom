import { expect, test, type Page } from "@playwright/test";

import type { paths } from "../src/api/types.gen";
// 문구를 문자열로 박지 않는다 — `docs/문구.md` 1.18 이 SSOT 다.
import { 턴문구 } from "../src/components/turn-copy";
import { 버튼 } from "../src/app/copy";

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
