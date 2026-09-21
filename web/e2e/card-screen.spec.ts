import { expect, test, type Page } from "@playwright/test";

import type { components, paths } from "../src/api/types.gen";
// **가림 글자를 문자열로 박지 않는다.** 확정본이 바뀌면 상수 하나만 고치면 되고,
// 여기 박아두면 **문구가 바뀌는 날 테스트가 제품을 붙잡는다** (`docs/문구.md` 1.1).
import { PII_MASK } from "../src/lib/pii";
// 문구도 같은 이유로 박지 않는다 — `docs/문구.md` 2.2·2.4·2.5 가 SSOT 다.
import { 버튼, 못닿음 } from "../src/app/copy";
// 상한도 문구와 같다 — **숫자를 여기 박으면 규약이 바뀌는 날 테스트가 제품을 붙잡는다.**
import { 첫폴링, 폴링상한 } from "../src/lib/artwork";
// 대기 대사도 박지 않는다 — `docs/문구.md` **1.5** 가 SSOT 다.
// 진입 라벨은 `용어사전.md` 48행 **아이 화면** 열이다.
import { 책펼치기라벨 as 내책라벨 } from "../src/components/book-link";
// 배지 낱말도 박지 않는다 — `docs/문구.md` **1.8** · `용어사전.md` 36행이 SSOT 다.
import { 티어이름 } from "../src/components/tier-badge";
// 가림 안내도 같은 이유로 박지 않는다 — `docs/문구.md` **1.1** 이 SSOT 다.
import { 가림안내 } from "../src/components/attempt-input";
import { 코드입력 } from "../src/app/child/auth/copy";
import { 상태표시 } from "../src/app/status-copy";
// 튜토리얼 문구도 박지 않는다 — `docs/문구.md` **1.22** 가 SSOT 다.
import { 튜토리얼문구 } from "../src/app/tutorial-copy";
// 문도 박지 않는다 — `docs/문구.md` **1.25** 가 SSOT 다.
import { 모험문 } from "../src/app/chapter-door-copy";

/**
 * 오늘의 모험 화면(A0-2)이 응답 네 가지를 각각 그리는지 본다.
 *
 * **문장은 전부 지어낸 것이다.** 실제 아이 문장을 테스트에 넣지 않는다 —
 * 예시셋과 같은 규칙이다 (`docs/루브릭_예시셋.md`).
 */

/** 계약에서 끌어온다. `make contracts` 로 계약이 갈라지면 **여기서 타입이 깨져 알려준다.** */
type CardResponse =
  paths["/api/v1/cards/next"]["get"]["responses"][200]["content"]["application/json"];

const CARD: CardResponse = {
  card_id: "c99",
  type: "discovery",
  situation: "낡은 등대 문이 반쯤 열려 있고 안쪽에서 파란 빛이 새어 나온다.",
  prompt_label: "탐험가는 어떻게 할까?",
  guide: {
    expression: "default",
    line: "나침반이 조용하네. 네가 뭘 할지 말해주면 움직일 거야!",
  },
  today: { cards_done: 1, cap: 5 },
};

const CARDS_NEXT = "**/api/v1/cards/next";
const ATTEMPTS = "**/api/v1/attempts";
const EVENTS = "**/api/v1/events";

test.use({ serviceWorkers: "block" });

// 계정·글·그림 API와 외부 요청은 실제로 보내지 않는다. 개별 검사의 목이 우선한다.
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/healthz")) return route.fulfill({ status: 200, json: { status: "ok" } });
    if (url.pathname === "/api/v1/child/me") return route.fulfill({ status: 200, json: {
      child_id: "card-test-child", nickname: "등대지기", guide_name: null,
      today: { cards_done: 1, cap: 5, locked: false, resets_at: "2026-09-21T00:00:00+09:00" },
    } });
    if (url.pathname === "/api/v1/chapters/current") return route.fulfill({ status: 404, json: {
      error: { code: "NO_ACTIVE_CHAPTER", message: "검사용 응답" },
    } });
    if (url.pathname === "/api/v1/events") return route.fulfill({ status: 204 });
    if (url.pathname.startsWith("/api/v1/artworks/") && !url.pathname.endsWith("/image")) {
      return route.fulfill({ status: 200, json: { artwork_id: "w1", status: "pending", url: null } });
    }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: { error: {
      code: "UNMOCKED_API", message: "검사용 응답",
    } } });
    return url.origin === origin ? route.continue() : route.abort();
  });
});

/**
 * (a) 정상 응답.
 *
 * **반환 타입을 계약에서 끌어온다.** 여기 타입이 없어서 **`placeholder_url` 이 계약에서
 * 빠진 뒤에도 살아남았다** (2026-09-08). 위 `CARD` 는 타입이 붙어 있어 멀쩡했는데
 * 이 함수만 맨 객체였다 — **낡은 픽스처가 아니라 검사 밖에 있던 픽스처**다.
 * 타입을 붙이면 **다음번 계약 변경이 빨간불로 온다.**
 */
type AttemptResult = components["schemas"]["AttemptResult"];

/**
 * **결과 대사는 카드 대사와 다르다.** 서버가 등급에 따라 골라 `{말}` 자리에 **첫 하이라이트**를
 * 채워 내려준다 (`문구.md` 1.6 — **그 표는 서버 몫이고 프론트는 폴백을 갖지 않는다**).
 *
 * **여기 있는 이유** — 2026-09-09 까지 이 파일의 픽스처가 **결과 응답에 카드의 `guide` 를 그대로**
 * 넣고 있었다. 그러면 **서버가 절대 안 보내는 응답**이 되고(축 ⑩), 더 나쁜 것은
 * **「카드 대사」와 「결과 대사」가 글자까지 같아져 둘을 가르는 검사가 하나도 성립하지 않는다**는 것이다 —
 * 화면이 `screen.card.guide` 를 그려도 **154개가 전부 초록**이었다.
 * **사람이 스크린샷을 보고서야 나왔다.**
 */
const 결과가이드: components["schemas"]["Guide"] = {
  expression: "compass_bright",
  line: "오, '살금살금'에 바늘이 크게 흔들렸어!",
};

function 결과(
  guide: components["schemas"]["Guide"] = 결과가이드,
  highlights: AttemptResult["highlights"] = [],
): AttemptResult {
  return {
    outcome: "result",
    attempt_id: "a1",
    tier: "rare",
    highlights,
    guide,
    // `placeholder_url` 은 빠졌다 — **성공이든 폴백이든 `/artworks/{id}/image` 한 주소**다.
    artwork: { artwork_id: "w1", status: "pending", url: null },
    today: { cards_done: 2, cap: 5, locked: false },
    can_retry: true,
  };
}

/** 오류 봉투는 `docs/api/공통규약.md` 형식이다. */
function errorBody(
  code: string,
  message: string,
  detail?: Record<string, unknown>,
) {
  return JSON.stringify({ error: { code, message, detail } });
}

/** 가로 스크롤이 생기면 태블릿 가로·모바일 세로 어느 쪽이든 깨진 것이다. */
async function 가로스크롤없음(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

test("카드가 오면 상황문을 그린다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );

  await page.goto("/");

  await expect(page.getByText(CARD.situation)).toBeVisible();

  // 가이드는 서버가 준 표정·대사 그대로다. 입력 중에는 `default` 이고, 프론트가 바꾸지 않는다.
  await expect(page.getByText(CARD.guide.line)).toBeVisible();
  await expect(page.locator('img[src="/guide/default-stage.png"]')).toBeVisible();

  // 자유 입력창 하나. **선택지 버튼이 없어야 한다** — 있으면 「직접 쓴다」가 무너진다.
  const 입력창 = page.getByLabel(CARD.prompt_label);
  await expect(입력창).toBeVisible();
  await 입력창.fill("등대 문틈으로 손전등을 비춰 안쪽을 살핀다");
  await expect(입력창).toHaveValue("등대 문틈으로 손전등을 비춰 안쪽을 살핀다");
  // 버튼은 「보내기」 하나뿐이어야 한다. 선택지가 몰래 생기면 여기서 걸린다.
  // **`main` 안에서 센다.** 밖까지 세면 개발 빌드의 Next 오버레이 버튼(`#next-logo`)이 함께 잡혀
  // **우리 UI 와 무관한 이유로 빨간불**이 된다 — 라우트가 둘이 되고 중간에 컴파일이 일어나자 실제로 그랬다.
  await expect(page.locator("main").getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: 버튼.그림으로보기 })).toBeEnabled();

  await 가로스크롤없음(page);

  // 아이 화면에 나오면 안 되는 말들 (`docs/용어사전.md` 8장).
  // 카드 종류(발견/위기/만남)도 내부 용어라 화면에 없어야 한다.
  const 화면 = await page.locator("main").innerText();
  for (const 금지어 of ["점수", "채점", "연습", "학습", "보스", "앨범", "발견"]) {
    expect(화면).not.toContain(금지어);
  }
});

test("쓸수록 나침반이 밝아진다 — 숫자도 진행바도 없이", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.goto("/");

  // 빛은 그라디언트로 칠한 원 하나다. 밝기는 그 원의 `opacity` 로만 나타난다.
  // **표식이 붙은 원 하나만 본다.** 종전에는 `fill="url(..."` 로 골랐는데 화면이 다듬어지며
  // **그런 원이 넷**이 됐다 — 바깥 테두리·안쪽 빛까지 걸려 strict mode 에서 죽었다.
  // 재려는 것은 **글을 쓸수록 밝아지는 그 빛**이고, 거기에만 `data-compass-glow` 가 있다.
  const 빛 = page.locator("main svg circle[data-compass-glow]");
  const 밝기 = async () =>
    Number(await 빛.evaluate((el) => getComputedStyle(el).opacity));

  const 입력창 = page.getByLabel(CARD.prompt_label);

  // **몇 글자만 써도 눈에 띄게 움직여야 한다.** 여기가 아이가 규칙을 배우는 자리다 —
  // 2026-09-09 실기기에서 **빈 상태와 6자가 눈으로 같았고**, 그래서 그 표시가
  // **정체불명의 점**으로 남았다.
  // **전이가 0.5초다.** 「조금이라도 커졌다」에서 멈추면 **전이 중간값을 잡는다** —
  // 2026-09-09 에 실제로 그렇게 0.35 를 읽고 검사가 헛돌 뻔했다. **단계마다 목표치까지 기다린다.**
  await 입력창.fill("문을 연다");
  await expect.poll(밝기).toBeGreaterThan(0.33);
  const 조금 = await 밝기();

  // 서른 자쯤. **PRD A0-2 MUST 는 「30자 넘으면 밝아짐」**이다.
  const 서른쯤 = "낡은 등대 문틈으로 손전등을 비추자 계단이 보였다";
  await 입력창.fill(서른쯤);
  await expect.poll(밝기).toBeGreaterThan(0.6);
  const 밝아짐 = await 밝기();
  expect(밝아짐).toBeGreaterThan(조금);

  // **30자를 넘어서도 계속 올라야 한다.** 전에는 여기서 멈췄고 — **「30에서 가득」은 PRD 가 아니라
  // 우리 구현이었다** — **H2 합격선이 회당 150자인데 30~150 구간에 신호가 0** 이었다.
  // **더 써도 반응이 없으면 더 쓸 이유가 없다.**
  await 입력창.fill(서른쯤.repeat(2));
  await expect.poll(밝기).toBeGreaterThan(0.7);
  expect(await 밝기()).toBeGreaterThan(밝아짐);

  await 입력창.fill(서른쯤.repeat(7));
  await expect.poll(밝기).toBe(1);

  // 계단이 아니라 연속 변화다 — 적게 썼을 때가 가득 찬 것보다 어두워야 한다.
  expect(조금).toBeLessThan(1);

  // **숫자·퍼센트·진행바가 화면에 없다.** 숫자를 지운 자리에 바를 넣으면 같은 것이 된다.
  const 화면 = await page.locator("main").innerText();
  expect(화면).not.toMatch(/[0-9]|%/);
  await expect(page.locator("main progress, main [role='progressbar']")).toHaveCount(0);
});

test("쓴 것을 보낸다 — 글자 수로 잠기지 않고, retry_of 는 비운다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.goto("/");

  const 보내기 = page.getByRole("button", { name: 버튼.그림으로보기 });
  const 입력창 = page.getByLabel(CARD.prompt_label);

  // 아무것도 안 썼을 때만 막힌다. **30자와 무관하다.**
  await expect(보내기).toBeDisabled();
  await 입력창.fill("문을 연다");
  await expect(보내기).toBeEnabled();

  let 보낸것: Record<string, unknown> = {};
  await page.route(ATTEMPTS, (route) => {
    보낸것 = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: 결과() });
  });
  await 보내기.click();

  // **결과 화면에 닿은 신호로 삽화 자리를 본다.** 전에는 가이드 대사를 봤는데,
  // 그 대사는 **그림이 뜬 뒤에만** 나온다 — 굽는 6~8초 동안은 등급이 새지 않게 가려져 있다
  // (`문구.md` 1.5). 이 검사가 보는 것은 **보낸 내용**이지 연출이 아니다.
  await expect(page.locator("main [data-삽화자리]")).toBeVisible();
  expect(보낸것.card_id).toBe(CARD.card_id);
  expect(보낸것.text).toBe("문을 연다");
  // **항상 null.** 채우면 그 카드가 하루 5장에서 안 빠지고, H2 회당 평균도 갈린다.
  expect(보낸것.retry_of).toBeNull();
});

/**
 * **삽화 주소는 서버가 절대 주소로 준다.** 앞에 아무것도 붙이지 않는 것이 계약이다
 * (`docs/api/Stage0.md` 5절). E2E 는 web 과 api 가 같은 오리진이라 여기서도 그 모양이다.
 */
const ARTWORK = "w1";
const ARTWORK_URL = `http://localhost:3000/api/v1/artworks/${ARTWORK}/image`;

/** 1x1 투명 PNG. **그림이 실제로 떴는지**를 보려면 바이트가 진짜여야 한다. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("그림이 뜬다 — 서버가 준 주소 그대로, crossOrigin 없이", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({ status: 200, json: 결과() }),
  );

  // 첫 물음에는 아직 굽는 중이고, 그다음에 뜬다. **두 번은 물어야 폴링이 실제로 돈 것**이다.
  let 물어본횟수 = 0;
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) => {
    물어본횟수 += 1;
    const artwork: components["schemas"]["Artwork"] = {
      artwork_id: ARTWORK,
      status: 물어본횟수 === 1 ? "pending" : "ready",
      url: 물어본횟수 === 1 ? null : ARTWORK_URL,
      tier: "rare",
      // **참이어도 화면이 달라지지 않아야 한다** (B-3 완료 조건).
      // 「기본 그림이야」라고 말하는 순간 아이가 자기 문장이 부족했다고 읽는다.
      fallback: true,
    };
    return route.fulfill({ status: 200, json: artwork });
  });

  // **이미지 라우트를 나중에 건다.** Playwright 는 나중 것이 먼저 걸린다.
  const 그림요청: string[] = [];
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) => {
    그림요청.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 });
  });

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  // 굽는 동안 화면의 유일한 말은 **액자 안 대기 대사**다 (`문구.md` 1.5).
  const 대기대사 = page.locator("main [data-대기대사]");
  await expect(대기대사).toBeVisible();
  await expect(대기대사).toHaveText("네 이야기를 그림으로 펼치고 있어.");

  // **결과 대사가 여기 있으면 안 된다.** 있으면 아이가 그림보다 먼저 등급 반응을 읽는다 —
  // 2026-09-08 까지 실제로 그랬고, 1.5 가 생긴 이유가 그것이다.
  // **카드 대사가 아니라 결과 대사를 봐야 한다** — 둘이 같은 문자열이면 이 줄은 아무것도 안 잰다.
  await expect(page.getByText(결과가이드.line)).toHaveCount(0);
  // **배지도 마찬가지다.** 배지가 먼저 뜨면 그림은 이미 아는 것을 확인하는 절차가 된다.
  await expect(page.locator("main [data-티어배지]")).toHaveCount(0);

  const 그림 = page.locator(`main img[src="${ARTWORK_URL}"]`);
  await expect(그림).toBeVisible();
  expect(물어본횟수).toBeGreaterThanOrEqual(2);

  // 그림이 온 **뒤에** 결과 대사와 배지가 온다. 대기 대사는 그림이 덮어 사라진다.
  // **카드 대사가 아니다** — 서버가 등급 보고 고른 것이고 `{말}` 이 채워져 있다 (`문구.md` 1.6).
  await expect(page.getByText(결과가이드.line)).toBeVisible();
  await expect(page.getByText(CARD.guide.line)).toHaveCount(0);
  await expect(page.locator("main [data-티어배지]")).toHaveText(티어이름.rare);
  await expect(대기대사).toHaveCount(0);

  // **`crossOrigin` 이 붙으면 쿠키가 안 실려 그림이 통째로 안 뜬다** (`Stage0.md` 5절 ⚠).
  // 습관적으로 붙는 속성이라 **여기서 못을 박는다** — 붙는 날 네트워크 탭을 안 열면 원인이 안 보인다.
  await expect(그림).not.toHaveAttribute("crossorigin", /.*/);

  // **주소 앞에 아무것도 안 붙였다.** 상대 경로로 바꾸거나 오리진을 덧대면 여기서 걸린다.
  expect(그림요청).toContain(ARTWORK_URL);

  // **그림을 막 받은 이 자리에서 내 책으로 들어간다** — 「이 장면이 네 책에 남아」가
  // 파는 것이 그것이다. **굽는 동안에는 이 자리 전체가 안 그려지므로 링크도 없다.**
  await expect(page.getByRole("link", { name: 내책라벨 })).toHaveAttribute(
    "href",
    "/book",
  );

  // **`fallback: true` 인데도 아이에게 아무 말도 안 한다.** 그냥 그림이 나온 것이어야 한다.
  //
  // **「기본」을 여기서 못 센다** — 2026-09-08 부터 그것이 **티어 배지의 낱말**이다
  // (`용어사전.md` 36행 아이 화면 열). 폴백이 샌 신호로 쓰면 **`basic` 결과에서 무조건 빨간불**이 된다.
  const 화면 = await page.locator("main").innerText();
  for (const 금지어 of ["실패", "대신", "임시"]) {
    expect(화면).not.toContain(금지어);
  }

  // **「티어」는 내부 용어라 화면에 없어야 한다** (`문구.md` 1.8).
  // 「희귀」는 되고 「희귀 티어」는 안 된다 — 사전의 열을 넘지 않는다.
  expect(화면).not.toContain("티어");
});

test("그림이 끝내 안 와도 가이드는 그대로 그린다 — 실패 화면을 만들지 않는다", async ({
  page,
}) => {
  // **상한(15초)을 실제로 넘겨본다.** 안 넘기면 「기다리는 중」만 보고 「못 받았다」를 봤다고 하게 된다.
  test.slow();

  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({ status: 200, json: 결과() }),
  );
  // **서버에 통째로 못 닿는 경우**다. 정상 경로에서는 서버가 15초에 기본 에셋으로 확정하므로
  // 여기까지 오지 않는다 — 그래서 이 검사가 **유일하게 「못받음」을 밟는 자리**다.
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) => route.abort());

  const 쓴것 = "등대 계단을 한 칸씩 올라간다";
  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill(쓴것);
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  // 굽는 동안에는 자리가 잡혀 있고 그 안에서 대기 대사가 기다린다.
  const 자리 = page.locator("main [data-삽화자리]");
  await expect(자리).toBeVisible();
  await expect(page.locator("main [data-대기대사]")).toBeVisible();

  // **상한을 넘기면 자리가 통째로 사라진다.** 빈 액자를 남기면 아이가
  // 「여기 그림이 있어야 하는데 없다」로 읽어, 실패 화면을 안 만든다는 결정이 연출로 뒤집힌다.
  await expect(자리).toHaveCount(0, { timeout: 폴링상한 + 5_000 });

  // 그림만 없다. **가이드 대사도 배지도 그대로 있다** (`문구.md` 1.7) — 아이는 자기 문장이
  // 통했다는 것을 알아야 하고, 그림은 「내 책」에서 다시 본다. 오류 문구도 버튼도 안 생긴다.
  await expect(page.getByText(결과가이드.line)).toBeVisible();
  await expect(page.locator("main [data-티어배지]")).toHaveText(티어이름.rare);
  await expect(page.getByRole("button", { name: 버튼.다시열기 })).toHaveCount(0);
  // **아무 말도 안 한다** (`문구.md` 1.7). 금지어 목록으로 막지 않고 **화면에 남은 것을 통째로
  // 센다** — 목록은 **적어 둔 낱말만** 막지만, 여기서 막아야 하는 것은 **새 문장이 생기는 것**이다.
  // **장식은 글이 아니다.** `aria-hidden` 인 것(「내 책 펼치기」의 화살표 등)을 빼고 센다 —
  // 이 검사가 잡으려는 것은 **새 문장이 생기는 것**이지 장식이 바뀌는 것이 아니다.
  // 스크린리더도 그것을 안 읽는다.
  const 화면 = await page.locator("main").evaluate((el) => {
    const 사본 = el.cloneNode(true) as HTMLElement;
    사본.querySelectorAll('[aria-hidden="true"]').forEach((장식) => { 장식.remove(); });
    사본.style.position = "absolute";
    사본.style.left = "-9999px";
    el.ownerDocument.body.append(사본);
    const 글 = 사본.innerText;
    사본.remove();
    return 글;
  });
  // 줄 사이 빈 줄은 **블록이 나뉜 자국일 뿐**이라 센 것에서 뺀다. 세는 것은 **문장의 목록**이다.
  const 줄들 = 화면
    .split("\n")
    .map((줄) => 줄.trim())
    .filter((줄) => 줄 !== "");
  // **순서가 곧 검사다** (2026-09-09). 아이 문장이 **가이드 대사 뒤**에 오면
  // **누구 말인지 안 읽힌다** — 실기기에서 실제로 그랬고, 그러면 관찰 신호 7번을 못 잰다.
  // 지금 순서는 **내 책의 한 쪽과 같다**: 그림(여기서는 사라졌다) · 문장 · 배지.
  // **이 배열을 고칠 때는 화면 순서를 고치는 것**이라는 걸 알고 고쳐야 한다.
  // **2026-09-12 에 「다음 장면 열기」가 들어왔다** (`문구.md` 1.17) — 결과 화면에
  // **이어갈 길이 하나도 없었다.** 이 배열이 그 변경을 잡았다: 화면에 줄이 하나 늘어난 것을
  // **아무도 안 시켰는데 빨간불로 알려준 자리**다. **그게 이 검사가 하는 일이다.**
  //
  // **문이 「내 책」보다 앞이다** — 그림을 막 받은 아이가 이어서 하는 일이 이쪽이고
  // **더 흔한 길이 먼저**다. 이 순서를 바꾸는 것은 **화면을 바꾸는 것**이다.
  // **2026-09-15 에 「다시 써보기」가 들어왔다** (`문구.md` 2.2 · 결과 문서 ④) —
  // **이 배열이 또 그 변경을 잡았다.** 순서는 `MVP_PRD.md` 72행(`[다시 써보기 | 다음 카드]`)이다.
  expect(줄들).toEqual([
    쓴것,
    티어이름.rare,
    결과가이드.line,
    버튼.다시써보기,
    버튼.새이야기만나기,
    내책라벨,
  ]);
  expect(화면).not.toContain(못닿음.보내기);
});

test("쓴 문장이 그대로 나오고 묘사어 자리에 표시가 붙는다", async ({ page }) => {
  const 쓴것 = "낡은 등대 문틈으로 살금살금 손전등을 비췄다";
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({
      status: 200,
      json: 결과(결과가이드, [
        { text: "낡은", kind: "adj" },
        { text: "살금살금", kind: "adv" },
        // **원문에 없는 것**이다. 서버가 걸러 주기로 돼 있지만(`Stage0.md` 4절)
        // **프론트는 그 보장 위에 서되 못 찾으면 조용히 건너뛴다.**
        { text: "캄캄한", kind: "adj" },
      ]),
    }),
  );
  // 그림이 바로 뜨게 둔다 — 이 검사가 보는 것은 문장이다.
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "ready",
        url: ARTWORK_URL,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill(쓴것);
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  // **한 글자도 안 잃는다.** 아이 문장은 창작물이라 표시하려다 깎으면 안 된다.
  const 문장 = page.locator("main [data-쓴문장]");
  await expect(문장).toHaveText(쓴것);

  // 찾은 둘만 표시된다. **못 찾은 「캄캄한」은 조용히 건너뛴다** — 화면이 죽지 않는다.
  await expect(문장.locator("[data-강조]")).toHaveText(["낡은", "살금살금"]);

  // **가려진 자리에 설명을 붙이지 않는다**(미결 11-5 대표 판정)는 것과 같은 규칙으로,
  // 표시 옆에 해설을 두지 않는다 — 어느 말이 통했는지는 **가이드가 이미 말한다.**
  const 화면 = await page.locator("main").innerText();
  expect(화면).not.toContain("묘사");
  expect(화면).not.toContain("단어");
});

test("굽는 동안에는 쓴 문장도 표시도 안 보인다 — 표시가 많고 적은 것이 곧 신호다", async ({
  page,
}) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({
      status: 200,
      json: 결과(결과가이드, [{ text: "낡은", kind: "adj" }]),
    }),
  );
  // 계속 굽는 중으로 둔다.
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "pending",
        url: null,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("낡은 문을 연다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  await expect(page.locator("main [data-대기대사]")).toBeVisible();
  await expect(page.locator("main [data-쓴문장]")).toHaveCount(0);
});

test("되묻기가 오면 그 자리에 머문다 — 쓴 문장이 남는다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({
      status: 200,
      json: {
        outcome: "scaffold",
        attempt_id: "a1",
        guide: { expression: "compass_dim", line: "그림자를 어떻게 할 건지 조금만 더 말해줄래?" },
        scaffold_count: 1,
        today: { cards_done: 1, cap: 5, locked: false },
      },
    }),
  );
  await page.goto("/");

  const 입력창 = page.getByLabel(CARD.prompt_label);
  await 입력창.fill("문을 연다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  // 질문은 가이드 대사로 온다. 표정도 서버가 준 것으로 바뀐다.
  await expect(
    page.getByText("그림자를 어떻게 할 건지 조금만 더 말해줄래?"),
  ).toBeVisible();
  await expect(page.locator('img[src="/guide/compass_dim-stage.png"]')).toBeVisible();

  // **입력창이 그대로 있고 쓴 문장도 그대로다.** 다시 보낼 수 있어야 한다.
  await expect(입력창).toHaveValue("문을 연다");
  await expect(page.getByRole("button", { name: 버튼.그림으로보기 })).toBeEnabled();
});

test("차단돼도 쓴 문장을 지우지 않는다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({
      status: 200,
      json: {
        outcome: "blocked",
        // **`"moderation"` 하나뿐이다.** 한때 `"pii"` 가 있었는데 **대표가 「서버 2차도 가리고
        // 진행」으로 판정**하면서 계약에서 빠졌다 (미결 11-5, 2026-09-08) — PII 로는 차단이
        // **아예 안 나가므로** 그 분기는 영영 안 쓰인다. **없는 응답을 테스트가 지어내면
        // 죽은 분기를 살아 있는 것처럼 붙잡는다.**
        reason: "moderation",
        guide: { expression: "compass_dim", line: "나침반이 그 말은 못 알아듣네. 다르게 말해줄래?" },
        today: { cards_done: 1, cap: 5, locked: false },
      },
    }),
  );
  await page.goto("/");

  const 입력창 = page.getByLabel(CARD.prompt_label);
  await 입력창.fill("문을 열고 들어간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  await expect(page.getByText("다르게 말해줄래?")).toBeVisible();
  await expect(입력창).toHaveValue("문을 열고 들어간다");

  // 오류 화면으로 때우지 않는다 — 아이는 자기가 뭘 잘못했는지 모른 채 막히면 안 된다.
  await expect(page.getByRole("button", { name: 버튼.다시열기 })).toHaveCount(0);
});

test("오늘 카드를 다 쓰면 서버가 준 대사를 그대로 보여준다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: errorBody("DAILY_CAP_REACHED", "오늘 카드를 다 썼어요", {
        guide: { expression: "session_end", line: "오늘 모험은 여기까지! 네가 쓴 글과 그림이 책에 모여 있어. 내일 또 보자." },
      }),
    }),
  );

  await page.goto("/");

  await expect(page.getByText("오늘 모험은 여기까지! 네가 쓴 글과 그림이 책에 모여 있어. 내일 또 보자.")).toBeVisible();
  await expect(page.locator('img[src="/guide/session_end-stage.png"]')).toBeVisible();
  await expect(page.locator(".game-shell--ending")).toBeVisible();
  // 쓰기가 끝나도, 앞서 저장한 책을 읽는 길은 남아 있다.
  const 내책 = page.getByRole("link", { name: 내책라벨, exact: true });
  await expect(내책).toBeVisible();
  await expect(내책).toHaveAttribute("href", "/book");
  await expect(page.locator("textarea")).toHaveCount(0);
  await 가로스크롤없음(page);
});

test("여섯 번째를 보내도 가이드가 말한다 — 두 목소리가 나란히 서지 않는다", async ({
  page,
}) => {
  const 가이드대사 = "오늘 모험은 여기까지! 네가 쓴 글과 그림이 책에 모여 있어. 내일 또 보자.";
  const 앱문구 = "오늘 카드를 다 썼어요";

  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  // **하루 상한은 보내는 쪽에서도 온다** (A0-5). 카드를 부를 때만 오는 것이 아니다.
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: errorBody("DAILY_CAP_REACHED", 앱문구, {
        guide: { expression: "session_end", line: 가이드대사 },
      }),
    }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("문을 연다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  // **목소리 규칙** (`문구.md` 0장) — 한 화면에 둘이 오면 `guide.line` 만 나온다.
  // 여기가 빠져 있어 **보내는 쪽만 앱 목소리로 떨어졌다**: 가이드가 하던 말이 갑자기 존댓말이 된다.
  await expect(page.getByText(가이드대사)).toBeVisible();
  expect(await page.locator("main").innerText()).not.toContain(앱문구);
  // **표정도 서버가 준 것 그대로다.** 대사만 꺼내 쓰면 `session_end` 얼굴이 영영 안 나온다.
  await expect(page.locator('img[src="/guide/session_end-stage.png"]')).toBeVisible();
});

test("종료 인사에 모르는 표정이 오면 캐릭터를 세우지 않는다 — 말은 그대로 전한다", async ({
  page,
}) => {
  const 가이드대사 = "오늘 모험은 여기까지! 네가 쓴 글과 그림이 책에 모여 있어. 내일 또 보자.";
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: errorBody("DAILY_CAP_REACHED", "오늘 카드를 다 썼어요", {
        // 계약이 넓어지는 날 실제로 올 수 있는 값이다. **파일명이 곧 `expression`** 이라
        // 그대로 넘기면 **없는 PNG 를 불러 그림이 깨진다.**
        guide: { expression: "compass_spin", line: 가이드대사 },
      }),
    }),
  );

  await page.goto("/");

  // 말은 잃지 않는다 — 아이가 왜 못 들어가는지 알아야 한다.
  await expect(page.getByText(가이드대사)).toBeVisible();
  // 깨진 그림을 세우느니 안 세운다.
  await expect(page.locator("main img")).toHaveCount(0);
  const 내책 = page.getByRole("link", { name: 내책라벨, exact: true });
  await expect(내책).toBeVisible();
  await expect(내책).toHaveAttribute("href", "/book");
  await 가로스크롤없음(page);
});

test("서버가 거절하면 빈 화면이 아니라 서버 문구가 뜬다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: errorBody("INTERNAL_ERROR", "지금은 길을 찾을 수 없어요"),
    }),
  );

  await page.goto("/");

  await expect(page.getByText("지금은 길을 찾을 수 없어요")).toBeVisible();
});

test("서버에 닿지 못하면 다시 열 수 있다", async ({ page }) => {
  // 첫 요청은 아예 실패시킨다 — api 를 내리지 않고 「못 닿음」을 만드는 유일한 방법이다.
  await page.route(CARDS_NEXT, (route) => route.abort("failed"));

  await page.goto("/");

  const 다시열기 = page.getByRole("button", { name: 버튼.다시열기 });
  await expect(다시열기).toBeVisible();

  // **개발 빌드에서만** 원인 후보가 함께 뜬다 (운영 번들에서는 `hints` 가 비어 이 블록이 없다).
  // E2E 는 `next dev` 로 돌아 개발 빌드다. 아이가 읽는 문구는 그대로 있고, 이건 그 아래 따로 붙는다.
  await expect(page.getByText(못닿음.장면)).toBeVisible();
  const 단서 = page.locator("[data-dev-hints]");
  await expect(단서).toBeVisible();
  // 같은 오리진이라(`NEXT_PUBLIC_API_BASE_URL=/api/v1`) CORS·mixed content 는 후보가 아니다.
  // **없는 원인을 지어내면 엉뚱한 데를 뜯게 된다.**
  await expect(단서).toContainText("make dev-api");
  await expect(단서).not.toContainText("CORS");

  // 두 번째부터는 정상 응답. 다시 열기가 실제로 다시 부르는지까지 본다.
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await 다시열기.click();

  await expect(page.getByText(CARD.situation)).toBeVisible();
});

test("개인정보를 쓰면 그 자리에서 가려진다 — 막지 않고 가린다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(EVENTS, (route) => route.fulfill({ status: 204 }));
  await page.goto("/");

  const 입력창 = page.getByLabel(CARD.prompt_label);
  const 보내기 = page.getByRole("button", { name: 버튼.그림으로보기 });

  await 입력창.fill("등대지기한테 010-1234-5678 로 전화한다");

  // 번호는 사라지고 나머지 문장은 그대로다. **전송을 막지 않는다** (대표 판정 2026-09-07).
  await expect(입력창).toHaveValue(`등대지기한테 ${PII_MASK} 로 전화한다`);
  await expect(보내기).toBeEnabled();

  // 가린 이유를 말해주는 유일한 자리다. **혼내는 말이 아니어야 한다.**
  const 안내 = page.getByRole("status");
  await expect(안내).toHaveText(가림안내.phone);
  expect(await 안내.innerText()).not.toMatch(/안 돼요|하지 마|틀렸|나쁜/);

  // **다음 글자를 쳐도 안내가 남아 있어야 한다.** 한 번의 타이핑에 사라지면
  // 아이가 읽기도 전에 없어져, 자기 글자가 왜 바뀌었는지 알 방법이 사라진다.
  await 입력창.fill(`등대지기한테 ${PII_MASK} 로 전화한다 그리고 문을 연다`);
  await expect(안내).toHaveText(가림안내.phone);

  // 서버로 가는 것도 **가린 문장**이다. 서버는 이걸 책 콘텐츠로 저장한다.
  let 보낸것: Record<string, unknown> = {};
  await page.route(ATTEMPTS, (route) => {
    보낸것 = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: 결과() });
  });
  await 보내기.click();
  // **결과 화면에 닿은 신호는 삽화 자리다** — 위 「쓴 것을 보낸다」와 같은 이유다.
  // 여기 있던 `CARD.guide.line` 은 **경쟁 조건으로 초록이었다**: 전환이 끝나기 전
  // **카드 화면에 떠 있던 같은 대사**를 잡고 있었다. 결과 화면의 대사는 그림이 뜬 뒤에야 온다.
  await expect(page.locator("main [data-삽화자리]")).toBeVisible();
  expect(보낸것.text).toBe(`등대지기한테 ${PII_MASK} 로 전화한다 그리고 문을 연다`);
});

test("가린 자리는 아이가 지울 수 있다 — 덩어리가 아니라 평범한 글자다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(EVENTS, (route) => route.fulfill({ status: 204 }));
  await page.goto("/");

  const 입력창 = page.getByLabel(CARD.prompt_label);
  await 입력창.fill("010-1234-5678");
  await expect(입력창).toHaveValue(PII_MASK);

  // 지워지지 않는 덩어리면 아이가 자기 문장을 못 고친다. 한 글자씩 지워져야 한다.
  await 입력창.press("End");
  await 입력창.press("Backspace");
  await expect(입력창).toHaveValue(PII_MASK.slice(0, -1));
});

test("가렸다는 사실만 남긴다 — 아이 문장도 가린 값도 싣지 않는다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );

  const 이벤트: Record<string, unknown>[] = [];
  await page.route(EVENTS, (route) => {
    const body = route.request().postDataJSON() as {
      events: Record<string, unknown>[];
    };
    이벤트.push(...body.events);
    return route.fulfill({ status: 204 });
  });
  await page.goto("/");

  await page
    .getByLabel(CARD.prompt_label)
    .fill("등대지기한테 010-1234-5678 로 전화한다");

  await expect.poll(() => 이벤트.length).toBeGreaterThan(0);

  const 하나 = 이벤트[0];
  expect(하나.event).toBe("pii_masked");
  expect(하나.layer).toBe("client");
  expect(하나.kind).toBe("phone");
  // **원문 필드 없음** (`docs/api/Stage0.md` 7절). 번호도 문장도 실려 나가지 않는다.
  expect(JSON.stringify(이벤트)).not.toContain("010");
  expect(JSON.stringify(이벤트)).not.toContain("등대지기");
});

test("한글 조합 중에는 손대지 않는다 — 조합이 끝난 뒤에 가린다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(EVENTS, (route) => route.fulfill({ status: 204 }));
  await page.goto("/");

  const 입력창 = page.getByLabel(CARD.prompt_label);
  await 입력창.click();

  // IME 를 흉내 낸다. Playwright 의 타이핑은 조합 이벤트를 만들지 않아 직접 쏜다.
  // **조합 중에 값을 갈아치우면 IME 가 조합을 잃고 글자가 깨진다** — 취향이 아니라 버그다.
  const 치기 = (v: string, 조합: "start" | "end" | null) =>
    page.evaluate(
      ({ v, 조합 }) => {
        const el = document.querySelector("#attempt") as HTMLTextAreaElement;
        if (조합 === "start") {
          el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        }
        // React 가 관리하는 값이라 네이티브 setter 를 거쳐야 변경이 인식된다.
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!;
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        if (조합 === "end") {
          el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
        }
      },
      { v, 조합 },
    );

  await 치기("우리 학교는 한빛초등학교", "start");
  // **조합 중에는 그대로 있어야 한다.** 여기서 가려지면 조합이 깨진 것이다.
  await expect(입력창).toHaveValue("우리 학교는 한빛초등학교");

  await 치기("우리 학교는 한빛초등학교야", "end");
  // 조합이 끝난 지금 가린다.
  await expect(입력창).toHaveValue(`우리 학교는 ${PII_MASK}야`);
});

test("불러오는 동안 무엇을 하고 있는지 말한다", async ({ page }) => {
  // **응답을 우리가 쥐고 있다가 놓는다.** 그냥 두면 로딩이 눈 깜짝할 새 지나가
  // 이 검사가 **있으나 마나**가 된다 — 재는 창을 우리가 만든다.
  let 놓기: () => void = () => {};
  const 붙잡기 = new Promise<void>((r) => (놓기 = r));
  await page.route(CARDS_NEXT, async (route) => {
    await 붙잡기;
    return route.fulfill({ status: 200, json: CARD });
  });

  await page.goto("/");

  // `문구.md` 2.5. **빈 화면으로 두지 않는다** — 아이는 왜 아무 일도 안 일어나는지 알 방법이 없다.
  await expect(page.getByText(상태표시.장면부르는중)).toBeVisible();

  놓기();
  await expect(page.getByText(CARD.situation)).toBeVisible();
  await expect(page.getByText(상태표시.장면부르는중)).toHaveCount(0);
});

test("보내기가 못 닿으면 쓴 문장을 지킨다 — 화면을 넘기지 않는다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  await page.route(ATTEMPTS, (route) => route.abort("failed"));
  await page.goto("/");

  const 문장 = "낡은 등대 문틈으로 손전등을 비추자 젖은 발자국이 이어져 있었다";
  const 입력창 = page.getByLabel(CARD.prompt_label);
  await 입력창.fill(문장);
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  // **`문구.md` 2.4 뼈대다** — 장면을 못 연 것이 아니라 **못 보낸 것**이다.
  await expect(page.getByText(못닿음.보내기)).toBeVisible();
  await expect(page.getByText(못닿음.장면)).toHaveCount(0);

  // **핵심.** 화면을 넘기면 「다시 열기」가 **다른 카드**를 불러오고, 입력칸에 남은 문장이
  // **앞 장면에 쓴 글인 채로 새 장면에 붙는다.** 그래서 카드도 문장도 그 자리에 있어야 한다.
  await expect(page.getByText(CARD.situation)).toBeVisible();
  await expect(입력창).toHaveValue(문장);
  await expect(page.getByRole("button", { name: 버튼.다시열기 })).toHaveCount(0);
});

/** 정사각형 픽스처의 원본 비율. 구현 상수를 가져오지 않고 실제 화면을 잰다. */
const 픽스처비율 = 1;

test("결과는 정사각형 원본을 같은 비율의 액자에 온전히 보여준다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({ status: 200, json: 결과() }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "ready",
        url: ARTWORK_URL,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  const 액자 = page.locator("main [data-삽화자리]");
  await expect(액자).toBeVisible();

  // 이 픽스처는 정사각형이다. 비정사각 원본은 별도 검사에서 원본 비율과 대조한다.
  const 자리 = await 액자.boundingBox();
  expect(자리).not.toBeNull();
  expect(자리!.width / 자리!.height).toBeCloseTo(픽스처비율, 2);

  // 원본을 잘라 틀에 맞추지 않는다.
  const 그림 = 액자.locator("img");
  await expect(그림).toHaveCSS("object-fit", "contain");
  await expect(그림).toHaveAttribute("src", ARTWORK_URL);
});

test("그림이 화면을 다 먹지 않는다 — 아래 것들이 접히면 보상이 아니다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({ status: 200, json: 결과() }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "ready",
        url: ARTWORK_URL,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  const 액자 = page.locator("main [data-삽화자리]");
  await expect(액자).toBeVisible();
  const 자리 = (await 액자.boundingBox())!;
  const 화면높이 = page.viewportSize()!.height;

  // **모바일 세로(390×844)에서 폭을 다 쓰면 액자가 672px 다** — 그러면 바로 아래
  // 배지·가이드·아이 문장·「내 책」이 통째로 접힌다. 높이 상한이 그것을 막는다.
  expect(자리.height).toBeLessThan(화면높이 * 0.7);

  // **비율은 그대로다.** 높이를 `max-height` 로 자르면 상자가 옆으로 퍼져
  // 그림이 레터박스로 앉는다 — 그래서 폭 상한으로 환산해서 건다.
  expect(자리.width / 자리.height).toBeCloseTo(픽스처비율, 2);

  // 액자 바로 아래 등급 배지가 **스크롤 없이 보인다.**
  const 배지 = (await page.locator("main [data-티어배지]").boundingBox())!;
  expect(배지.y + 배지.height).toBeLessThan(화면높이);
});

test("낮은 화면에서도 액자가 비율을 지킨다 — 실기기가 여기서 깨졌다", async ({ page }) => {
  // **iPad 6 가로다** (2026-09-09 실측 뷰포트 1024×768). 프로젝트 뷰포트 둘(1280×800·390×844)이
  // **둘 다 이 자리를 안 밟았다** — 실기기에서 액자가 **260×237(비율 1.10)** 로 찍혔는데
  // 검사는 0.579 로 초록이었다. **재는 조건이 달라서 모순이 아니었다.**
  await page.setViewportSize({ width: 1024, height: 768 });

  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({ status: 200, json: 결과() }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "ready",
        url: ARTWORK_URL,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  const 액자 = page.locator("main [data-삽화자리]");
  await expect(액자).toBeVisible();
  const 자리 = (await 액자.boundingBox())!;

  // **높이가 눌리면 안 된다.** 액자 안에는 흐름에 있는 것이 없어서(`Image fill` 은 절대 배치)
  // **`min-height:auto` 가 0 으로 풀리고**, 세로 flex 가 꽉 차면 **비율을 이기고 찌그러뜨린다.**
  expect(자리.width / 자리.height).toBeCloseTo(픽스처비율, 2);
});

test("이미 구워진 그림은 그 자리에서 뜬다 — 3초를 기다리지 않는다", async ({ page }) => {
  // **2026-09-09 계약 변경**(`cc5b724`). 백엔드가 lazy 캐시를 세우면서
  // **`POST /attempts` 가 캐시 히트면 `ready` 와 `url` 을 그 자리에서 실어 온다.**
  // **스키마는 안 바뀌고 값만 바뀌므로 `make contracts-check` 가 못 잡는다.**
  //
  // **파일럿에서는 예외가 아니라 상시다** — 60조합을 다 미리 뽑으므로 **거의 모든 시도가 캐시 히트**다.
  // 여기서 3초를 기다리면 **아이가 매번 이미 있는 그림을 두고 3초를 본다.**
  //
  // **이 갈래에 검사가 하나도 없었다** — 픽스처가 전부 `pending` 만 줬다.
  // 계약이 **두 모양을 다 허용하는데 한 모양만 재고 있었다.**
  const 즉시그림 = `${ARTWORK_URL}`;

  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...결과(결과가이드, [{ text: "살금살금", kind: "adv" }]),
        artwork: { artwork_id: ARTWORK, status: "ready", url: 즉시그림 },
      } satisfies AttemptResult,
    }),
  );

  // **폴링이 아예 안 나가야 한다.** 나가면 「3초를 안 기다린다」가 거짓이다.
  let 물어봤나 = false;
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) => {
    물어봤나 = true;
    return route.fulfill({ status: 200, json: { artwork_id: ARTWORK, status: "ready", url: 즉시그림, tier: "rare", fallback: false } satisfies components["schemas"]["Artwork"] });
  });
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("낡은 등대 문틈으로 살금살금 손전등을 비췄다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  // 그림이 **첫 폴링 시각(3초)보다 훨씬 전에** 떠야 한다.
  await expect(page.locator(`main img[src="${즉시그림}"]`)).toBeVisible({ timeout: 첫폴링 - 500 });

  // **「삽화 대기」 대사가 스쳐서도 안 된다** — 이미 있는 그림 앞에서 기다리는 말을 하면
  // **말과 화면이 어긋난다.** 깜박이는 것도 아이에게는 오류로 보인다.
  await expect(page.locator("main [data-대기대사]")).toHaveCount(0);

  // 등급·가이드·아이 문장도 **같이** 열린다 — 그림이 이미 있으니 가릴 이유가 없다.
  await expect(page.locator("main [data-티어배지]")).toHaveText(티어이름.rare);
  await expect(page.getByText(결과가이드.line)).toBeVisible();

  expect(물어봤나).toBe(false);
});

// ── 다음 장면으로 가는 문 (`문구.md` 1.17) ─────────────────────────────

/**
 * 한 장을 써서 결과 화면까지 간다. **문이 없어서 여기가 막다른 길이었다.**
 *
 * **그림을 끝까지 굽힌다.** 이 문은 `삽화.kind !== "기다림"` 안에 있다 —
 * `문구.md` 1.17 이 자리를 **「그림을 받은 뒤」**로 정했기 때문이다. 굽는 동안 띄우면
 * **등급 반응이 그림보다 먼저 뜨는 것과 같은 자리**가 하나 더 생긴다 (1.5).
 */
async function 결과화면까지(
  page: Page,
  카드응답 = CARD,
  결과응답: AttemptResult = 결과(),
) {
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({ status: 200, json: 결과응답 }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) => {
    const artwork: components["schemas"]["Artwork"] = {
      artwork_id: ARTWORK,
      status: "ready",
      url: ARTWORK_URL,
      tier: "rare",
      fallback: false,
    };
    return route.fulfill({ status: 200, json: artwork });
  });
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );

  await page.goto("/");
  await page.getByLabel(카드응답.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();
  await expect(page.locator("[data-다음장면]")).toBeVisible();
}

/**
 * **다음에 무엇이 오는지를 호출 횟수로 정하지 않는다.** `next dev` 는 StrictMode 라
 * **마운트 효과가 두 번 돈다** — 「1회차면 카드, 2회차면 다음 것」으로 쓰면
 * **첫 화면이 이미 2회차**가 되어 픽스처가 통째로 어긋난다 (2026-09-12 실측).
 * **테스트가 직접 바꾸는 값**으로 둔다: 무엇을 줄지는 **횟수가 아니라 상태**가 정한다.
 */
test("결과 화면에서 다음 장면을 연다 — 앱을 껐다 켜지 않아도 된다", async ({ page }) => {
  // **카드를 두 장 준비한다.** 한 장만 주면 **두 번째가 첫 번째와 같아도 통과**해서
  // 「새로 불렀다」와 「화면이 안 바뀌었다」가 안 갈린다.
  const 다음카드 = {
    ...CARD,
    card_id: "c100",
    situation: "무너진 다리 앞에서 강물이 빠르게 흐른다.",
  };
  let 줄카드: CardResponse = CARD;
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: 줄카드 }),
  );

  await 결과화면까지(page);

  줄카드 = 다음카드;
  await page.locator("[data-다음장면]").click();

  // **두 번째 카드가 온다.** 2026-09-12 전에는 이 길이 아예 없어서
  // 사용자가 **앱을 껐다 켜서** 두 번째 장을 했다 — 홈 화면 앱은 새로고침 버튼조차 없었다.
  // **2026-09-14 에 그 사정은 없어졌다**(`adr/0014`). **재는 것은 그대로다** — 이어갈 문이 있는가.
  await expect(page.getByText(다음카드.situation)).toBeVisible();

  // **앞 장면이 남아 있지 않다.** 결과가 그대로면 아이는 자기가 뭘 눌렀는지 모른다.
  await expect(page.locator("[data-다음장면]")).toHaveCount(0);
  await expect(page.getByText(CARD.situation)).toHaveCount(0);
});

test("다 썼어도 버튼을 숨기지 않는다 — 끝은 가이드가 말한다", async ({ page }) => {
  const 종료대사 = "오늘 모험은 여기까지! 네가 쓴 글과 그림이 책에 모여 있어. 내일 또 보자.";
  // **호출 횟수로 가르지 않는다** — 위 주석 참조. StrictMode 가 마운트 효과를 두 번 돌린다.
  let 다썼다 = false;
  await page.route(CARDS_NEXT, (route) =>
    다썼다
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: errorBody("DAILY_CAP_REACHED", "오늘 카드를 다 썼어요", {
            guide: { expression: "session_end", line: 종료대사 },
          }),
        })
      : route.fulfill({ status: 200, json: CARD }),
  );

  // **마지막 장을 쓴 상태로 둔다.** 픽스처가 `cards_done: 2` 면 **다 쓴 자리가 아니라서**,
  // 누가 「상한에 닿으면 문을 숨기자」로 고쳐도 **이 검사가 안 문다** (2026-09-12 뒤집다 잡았다).
  // **지키려는 것이 바로 그 자리**다 — 5장을 채운 아이가 그 문을 본다.
  await 결과화면까지(page, CARD, {
    ...결과(),
    today: { cards_done: 5, cap: 5, locked: true },
  });
  다썼다 = true;

  // **미리 숨기지 않는다** (1.17) — 숨기면 아이가 「왜 없지」를 묻는다.
  // **눌러서 듣는 편이 끝을 가이드가 말하는 것**이 된다 (1.10 이 세운 자리).
  // **상한에 닿았어도 문이 그대로 있다**를 먼저 적는다 — 눌러서 됐다는 것만으로는
  // 「보였다」가 단언으로 안 남는다.
  await expect(page.locator("[data-다음장면]")).toBeVisible();
  await page.locator("[data-다음장면]").click();

  await expect(page.getByText(종료대사)).toBeVisible();
  await expect(page.locator('img[src="/guide/session_end-stage.png"]')).toBeVisible();
  // **오류 화면으로 때우지 않는다.** 상한은 고장이 아니라 가드레일이다.
  await expect(page.getByRole("button", { name: 버튼.다시열기 })).toHaveCount(0);
});

test("이어가는 문에 재촉하는 말을 쓰지 않는다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  await 결과화면까지(page);

  // **하루 5장은 상한이지 할당량이 아니다** — 아이가 그만두는 것이 정상인 설계다
  // (도파민 가드레일). 「또」·「한 번 더」는 재촉으로 읽힌다 (`문구.md` 1.17).
  const 문 = await page.locator("[data-다음장면]").innerText();
  for (const 안쓰는말 of ["또", "한 번 더", "더 해", "신나", "계속"]) {
    expect(문).not.toContain(안쓰는말);
  }
});

test("쓰는 도중 세션이 끊기면 인증 화면으로 보낸다 — 막다른 화면에 두지 않는다", async ({
  page,
}) => {
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");

  // **보내는 그 순간에 끊긴다.** 2026-09-12 파일럿에서 실제로 도는 경로다 — 학부모가
  // **접속 코드를 재발급하면 `token_version` 이 올라 남아 있는 기기가 전부 끊긴다**
  // (`공통규약.md` 「폐기」). **자녀 삭제도 같은 401 이고 아이 쪽에서는 구분되지 않는다.**
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: errorBody("UNAUTHORIZED", "다시 한 번 들어와 주세요"),
    }),
  );
  // **인증 화면이 물어볼 자리도 물려 둔다.** 안 물리면 그 화면이 **「못 닿음」 갈래**로 떨어져
  // **아이가 들어갈 화면에 닿았는지를 못 본다** — 「무언가 그려졌다」만 재게 된다.
  await page.route("**/api/v1/child/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: errorBody("UNAUTHORIZED", "다시 한 번 들어와 주세요"),
    }),
  );

  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  // **문구만 띄우면 아이는 갇힌다** — 「나가기」도 인증 확인 뒤에만 그려서 **누를 것이 하나도 없다.**
  // **표식을 달고 간다** (`문구.md` 3.3) — 인증 화면이 **왜 왔는지**를 알아야
  // 「부모님이 새 접속 코드를 받으셨어요」를 말할 수 있다. 쿠키가 `HttpOnly` 라 **출처가 유일한 단서**다.
  await expect(page).toHaveURL(/\/child\/auth\?kicked=1$/);

  // **마운트 때 401 과 같은 자리로 간다.** 갈래가 둘이면 한쪽만 고쳐지는 날이 온다.
  //
  // **⚠ 「비어 있지 않다」로 재지 않는다** (2026-09-14 고침). 그 단언은 **화면이 무엇을
  // 그렸는지 안 보고 「무언가 있다」만** 봐서, 부하가 걸리면 **아직 안 그린 한순간**을 잡아
  // 흔들린다 — 격리하면 통과하고 전체 실행에서만 깨졌다. **구체적인 것을 본다.**
  await expect(page.getByText(코드입력.제목)).toBeVisible();
});

/**
 * **⛔ 2026-09-14 아동 3명 관찰에서 나왔다** (`프리테스트_결과_2026-09-14.md` 3장 ③).
 * **셋 다 기기를 가로로 들었고 셋 다 「내 책」을 못 열었다.**
 *
 * **「관심이 없다」가 아니었다** — 관찰 신호 8 이 「기기를 어떻게 들었는지 함께 적는다」로
 * 세워 둔 장치가 그것을 갈랐다. **안 적었으면 정반대로 읽었을 것이다.**
 *
 * **⚠ 왜 검사가 여태 못 잡았나** — `click()` 과 `toBeVisible()` 이 **자동으로 스크롤한다.**
 * 그래서 「링크가 있다」는 초록인데 **아이는 스크롤을 안 했다.** 여기서는 **좌표를 직접 재고
 * `scrollY === 0` 을 같이 확인한다.**
 *
 * **⚠ 그리고 가로만의 문제가 아니었다** (2026-09-15 실측). 「내 책」 아래끝이
 * **1024×768 에서 996 · 1280×800 에서 1015 · 390×844 에서 977** — **세 뷰포트 전부에서
 * 첫 화면 밖**이었다. **관찰은 가로에서 났지만 원인은 세로에도 있다.**
 */
for (const [폭, 높이, 어디] of [
  [1024, 768, "iPad 가로 — 아이 셋이 이렇게 들었다"],
  [1280, 800, "검사 기본 뷰포트"],
  [390, 844, "폰 세로"],
  // **⛔ 가장 좁은 것 하나** (2026-09-15 PM). **그게 통과하면 위는 따라온다.**
  // 위 셋만 볼 때는 초록이었는데 **주소창이 있는 폰 크기에서는 「내 책」이 95px 밖**이었다 —
  // **③ 이 그 크기들에서는 안 닫혀 있었다.**
  [360, 640, "작은 안드로이드 — 주소창까지 있으면 이 정도다"],
  [844, 390, "폰 가로 — 그림을 줄이지 않고 나가는 길을 남긴다"],
] as const) {
  test(`보상까지가 첫 화면 안에 있다 — ${폭}×${높이} (${어디})`, async ({ page }) => {
    await page.setViewportSize({ width: 폭, height: 높이 });
    await page.route(CARDS_NEXT, (route) =>
      route.fulfill({ status: 200, json: CARD }),
    );

    await 결과화면까지(page);

    // **아이가 안 한 것을 검사도 안 한다.** 이 줄이 없으면 위의 `toBeVisible` 이
    // 이미 스크롤시켜 둔 화면을 재게 된다.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    for (const [이름, 자리] of [
      ["다음 장면", await page.locator("[data-다음장면]").boundingBox()],
      ["내 책", await page.getByRole("link", { name: 내책라벨 }).boundingBox()],
    ] as const) {
      // **보상 흐름의 끝이다.** 여기가 화면 밖이면 아이에게는 **없는 것**이다.
      expect(
        Math.round(자리!.y + 자리!.height),
        `${이름}이 첫 화면 밖이다 (${폭}×${높이})`,
      ).toBeLessThanOrEqual(높이);
    }

    // **그림이 여전히 보상이다.** 위를 맞추려고 액자를 접어버리면 **연출이 사라진다** —
    // 「그림이 화면을 다 먹지 않는다」의 반대쪽 난간이다.
    const 액자 = (await page.locator("main [data-삽화자리]").boundingBox())!;
    expect(액자.height).toBeGreaterThan(높이 * 0.3);
  });
}

/**
 * **⛔ 2026-09-14 아동 3명 관찰 회차에서 나왔다** (`프리테스트_결과_2026-09-14.md` 3장 ⑨ ·
 * `문구.md` **2.6**).
 *
 * **한 브라우저에 아이 세션이 30일 남는다.** 어른이 다음 아이에게 기기를 넘겼는데
 * **앞 아이 세션이 그대로**였고, **그 아이가 쓴 글이 앞 아이 책에 들어갔다.**
 * 그때 **화면 어디에도 누구인지가 없었다.**
 *
 * **아이가 읽는 것이 아니라 어른이 확인하는 것이다** — 그래서 **꾸미지 않고**,
 * 대신 **보이는 자리**에 둔다. 2.6 이 「맨 위」에 근거를 단 것이 그것이고,
 * **③(「내 책」이 첫 화면 밖)이 같은 날 그 근거를 증명했다.**
 */
test("지금 누구인지가 맨 위에 있다 — 앞 아이로 놀지 않게", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route("**/api/v1/child/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        child_id: "c-1",
        nickname: "은빛나침반",
        guide_name: null,
        today: { cards_done: 0, cap: 5 },
      },
    }),
  );

  await page.goto("/");
  const 이름 = page.locator("[data-탐험가이름]");

  // **이름만 쓴다. 라벨도 꾸밈말도 없다** (2.6).
  await expect(이름).toHaveText("은빛나침반");

  // **「맨 위」가 조건이다 — 스크롤 없이 보여야 한다.** 안 보이는 자리에 둔 표식은 표식이 아니다.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const 자리 = (await 이름.boundingBox())!;
  expect(자리.y).toBeLessThan(768 * 0.2);

  // **⚠ 그 자리만 본다. 화면 전체를 보면 카드 문구를 문다** — `prompt_label` 이
  // **「탐험가는 어떻게 할까?」**이고 그건 **서버가 주는 정상 문구**다(`용어사전.md` 아이 화면 열).
  // **2.6 이 규율하는 것은 이 한 자리**이고, 넓게 재면 **제품이 아니라 남의 규칙을 잰다.**
  const 그자리 = await page.locator("header").innerText();
  expect(그자리.trim()).toBe("은빛나침반");
  // **⛔ 「별명」은 학부모 화면 말이고**(`용어사전.md`), **「탐험가」는 아이가 스스로를 부르는 말**이지
  // 이름 앞에 붙이는 직함이 아니다. **인사말로 감싸지도 않는다** — 말을 거는 자리가 하나 더 는다.
  for (const 안쓰는말 of ["별명", "탐험가", "안녕", "님", "환영"]) {
    expect(그자리).not.toContain(안쓰는말);
  }
});

test("누구인지 모르면 아무 이름도 안 쓴다 — 지어내지 않는다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  // **`/child/me` 가 못 닿았다.** 카드는 왔으므로 아이는 들어와 있다 —
  // **그래도 이름을 모르면 그 자리를 안 그린다.** 「탐험가」 같은 기본값을 넣으면
  // **다음 아이가 그 화면을 보고 자기 판이라고 읽는다** — 없느니만 못하다.
  await page.route("**/api/v1/child/me", (route) => route.abort("failed"));

  await page.goto("/");
  await expect(page.getByText(CARD.situation)).toBeVisible();
  await expect(page.locator("[data-탐험가이름]")).toHaveCount(0);
});

test("다음 장면으로 가면 입력칸이 비어 있다 — 앞 장면에 쓴 글이 따라오지 않는다", async ({
  page,
}) => {
  const 다음카드 = { ...CARD, card_id: "c200", situation: "무너진 다리 앞에서 강물이 빠르게 흐른다." };
  let 줄카드: CardResponse = CARD;
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: 줄카드 }));

  await 결과화면까지(page);
  줄카드 = 다음카드;
  await page.locator("[data-다음장면]").click();
  await expect(page.getByText(다음카드.situation)).toBeVisible();

  // **앞 장면에 쓴 글이 새 장면 아래 붙어 있으면 아이는 자기가 쓴 것으로 읽는다.**
  await expect(page.getByLabel(다음카드.prompt_label)).toHaveValue("");
});

/**
 * **⛔ 2026-09-15 — 버튼이 없어서 아무도 안 눌렀다** (`프리테스트_결과_2026-09-14.md` ④ ·
 * `문구.md` **2.2** 신설 · `adr/0015` ②).
 *
 * **`page.tsx` 가 `retry_of` 를 항상 `null` 로 보내고 있었다.** 주석은 「채우는 것은 같은 카드를
 * 다시 풀 때뿐이고 그건 W4 다」였는데 **W4 는 지났다.** PM 이 결과 문서 ④ 를
 * **「아이들이 안 누른 게 아니라 그 버튼이 없다」**로 고쳐 썼다.
 *
 * **⭐ 「구체적으로 쓸수록 더 좋은 그림」이 이 제품의 보상 구조인데 다시 시도할 문이 없었다.**
 * `adr/0015` ②(등급이 올랐을 때만 다시 굽는다)도 **이 버튼이 있어야 성립한다.**
 */
test("다시 써보기는 같은 장면으로 돌아가고 쓴 문장을 남긴다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  await 결과화면까지(page);

  await page.getByRole("button", { name: 버튼.다시써보기 }).click();

  // **같은 장면이다.** 새 카드를 부르면 그건 「다음 장면」이지 「다시 써보기」가 아니다.
  await expect(page.getByText(CARD.situation)).toBeVisible();
  // **쓴 문장이 남는다** — 되묻기·차단이 그 자리에 머무는 것과 같은 규칙이다.
  // 태블릿에서 처음부터 다시 치게 하면 **아이는 그냥 그만둔다.**
  await expect(page.getByLabel(CARD.prompt_label)).toHaveValue("등대 계단을 한 칸씩 올라간다");
  // 결과 자리는 치운다 — 앞 결과가 남아 있으면 무엇이 방금 일어난 것인지 갈린다.
  await expect(page.locator("[data-다음장면]")).toHaveCount(0);
});

test("다시 쓴 것은 앞 시도에 붙여 보낸다 — 카드를 한 장 더 쓰는 게 아니다", async ({ page }) => {
  const 보낸것 = await 보낸것을받으며결과까지(page);
  await page.getByRole("button", { name: 버튼.다시써보기 }).click();
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 천천히 올라간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();
  await expect(page.locator("[data-다음장면]")).toBeVisible();

  // **첫 시도는 `null`, 다시 쓴 것은 앞 `attempt_id`** (`Stage0.md` 4절).
  // **일일 카운트가 이 값에 걸려 있다** — 비워 보내면 아이가 **오늘 카드 한 장을 더 쓴 셈**이 된다.
  expect(보낸것[0].retry_of).toBe(null);
  expect(보낸것[1].retry_of).toBe(결과().attempt_id);

  // **다음 장면으로 가면 다시 `null` 이다.** 안 비우면 **새 카드가 앞 시도의 재시도로 실린다.**
  await page.locator("[data-다음장면]").click();
  await page.getByLabel(CARD.prompt_label).fill("무너진 다리를 건넌다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();
  expect(보낸것[2].retry_of).toBe(null);
});

test("다시 쓰다 되묻기가 와도 앞 시도에 계속 붙인다", async ({ page }) => {
  const 되묻기 = { 할차례: false };
  const 보낸것 = await 보낸것을받으며결과까지(page, 되묻기);
  await page.getByRole("button", { name: 버튼.다시써보기 }).click();

  되묻기.할차례 = true;
  await page.getByLabel(CARD.prompt_label).fill("빛이 있다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();
  await expect(page.getByText("그 빛은 어떤 색이야?")).toBeVisible();

  되묻기.할차례 = false;
  await page.getByLabel(CARD.prompt_label).fill("파란 빛이 계단 끝에서 흔들린다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();
  await expect(page.locator("[data-다음장면]")).toBeVisible();

  // **되묻기는 시도가 끝난 것이 아니라 같은 시도의 연장이다** (`Stage0.md` 4절) —
  // **재시도 중에 되묻기가 오면 그 연장도 여전히 재시도다.** 여기서 `null` 로 돌리면
  // **서버가 일일 카운트를 올려** 아이가 오늘 카드 한 장을 더 쓴 셈이 된다.
  expect(보낸것[1].retry_of).toBe(결과().attempt_id);
  expect(보낸것[2].retry_of).toBe(결과().attempt_id);
});

/**
 * 결과 화면까지 가되 **보낸 것을 모은다.**
 *
 * **⚠ `결과화면까지` 를 쓰고 그 앞에 라우트를 걸면 안 된다** — **Playwright 는 나중에 등록한
 * 라우트가 이긴다.** 헬퍼가 자기 `ATTEMPTS` 라우트를 걸어 **앞서 건 수집기가 통째로 가려지고**,
 * 증상은 **「요청이 하나도 안 잡힌다」**라 화면 코드를 뒤지게 된다 (2026-09-15 실측).
 */
async function 보낸것을받으며결과까지(page: Page, 되묻기 = { 할차례: false }) {
  const 보낸것: Record<string, unknown>[] = [];
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "ready",
        url: ARTWORK_URL,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );
  await page.route(ATTEMPTS, (route) => {
    보낸것.push(route.request().postDataJSON());
    return 되묻기.할차례
      ? route.fulfill({
          status: 200,
          json: {
            outcome: "scaffold",
            attempt_id: "a-scaffold",
            guide: { expression: "compass_dim", line: "그 빛은 어떤 색이야?" },
          },
        })
      : route.fulfill({ status: 200, json: 결과() });
  });

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();
  await expect(page.locator("[data-다음장면]")).toBeVisible();
  return 보낸것;
}

/**
 * 대기는 1:1 자리로 보여주고 그림이 오면 실제 원본 비율로 바꾼다.
 * 최대 변의 크기는 유지하면서 짧은 변을 줄여, 빈 띠 없이 원본 전체를 보여준다.
 */
for (const [원본폭, 원본높이, 방향] of [[240, 120, "가로"], [120, 240, "세로"], [200, 200, "정사각형"]] as const) {
test(`결과 액자는 최대 크기 안에서 ${방향} 원본 비율과 가장자리까지 보존한다`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let 그림보여주기!: () => void;
  const 그림응답대기 = new Promise<void>((resolve) => { 그림보여주기 = resolve; });
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  await page.route(ATTEMPTS, (route) => route.fulfill({ status: 200, json: 결과() }));
  await page.route(`**/api/v1/artworks/${ARTWORK}`, async (route) => {
    await 그림응답대기;
    return route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "ready",
        url: ARTWORK_URL,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    });
  });
  // 원본의 네 모서리를 구별할 수 있는 지어낸 그림이다. 실제 삽화는 읽거나 바꾸지 않는다.
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${원본폭}" height="${원본높이}"><rect width="100%" height="100%" fill="#d6e4ed"/><rect width="20" height="20" fill="#c24136"/><rect x="${원본폭 - 20}" width="20" height="20" fill="#356b3e"/><rect y="${원본높이 - 20}" width="20" height="20" fill="#305a96"/><rect x="${원본폭 - 20}" y="${원본높이 - 20}" width="20" height="20" fill="#8d489c"/></svg>`,
    }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  const 액자 = page.locator("main [data-삽화자리]");
  await expect(액자).toBeVisible();
  await expect(액자.locator("[data-대기대사]")).toBeVisible();
  await expect(액자.locator(".story-opening__page")).toHaveCSS("animation-name", "none");
  const 받기전 = (await 액자.boundingBox())!;
  expect(받기전.width / 받기전.height).toBeCloseTo(1, 2);

  그림보여주기();
  const 그림 = page.locator(`main img[src="${ARTWORK_URL}"]`);
  await expect(그림).toBeVisible();
  await expect(그림).toHaveCSS("object-fit", "contain");
  await expect(그림).toHaveCSS("transform", "none");
  await expect(그림).toHaveAttribute("src", ARTWORK_URL);
  await expect(그림).not.toHaveAttribute("crossorigin", /.*/);
  await expect.poll(() => 그림.evaluate((element) => {
    const image = element as HTMLImageElement;
    return { width: image.naturalWidth, height: image.naturalHeight };
  })).toEqual({ width: 원본폭, height: 원본높이 });
  await expect.poll(async () => {
    const bounds = (await 액자.boundingBox())!;
    return bounds.width / bounds.height;
  }).toBeCloseTo(원본폭 / 원본높이, 2);

  const 그림자리 = (await 그림.boundingBox())!;
  const 액자자리 = (await 액자.boundingBox())!;
  expect(그림자리.x).toBeGreaterThanOrEqual(액자자리.x - 1);
  expect(그림자리.y).toBeGreaterThanOrEqual(액자자리.y - 1);
  expect(그림자리.x + 그림자리.width).toBeLessThanOrEqual(액자자리.x + 액자자리.width + 1);
  expect(그림자리.y + 그림자리.height).toBeLessThanOrEqual(액자자리.y + 액자자리.height + 1);

  // CSS 선언뿐 아니라 실제 화면의 원본 네 모서리 색을 읽는다. 둥근 액자가
  // 정사각 원본을 자르는 경우도 잡으며, 그림 안쪽 여백은 실제 computed padding을 따른다.
  const 모서리좌표 = await 그림.evaluate((element) => {
    const image = element as HTMLImageElement;
    const frame = image.parentElement!.getBoundingClientRect();
    const bounds = image.getBoundingClientRect();
    const css = getComputedStyle(image);
    const left = parseFloat(css.paddingLeft);
    const top = parseFloat(css.paddingTop);
    const width = bounds.width - left - parseFloat(css.paddingRight);
    const height = bounds.height - top - parseFloat(css.paddingBottom);
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const x = bounds.x - frame.x + left + (width - image.naturalWidth * scale) / 2;
    const y = bounds.y - frame.y + top + (height - image.naturalHeight * scale) / 2;
    return {
      frameWidth: frame.width,
      frameHeight: frame.height,
      points: [
        [x + scale, y + scale],
        [x + (image.naturalWidth - 1) * scale, y + scale],
        [x + scale, y + (image.naturalHeight - 1) * scale],
        [x + (image.naturalWidth - 1) * scale, y + (image.naturalHeight - 1) * scale],
      ],
    };
  });
  const 화면그림 = await 액자.screenshot({ animations: "disabled" });
  const 모서리색 = await page.evaluate(async ({ png, geometry }) => {
    const screenshot = new Image();
    screenshot.src = `data:image/png;base64,${png}`;
    await screenshot.decode();
    const canvas = document.createElement("canvas");
    canvas.width = screenshot.naturalWidth;
    canvas.height = screenshot.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(screenshot, 0, 0);
    return geometry.points.map(([x, y]) => Array.from(context.getImageData(
      Math.floor(x * canvas.width / geometry.frameWidth),
      Math.floor(y * canvas.height / geometry.frameHeight), 1, 1,
    ).data).slice(0, 3));
  }, { png: 화면그림.toString("base64"), geometry: 모서리좌표 });
  expect(모서리색).toEqual([[194, 65, 54], [53, 107, 62], [48, 90, 150], [141, 72, 156]]);

  const 받은뒤 = (await 액자.boundingBox())!;
  expect(Math.abs(Math.max(받은뒤.width, 받은뒤.height) - Math.max(받기전.width, 받기전.height))).toBeLessThanOrEqual(1);
  if (원본폭 !== 원본높이) {
    expect(Math.min(받은뒤.width, 받은뒤.height)).toBeLessThan(Math.min(받기전.width, 받기전.height));
  }
});
}

test("그림이 오기 전 빈 자리는 1:1 이다 — 평시 경로의 모양이다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  await page.route(ATTEMPTS, (route) => route.fulfill({ status: 200, json: 결과() }));
  // **계속 굽는 중으로 둔다.** 이 상태가 「자리를 비워 두는」 그 자리다.
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "pending",
        url: null,
        tier: null,
        fallback: null,
      } as unknown as components["schemas"]["Artwork"],
    }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  const 액자 = page.locator("main [data-삽화자리]");
  await expect(액자).toBeVisible();
  const 자리 = (await 액자.boundingBox())!;
  // 실제 비율을 알기 전에는 정사각형 자리로 기다린다.
  expect(자리.width / 자리.height).toBeCloseTo(1, 2);
});

/**
 * **⛔ 2026-09-16 · `문구.md` 2.5 넷째 행 신설.** 이 자리가 **비어 있었다** —
 * 아이가 「보내기」를 누르면 **입력창이 잠기고 버튼이 흐려질 뿐 아무 말도 안 했다.**
 *
 * **길이는 2.9초다**(운영 실측 `POST /attempts` 2856ms) — **콜드가 아니다.**
 * 아이 흐름의 **첫 요청(접속 코드)이 콜드를 다 맞는다.** 짧아도 **눌렸는지를 화면이
 * 말해 주지 않는 것**은 길이와 별개다.
 *
 * **⛔ 가이드가 말을 거는 자리가 아니다** — **평가가 도는 중**이라 무슨 말이든
 * **판정을 예고하는 것처럼 읽힌다.** 1.5(삽화 대기)는 **등급이 정해진 뒤**라 안전하다.
 */
test("문장을 보내는 동안 이야기를 읽는다고 말한다 — 등급을 미리 흘리지 않는다", async ({
  page,
}) => {
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  let 풀어준다: (() => void) | null = null;
  await page.route(ATTEMPTS, async (route) => {
    await new Promise<void>((res) => (풀어준다 = res));
    return route.fulfill({ status: 200, json: 결과() });
  });

  // **결과 뒤까지 본다** — 그 말이 사라지는 것도 이 검사의 몫이라 삽화까지 걸어 둔다.
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "ready",
        url: ARTWORK_URL,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}/image`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );

  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill("등대 계단을 한 칸씩 올라간다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();

  await expect(page.locator("[data-읽는중]")).toHaveText("네 이야기를 읽고 있어.");
  // **쓴 문장이 그대로 있다** — 보내는 중에 사라지면 아이는 날아간 줄 안다.
  await expect(page.getByLabel(CARD.prompt_label)).toHaveValue("등대 계단을 한 칸씩 올라간다");

  // **⛔ 등급을 미리 흘리지 않는다.** 이 자리는 **평가가 도는 중**이라 배지도 결과 대사도
  // 아직 오면 안 된다 — 오면 그림보다 먼저 판정을 읽는다 (`문구.md` 1.5 가 생긴 이유).
  await expect(page.locator("main [data-티어배지]")).toHaveCount(0);
  await expect(page.getByText(결과가이드.line)).toHaveCount(0);

  await expect.poll(() => 풀어준다 !== null).toBe(true);
  풀어준다!();

  // 결과가 오면 그 말이 사라진다 — 남아 있으면 **끝난 뒤에도 기다리는 것처럼 보인다.**
  await expect(page.locator("[data-다음장면]")).toBeVisible();
  await expect(page.locator("[data-읽는중]")).toHaveCount(0);
});

/**
 * **튜토리얼 「나침반 깨우기」** (A-6 · `문구.md` **1.22** · W7 **10번**).
 *
 * **화면은 카드 화면 그대로다** — **새 화면을 만들지 않았다.** A-6 이 「루프를 설정만
 * 바꾼다」이고, 안내 화면을 한 장 세우면 **첫 5~7분에 관문이 하나 생긴다.**
 *
 * **⛔ 켜는 것과 만드는 것은 다르다** — T1~T3 **카드 본문은 대표 미검수**이고
 * 백엔드가 **기본 꺼짐**으로 뒀다(`config.tutorial_enabled`). **여기서 재는 것은 화면**이다.
 */
const 튜토리얼카드 = (over: Partial<CardResponse> = {}): CardResponse => ({
  ...CARD,
  card_id: "t1",
  ...over,
});

/**
 * **⛔ 카드 화면 맨 위에는 안내 줄을 두지 않는다** (2026-09-21 사용자 판정).
 *
 * 종전 T1 여는 말(「나침반이 아직 자고 있어…」)은 **아래 말풍선의 「네가 이야기를 쓰면
 * 반짝여」와 뜻이 겹쳤고**, 자고 있다·깨어난다·반짝인다 **세 설정이 한 화면에 섞였다.**
 * **T1 도 예외가 아니다** — 여기서 T1 을 같이 재는 이유다.
 */
test("카드 화면 맨 위에는 안내 줄이 없다 — T1 도 마찬가지다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: 튜토리얼카드() }),
  );
  await page.goto("/");
  await expect(page.getByText(CARD.situation)).toBeVisible();
  await expect(page.locator("[data-튜토리얼안내]")).toHaveCount(0);
});

test("튜토리얼이 아닌 카드에도 안 나온다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  await page.goto("/");
  await expect(page.getByText(CARD.situation)).toBeVisible();
  await expect(page.locator("[data-튜토리얼안내]")).toHaveCount(0);
});

/**
 * **⛔ 1.22 의 급소 — T2 가 재촉이 되면 안 된다.**
 *
 * **말로 안 하기로 한 것을 자리와 크기로 하면 같은 것**이다. 그래서 문장만 보지 않고
 * **「다시 써보기」가 커졌는지**를 같이 잰다 — `check-copy` 도 단위 검사도 못 보는 자리다
 * (W7 7번에서 1.18 을 좌표로 잰 것과 같은 이유).
 */

/**
 * 결과 화면의 **버튼 줄까지** 간다. **삽화를 풀어 줘야 거기 닿는다** —
 * 안 풀면 화면이 **「네가 쓴 곳으로 가고 있어」**(1.5 대기)에 머문다.
 * **튜토리얼 문구 둘이 그 버튼 줄 옆에 있어** 여기까지 와야 잰다.
 */
async function 결과버튼줄까지(
  page: Page,
  cardId: string,
  tier: "basic" | "rare" | "legendary" = "rare",
) {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: 튜토리얼카드({ card_id: cardId }) }),
  );
  await page.route(ATTEMPTS, (route) =>
    route.fulfill({ status: 200, json: { ...결과(), tier } }),
  );
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        artwork_id: ARTWORK,
        status: "ready",
        url: ARTWORK_URL,
        tier: "rare",
        fallback: false,
      } satisfies components["schemas"]["Artwork"],
    }),
  );
  await page.goto("/");
  await page.locator("#attempt").fill("낡은 등대 문틈으로 손전등을 비춰 안쪽을 살핀다");
  await page.getByRole("button", { name: 버튼.그림으로보기 }).click();
  await expect(page.locator("[data-다시써보기]")).toBeVisible();
}

test("T2 권유가 「다시 써보기」를 키우지 않는다", async ({ page }) => {
  await 결과버튼줄까지(page, "t2");

  await expect(page.locator("[data-튜토리얼안내]")).toHaveText(튜토리얼문구.다시쓰기권유);

  // **두 버튼의 글자 크기가 같다.** 「다시 써보기」만 커지면 그게 재촉이다.
  const 크기 = (칸: string) =>
    page.evaluate((s) => getComputedStyle(document.querySelector(s)!).fontSize, 칸);
  expect(await 크기("[data-다시써보기]")).toBe(await 크기("[data-다음장면]"));

  // **깜빡이지 않는다.** 애니메이션도 재촉이다.
  const 움직임 = await page.evaluate(() => {
    const el = document.querySelector("[data-다시써보기]")!;
    const s = getComputedStyle(el);
    return `${s.animationName}|${s.animationIterationCount}`;
  });
  expect(움직임.startsWith("none")).toBe(true);
});

/**
 * **⛔ 대표 판정 ① — 최고 티어면 권유를 안 띄운다** (2026-09-16).
 *
 * **A-6 이 「두 번째 삽화가 한 티어 오르는 것을 보고 체득한다」로 설계됐는데
 * 첫 시도가 `legendary` 면 오를 티어가 없다.** PRD 가 안 적은 경우이고
 * **대표 검수에서 그 화면이 실제로 나왔다.**
 *
 * **권유가 붙으면 ① 거짓이 되고 ② 티어가 보상에서 평가로 되돌아간다**
 * (`MVP_PRD.md` 129행 — 「티어 이름과 삽화로만 표현」).
 */
test("⛔ 전설이면 T2 권유를 안 띄운다 — 오를 티어가 없다", async ({ page }) => {
  await 결과버튼줄까지(page, "t2", "legendary");

  expect(
    await page.locator("main").innerText(),
    "전설인데 권유가 붙었다 — 「전설인데도 부족하다」로 읽힌다",
  ).not.toContain(튜토리얼문구.다시쓰기권유);
});

/**
 * **⛔ 없애는 것은 「말」이지 「길」이 아니다.**
 * `MVP_PRD.md` **75행** — 「다시 써보기는 카드 소진에 포함 안 됨, **횟수 제한 없음**」.
 * **전설을 받고도 더 쓰고 싶은 아이는 언제든 누른다.**
 *
 * **⭐ 우리가 권하면 「네 답이 부족하다」이고 아이가 스스로 누르면 「더 해보고 싶다」다.**
 */
test("⛔ 전설이어도 「다시 써보기」 버튼은 그대로 있다 — 길은 안 막는다", async ({
  page,
}) => {
  await 결과버튼줄까지(page, "t2", "legendary");
  await expect(page.locator("[data-다시써보기]")).toBeVisible();
  await expect(page.locator("[data-다시써보기]")).toBeEnabled();
});

test("T3 뒤에 닫는 말이 나오고, 잠금·관문을 말하지 않는다", async ({ page }) => {
  await 결과버튼줄까지(page, "t3");

  await expect(page.locator("[data-튜토리얼안내]")).toHaveText(튜토리얼문구.닫는말);

  // **⛔ A-6 MUST — 첫 5~7분이 관문이 되면 아이는 시작도 못 한다.**
  const 화면 = await page.locator("main").innerText();
  for (const 금지 of ["세 장", "남은 장", "잠", "열렸", "연습", "점수", "학습", "채점"]) {
    expect(화면, `「${금지}」가 튜토리얼 화면에 있다`).not.toContain(금지);
  }
});

/**
 * **모험으로 들어가는 문** (`문구.md` **1.25** · W7 **18번**).
 *
 * **⛔ 2026-09-17 까지 이 문이 없었다.** Stage 1 부품이 전부 선 뒤에도 **`/chapter` 로
 * 보내는 코드가 저장소 전체에 0건**이었고, 튜토리얼 1.22 가 **「이제 진짜 모험을 가자」**를
 * 띄우는데 **갈 데가 없었다** — **문구가 거짓말을 하고 있었다.**
 *
 * **⭐ 막히지 않는 누락이 더 오래 간다** — 계약이 어긋났을 때는 누군가 막혀서 물어 왔는데
 * 이건 **아무도 안 막혔다.** 그래서 **검사로 붙잡는다.**
 */
test("튜토리얼이 아닌 날엔 홈에 모험으로 가는 문이 있다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  // **404 = 하던 이야기가 없다** (`NO_ACTIVE_CHAPTER`).
  await page.route("**/api/v1/chapters/current", (route) =>
    route.fulfill({
      status: 404,
      body: errorBody("NO_ACTIVE_CHAPTER", "지금 이어갈 이야기가 없어요"),
      headers: { "content-type": "application/json" },
    }),
  );
  await page.goto("/");

  await expect(page.locator("[data-모험문]")).toContainText(모험문.기다린다);
  const 문 = page.getByRole("link", { name: 모험문.떠나기 });
  await expect(문).toHaveAttribute("href", "/chapter");
  await expect(page.locator("[data-모험문툴팁]")).toBeHidden();
  await 문.hover();
  await expect(page.locator("[data-모험문툴팁]")).toHaveText("다음에 무슨 일이 일어날지 직접 쓰면, 네 글대로 이야기가 이어져.");
});

test("하던 이야기가 있으면 그리로 보낸다 — 「이어서」를 안 쓴다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
  await page.route("**/api/v1/chapters/current", (route) =>
    route.fulfill({ status: 200, json: { chapter_id: "c1" } }),
  );
  await page.goto("/");

  // **문장을 검사에 박지 않는다.** 박아 뒀더니 문구가 2026-09-20 에 확정되면서 이 검사만
  // 중간 단계(「하던 모험을 계속해 볼까?」)를 붙들고 빨개졌다 — `문구.md` 646행이
  // **「그날 안에 지나간 중간 단계다. 되돌리지 않는다」**로 못 박은 그 문장이다.
  await expect(page.locator("[data-모험문]")).toContainText(모험문.가던데까지);
  await expect(page.getByRole("link", { name: 모험문.하던이야기로, exact: true })).toBeVisible();

  // **⛔ 1.20 이 「이어서 더 하기」를 금지했다.** 낱말이 겹치면 둘이 같은 것으로 읽힌다.
  expect(await page.locator("main").innerText()).not.toContain("이어서");
});

/**
 * **⛔ 튜토리얼 중에는 문을 안 그린다.**
 * T1~T3 는 **첫 5~7분**이고 **A-6 이 「잠금·관문 없음」**으로 세운 자리다.
 * **다른 길을 같이 내면 아이가 무엇부터 할지 고르게 되고 그 5~7분이 관문이 된다.**
 */
for (const cardId of ["t1", "t2", "t3"] as const) {
  test(`튜토리얼 중에는 문이 없다 — ${cardId} 작성 중 갈림길을 안 만든다`, async ({ page }) => {
    await page.route(CARDS_NEXT, (route) =>
      route.fulfill({ status: 200, json: 튜토리얼카드({ card_id: cardId }) }),
    );
    await page.goto("/");
    await expect(page.locator(".scene-card")).toBeVisible();
    await expect(page.locator("[data-모험문]")).toHaveCount(0);
    await expect(page.getByLabel(CARD.prompt_label)).toBeVisible();
    await expect(page.locator("[data-모험문버튼]")).toHaveCount(0);
  });
}

/**
 * **⛔ 튜토리얼 결과에는 「내 책 펼치기」가 없다** (2026-09-21 사용자 판정).
 *
 * **T1~T3 는 책에 안 쌓인다** — 석 장이 실리면 **아이 책의 첫 세 장이 연습**이 된다
 * (`api/app/api/v1/attempts.py`). 그런데 **결과 화면의 이 버튼만 검사 없이 떠 있었고**,
 * 아이가 누르면 **빈 책**에 닿았다. **화면 위쪽의 같은 버튼은 이미 가리고 있었다** —
 * 한쪽만 고쳐 두면 **다음에 다시 어긋난다.**
 *
 * **⛔ 이 검사가 「책에 남는다」 문제를 다 덮지 않는다.** 가이드가 여전히
 * **「이 장면은 네 책에 남아」**라고 말하고 그건 **백엔드 몫**이다
 * (`api/app/guide_lines.py`). **버튼을 감추는 것은 절반이다.**
 */
for (const cardId of ["t1", "t2", "t3"] as const) {
  test(`튜토리얼 결과에는 내 책으로 가는 버튼이 없다 — ${cardId} 는 책에 안 쌓인다`, async ({
    page,
  }) => {
    await 결과버튼줄까지(page, cardId);

    // **버튼 줄에는 와 있다** — 못 닿아서 없는 것과 구분한다.
    await expect(page.locator("[data-다시써보기]")).toBeVisible();
    await expect(page.getByRole("link", { name: 내책라벨 })).toHaveCount(0);
  });
}

test("튜토리얼이 아닌 결과에는 내 책으로 가는 버튼이 있다", async ({ page }) => {
  // **막는 것이 튜토리얼뿐인지 본다.** 아니면 위 검사는 「버튼이 아예 없다」도 통과한다.
  await 결과버튼줄까지(page, "c01");

  await expect(page.getByRole("link", { name: 내책라벨 })).toHaveAttribute("href", "/book");
});

test("T3 를 끝내면 닫는말이 가리키는 그 버튼이 있다", async ({ page }) => {
  await 결과버튼줄까지(page, "t3");
  await expect(page.locator("[data-튜토리얼안내]")).toHaveText(튜토리얼문구.닫는말);
  // **말만 있고 버튼이 없으면 그 문장이 거짓이 된다.**
  await expect(page.getByRole("link", { name: 모험문.떠나기 })).toHaveAttribute(
    "href",
    "/chapter",
  );
});

/**
 * **⛔ 문을 카드 위에 넣었으니 쓸 자리가 밀렸는지 재야 한다** (W6 14번 판정 · W7 18번).
 *
 * **「그 화면에 온 사람이 해야 할 일은 첫 화면에 있어야 한다.」** 카드 화면에서 아이가
 * 해야 할 일은 **쓰는 것**이다. **문을 얹어서 그것이 밀려나면 문이 해를 끼친 것**이다.
 *
 * **⚠ 기존 「보상까지가 첫 화면 안에」는 결과 화면을 잰다.** 카드 화면을 재는 검사가
 * 없어서 **문을 넣고도 초록이었다** — 2026-09-17 에 그 빈자리를 메운다.
 */
for (const [폭, 높이, 어디] of [
  [1024, 768, "iPad 가로"],
  [390, 844, "폰 세로"],
  [360, 640, "작은 안드로이드"],
] as const) {
  test(`문을 얹어도 쓸 자리가 첫 화면 안에 있다 — ${폭}×${높이} (${어디})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 폭, height: 높이 });
    await page.route(CARDS_NEXT, (route) => route.fulfill({ status: 200, json: CARD }));
    await page.route("**/api/v1/chapters/current", (route) =>
      route.fulfill({ status: 200, json: { chapter_id: "c1" } }),
    );
    await page.goto("/");
    await expect(page.locator("[data-모험문]")).toBeVisible();
    // 문은 소개 시작부터 보인다. 입력창 위치는 글쓰기 차례가 된 뒤에 잰다.
    await expect(page.locator("#attempt")).toBeVisible();

    // **아이가 안 한 것을 검사도 안 한다.**
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    for (const [이름, 자리] of [
      ["쓰는 칸", await page.locator("#attempt").boundingBox()],
      ["보내기", await page.getByRole("button", { name: 버튼.그림으로보기 }).boundingBox()],
    ] as const) {
      expect(
        Math.round(자리!.y + 자리!.height),
        `${이름}이 첫 화면 밖이다 (${폭}×${높이})`,
      ).toBeLessThanOrEqual(높이);
    }
  });
}
