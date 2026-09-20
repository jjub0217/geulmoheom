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
  지우기,
} from "../src/components/children-copy";
import { 학부모오류문구, 폼 } from "../src/app/parents/signup/copy";
import { 로그인 } from "../src/app/parents/login/copy";
import { 아이입장으로보낼곳 } from "../src/lib/parent-kicked";

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
/** **`access-code` 와 겹치지 않게 끝을 못 박는다** — `*` 하나면 그쪽까지 잡는다. */
const 자녀하나 = (childId: string) => `**/api/v1/parents/children/${childId}`;

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

test("첫 아이를 만들 때는 빈 목록 대신 아이 추가와 코드 받기를 먼저 보여 준다", async ({ page }) => {
  await 관리화면(page, []);

  await expect(page.getByText(폼.가입됨안내)).toBeVisible();
  await expect(page.getByText(목록.제목)).toHaveCount(0);
  await expect(page.getByRole("button", { name: 만들기.버튼 })).toBeVisible();
});

test("자녀 만들기 안내는 실제 이름도 된다고 말한다 — 별명을 지으라고 하지 않는다", async ({
  page,
}) => {
  await 관리화면(page, []);

  const 화면 = await page.locator("main").innerText();

  expect(화면).toContain(만들기.안내);

  // **⛔ 옛 안내가 돌아오면 마스킹을 꺼도 효과가 0 이다** (2026-09-10).
  // 화면이 「별명으로 지어주세요」라고 말하면 **학부모가 별명을 지어 주고 아이 이름은 책에 안 들어간다.**
  // **기술은 열렸는데 안내가 닫아 두는 상태**라 코드 어디에도 빨간불이 안 뜬다 — 그래서 여기서 막는다.
  expect(화면).not.toContain("실명");
  expect(화면).not.toContain("별명으로 지어주세요");

  // 안내와 입력칸 라벨은 모두 이름을 가리켜야 한다.
  await expect(page.getByLabel("아이 이름")).toBeVisible();
});

test("목록은 아이 정보와 접속 코드 관리만 보여준다", async ({ page }) => {
  await 관리화면(page, [아이, { ...아이, child_id: "c-2222", nickname: "달빛", played_today: true }]);

  await expect(page.locator("[data-자녀]").first()).toContainText(`${아이.nickname} · 만 11세`);
  await expect(page.getByRole("heading", { name: 재발급.제목 })).toHaveCount(2);

  // `played_today` 와 `daily_cap` 은 접속 상태도, 부모가 이 화면에서 해야 할 일도 아니다.
  // API가 코드 사용·만료·현재 로그인 상태를 주지 않으므로 화면은 상태를 추측하지 않는다.
  const 화면 = await page.locator("main").innerText();
  for (const 숨길말 of ["오늘 이야기를 썼어요", "오늘은 아직 이야기를 쓰지 않았어요", "하루에 이야기를"]) {
    expect(화면).not.toContain(숨길말);
  }

  // **아이 화면 어휘가 여기 나오면 안 된다** (`용어사전.md` 9장).
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
  await expect(코드칸(page)).toContainText(접속코드.같은주소);
});

test("재발급 경고는 누르기 전에 보인다 — 끊기는 것이 기기라 버튼 옆 한 줄이다", async ({
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

  // **3.8 의 `NOT_FOUND` 다.** 「없습니다」로 끝나야 한다 —
  // 「권한이 없습니다」로 쓰면 **「그 ID 는 존재한다」가 문구로 샌다.**
  await expect(page.locator("[data-재발급실패]")).toHaveText(학부모오류문구("NOT_FOUND"));
  const 화면 = await page.locator("main").innerText();
  for (const 새는말 of ["없는", "다른 사람", "권한", "찾을 수 없어요"]) {
    expect(화면).not.toContain(새는말);
  }
});

test("나이 선택지는 셋뿐이다 — 계약이 닫아 둔 것이다", async ({ page }) => {
  await 관리화면(page, []);

  const 나이 = page.getByLabel(만들기.나이);
  // **계약이 닫아 둔 값을 여기 다시 적는다** (`age_band ∈ {10, 11, 12}` — `types.gen.ts`).
  // **`나이선택.length` 를 읽으면 안 된다**: 선택지를 넷으로 늘려도 검사가 따라가서
  // **초록으로 지나간다** — 기대값의 출처가 대상이면 아무것도 안 재는 것이다 (축 ⑭).
  await expect(나이.locator("option")).toHaveCount(3);
  // `toHaveValues` 는 `<select>` 의 **선택된 값**을 보는 것이라 옵션 목록에는 안 맞다.
  const 값들 = await 나이
    .locator("option")
    .evaluateAll((옵션들) => 옵션들.map((o) => (o as HTMLOptionElement).value));
  expect(값들).toEqual(["10", "11", "12"]);
  // **「만」이 붙어야 한다** — 학부모는 학년으로 세는 습관이 있어 그냥 「11세」면 갈린다.
  for (const { 글자 } of 나이선택) {
    await expect(나이.locator("option", { hasText: 글자 })).toHaveCount(1);
  }
});

test("동의 시각은 자녀 접속 관리 화면에 표시하지 않는다", async ({ page }) => {
  await 관리화면(page, []);

  const 화면 = await page.locator("main").innerText();
  expect(화면).not.toContain("동의하신 날짜와 시간");
  expect(화면).not.toContain("2026년 9월 8일");
  expect(화면).not.toContain("2026-09-08T01:00:00Z");
  expect(화면).not.toContain("Z");
});

/**
 * 자녀 지우기 (E-4 후속 · COPPA · `문구.md` 3.9).
 *
 * **이 화면의 두 번째 되돌릴 수 없는 실수다.** 재발급은 기기가 끊기고 **이건 책이 사라진다** —
 * 검사의 무게가 **「지운 척하지 않는다」·「엉뚱한 아이를 안 지운다」**에 있다.
 */

const 둘 = [아이, { ...아이, child_id: "c-2222", nickname: "달빛나비" }];
const 확인창 = (page: Page) => page.locator("[data-삭제확인]");

test("지우기는 되묻는다 — 누르는 것만으로 안 지워진다", async ({ page }) => {
  let 불렀나 = false;
  await page.route(자녀하나(아이.child_id), (route) => {
    불렀나 = true;
    return route.fulfill({ status: 204, body: "" });
  });
  await 관리화면(page, [아이]);

  await page.locator("[data-자녀]").first().locator("[data-지우기]").click();

  // **누른 것만으로는 서버를 안 부른다.** 재발급(3.4)은 버튼 옆 경고로 됐지만
  // 여기는 **책이 사라져서** 창이 그 몫을 한다.
  expect(불렀나).toBe(false);
  await expect(확인창(page)).toBeVisible();

  // **무엇이 사라지는지 세어서 말한다** — 서버가 문장·그림·책·기록을 함께 지운다.
  // 「아이를 지웁니다」로 끝나면 학부모는 **책도 사라진다는 것을 지운 뒤에 안다.**
  await expect(확인창(page)).toContainText(지우기.사라진다);
  await expect(확인창(page)).toContainText(지우기.되돌릴수없다);
  await expect(확인창(page)).toContainText(지우기.기기도);
});

test("제목에 별명이 들어간다 — 목록 위치로만 구분되면 잘못 누른다", async ({ page }) => {
  await 관리화면(page, 둘);

  await page.locator("[data-자녀]").nth(1).locator("[data-지우기]").click();

  // **둘째 아이를 눌렀으면 둘째 별명이 떠야 한다.** 되돌릴 수 없는 것에는
  // **대상을 글자로 다시 쓴다.**
  await expect(확인창(page)).toContainText(지우기.제목("달빛나비"));
  await expect(확인창(page)).not.toContainText(아이.nickname);

  // **받침 없는 별명에 「을」이 붙으면 안 된다** (`문구.md` 6장 — 값이 문장에 들어가는 모양).
  expect(지우기.제목("달빛나비")).toContain("나비를");
  expect(지우기.제목(아이.nickname)).toContain("나침반을");
});

test("첫 포커스와 Esc 가 둘 다 「그대로 두기」다", async ({ page }) => {
  let 불렀나 = false;
  await page.route(자녀하나(아이.child_id), (route) => {
    불렀나 = true;
    return route.fulfill({ status: 204, body: "" });
  });
  await 관리화면(page, [아이]);

  await page.locator("[data-자녀]").first().locator("[data-지우기]").click();

  // **되돌릴 수 없는 쪽에 포커스가 앉지 않는다** — 엔터를 누르는 습관이 그대로 파기가 된다.
  await expect(page.getByRole("button", { name: 지우기.그대로둔다 })).toBeFocused();

  await page.keyboard.press("Escape");

  // **닫히는 방향이 안전한 쪽이다.** 나가기(2.3)와 같은 규칙인데 여기서 더 세다 —
  // 나가기는 다시 들어오면 되고 이것은 아무것도 안 돌아온다.
  await expect(확인창(page)).toHaveCount(0);
  expect(불렀나).toBe(false);
});

test("지운 뒤에 지웠다고 말한다 — 목록에서 사라지는 것으로 대신하지 않는다", async ({ page }) => {
  let 지워진뒤 = false;
  await page.route(자녀하나(아이.child_id), (route) => {
    지워진뒤 = true;
    return route.fulfill({ status: 204, body: "" });
  });
  // 목록은 두 번 불린다 — 처음과 지운 뒤. 지운 뒤에는 비어 있다.
  await page.route(ME, (route) =>
    route.fulfill({ status: 200, json: 가입됨(지워진뒤 ? [] : [아이]) }),
  );
  await page.goto("/parents/signup");
  await expect(page.getByText(폼.가입됨)).toBeVisible();

  await page.locator("[data-자녀]").first().locator("[data-지우기]").click();
  await page.locator("[data-지운다]").click();

  // **성공과 실패가 화면에서 구분돼야 한다** — 못 닿아서 안 지워진 것도 비슷하게 보인다.
  await expect(page.locator("[data-지웠다]")).toHaveText(지우기.지웠다(아이.nickname));
  await expect(확인창(page)).toHaveCount(0);
  await expect(page.locator("[data-자녀]")).toHaveCount(0);
});

test("못 닿으면 지운 척하지 않는다 — 창도 안 닫는다", async ({ page }) => {
  await page.route(자녀하나(아이.child_id), (route) => route.abort("failed"));
  await 관리화면(page, [아이]);

  await page.locator("[data-자녀]").first().locator("[data-지우기]").click();
  await page.locator("[data-지운다]").click();

  await expect(page.locator("[data-삭제실패]")).toHaveText(못닿음.삭제);
  // **아이 데이터가 그대로 남아 있다.** 창을 닫으면 목록이 그대로인 것을 보고
  // **왜 안 지워졌는지 모른다.**
  await expect(확인창(page)).toBeVisible();
  await expect(page.locator("[data-자녀]")).toHaveCount(1);
  await expect(page.locator("[data-지웠다]")).toHaveCount(0);
  // **「서버」가 화면에 없다** (`용어사전.md` 9장).
  expect(await page.locator("body").innerText()).not.toContain("서버");
});

test("형식 갖춘 거절은 code 로 고른다 — 아이 목소리가 새지 않는다", async ({ page }) => {
  await page.route(자녀하나(아이.child_id), (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "찾을 수 없어요" } },
    }),
  );
  await 관리화면(page, [아이]);

  await page.locator("[data-자녀]").first().locator("[data-지우기]").click();
  await page.locator("[data-지운다]").click();

  await expect(page.locator("[data-삭제실패]")).toHaveText(학부모오류문구("NOT_FOUND"));
  expect(await page.locator("body").innerText()).not.toContain("찾을 수 없어요");
});

test("지운 아이의 접속 코드가 화면에 남지 않는다", async ({ page }) => {
  let 지워진뒤 = false;
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
  await page.route(자녀하나(아이.child_id), (route) => {
    지워진뒤 = true;
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route(ME, (route) =>
    route.fulfill({ status: 200, json: 가입됨(지워진뒤 ? [] : [아이]) }),
  );
  await page.goto("/parents/signup");
  await expect(page.getByText(폼.가입됨)).toBeVisible();

  await page.getByLabel(만들기.별명).fill(아이.nickname);
  await page.getByRole("button", { name: 만들기.버튼 }).click();
  await expect(코드칸(page)).toContainText("482913");

  await page.locator("[data-자녀]").first().locator("[data-지우기]").click();
  await page.locator("[data-지운다]").click();

  // **파기된 아이의 접속 코드를 계속 띄우면 안 된다.** 「목록에 없는 코드」 자리는
  // 목록에 안 붙은 것을 조건으로 뜨는데 **지워진 아이가 정확히 그 조건에 걸린다.**
  await expect(page.locator("[data-지웠다]")).toBeVisible();
  await expect(코드칸(page)).toHaveCount(0);
});

/**
 * **⛔ 2026-09-14 회차 준비에서 나왔다** (`프리테스트_결과_2026-09-14.md` 3장 ⑩ · `문구.md` 3.11).
 *
 * **아이가 같은 기기로 들어오면 서버가 보호자 쿠키를 지운다**(`adr/0014` 결정 3).
 * **열려 있던 이 화면은 그것을 모른다** — 사용자가 **되돌릴 수 없는 삭제 확인창을 다 띄우고
 * 「지우기」를 누른 뒤에야** 403 을 만났다. 마음을 정하는 비용을 **다 치르고 나서**다.
 */

/** 처음엔 살아 있다가 **아이가 들어온 뒤**부터 403 을 준다. */
async function 아이가들어온다(page: Page) {
  let 아이가들어왔다 = false;
  await page.route(ME, (route) =>
    아이가들어왔다
      ? route.fulfill({
          status: 403,
          json: {
            code: "FORBIDDEN_ROLE",
            error: { code: "FORBIDDEN_ROLE", message: "여기는 지금 들어갈 수 없어요" },
          },
        })
      : route.fulfill({ status: 200, json: 가입됨([아이]) }),
  );
  await page.goto("/parents/signup");
  await expect(page.getByText(폼.가입됨)).toBeVisible();
  // **⚠ 「가입됨」만 기다리면 경쟁이 난다** (2026-09-15 실측 — 전체 실행에서만 빨간불이었다).
  // **`/parents/me` 를 두 곳이 부른다**: 가입 화면과 자녀 관리 패널. 「가입됨」은 앞의 것이
  // 돌아온 것일 뿐이라, **패널의 것이 아직 날아가는 중에 403 으로 뒤집으면**
  // 목록이 403 을 받아 **누르기도 전에 화면이 로그인으로 넘어간다.**
  // **자녀 줄이 보이는 것이 「패널도 200 을 받았다」**이므로 그것을 기다린다.
  await expect(page.locator("[data-자녀]").first()).toBeVisible();
  return () => {
    아이가들어왔다 = true;
  };
}

test("되돌릴 수 없는 창은 열기 전에 묻는다 — 이미 풀렸으면 아예 안 연다", async ({
  page,
}) => {
  const 들어오게한다 = await 아이가들어온다(page);
  let 지우려했나 = false;
  await page.route(자녀하나(아이.child_id), (route) => {
    지우려했나 = true;
    return route.fulfill({ status: 204, body: "" });
  });

  들어오게한다();
  await page.locator("[data-자녀]").first().locator("[data-지우기]").click();

  // **창이 안 열린다.** 열면 부모가 **마음을 정하는 비용을 다 치르고 나서** 안 된다는 말을 듣는다.
  await expect(확인창(page)).toHaveCount(0);
  expect(지우려했나).toBe(false);

  // **왜 그런지 말하는 화면으로 간다** (`문구.md` 3.11).
  await page.waitForURL(`**${아이입장으로보낼곳}`);
  await expect(page.locator("[data-안내]")).toHaveText(로그인.아이가들어왔다);
});

test("목록을 다시 부르다 풀려도 같은 곳으로 간다 — 자리마다 다르게 굴지 않는다", async ({
  page,
}) => {
  const 들어오게한다 = await 아이가들어온다(page);
  // **추가하기가 끝나면 목록을 다시 부른다.** 그 갈래에서 풀리는 경우다.
  await page.route(CHILDREN, (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: "FORBIDDEN_ROLE", message: "여기는 지금 들어갈 수 없어요" } },
    }),
  );

  들어오게한다();
  await page.getByLabel(만들기.별명).fill("새나침반");
  await page.getByRole("button", { name: 만들기.버튼 }).click();

  await page.waitForURL(`**${아이입장으로보낼곳}`);
  await expect(page.locator("[data-안내]")).toHaveText(로그인.아이가들어왔다);

  // **3.8 의 일반 문장으로 때우지 않는다** — 그 문장은 이유를 안 말한다.
  expect(await page.locator("main").innerText()).not.toContain(
    학부모오류문구("FORBIDDEN_ROLE"),
  );
});

/**
 * **401 도 같은 자리다** (`문구.md` **3.11** 의 401 절, 2026-09-15). **시간이 지나 풀린 경우**다 —
 * 종전에는 「다시 로그인해 주세요.」 **한 줄**이고 **거기서 로그인으로 가는 길이 없었다.**
 *
 * **⭐ 새 글자를 만들지 않는다.** 403 은 **원인이 시간이 아니라서** 안내를 갈았고,
 * **401 은 원인이 정말 시간이라** 3.10 기본 안내가 **이 경우를 위해 쓰인 문장**이다.
 */
test("시간이 지나 풀려도 같은 곳으로 간다 — 다만 안내는 기본 그대로다", async ({ page }) => {
  let 풀렸다 = false;
  await page.route(ME, (route) =>
    풀렸다
      ? route.fulfill({
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "다시 한 번 들어와 주세요" } },
        })
      : route.fulfill({ status: 200, json: 가입됨([아이]) }),
  );
  await page.goto("/parents/signup");
  await expect(page.getByText(폼.가입됨)).toBeVisible();
  await expect(page.locator("[data-자녀]").first()).toBeVisible();

  풀렸다 = true;
  await page.locator("[data-자녀]").first().locator("[data-지우기]").click();

  await expect(확인창(page)).toHaveCount(0);
  await page.waitForURL("**/parents/login");

  // **기본 안내 그대로다.** 여기서 새 말을 지으면 **같은 사실을 두 곳에서 다르게 쓰는 것**이 된다.
  await expect(page.locator("[data-안내]")).toHaveText(로그인.안내);
  // **아이 탓을 하지 않는다** — 아이가 들어온 것이 아니라 시간이 지난 것이다.
  expect(await page.locator("main").innerText()).not.toContain(로그인.아이가들어왔다);
  // **표식도 안 붙는다.** 붙이면 3.11 문장이 뜨고 **그건 이 경우에 거짓**이다.
  expect(new URL(page.url()).searchParams.has("child_entered")).toBe(false);
});

/**
 * **⛔ W6 14번 훑기에서 나왔다** (2026-09-15 · PM 판정).
 *
 * **부모가 이 화면에 오는 이유는 접속 코드**다. 그런데 **동의 기록과 로그아웃이 위에 있어**
 * 360×640 에서 **「아이 추가로 가는 길」이 29px 밖**이었고, **자녀가 늘수록 더 멀어진다.**
 *
 * **⛔ 재는 것은 「목록」과 「길」이지 폼 전체가 아니다** (PM). 「아이 추가하기」 버튼까지
 * 첫 화면에 넣으려 하지 마라 — **그러려면 폼을 접어야 하고 그건 이 항목이 아니다.**
 */
test("첫 화면에 자녀 목록과 아이 추가로 가는 길이 있다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await 관리화면(page, [아이]);

  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  for (const [이름, 것] of [
    ["자녀 목록", page.locator("[data-자녀]").first()],
    ["아이 추가로 가는 길", page.getByText(만들기.제목)],
  ] as const) {
    const 자리 = (await 것.boundingBox())!;
    expect(Math.round(자리.y + 자리.height), `${이름}이 첫 화면 밖이다`).toBeLessThanOrEqual(640);
  }
});
