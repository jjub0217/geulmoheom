import { expect, test, type Page } from "@playwright/test";
// 문구를 박지 않는다 — `docs/문구.md` 3.1·3.5·3.6 이 SSOT 다.
import { 상태표시 } from "../src/app/status-copy";
import { 고지, 못닿음, 학부모오류문구, 폼 } from "../src/app/parents/signup/copy";

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
const LOGOUT = "**/api/v1/parents/logout";

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
  const 가입하기 = page.getByRole("button", { name: 폼.가입하기 });
  await page.getByLabel(폼.이메일).fill("parent@example.com");
  await page.getByLabel(폼.비밀번호).fill("pw12345678");
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

  await page.getByLabel(폼.이메일).fill("parent@example.com");
  await page.getByLabel(폼.비밀번호).fill("pw12345678");
  await page.locator('input[name="consent"]').check();
  // 라벨링은 건드리지 않는다 — 거부한 상태 그대로 보낸다.
  await page.getByRole("button", { name: 폼.가입하기 }).click();

  await expect(page.getByText(폼.가입됨)).toBeVisible();
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

  await page.getByLabel(폼.이메일).fill("parent@example.com");
  await page.getByLabel(폼.비밀번호).fill("pw12345678");
  await page.locator('input[name="consent"]').check();
  await page.locator('input[name="labeling_consent"]').check();
  await page.getByRole("button", { name: 폼.가입하기 }).click();

  await expect(page.getByText(폼.가입됨)).toBeVisible();
  expect(보낸것.labeling_consent).toBe(true);
});

test("어디로 가고 얼마나 남는지를 화면에 적는다 — 링크 뒤에 숨기지 않는다", async ({
  page,
}) => {
  await 로그아웃상태(page);
  await page.goto("/parents/signup");

  // **폼이 뜬 뒤에 읽는다.** 3상태라 첫 프레임은 「확인하는 중…」이고,
  // 기다리지 않으면 그 화면을 읽고 「고지가 없다」고 잘못 말한다.
  await expect(page.getByRole("button", { name: 폼.가입하기 })).toBeVisible();

  const 화면 = await page.locator("main").innerText();

  // PRD E-4 MUST. 문구가 바뀌어도 **이 사실들은 화면에 남아야 한다.**
  // **표현이 아니라 사실을 검사한다.** 다만 이 조각들은 문자열로 잡는다 —
  // 문구를 고칠 때 여기가 함께 깨져서 **고지가 조용히 빠지는 것**을 막는다.
  // **조각이 아니라 문장 전체를 댄다.** 조각만 대면 문구가 바뀌어도 통과해버린다 —
  // 이 넷은 제3자 위탁 고지라 **글자가 바뀌면 고지 내용이 바뀐 것**이다.
  for (const 줄 of 고지) expect(화면).toContain(줄);
  expect(화면).toContain("보내기 전에 걸러냅니다");

  // **⛔ 안 걸러지는 것은 안 걸러진다고 말한다** (2026-09-10 신설, `문구.md` 3.1 의 4).
  // **위 `for` 는 이 줄을 못 지킨다** — 고지에서 4 를 빼면 루프도 같이 줄어 **조용히 통과한다.**
  // 3 에서 실명을 빼기만 하면 학부모는 여전히 걸러진다고 읽는다: 1·2 가 「보낸다·보관한다」인데
  // 3 이 「걸러낸다」로 끝나므로. **이 한 줄이 빠지면 고지가 아니라 알리바이가 된다.**
  expect(화면).toContain("지우지 않고 책에 그대로 남습니다");

  // **⛔ 실명이 걸러진다고 말하지 않는다** (2026-09-10, `문구.md` 3.1).
  // 위 `for` 는 **고지에 있는 것**만 지킨다 — 누가 3 에 「실명」을 도로 넣어도
  // `고지` 를 같이 고치면 그대로 통과한다. **틀린 고지가 통과하는 자리**라 따로 막는다.
  // 실명은 **「보내기 전에」 걸러진 적이 없고**(NER 이 같은 프로바이더에게 묻는다) 이제
  // **저장 차단마저 없앴다.** 그렇게 적으면 고지가 아니라 거짓이다.
  expect(화면).not.toContain("실명");
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

  await expect(page.getByText(상태표시.확인중)).toBeVisible();
  await expect(page.getByRole("button", { name: 폼.가입하기 })).toHaveCount(0);

  await expect.poll(() => 응답하기 !== null).toBe(true);
  응답하기!();
  await expect(page.getByRole("button", { name: 폼.가입하기 })).toBeVisible();
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

  // **`code` 로 고른 학부모 문구다** (`문구.md` 3.8). **가입 폼으로 되돌리지 않는다** —
  // 로그인이 풀린 게 아니라 역할이 다른 것이다.
  await expect(page.getByText(학부모오류문구("FORBIDDEN_ROLE"))).toBeVisible();
  await expect(page.getByRole("button", { name: 폼.가입하기 })).toHaveCount(0);

  // **서버가 준 아이 목소리가 화면에 없다.** 이 검사는 한때 그 문구를 **기대하고** 있었다 —
  // 즉 **테스트가 이 버그를 물고 있었다.** 문구를 문자열로 박으면 이렇게 된다.
  expect(await page.locator("main").innerText()).not.toContain("여기는 지금 들어갈 수 없어요");
});

test("로그아웃은 서버를 부른다 — 클라이언트가 쿠키를 지우는 시늉이 아니다", async ({
  page,
}) => {
  await 로그아웃상태(page);
  await page.route(SIGNUP, (route) => route.fulfill({ status: 201, json: 가입됨 }));

  let 불렀나 = false;
  await page.route(LOGOUT, (route) => {
    불렀나 = true;
    // 서버는 본문 없이 204 를 준다. 쿠키 삭제는 `Set-Cookie` 로만 일어난다 —
    // **`__Host-` 쿠키는 JS 가 못 읽고 못 지운다.**
    return route.fulfill({ status: 204 });
  });

  await page.goto("/parents/signup");
  await page.getByLabel(폼.이메일).fill("parent@example.com");
  await page.getByLabel(폼.비밀번호).fill("pw12345678");
  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: 폼.가입하기 }).click();
  await expect(page.getByText(폼.가입됨)).toBeVisible();

  await page.getByRole("button", { name: 폼.로그아웃 }).click();

  expect(불렀나).toBe(true);
  // **3상태가 「로그아웃됨」으로 간다.** 「확인 중」에 걸려 있으면 안 된다.
  await expect(page.getByRole("button", { name: 폼.가입하기 })).toBeVisible();
  await expect(page.getByText(상태표시.확인중)).toHaveCount(0);
  // 가족 태블릿이다. **다음 사람이 앞사람 이메일을 보면 안 된다.**
  await expect(page.getByLabel(폼.이메일)).toHaveValue("");
  await expect(page.locator('input[name="consent"]')).not.toBeChecked();
});

test("로그아웃이 하지 않는 일을 약속하지 않는다", async ({ page }) => {
  await 로그아웃상태(page);
  await page.route(SIGNUP, (route) => route.fulfill({ status: 201, json: 가입됨 }));

  await page.goto("/parents/signup");
  await page.getByLabel(폼.이메일).fill("parent@example.com");
  await page.getByLabel(폼.비밀번호).fill("pw12345678");
  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: 폼.가입하기 }).click();
  await expect(page.getByText(폼.가입됨)).toBeVisible();

  const 화면 = await page.locator("main").innerText();
  // **`token_version` 은 아직 올라가지 않는다** (E-3/E-4). 그때까지 이 말은 거짓말이다.
  expect(화면).not.toContain("모든 기기");
  expect(화면).not.toContain("전체 로그아웃");
  // **자녀 쿠키는 안 건드린다.** 「전부 나간다」처럼 보이게 만들지 않는다.
  expect(화면).not.toContain("전부");
});

test("로그아웃이 못 닿으면 나간 척하지 않는다 — 무엇이 안 됐는지 말한다", async ({
  page,
}) => {
  await 로그아웃상태(page);
  await page.route(SIGNUP, (route) => route.fulfill({ status: 201, json: 가입됨 }));
  await page.route(LOGOUT, (route) => route.abort("failed"));

  await page.goto("/parents/signup");
  await page.getByLabel(폼.이메일).fill("parent@example.com");
  await page.getByLabel(폼.비밀번호).fill("pw12345678");
  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: 폼.가입하기 }).click();
  await expect(page.getByText(폼.가입됨)).toBeVisible();

  await page.getByRole("button", { name: 폼.로그아웃 }).click();

  // **`문구.md` 3.5 다. 자리마다 다르다** — 「가입」이 아니라 「로그아웃」이 안 된 것이다.
  await expect(page.getByText(못닿음.로그아웃)).toBeVisible();
  await expect(page.getByText(못닿음.가입)).toHaveCount(0);

  // **쿠키가 그대로 살아 있다.** 가입 폼으로 되돌리면 나간 것처럼 보이는데 실제로는 로그인 상태다 —
  // 가족 태블릿에서 **다음 사람이 그 계정을 그대로 쓴다.**
  await expect(page.getByRole("button", { name: 폼.가입하기 })).toHaveCount(0);

  // **「서버」가 화면에 없다.** 한때 여기에 「지금 서버에 닿지 못했습니다」가 박혀 있었다 —
  // `용어사전.md` 9장: **읽어도 모르면 고지가 아니라 알리바이다.**
  // 개발 단서(`data-dev-hints`)는 개발자용이라 세지 않는다.
  const 학부모가읽는것 = await page.locator("main > div > p").first().innerText();
  expect(학부모가읽는것).not.toContain("서버");
});

/**
 * **⛔ 2026-09-14 저녁 — 사용자가 이 화면에 갇혔다** (`문구.md` 3.6 신설 근거).
 *
 * 이미 가입한 이메일로 다시 가입하면 서버가 **422 `VALIDATION_ERROR`** 를 낸다.
 * **「이미 가입된 이메일」이라고 말하지 않는 것은 의도**이고(`api/app/api/v1/parents.py:93`)
 * **그 결정은 옳다** — 그 문장 하나가 아무나 이메일 존재 여부를 확인하는 창구가 된다.
 *
 * **막다른 길이었던 것은 화면이다.** 뜨는 것은 한 줄뿐이고 **로그인으로 가는 길이 없었다.**
 */

test("가입 화면에 로그인으로 가는 길이 늘 있다 — 오류와 무관하다", async ({ page }) => {
  await 로그아웃상태(page);
  await page.goto("/parents/signup");

  // **⛔ 오류가 났을 때만 띄우면 그것 자체가 이메일 존재 확인 창구가 된다.**
  // 아무 일도 없는 지금 보여야 한다 — 3.10 의 「처음이신가요? 가입하기」와 **대칭**이다.
  const 길 = page.getByRole("link", { name: 폼.로그인으로 });
  await expect(길).toBeVisible();
  await expect(길).toHaveAttribute("href", "/parents/login");

  // 오류 문장은 아직 없다. **길만 있고 오류는 없는 상태가 정상 출발점**이다.
  await expect(page.getByText(폼.제출거절)).toHaveCount(0);
});

test("이미 가입된 이메일로 막혀도 갇히지 않는다 — 폼이 남고 길이 보인다", async ({
  page,
}) => {
  await 로그아웃상태(page);
  await page.route(SIGNUP, (route) =>
    route.fulfill({
      status: 422,
      json: {
        error: {
          code: "VALIDATION_ERROR",
          // **아이 목소리다** (`errors.py` 의 `CHILD_MESSAGE`). 화면에 그대로 나오면 안 된다.
          message: "잠깐 문제가 생겼어요. 다시 한 번 해볼까요",
          detail: { fields: [{ field: "email" }] },
        },
      },
    }),
  );

  await page.goto("/parents/signup");
  await page.getByLabel(폼.이메일).fill("parent@example.com");
  await page.getByLabel(폼.비밀번호).fill("pw12345678");
  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: 폼.가입하기 }).click();

  await expect(page.locator("[data-오류]")).toHaveText(폼.제출거절);

  // **⭐ 이것이 이 검사의 핵심이다.** 문장만 띄우고 폼을 치우면 **여전히 막다른 길**이다 —
  // 「입력을 다시 확인해 주세요」는 **확인할 입력이 화면에 있어야** 참이 된다.
  await expect(page.getByRole("button", { name: 폼.가입하기 })).toBeVisible();
  await expect(page.getByLabel(폼.이메일)).toHaveValue("parent@example.com");
  await expect(page.getByRole("link", { name: 폼.로그인으로 })).toBeVisible();

  const 화면 = await page.locator("main").innerText();
  expect(화면).not.toContain("잠깐 문제가 생겼어요");
});

test("가입 실패는 이유를 가리지 않는다 — 어느 코드든 같은 문장이다", async ({ page }) => {
  // **갈라 쓰면 그 갈림이 곧 정보다** (`문구.md` 3.6). 중복 이메일(422)과 다른 실패가
  // **다른 문장으로 나오면**, 남의 이메일을 넣고 **문장 모양만 보고** 계정 유무를 안다.
  const 본것: string[] = [];

  for (const [status, code] of [
    [422, "VALIDATION_ERROR"],
    [429, "RATE_LIMITED"],
    [500, "INTERNAL_ERROR"],
  ] as const) {
    await 로그아웃상태(page);
    await page.route(SIGNUP, (route) =>
      route.fulfill({ status, json: { error: { code, message: "아무 말" } } }),
    );

    await page.goto("/parents/signup");
    await page.getByLabel(폼.이메일).fill("parent@example.com");
    await page.getByLabel(폼.비밀번호).fill("pw12345678");
    await page.locator('input[name="consent"]').check();
    await page.getByRole("button", { name: 폼.가입하기 }).click();

    await expect(page.locator("[data-오류]")).toBeVisible();
    본것.push(await page.locator("[data-오류]").innerText());
    await page.unroute(SIGNUP);
  }

  expect(new Set(본것).size).toBe(1);
  expect(본것[0]).toBe(폼.제출거절);
  // **3.8 표를 이 자리에 쓰면 코드마다 문장이 갈린다.** 그 표가 여기 새는지 직접 본다.
  expect(본것[0]).not.toBe(학부모오류문구("VALIDATION_ERROR"));
  expect(본것[0]).not.toBe(학부모오류문구("RATE_LIMITED"));

  // **어느 칸도 계정이 있다고 단정하지 않는다.** 「있으시면」은 조건문이라 아무것도 확인해 주지 않는다.
  for (const 새면안되는말 of ["이미 가입된", "중복", "사용 중인", "존재하는"]) {
    expect(폼.제출거절).not.toContain(새면안되는말);
  }
});
