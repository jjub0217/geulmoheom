import { expect, test, type Page } from "@playwright/test";

import type { paths } from "../src/api/types.gen";
import { 코드입력 } from "../src/app/child/auth/copy";
import { 상태표시 } from "../src/app/status-copy";
import { 나가기문구 } from "../src/components/leave-copy";

/**
 * **들어가는 문** (2026-09-08 실기기에서 나왔다 · `주차계획/W4.md`).
 *
 * **아이가 홈 화면 아이콘을 처음 누르는 경로다.** 매니페스트 `start_url` 이 `/` 라 여기로 오는데,
 * 그때는 아직 쿠키가 없어 `/cards/next` 가 401 이다. **그런데 화면은 문구만 띄우고 있었다** —
 * **들어갈 문은 없고 나가는 문만 있는 화면**이었다.
 *
 * **E2E 142개가 전부 초록인데 이 경로를 아무도 안 걸었다.** 검사들이 **인증된 상태로 시작하거나
 * `/child/auth` 로 바로 들어갔기 때문**이다 — **아이가 실제로 밟는 첫 걸음을 아무도 안 쟀다.**
 * 그래서 이 파일이 있다.
 */

/**
 * **화면 안만 본다.** 리다이렉트 뒤에는 Next 의 라우트 안내자(`#__next-route-announcer__`)가
 * **같은 문장을 화면 밖에서 한 번 더 들고 있어** `getByText` 가 둘을 잡는다 —
 * 스크린리더에 새 화면 이름을 읽어주는 요소이고, **클라이언트 이동을 한 뒤에만 생긴다.**
 * 그래서 `goto` 로 바로 들어가는 `child-auth.spec.ts` 는 이걸 안 밟았고 **여기가 처음 밟았다.**
 */
const 본문 = (page: Page) => page.locator("main");

type CardResponse =
  paths["/api/v1/cards/next"]["get"]["responses"][200]["content"]["application/json"];

const CARDS_NEXT = "**/api/v1/cards/next";
const CHILD_ME = "**/api/v1/child/me";

const CARD: CardResponse = {
  card_id: "c99",
  type: "discovery",
  situation: "낡은 등대 문이 반쯤 열려 있고 안쪽에서 파란 빛이 새어 나온다.",
  prompt_label: "탐험가는 어떻게 할까?",
  guide: { expression: "default", line: "나침반이 조용하네." },
  today: { cards_done: 0, cap: 5 },
};

/** 아직 안 들어왔다. **홈 화면 아이콘을 처음 누른 아이가 정확히 이 상태다.** */
async function 안들어온상태(page: Page) {
  const 거절 = {
    status: 401,
    json: { error: { code: "UNAUTHORIZED", message: "다시 한 번 들어와 주세요" } },
  };
  await page.route(CARDS_NEXT, (route) => route.fulfill(거절));
  await page.route(CHILD_ME, (route) => route.fulfill(거절));
}

/**
 * **검사 둘이 하나로 접혔다** (2026-09-14, `adr/0014`). 예전에는 **홈 화면 앱이면 코드 입력,
 * 브라우저 탭이면 설치 안내**라 갈래마다 하나씩 있었다. **갈래가 없어졌다 — 어디서 열든 같다.**
 */
test("처음 열면 어디서 열든 코드 입력까지 간다 — 막다른 화면이 아니다", async ({ page }) => {
  await 안들어온상태(page);

  // **아이는 여기로 온다.** 부모가 건넨 주소가 `/` 다.
  await page.goto("/");

  // **자녀 인증 화면이 나머지를 안다** — 새로 만든 화면이 없다.
  await page.waitForURL("**/child/auth");
  await expect(본문(page).getByText(코드입력.제목)).toBeVisible();
  await expect(page.getByLabel(코드입력.라벨)).toBeVisible();

  // **문구를 고치지 않았다. 보여주는 자리를 고쳤다** — 그래서 이 문장은 이제 안 보인다.
  await expect(본문(page).getByText("다시 한 번 들어와 주세요")).toHaveCount(0);
});

/**
 * **제목이 재는 것과 맞아야 한다** (2026-09-08, 뒤집기에서 걸렸다).
 * 처음엔 이 검사 제목이 **「들어오기 전에는 나가기가 없다」**였는데, **나가기 게이트를 떼도 통과했다** —
 * 리다이렉트 뒤에는 인증 화면이고 **거기엔 원래 나가기가 없기 때문**이다.
 * **이 검사가 무는 것은 리다이렉트**이고, 게이트를 무는 것은 **아래 「확인되기 전에는」**이다.
 * **단언 단위로 뒤집지 않았으면 「게이트에 검사가 있다」고 적고 넘어갔다.**
 */
test("인증 화면에도 나가기가 없다 — 나가는 문만 남는 자리를 만들지 않는다", async ({ page }) => {
  await 안들어온상태(page);

  await page.goto("/");
  await page.waitForURL("**/child/auth");

  // **들어온 적 없는 아이에게 「부모님께 새 접속 코드를 받아야 해요」는 겁만 주고 사실도 아니다** —
  // 지금 나가도 잃을 세션이 없다. **문장은 맞고 자리가 틀렸다.**
  await expect(page.getByRole("button", { name: 나가기문구.버튼 })).toHaveCount(0);
});

test("확인되기 전에는 나가기를 안 그린다 — 찰나에 아이가 누른다", async ({ page }) => {
  // 응답을 붙잡아 둔다. **로딩 상태를 실제로 만들어 본다** — 상상으로 두면 아무것도 안 잰다.
  let 풀기: (() => void) | null = null;
  await page.route(CARDS_NEXT, async (route) => {
    await new Promise<void>((resolve) => {
      풀기 = resolve;
    });
    await route.fulfill({ status: 200, json: CARD });
  });

  await page.goto("/");

  // 아직 대답이 없다 — 화면은 「불러오는 중」이고 **여기에 나가기가 있으면 안 된다.**
  await expect(본문(page).getByText(상태표시.장면부르는중)).toBeVisible();
  await expect(page.getByRole("button", { name: 나가기문구.버튼 })).toHaveCount(0);

  // **요청이 실제로 붙잡혀 있는지 먼저 본다.** 이 줄이 없으면 위 「나가기 없음」이
  // **아직 요청도 안 나간 순간**을 잰 것일 수 있다 — 붙잡은 것이 아니라 지나친 것이다.
  await expect.poll(() => 풀기 !== null).toBe(true);
  풀기!();

  // 카드가 왔다 = **인증이 확인됐다.** 이제 그린다.
  await expect(본문(page).getByText(CARD.situation)).toBeVisible();
  await expect(page.getByRole("button", { name: 나가기문구.버튼 })).toBeVisible();
});

test("책도 같은 뿌리다 — 401 이면 인증 화면으로 보낸다", async ({ page }) => {
  await page.route(CHILD_ME, (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "다시 한 번 들어와 주세요" } },
    }),
  );
  await page.route("**/api/v1/book", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "다시 한 번 들어와 주세요" } },
    }),
  );

  // 결과 화면의 「내 책」을 눌렀는데 그 사이 쿠키가 죽으면 정확히 여기로 온다.
  // **이 화면에는 「나가기」가 아예 없어서 뒤로 가기 말고는 길이 없었다.**
  await page.goto("/book");

  // **표식이 붙는다** (2026-09-12, `문구.md` 3.3 · `lib/kicked.ts`) — 내 책을 열었다는 것은
  // **들어와 있었다**는 뜻이라, 인증 화면이 「부모님이 새 접속 코드를 받으셨어요」를 말해도 된다.
  // **`"**/child/auth"` 로 두면 물음표 뒤가 붙는 순간 안 맞는다** — 여기가 그래서 빨간불이었다.
  await page.waitForURL("**/child/auth?kicked=1");
  await expect(본문(page).getByText(코드입력.제목)).toBeVisible();
  await expect(본문(page).getByText(코드입력.끊겨서왔을때)).toBeVisible();
});

/**
 * **⛔ 2026-09-14 아동 3명 회차 준비에서 나왔다** (`프리테스트_결과_2026-09-14.md` 3장 ⑪).
 *
 * **이쪽이 진짜 흐름이다** — 부모가 접속 코드를 받아 아이에게 넘기고 **아이는 링크(`/`)를
 * 연다.** `/child/auth` 를 직접 치는 아이는 없다. 그런데 그 브라우저에는 **부모 쿠키가
 * 살아 있어** `/cards/next` 가 **403 `FORBIDDEN_ROLE`** 로 답한다.
 *
 * **어제 고친 것은 `/child/auth` 하나뿐이었다** — 정작 아이가 먼저 닿는 `/` 는
 * 「여기는 지금 들어갈 수 없어요」에서 끝나고 **코드 입력으로 가는 길이 없었다.**
 * **낱개로 고쳐서 다음이 또 나온 자리다.**
 */
async function 부모쿠키가있는상태(page: Page) {
  const 역할거절 = {
    status: 403,
    json: { error: { code: "FORBIDDEN_ROLE", message: "여기는 지금 들어갈 수 없어요" } },
  };
  await page.route(CARDS_NEXT, (route) => route.fulfill(역할거절));
  await page.route(CHILD_ME, (route) => route.fulfill(역할거절));
  await page.route("**/api/v1/book", (route) => route.fulfill(역할거절));
}

test("부모가 로그인한 브라우저에서 열어도 코드 입력까지 간다 — 403 도 401 과 같다", async ({
  page,
}) => {
  await 부모쿠키가있는상태(page);

  // **부모가 건넨 주소가 `/` 다.** 아이는 여기로 온다.
  await page.goto("/");

  await page.waitForURL("**/child/auth");
  await expect(본문(page).getByText(코드입력.제목)).toBeVisible();
  await expect(page.getByLabel(코드입력.라벨)).toBeVisible();

  // **막다른 화면이 아니다.** 이 문장에서 끝나면 아이가 들어갈 길이 없다.
  await expect(본문(page).getByText("여기는 지금 들어갈 수 없어요")).toHaveCount(0);

  // **표식을 안 단다.** 「부모님이 새 접속 코드를 받으셨어요」는 **끊긴 아이**에게 하는 말인데
  // (`문구.md` 3.3), 여기 온 아이는 **아직 한 번도 안 들어왔다** — 붙이면 거짓이다.
  expect(new URL(page.url()).searchParams.has("kicked")).toBe(false);
  await expect(본문(page).getByText(코드입력.끊겨서왔을때)).toHaveCount(0);
});

test("책도 같은 뿌리다 — 403 이면 표식 없이 인증 화면으로 보낸다", async ({ page }) => {
  await 부모쿠키가있는상태(page);

  await page.goto("/book");

  await page.waitForURL("**/child/auth");
  await expect(본문(page).getByText(코드입력.제목)).toBeVisible();

  // **401 과 갈린다.** 401 은 **들어와 있다가 끊긴 것**이라 표식을 달지만(위 검사),
  // 403 은 **부모 쿠키가 있는 것**이라 **새 코드를 받은 적이 없다.**
  expect(new URL(page.url()).searchParams.has("kicked")).toBe(false);
  await expect(본문(page).getByText(코드입력.끊겨서왔을때)).toHaveCount(0);
});

/**
 * **⛔ 2026-09-15 운영에서 나왔다** (`주차계획/W6.md` **15번** · 잠금 조건 ①).
 *
 * **무료 티어는 마지막 활동 +15분 00초에 내려가고, 다시 깨는 데 32초**가 든다
 * (2026-09-16 백엔드 실측). **그날 첫 아이가 그 32초를 맨눈으로 기다린다.**
 *
 * **⛔ 종전에 여기 「502 를 두 번 밟았다 · 「느리다」가 아니라 「죽는다」」로 적혀 있었다.
 * 콜드는 502 를 안 낸다** — 넷 다 정상 응답이었다 (2026-09-16 정정 · `주차계획/W6.md` 15번).
 *
 * **⭐ 그래도 이 검사는 그대로 값이다 — 재는 것이 원인이 아니라 「새지 않는다」이기 때문**이다.
 * **깨우기가 어떤 이유로 실패하든**(배포 전환의 502 · 끊긴 망 · 404)
 * **그것이 화면에 새면 아이가 영문 모를 오류를 본다.** 502 는 그 실패를 **대표하는 모양**으로 쓴다.
 */
test("화면이 뜨면 식은 서버를 깨운다 — 그 요청이 502 로 죽어도 화면은 멀쩡하다", async ({
  page,
}) => {
  const 깨움: string[] = [];
  await page.route("**/healthz", (route) => {
    깨움.push(route.request().method());
    // **앞단이 기다리다 포기한 모양 그대로** 돌려준다.
    return route.fulfill({ status: 502, contentType: "text/html", body: "Bad Gateway" });
  });
  await 안들어온상태(page);

  await page.goto("/");

  // **화면은 제 갈 길을 간다.** 깨우기가 죽은 것이 여기 새면 안 된다.
  await page.waitForURL("**/child/auth");
  await expect(page.getByLabel(코드입력.라벨)).toBeVisible();
  await expect(본문(page).getByText("Bad Gateway")).toHaveCount(0);
  for (const 새면안되는말 of ["502", "Gateway", "healthz"]) {
    expect(await page.locator("body").innerText()).not.toContain(새면안되는말);
  }

  // **한 번은 쳤다.** `GET` 이다 — 깨우기가 무엇을 바꾸면 안 된다.
  expect(깨움.length).toBeGreaterThanOrEqual(1);
  expect(new Set(깨움)).toEqual(new Set(["GET"]));
});
