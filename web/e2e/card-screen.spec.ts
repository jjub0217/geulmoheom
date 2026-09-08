import { expect, test, type Page } from "@playwright/test";

import type { components, paths } from "../src/api/types.gen";
// **가림 글자를 문자열로 박지 않는다.** 확정본이 바뀌면 상수 하나만 고치면 되고,
// 여기 박아두면 **문구가 바뀌는 날 테스트가 제품을 붙잡는다** (`docs/문구.md` 1.1).
import { PII_MASK } from "../src/lib/pii";
// 문구도 같은 이유로 박지 않는다 — `docs/문구.md` 2.2·2.4·2.5 가 SSOT 다.
import { 버튼, 못닿음 } from "../src/app/copy";
// 상한도 문구와 같다 — **숫자를 여기 박으면 규약이 바뀌는 날 테스트가 제품을 붙잡는다.**
import { 폴링상한 } from "../src/lib/artwork";
// 대기 대사도 박지 않는다 — `docs/문구.md` **1.5** 가 SSOT 다.
import { 삽화대기대사 } from "../src/components/artwork-copy";
// 배지 낱말도 박지 않는다 — `docs/문구.md` **1.8** · `용어사전.md` 36행이 SSOT 다.
import { 티어이름 } from "../src/components/tier-badge";
// 가림 안내도 같은 이유로 박지 않는다 — `docs/문구.md` **1.1** 이 SSOT 다.
import { 가림안내 } from "../src/components/attempt-input";
import { 상태표시 } from "../src/app/status-copy";

/**
 * 오늘의 모험 화면(A0-2)이 응답 네 가지를 각각 그리는지 본다.
 *
 * **문장은 전부 지어낸 것이다.** 실제 아이 문장을 테스트에 넣지 않는다 —
 * 예시셋과 같은 규칙이다 (`docs/루브릭_예시셋.md`).
 */

/** 계약에서 끌어온다. `make contracts` 로 계약이 갈라지면 **여기서 타입이 깨져 알려준다.** */
type CardResponse =
  paths["/api/v1/cards/next"]["get"]["responses"][200]["content"]["application/json"];

const CARD_SKETCH = "https://r2.example/geulmoheom/cards/c99_sketch.webp";

const CARD: CardResponse = {
  card_id: "c99",
  type: "discovery",
  situation: "낡은 등대 문이 반쯤 열려 있고 안쪽에서 파란 빛이 새어 나온다.",
  prompt_label: "탐험가는 어떻게 할까?",
  sketch_url: CARD_SKETCH,
  guide: {
    expression: "default",
    line: "나침반이 조용하네. 네가 뭘 할지 말해주면 움직일 거야!",
  },
  today: { cards_done: 1, cap: 5 },
};

const CARDS_NEXT = "**/api/v1/cards/next";
const ATTEMPTS = "**/api/v1/attempts";
const EVENTS = "**/api/v1/events";

/**
 * (a) 정상 응답.
 *
 * **반환 타입을 계약에서 끌어온다.** 여기 타입이 없어서 **`placeholder_url` 이 계약에서
 * 빠진 뒤에도 살아남았다** (2026-09-08). 위 `CARD` 는 타입이 붙어 있어 멀쩡했는데
 * 이 함수만 맨 객체였다 — **낡은 픽스처가 아니라 검사 밖에 있던 픽스처**다.
 * 타입을 붙이면 **다음번 계약 변경이 빨간불로 온다.**
 */
type AttemptResult = components["schemas"]["AttemptResult"];

function 결과(
  guide: components["schemas"]["Guide"],
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
  await expect(page.locator('img[src="/guide/default.png"]')).toBeVisible();

  // 자유 입력창 하나. **선택지 버튼이 없어야 한다** — 있으면 「직접 쓴다」가 무너진다.
  const 입력창 = page.getByLabel(CARD.prompt_label);
  await expect(입력창).toBeVisible();
  await 입력창.fill("등대 문틈으로 손전등을 비춰 안쪽을 살핀다");
  await expect(입력창).toHaveValue("등대 문틈으로 손전등을 비춰 안쪽을 살핀다");
  // 버튼은 「보내기」 하나뿐이어야 한다. 선택지가 몰래 생기면 여기서 걸린다.
  // **`main` 안에서 센다.** 밖까지 세면 개발 빌드의 Next 오버레이 버튼(`#next-logo`)이 함께 잡혀
  // **우리 UI 와 무관한 이유로 빨간불**이 된다 — 라우트가 둘이 되고 중간에 컴파일이 일어나자 실제로 그랬다.
  await expect(page.locator("main").getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: 버튼.보내기 })).toBeEnabled();

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
  const 빛 = page.locator('main svg circle[fill^="url("]');
  const 밝기 = async () =>
    Number(await 빛.evaluate((el) => getComputedStyle(el).opacity));

  const 입력창 = page.getByLabel(CARD.prompt_label);

  await 입력창.fill("문을 연다");
  await expect.poll(밝기).toBeGreaterThan(0);
  const 조금 = await 밝기();

  // 30자에서 가득 찬다 (PRD A0-2). 넘겨도 1 에서 멈춘다.
  await 입력창.fill("낡은 등대 문틈으로 손전등을 비추자 계단 위에 젖은 발자국이 이어져 있었다");
  await expect.poll(밝기).toBe(1);

  // 계단이 아니라 연속 변화다 — 적게 썼을 때가 가득 찬 것보다 어두워야 한다.
  expect(조금).toBeLessThan(1);
  expect(조금).toBeGreaterThan(0);

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

  const 보내기 = page.getByRole("button", { name: 버튼.보내기 });
  const 입력창 = page.getByLabel(CARD.prompt_label);

  // 아무것도 안 썼을 때만 막힌다. **30자와 무관하다.**
  await expect(보내기).toBeDisabled();
  await 입력창.fill("문을 연다");
  await expect(보내기).toBeEnabled();

  let 보낸것: Record<string, unknown> = {};
  await page.route(ATTEMPTS, (route) => {
    보낸것 = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: 결과(CARD.guide) });
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
    route.fulfill({ status: 200, json: 결과(CARD.guide) }),
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
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  // 굽는 동안 화면의 유일한 말은 **액자 안 대기 대사**다 (`문구.md` 1.5).
  const 대기대사 = page.locator("main [data-대기대사]");
  await expect(대기대사).toBeVisible();
  expect([...삽화대기대사]).toContain((await 대기대사.innerText()).trim());

  // **결과 대사가 여기 있으면 안 된다.** 있으면 아이가 그림보다 먼저 등급 반응을 읽는다 —
  // 2026-09-08 까지 실제로 그랬고, 1.5 가 생긴 이유가 그것이다.
  await expect(page.getByText(CARD.guide.line)).toHaveCount(0);
  // **배지도 마찬가지다.** 배지가 먼저 뜨면 그림은 이미 아는 것을 확인하는 절차가 된다.
  await expect(page.locator("main [data-티어배지]")).toHaveCount(0);

  const 그림 = page.locator(`main img[src="${ARTWORK_URL}"]`);
  await expect(그림).toBeVisible();
  expect(물어본횟수).toBeGreaterThanOrEqual(2);

  // 그림이 온 **뒤에** 결과 대사와 배지가 온다. 대기 대사는 그림이 덮어 사라진다.
  await expect(page.getByText(CARD.guide.line)).toBeVisible();
  await expect(page.locator("main [data-티어배지]")).toHaveText(티어이름.rare);
  await expect(대기대사).toHaveCount(0);

  // **`crossOrigin` 이 붙으면 쿠키가 안 실려 그림이 통째로 안 뜬다** (`Stage0.md` 5절 ⚠).
  // 습관적으로 붙는 속성이라 **여기서 못을 박는다** — 붙는 날 네트워크 탭을 안 열면 원인이 안 보인다.
  await expect(그림).not.toHaveAttribute("crossorigin", /.*/);

  // **주소 앞에 아무것도 안 붙였다.** 상대 경로로 바꾸거나 오리진을 덧대면 여기서 걸린다.
  expect(그림요청).toContain(ARTWORK_URL);

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
    route.fulfill({ status: 200, json: 결과(CARD.guide) }),
  );
  // **서버에 통째로 못 닿는 경우**다. 정상 경로에서는 서버가 15초에 기본 에셋으로 확정하므로
  // 여기까지 오지 않는다 — 그래서 이 검사가 **유일하게 「못받음」을 밟는 자리**다.
  await page.route(`**/api/v1/artworks/${ARTWORK}`, (route) => route.abort());

  const 쓴것 = "등대 계단을 한 칸씩 올라간다";
  await page.goto("/");
  await page.getByLabel(CARD.prompt_label).fill(쓴것);
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  // 굽는 동안에는 자리가 잡혀 있고 그 안에서 대기 대사가 기다린다.
  const 자리 = page.locator("main [data-삽화자리]");
  await expect(자리).toBeVisible();
  await expect(page.locator("main [data-대기대사]")).toBeVisible();

  // **상한을 넘기면 자리가 통째로 사라진다.** 빈 액자를 남기면 아이가
  // 「여기 그림이 있어야 하는데 없다」로 읽어, 실패 화면을 안 만든다는 결정이 연출로 뒤집힌다.
  await expect(자리).toHaveCount(0, { timeout: 폴링상한 + 5_000 });

  // 그림만 없다. **가이드 대사도 배지도 그대로 있다** (`문구.md` 1.7) — 아이는 자기 문장이
  // 통했다는 것을 알아야 하고, 그림은 「내 책」에서 다시 본다. 오류 문구도 버튼도 안 생긴다.
  await expect(page.getByText(CARD.guide.line)).toBeVisible();
  await expect(page.locator("main [data-티어배지]")).toHaveText(티어이름.rare);
  await expect(page.getByRole("button", { name: 버튼.다시열기 })).toHaveCount(0);
  // **아무 말도 안 한다** (`문구.md` 1.7). 금지어 목록으로 막지 않고 **화면에 남은 것을 통째로
  // 센다** — 목록은 **적어 둔 낱말만** 막지만, 여기서 막아야 하는 것은 **새 문장이 생기는 것**이다.
  const 화면 = await page.locator("main").innerText();
  // 줄 사이 빈 줄은 **블록이 나뉜 자국일 뿐**이라 센 것에서 뺀다. 세는 것은 **문장의 목록**이다.
  const 줄들 = 화면
    .split("\n")
    .map((줄) => 줄.trim())
    .filter((줄) => 줄 !== "");
  expect(줄들).toEqual([티어이름.rare, CARD.guide.line, 쓴것]);
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
      json: 결과(CARD.guide, [
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
  await page.getByRole("button", { name: 버튼.보내기 }).click();

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
      json: 결과(CARD.guide, [{ text: "낡은", kind: "adj" }]),
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
  await page.getByRole("button", { name: 버튼.보내기 }).click();

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
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  // 질문은 가이드 대사로 온다. 표정도 서버가 준 것으로 바뀐다.
  await expect(
    page.getByText("그림자를 어떻게 할 건지 조금만 더 말해줄래?"),
  ).toBeVisible();
  await expect(page.locator('img[src="/guide/compass_dim.png"]')).toBeVisible();

  // **입력창이 그대로 있고 쓴 문장도 그대로다.** 다시 보낼 수 있어야 한다.
  await expect(입력창).toHaveValue("문을 연다");
  await expect(page.getByRole("button", { name: 버튼.보내기 })).toBeEnabled();
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
  await page.getByRole("button", { name: 버튼.보내기 }).click();

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
        guide: { expression: "session_end", line: "오늘 모험은 여기까지! 내일 또 보자" },
      }),
    }),
  );

  await page.goto("/");

  await expect(page.getByText("오늘 모험은 여기까지! 내일 또 보자")).toBeVisible();
  await expect(page.locator('img[src="/guide/session_end.png"]')).toBeVisible();
  await 가로스크롤없음(page);
});

test("여섯 번째를 보내도 가이드가 말한다 — 두 목소리가 나란히 서지 않는다", async ({
  page,
}) => {
  const 가이드대사 = "오늘 모험은 여기까지! 내일 또 보자";
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
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  // **목소리 규칙** (`문구.md` 0장) — 한 화면에 둘이 오면 `guide.line` 만 나온다.
  // 여기가 빠져 있어 **보내는 쪽만 앱 목소리로 떨어졌다**: 가이드가 하던 말이 갑자기 존댓말이 된다.
  await expect(page.getByText(가이드대사)).toBeVisible();
  expect(await page.locator("main").innerText()).not.toContain(앱문구);
  // **표정도 서버가 준 것 그대로다.** 대사만 꺼내 쓰면 `session_end` 얼굴이 영영 안 나온다.
  await expect(page.locator('img[src="/guide/session_end.png"]')).toBeVisible();
});

test("종료 인사에 모르는 표정이 오면 캐릭터를 세우지 않는다 — 말은 그대로 전한다", async ({
  page,
}) => {
  const 가이드대사 = "오늘 모험은 여기까지! 내일 또 보자";
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
  const 보내기 = page.getByRole("button", { name: 버튼.보내기 });

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
    return route.fulfill({ status: 200, json: 결과(CARD.guide) });
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
  await page.getByRole("button", { name: 버튼.보내기 }).click();

  // **`문구.md` 2.4 뼈대다** — 장면을 못 연 것이 아니라 **못 보낸 것**이다.
  await expect(page.getByText(못닿음.보내기)).toBeVisible();
  await expect(page.getByText(못닿음.장면)).toHaveCount(0);

  // **핵심.** 화면을 넘기면 「다시 열기」가 **다른 카드**를 불러오고, 입력칸에 남은 문장이
  // **앞 장면에 쓴 글인 채로 새 장면에 붙는다.** 그래서 카드도 문장도 그 자리에 있어야 한다.
  await expect(page.getByText(CARD.situation)).toBeVisible();
  await expect(입력창).toHaveValue(문장);
  await expect(page.getByRole("button", { name: 버튼.다시열기 })).toHaveCount(0);
});
