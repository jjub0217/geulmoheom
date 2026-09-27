import { expect, test, type Page } from "@playwright/test";

import { 못닿음, 코드입력 } from "../src/app/child/auth/copy";
import { 입장문구 } from "../src/components/account-entry";
import { 폼 } from "../src/app/parents/signup/copy";
import { 상태표시 } from "../src/app/status-copy";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/healthz")) {
      return route.fulfill({ status: 200, json: { status: "ok" } });
    }
    // 각 검사가 선언한 모의 응답 이외에는 실제 인증·데이터 요청을 보내지 않는다.
    if (url.pathname.startsWith("/api/")) {
      return route.fulfill({ status: 404, json: { detail: "Unmocked child authentication request" } });
    }
    if (url.origin !== origin) return route.abort();
    return route.continue();
  });
});

/**
 * 자녀 인증 화면 (E-3 프론트 짝).
 *
 * **⛔ 2026-09-14 에 이 파일의 첫 검사가 뒤집혔다** (`adr/0014`).
 *
 * 종전 머리말은 이랬다 — 「여기 첫 검사가 **이 화면이 존재하는 이유 그 자체**다: 브라우저 탭에
 * **코드 입력칸이 없어야 한다.** 나중에 누가 「탭에서도 되게 해주자」로 게이트를 열면
 * **이 테스트가 막는다**」. **그 게이트를 지금 일부러 열었다.**
 *
 * **막던 이유는 하나뿐이었다** — 접속 코드가 1회용인데 **iOS 홈 화면 앱이 Safari 와 쿠키를
 * 공유하지 않아**, 탭에서 써 버리면 아이가 재발급 없이 못 들어왔다. **웹만 쓰기로 하면서
 * 그 이유가 통째로 사라졌다**: 쿠키 통이 하나뿐이라 **코드가 갈릴 데가 없다.**
 *
 * **검사가 규칙을 지켰고, 규칙이 바뀌자 검사가 막았다. 그게 맞는 순서다** —
 * 문서만 고치고 검사를 안 고쳤으면 **어느 쪽이 참인지 모르는 채로 남았을 것**이다.
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

test("브라우저 탭에서 코드 입력이 바로 열린다", async ({ page }) => {
  await 안들어온상태(page);
  await page.goto("/child/auth");

  // **2026-09-14 에 뒤집힌 자리다** (`adr/0014`). 예전에는 **여기서 안내만 뜨고
  // 입력칸이 아예 없었다** — 접속 코드가 1회용인데 iOS 홈 화면 앱이 Safari 와 쿠키를
  // 공유하지 않아, 탭에서 써 버리면 **재발급 없이 못 들어왔기 때문**이다.
  // **웹만 쓰기로 하면서 그 벽이 선 이유가 통째로 사라졌다** — 쿠키 통이 하나뿐이라
  // 코드가 갈릴 데가 없다.
  await expect(page.getByText(코드입력.제목)).toBeVisible();
  // 무엇을 넣어야 하는지 모양을 미리 알려주는 줄. 오류를 나눠 말할 수 없으니 이것이 유일한 대응이다.
  await expect(page.getByText(코드입력.안내)).toBeVisible();
  await expect(page.getByLabel(코드입력.라벨)).toBeVisible();
  await expect(page.getByRole("button", { name: 코드입력.버튼 })).toBeVisible();

  // **설치를 요구하는 말이 화면에 없다.** 낱말로 막는다 — 안내를 지웠어도
  // **다른 자리에서 「홈 화면에 추가」가 다시 새어 나오면** 유입을 깎는 그 문턱이 돌아온다.
  const 화면 = await page.locator("main").innerText();
  for (const 안쓰는말 of ["홈 화면에 추가", "설치", "앱을 열고"]) {
    expect(화면).not.toContain(안쓰는말);
  }
});

test("6자리가 아니면 들어갈 수 없다", async ({ page }) => {
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
  // 응답을 주지 않는다. 서버가 **아무 말도 못 한** 자리다 — `error.message` 가 없다.
  await page.route(ME, (route) => route.abort("failed"));
  await page.goto("/child/auth");

  await expect(page.getByText(못닿음)).toBeVisible();

  // **`문구.md` 2.4 가 「서버」를 금지한다** — 2.1 의 「기술 용어를 섞지 않는다」가 여기에도 걸린다.
  // 한때 이 자리에 「지금 **서버**에 닿지 못했습니다」가 박혀 있었다 (2026-09-07 갈아치웠다).
  // 개발 단서(`data-dev-hints`)는 개발자용이라 세지 않는다 — 운영 번들에서는 아예 안 그려진다.
  const 아이에게보이는것 = await page
    .getByText(못닿음, { exact: true })
    .innerText();
  expect(아이에게보이는것).not.toContain("서버");
});

// ── 쓰다가 끊겨서 왔을 때 (`문구.md` 3.3, 2026-09-12 신설) ──────────────

const 안내줄 = (page: Page) => page.locator("[data-안내]");

test("쓰다가 끊겨서 오면 주어가 부모인 한 줄을 말한다", async ({ page }) => {
  await 안들어온상태(page);

  await page.goto("/child/auth?kicked=1");

  // **아이는 왜 끊겼는지도, 무엇을 해야 하는지도 몰랐다.**
  await expect(안내줄(page)).toHaveText(코드입력.끊겨서왔을때);
  // **⛔ 배열로 견준다** (2026-09-23). 끊겨서 온 안내가 **조각 둘**이 되면서
  // `[data-안내]` 도 둘이다 — 문자열 하나로 견주면 **무엇이 틀렸는지가 아니라
  // 「요소가 둘이다」로 막힌다.** 재는 것은 그대로다: **기본 안내를 말하지 않는다.**
  await expect(안내줄(page)).not.toHaveText([코드입력.안내]);

  const 화면 = await page.locator("main").innerText();
  // **⛔ 아이에게 자기 계정이 사라졌다고 화면이 말하게 두지 않는다** — 그건 어른이 할 말이다.
  for (const 안쓰는말 of ["지워졌", "삭제", "계정이 없", "없어졌"]) {
    expect(화면).not.toContain(안쓰는말);
  }
  // **쓰던 문장을 잃는다는 말을 안 한다** — 못 되살리는 것을 굳이 알리면 상실만 키운다.
  for (const 안쓰는말 of ["잃었", "사라진 문장", "저장되지 않"]) {
    expect(화면).not.toContain(안쓰는말);
  }
});

test("처음 온 아이에게는 그 줄을 말하지 않는다 — 받은 적 없는 코드를 찾게 된다", async ({
  page,
}) => {
  await 안들어온상태(page);

  // **표식 없이 온다.** `start_url` 이 `/` 라 **처음 온 아이도 마운트 401 로 여기 온다** —
  // 그래서 마운트 쪽에는 표식을 안 단다 (`lib/kicked.ts`).
  // **틀리는 방향이 대칭이 아니다**: 끊겼는데 기본 안내를 보는 것은 오늘과 같지만,
  // 안 끊겼는데 이 줄을 보면 **아이에게 거짓을 말한다.**
  await page.goto("/child/auth");

  await expect(안내줄(page)).toHaveText(코드입력.안내);
  await expect(안내줄(page)).not.toHaveText(코드입력.끊겨서왔을때);
});

test("코드를 틀려도 끊겼다는 안내가 그대로 남는다", async ({ page }) => {
  await 안들어온상태(page);
  const 서버문구 = "코드가 맞지 않아요. 부모님께 다시 물어볼까요";
  await page.route(AUTH, (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: 서버문구 } },
    }),
  );

  await page.goto("/child/auth?kicked=1");
  await page.getByLabel(코드입력.라벨).fill("123456");
  await page.getByRole("button", { name: 코드입력.버튼 }).click();

  // **오타 한 번에 안내가 기본으로 돌아가면** 아이가 읽던 줄을 잃는다.
  await expect(page.locator("[data-오류]")).toHaveText(서버문구);
  await expect(안내줄(page)).toHaveText(코드입력.끊겨서왔을때);
});

/**
 * **⛔ 2026-09-15 백엔드 실측에서 나왔다** — **식은 서버의 첫 요청이 33.3초**다
 * (502 가 아니라 200 이었다). 그 33초 동안 이 화면이 **아무 말도 안 하고 있었다** —
 * 아이가 보는 것은 **흐려진 버튼 하나**였고, **그날 첫 아이가 정확히 그 화면을 본다.**
 *
 * **⭐ 문구는 이미 있었다** (`문구.md` **2.5** 「접속 코드를 확인하는 중 — 확인하는 중…」).
 * **없는 말이 아니라 자리가 비어 있었다** — 화면이 마운트 때만 그 말을 쓰고 있었다.
 */
test("코드를 보내는 동안 기다린다고 말한다 — 식은 서버는 33초가 걸린다", async ({ page }) => {
  await 안들어온상태(page);
  let 풀어준다: (() => void) | null = null;
  await page.route(AUTH, async (route) => {
    await new Promise<void>((res) => (풀어준다 = res));
    return route.fulfill({ status: 200, json: { child_id: "c1", nickname: "은빛나침반" } });
  });

  await page.goto("/child/auth");
  await page.getByLabel(코드입력.라벨).fill("123456");
  await page.getByRole("button", { name: 코드입력.버튼 }).click();

  // **보내는 동안 화면이 말한다.** 이 줄이 없으면 아이는 **눌렸는지조차 모른다.**
  await expect(page.locator("[data-확인중]")).toHaveText(상태표시.확인중);

  // **⛔ 끝까지 붙어 있어야 한다** (백엔드 지적, 2026-09-15). 3초쯤 떴다 사라지면
  // **33초짜리 침묵이 30초로 줄 뿐**이다. **6초를 실제로 기다려 본다** — 어딘가에
  // 타임아웃이나 자동 숨김이 생기면 여기서 걸린다.
  await page.waitForTimeout(6000);
  await expect(page.locator("[data-확인중]")).toBeVisible();
  // 그 동안 **쓴 코드도 그대로 남아 있다** — 사라지면 아이는 다시 쳐야 한다.
  await expect(page.getByLabel(코드입력.라벨)).toHaveValue("123456");

  await expect.poll(() => 풀어준다 !== null).toBe(true);
  풀어준다!();

  // 끝나면 그 말이 사라진다 — 남아 있으면 **끝난 뒤에도 기다리는 것처럼 보인다.**
  await page.waitForURL("**/");
  await expect(page.locator("[data-확인중]")).toHaveCount(0);
});

/**
 * **맨 주소로 들어온 어른이 갇히지 않는다** (계획 「해커톤 제출 전」 ① · `문구.md` 3.3 새 절).
 *
 * ⛔ **막다른 길이었다.** 서비스 주소를 그냥 열면 자동으로 이 화면에 오는데
 * (`app/page.tsx` 의 `router.replace("/child/auth")`), 화면은 **6자리 접속 코드**를 요구한다.
 * **처음 온 사람에게는 그 코드가 없고, 코드를 만들 방법도 되돌아갈 데도 없었다.**
 * **서비스를 처음 여는 사람이 정확히 그 사람이다.**
 *
 * ⭐ **재는 것은 문장이 아니라 길이다.** 문구가 화면에 있는지가 아니라
 * **맨 주소에서 부모 가입 폼까지 손으로 닿는지**를 끝까지 걷는다 — 그것이 완료 조건이었다.
 *
 * 문장은 `account-entry.tsx`·`signup/copy.ts` 에서 가져온다. 여기 베껴 적으면 문구가 바뀌는 날
 * 검사가 제품을 붙잡는다.
 */
test("맨 주소로 들어온 어른이 갇히지 않는다 — 접속 코드가 없어도 부모 가입까지 걸어간다", async ({ page }) => {
  const 안들어왔다 = (route: { fulfill: (r: object) => unknown }) =>
    route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED", message: "검사용 응답" } } });
  // ⭐ 맨 주소를 인증 화면으로 보내는 것은 `/cards/next` 의 401 이다 (`app/page.tsx`) —
  //    `/child/me` 가 아니다. 셋 다 「아직 안 들어왔다」로 둔다.
  await page.route("**/api/v1/cards/next", 안들어왔다);
  await page.route("**/api/v1/child/me", 안들어왔다);
  await page.route("**/api/v1/parents/me", 안들어왔다);

  // 맨 주소다. 아이 인증 화면으로 보내지는 것이 지금 동작이다.
  await page.goto("/");
  await expect(page).toHaveURL(/\/child\/auth$/);
  await expect(page.getByRole("heading", { name: 코드입력.제목 })).toBeVisible();

  // **아이가 지금 할 수 있는 일을 말한다** (2026-09-22 사용자 지시 · `문구.md` 3.3).
  // ⛔ **종전 둘째 줄이 없어졌다** — 「부모님이 먼저 가입하시면…」은 **아이가 할 수 없는 일**이라
  // 아이 화면에서 설명할 것이 아니었다. 한 줄이면 된다.
  await expect(page.getByText(입장문구.코드없음)).toBeVisible();

  const 가는길 = page.getByRole("link", { name: 입장문구.부모가입 });
  await expect(가는길).toBeVisible();
  await expect(가는길).toHaveAttribute("href", "/parents/signup");

  // **누르면 실제로 닿는다.** 여기까지가 「손으로 닿는다」다.
  await 가는길.click();
  await expect(page).toHaveURL(/\/parents\/signup$/);
  // ⛔ 401 은 가입 폼을 띄운다. 알려진 「가입 무한 고리」는 아이 코드를 이미 넣은 뒤(403)에만 난다.
  await expect(page.getByRole("button", { name: 폼.가입하기 })).toBeVisible();
});
