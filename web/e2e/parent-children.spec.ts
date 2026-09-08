import { expect, test, type Page } from "@playwright/test";

import type { components } from "../src/api/types.gen";
// 문구를 박지 않는다 — `docs/문구.md` 3.4·3.5 가 SSOT 다.
import {
  나이선택,
  만들기,
  목록,
  못닿음,
  재발급,
  접속코드,
  하루상한,
} from "../src/components/children-copy";
import { 폼 } from "../src/app/parents/signup/copy";

/**
 * 학부모 자녀 관리 (E-4 프론트 짝).
 *
 * **이 화면이 없으면 아이가 아예 못 들어온다** — 접속 코드가 여기서만 나온다.
 * 그래서 검사의 무게가 **「만들 수 있다」가 아니라 「코드를 잃지 않는다」·「모르고 끊지 않는다」**에 있다.
 */

type ParentMe = components["schemas"]["ParentMe"];
type ChildSummary = components["schemas"]["ChildSummary"];

const ME = "**/api/v1/parents/me";
const CHILDREN = "**/api/v1/parents/children";
const ACCESS_CODE = "**/api/v1/parents/children/*/access-code";

const 아이: ChildSummary = {
  child_id: "c-1111",
  nickname: "은빛나침반",
  age_band: 11,
  daily_cap: 5,
  played_today: false,
  last_active_at: null,
};

function 가입됨(children: ChildSummary[]): ParentMe {
  return {
    parent_id: "p-1",
    email: "parent@example.com",
    consent_at: "2026-09-08T01:00:00Z",
    children,
  };
}

/** 이미 가입된 상태로 화면을 연다. 자녀 관리는 「가입됨」 안에 붙어 있다. */
async function 관리화면(page: Page, children: ChildSummary[]) {
  await page.route(ME, (route) =>
    route.fulfill({ status: 200, json: 가입됨(children) }),
  );
  await page.goto("/parents/signup");
  await expect(page.getByText(폼.가입됨)).toBeVisible();
}

const 코드칸 = (page: Page) => page.locator("[data-접속코드]");

test("아이가 없으면 없다고 말하고 추가하라고 한다", async ({ page }) => {
  await 관리화면(page, []);

  await expect(page.getByText(목록.비었을때)).toBeVisible();
  // **빈 화면으로 두지 않는다.** 아무것도 없으면 학부모는 고장인지 빈 것인지 모른다.
  await expect(page.getByRole("button", { name: 만들기.버튼 })).toBeVisible();
});

test("목록은 오늘 썼는지와 하루 상한을 함께 보여준다", async ({ page }) => {
  await 관리화면(page, [아이, { ...아이, child_id: "c-2222", nickname: "달빛", played_today: true }]);

  await expect(page.getByText(아이.nickname)).toBeVisible();
  // **개수가 아니라 「했다/아직」이다** — 계약에 개수가 없다(`played_today` 는 참/거짓).
  await expect(page.locator("[data-오늘]").first()).toHaveText(목록.오늘아직);
  await expect(page.locator("[data-오늘]").nth(1)).toHaveText(목록.오늘썼다);

  // **상한은 말하지 않으면 없는 것과 같다.** 학부모의 핵심 불안이 도파민이다.
  await expect(page.getByText(하루상한(아이.daily_cap)).first()).toBeVisible();

  // **아이 화면 어휘가 여기 나오면 안 된다** (`용어사전.md` 9장).
  const 화면 = await page.locator("main").innerText();
  for (const 금지어 of ["카드", "장면", "탐험가", "점수", "채점", "연습"]) {
    expect(화면).not.toContain(금지어);
  }
});

test("아이를 추가하면 접속 코드가 그 자리에서 뜬다", async ({ page }) => {
  await page.route(CHILDREN, (route) =>
    route.fulfill({
      status: 201,
      json: {
        child_id: 아이.child_id,
        nickname: 아이.nickname,
        access_code: "482913",
        access_code_expires_at: "2026-09-09T01:00:00Z",
      },
    }),
  );
  await 관리화면(page, []);

  await page.getByLabel(만들기.별명).fill(아이.nickname);
  await page.getByLabel(만들기.나이).selectOption("11");
  await page.getByRole("button", { name: 만들기.버튼 }).click();

  // **평문 코드는 이 응답 한 번에만 실린다.** 서버는 해시만 저장해서 다시 못 받는다 —
  // 화면이 이걸 안 띄우면 학부모는 **재발급 말고는 방법이 없다.**
  await expect(코드칸(page)).toContainText("482913");
  await expect(코드칸(page)).toContainText(접속코드.제목);
  // **본 그 순간에 말해야 한다.** 나중에 다시 열어보려 하는 것이 실제 실패 모드다.
  await expect(코드칸(page)).toContainText(접속코드.한번만);
  // 아이 화면(3.2)이 막아주지만 **먼저 알면 아이가 그 벽을 안 만난다.**
  await expect(코드칸(page)).toContainText(접속코드.홈화면앱);
});

test("재발급 경고는 누르기 전에 보인다 — 이 화면의 유일한 되돌릴 수 없는 실수다", async ({
  page,
}) => {
  let 불렀나 = false;
  await page.route(ACCESS_CODE, (route) => {
    불렀나 = true;
    return route.fulfill({
      status: 200,
      json: { access_code: "778899", access_code_expires_at: "2026-09-09T01:00:00Z" },
    });
  });
  await 관리화면(page, [아이]);

  // **누르기 전에 보여야 한다.** 재발급이 `token_version` 을 올려 아이 태블릿이 끊긴다 —
  // 누른 뒤에 말하면 이미 끊긴 다음이다.
  await expect(page.getByText(재발급.경고)).toBeVisible();
  expect(불렀나).toBe(false);

  await page.getByRole("button", { name: 재발급.버튼 }).click();

  await expect.poll(() => 불렀나).toBe(true);
  await expect(코드칸(page)).toContainText("778899");
});

test("별명이 걸리면 무엇이 걸렸는지 말해 준다 — 아이 화면과 정반대다", async ({ page }) => {
  await page.route(CHILDREN, (route) =>
    route.fulfill({
      status: 422,
      json: {
        error: {
          code: "VALIDATION_ERROR",
          // **서버 문구는 아이 목소리다.** 이 화면은 이걸 쓰지 않는다 (`문구.md` 3.4).
          message: "그 이름은 쓸 수 없어. 다른 이름으로 지어볼래?",
          detail: { reason: "PII_DETECTED", kind: "school" },
        },
      },
    }),
  );
  await 관리화면(page, []);

  await page.getByLabel(만들기.별명).fill("한빛초등학교");
  await page.getByRole("button", { name: 만들기.버튼 }).click();

  // **학부모는 다시 지어야 하는 사람**이라 무엇이 걸렸는지 모르면
  // **같은 별명을 조금 바꿔 다시 넣는다.** 그래서 종류를 말해 준다.
  await expect(page.locator("[data-만들기실패]")).toContainText("학교 이름");

  // **서버가 준 아이 목소리 문구가 학부모 화면에 나가면 안 된다** (`문구.md` 4장 「열린 자리」).
  const 화면 = await page.locator("main").innerText();
  expect(화면).not.toContain("지어볼래");

  // 쓴 것을 지우지 않는다 — 고쳐서 다시 내는 자리다.
  await expect(page.getByLabel(만들기.별명)).toHaveValue("한빛초등학교");
});

test("추가가 못 닿으면 무엇이 안 됐는지 말한다", async ({ page }) => {
  await page.route(CHILDREN, (route) => route.abort("failed"));
  await 관리화면(page, []);

  await page.getByLabel(만들기.별명).fill("은빛나침반");
  await page.getByRole("button", { name: 만들기.버튼 }).click();

  await expect(page.locator("[data-만들기실패]")).toHaveText(못닿음.추가);
  // **「서버」가 화면에 없다** (`용어사전.md` 9장 — 읽어도 모르면 고지가 아니라 알리바이다).
  expect(await page.locator("main").innerText()).not.toContain("서버");
  // 코드가 뜨지 않았다 — 안 만들어졌는데 만들어진 것처럼 보이면 안 된다.
  await expect(코드칸(page)).toHaveCount(0);
});

test("남의 아이인지 없는 아이인지 화면에서 구분하지 않는다", async ({ page }) => {
  // 서버는 남의 자녀에도 404 를 준다(403 이 아니다).
  await page.route(ACCESS_CODE, (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "찾을 수 없어요" } },
    }),
  );
  await 관리화면(page, [아이]);

  await page.getByRole("button", { name: 재발급.버튼 }).click();

  // **구분해 보여주는 순간 「그 ID 는 존재한다」가 샌다.** 못 닿은 것과 한 문구로 묶는다.
  await expect(page.locator("[data-재발급실패]")).toHaveText(못닿음.재발급);
  const 화면 = await page.locator("main").innerText();
  for (const 새는말 of ["없는", "다른 사람", "권한", "찾을 수 없어요"]) {
    expect(화면).not.toContain(새는말);
  }
});

test("나이 선택지는 셋뿐이다 — 계약이 닫아 둔 것이다", async ({ page }) => {
  await 관리화면(page, []);

  const 나이 = page.getByLabel(만들기.나이);
  await expect(나이.locator("option")).toHaveCount(나이선택.length);
  // **「만」이 붙어야 한다** — 학부모는 학년으로 세는 습관이 있어 그냥 「11세」면 갈린다.
  for (const { 글자 } of 나이선택) {
    await expect(나이.locator("option", { hasText: 글자 })).toHaveCount(1);
  }
});
