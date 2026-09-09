import { expect, test, type Page } from "@playwright/test";

import { 못닿음, 설치안내, 코드입력 } from "../src/app/child/auth/copy";
// 흉내는 `_helpers.ts` 한 곳에 있다 — 복사하면 한쪽만 고쳐지는 날 둘이 다른 것을 잰다.
import { 홈화면앱으로 } from "./_helpers";

/**
 * 자녀 인증 화면 (E-3 프론트 짝).
 *
 * **여기 첫 검사가 이 화면이 존재하는 이유 그 자체다** — 브라우저 탭에 **코드 입력칸이 없어야
 * 한다.** 접속 코드는 1회용이고 iOS 홈 화면 앱은 Safari 와 쿠키를 공유하지 않아,
 * 탭에서 써버리면 **아이는 재발급 없이 못 들어온다.** 나중에 누가 「탭에서도 되게 해주자」로
 * 게이트를 열면 **이 테스트가 막는다.** 규칙을 문서에만 적어두면 아무도 안 막는다.
 *
 * **문구를 문자열로 박지 않는다.** `copy.ts` 를 import 한다 — 오늘 `[보안 필터]` 를 여섯 군데에
 * 박아둔 탓에 **문구를 바꾸는 날 테스트가 제품을 붙잡았다.**
 */

const ME = "**/api/v1/child/me";
const AUTH = "**/api/v1/child/auth";

/** 아직 안 들어온 상태. 이 화면의 정상 출발점이다. */
async function 안들어온상태(page: Page) {
  await page.route(ME, (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "다시 한 번 들어와 주세요" } },
    }),
  );
}

test("브라우저 탭에서는 코드 입력칸이 아예 없다 — 보이면 누른다", async ({ page }) => {
  await 안들어온상태(page);
  // 흉내를 안 낸다 = 보통 탭이다.
  await page.goto("/child/auth");

  await expect(page.getByText(설치안내.제목)).toBeVisible();
  // **왜 안 되는지가 먼저다.** 이 줄이 빠지면 막는 화면으로만 읽힌다.
  await expect(page.getByText(설치안내.이유)).toBeVisible();

  // **핵심.** 흐리게라도 두지 않는다 — 숨김이 아니라 **존재하지 않아야** 한다.
  await expect(page.locator("input")).toHaveCount(0);
  await expect(page.getByRole("button", { name: 코드입력.버튼 })).toHaveCount(0);
});

test("홈 화면 앱에서는 코드 입력이 열린다", async ({ page }) => {
  await 홈화면앱으로(page);
  await 안들어온상태(page);
  await page.goto("/child/auth");

  await expect(page.getByText(코드입력.제목)).toBeVisible();
  // 무엇을 넣어야 하는지 모양을 미리 알려주는 줄. 오류를 나눠 말할 수 없으니 이것이 유일한 대응이다.
  await expect(page.getByText(코드입력.안내)).toBeVisible();
  await expect(page.getByLabel(코드입력.라벨)).toBeVisible();
  // 설치 안내는 이 갈래에 없다 — 둘이 같이 뜨면 아이가 무엇을 할 차례인지 모른다.
  await expect(page.getByText(설치안내.제목)).toHaveCount(0);
});

test("6자리가 아니면 들어갈 수 없다", async ({ page }) => {
  await 홈화면앱으로(page);
  await 안들어온상태(page);
  await page.goto("/child/auth");

  const 들어가기 = page.getByRole("button", { name: 코드입력.버튼 });
  await expect(들어가기).toBeDisabled();

  await page.getByLabel(코드입력.라벨).fill("12345");
  await expect(들어가기).toBeDisabled();

  await page.getByLabel(코드입력.라벨).fill("123456");
  await expect(들어가기).toBeEnabled();
});

test("숫자가 아닌 것은 애초에 들어가지 않는다", async ({ page }) => {
  await 홈화면앱으로(page);
  await 안들어온상태(page);
  await page.goto("/child/auth");

  const 입력칸 = page.getByLabel(코드입력.라벨);
  await 입력칸.fill("12ab34cd56");
  // 서버는 어차피 같은 401 을 주지만, **아이가 무엇을 잘못 넣었는지 듣지 못하므로**
  // 넣을 수 없게 하는 편이 낫다. 길이도 6에서 잘린다.
  await expect(입력칸).toHaveValue("123456");
});

test("코드가 틀리면 서버 문구를 그대로 보여주고 입력값을 지우지 않는다", async ({
  page,
}) => {
  await 홈화면앱으로(page);
  await 안들어온상태(page);
  await page.goto("/child/auth");

  // 없는 코드·만료된 코드·이미 쓴 코드가 **전부 같은 401** 이다 — 구분하면 코드를
  // 찍어보는 쪽에 신호가 샌다. 화면도 나눠 말하지 않는다.
  const 서버문구 = "다시 한 번 들어와 주세요";
  await page.route(AUTH, (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: 서버문구 } },
    }),
  );

  await page.getByLabel(코드입력.라벨).fill("123456");
  await page.getByRole("button", { name: 코드입력.버튼 }).click();

  await expect(page.locator("[data-오류]")).toHaveText(서버문구);
  // **화면을 갈아치우지 않는다.** 오타 하나로 6자리를 처음부터 다시 치게 만들지 않는다.
  await expect(page.getByLabel(코드입력.라벨)).toHaveValue("123456");
});

test("성공하면 화면을 하나 더 만들지 않고 모험 화면으로 간다", async ({ page }) => {
  await 홈화면앱으로(page);
  await 안들어온상태(page);
  await page.goto("/child/auth");

  await page.route(AUTH, (route) =>
    route.fulfill({
      status: 200,
      json: {
        child: { child_id: "c-1", nickname: "민준", guide_name: null },
      },
    }),
  );

  await page.getByLabel(코드입력.라벨).fill("123456");
  await page.getByRole("button", { name: 코드입력.버튼 }).click();

  // 「환영합니다」류를 두지 않는다 — **환영은 가이드 몫**이고 그것은 모험 화면에서 일어난다.
  await expect(page).toHaveURL(/\/$/);
});

test("닿지 못하면 아이 사정으로 말한다 — 「서버」가 화면에 없다", async ({ page }) => {
  await 홈화면앱으로(page);
  // 응답을 주지 않는다. 서버가 **아무 말도 못 한** 자리다 — `error.message` 가 없다.
  await page.route(ME, (route) => route.abort("failed"));
  await page.goto("/child/auth");

  await expect(page.getByText(못닿음)).toBeVisible();

  // **`문구.md` 2.4 가 「서버」를 금지한다** — 2.1 의 「기술 용어를 섞지 않는다」가 여기에도 걸린다.
  // 한때 이 자리에 「지금 **서버**에 닿지 못했습니다」가 박혀 있었다 (2026-09-07 갈아치웠다).
  // 개발 단서(`data-dev-hints`)는 개발자용이라 세지 않는다 — 운영 번들에서는 아예 안 그려진다.
  const 아이에게보이는것 = await page
    .locator("main > div > p")
    .first()
    .innerText();
  expect(아이에게보이는것).not.toContain("서버");
});
