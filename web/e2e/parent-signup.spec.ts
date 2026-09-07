import { expect, test, type Page } from "@playwright/test";

import type { components } from "../src/api/types.gen";

/**
 * 보호자 가입·동의 화면 (E-4 프론트 몫).
 *
 * **여기 있는 검사 둘이 COPPA 동의의 핵심이다** — 「둘 다 미리 체크돼 있지 않다」와
 * 「라벨링을 거부해도 제출된다」. 나중에 누가 전환율을 이유로 기본 체크를 켜려 하면
 * **이 테스트가 막는다.** 규칙을 문서에만 적어두면 아무도 안 막는다.
 */

type SignupResponse = components["schemas"]["SignupResponse"];

const ME = "**/api/v1/parents/me";
const SIGNUP = "**/api/v1/parents/signup";

const 가입됨: SignupResponse = {
  parent_id: "11111111-0000-4000-8000-000000000001",
  consent_at: "2026-09-07T09:00:00Z",
};

/** 아직 안 들어온 상태. 이 화면의 정상 출발점이다. */
async function 로그아웃상태(page: Page) {
  await page.route(ME, (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "다시 한 번 들어와 주세요" } },
    }),
  );
}

test("동의 둘 중 어느 것도 미리 체크돼 있지 않다", async ({ page }) => {
  await 로그아웃상태(page);
  await page.goto("/parents/signup");

  const 필수 = page.locator('input[name="consent"]');
  const 선택 = page.locator('input[name="labeling_consent"]');

  await expect(필수).not.toBeChecked();
  await expect(선택).not.toBeChecked();

  // 동의를 **받는** 화면이지 통과시키는 화면이 아니다. 필수를 안 누르면 보낼 수 없다.
  const 가입하기 = page.getByRole("button", { name: "가입하기" });
  await page.getByLabel("이메일").fill("parent@example.com");
  await page.getByLabel("비밀번호").fill("pw12345678");
  await expect(가입하기).toBeDisabled();

  await 필수.check();
  await expect(가입하기).toBeEnabled();
});

test("라벨링을 거부해도 가입된다 — 별개 필드로 나간다", async ({ page }) => {
  await 로그아웃상태(page);
  await page.goto("/parents/signup");

  let 보낸것: Record<string, unknown> = {};
  await page.route(SIGNUP, (route) => {
    보낸것 = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: 가입됨 });
  });

  await page.getByLabel("이메일").fill("parent@example.com");
  await page.getByLabel("비밀번호").fill("pw12345678");
  await page.locator('input[name="consent"]').check();
  // 라벨링은 건드리지 않는다 — 거부한 상태 그대로 보낸다.
  await page.getByRole("button", { name: "가입하기" }).click();

  await expect(page.getByText("가입됐습니다")).toBeVisible();
  expect(보낸것.consent).toBe(true);
  // **하나로 묶이지 않았다.** 묶여 있으면 여기서 true 가 되거나 필드 자체가 없다.
  expect(보낸것.labeling_consent).toBe(false);
});

test("라벨링에 동의하면 그 값만 따로 올라간다", async ({ page }) => {
  await 로그아웃상태(page);
  await page.goto("/parents/signup");

  let 보낸것: Record<string, unknown> = {};
  await page.route(SIGNUP, (route) => {
    보낸것 = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: 가입됨 });
  });

  await page.getByLabel("이메일").fill("parent@example.com");
  await page.getByLabel("비밀번호").fill("pw12345678");
  await page.locator('input[name="consent"]').check();
  await page.locator('input[name="labeling_consent"]').check();
  await page.getByRole("button", { name: "가입하기" }).click();

  await expect(page.getByText("가입됐습니다")).toBeVisible();
  expect(보낸것.labeling_consent).toBe(true);
});

test("어디로 가고 얼마나 남는지를 화면에 적는다 — 링크 뒤에 숨기지 않는다", async ({
  page,
}) => {
  await 로그아웃상태(page);
  await page.goto("/parents/signup");

  // **폼이 뜬 뒤에 읽는다.** 3상태라 첫 프레임은 「확인하는 중…」이고,
  // 기다리지 않으면 그 화면을 읽고 「고지가 없다」고 잘못 말한다.
  await expect(page.getByRole("button", { name: "가입하기" })).toBeVisible();

  const 화면 = await page.locator("main").innerText();

  // PRD E-4 MUST 셋. 문구가 바뀌어도 **이 사실들은 화면에 남아야 한다.**
  expect(화면).toContain("Google Gemini API");
  expect(화면).toContain("학습에는 쓰이지 않습니다");
  expect(화면).toContain("제한된 기간 보관");
  expect(화면).toContain("전송 전에 걸러집니다");
  // 없으면 「체크 안 하면 기능이 줄어드나」 하고 그냥 누른다.
  expect(화면).toContain("거부해도 모든 기능을 그대로 쓸 수 있습니다");

  // **「AI 학습」이라고 쓰지 않는다.** 학부모의 핵심 불안(「AI 가 대신 써준다」)을 정면으로 부른다.
  expect(화면).not.toContain("AI 학습");

  // **아이 화면이 아니다.** 여기에 아이 화면 어휘가 나오면 진지함이 깎인다
  // (`docs/용어사전.md` — 「탐험가」·「모험」은 아이 화면 열, 「점수」류는 금지어).
  for (const 안쓰는말 of ["탐험가", "나침반", "점수", "채점", "연습", "보스", "앨범"]) {
    expect(화면).not.toContain(안쓰는말);
  }
});

test("확인 중에는 가입 폼을 그리지 않는다 — 2상태면 여기서 깜빡인다", async ({
  page,
}) => {
  let 응답하기: (() => void) | null = null;
  await page.route(ME, async (route) => {
    await new Promise<void>((resolve) => {
      응답하기 = resolve;
    });
    return route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "다시 한 번 들어와 주세요" } },
    });
  });

  await page.goto("/parents/signup");

  await expect(page.getByText("확인하는 중…")).toBeVisible();
  await expect(page.getByRole("button", { name: "가입하기" })).toHaveCount(0);

  await expect.poll(() => 응답하기 !== null).toBe(true);
  응답하기!();
  await expect(page.getByRole("button", { name: "가입하기" })).toBeVisible();
});

test("자녀 쿠키로 들어오면 다시 가입시키지 않는다 — 403 은 역할 문제다", async ({
  page,
}) => {
  await page.route(ME, (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: "FORBIDDEN_ROLE",
          message: "여기는 지금 들어갈 수 없어요",
        },
      },
    }),
  );

  await page.goto("/parents/signup");

  // 서버가 준 문구를 그대로 보여준다. **가입 폼으로 되돌리지 않는다** —
  // 로그인이 풀린 게 아니라 역할이 다른 것이다.
  await expect(page.getByText("여기는 지금 들어갈 수 없어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "가입하기" })).toHaveCount(0);
});
