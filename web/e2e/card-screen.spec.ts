import { expect, test, type Page } from "@playwright/test";

import type { paths } from "../src/api/types.gen";

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

/** (a) 정상 응답. 삽화·하이라이트 연출은 W4 라 여기서는 최소 형태만 쓴다. */
function 결과(guide: { expression: string; line: string }) {
  return {
    outcome: "result",
    attempt_id: "a1",
    tier: "rare",
    highlights: [],
    guide,
    artwork: {
      artwork_id: "w1",
      status: "pending",
      url: null,
      placeholder_url: CARD_SKETCH,
    },
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
  await expect(page.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "보내기" })).toBeEnabled();

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

  const 보내기 = page.getByRole("button", { name: "보내기" });
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

  await expect(page.getByText(CARD.guide.line)).toBeVisible();
  expect(보낸것.card_id).toBe(CARD.card_id);
  expect(보낸것.text).toBe("문을 연다");
  // **항상 null.** 채우면 그 카드가 하루 5장에서 안 빠지고, H2 회당 평균도 갈린다.
  expect(보낸것.retry_of).toBeNull();
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
  await page.getByRole("button", { name: "보내기" }).click();

  // 질문은 가이드 대사로 온다. 표정도 서버가 준 것으로 바뀐다.
  await expect(
    page.getByText("그림자를 어떻게 할 건지 조금만 더 말해줄래?"),
  ).toBeVisible();
  await expect(page.locator('img[src="/guide/compass_dim.png"]')).toBeVisible();

  // **입력창이 그대로 있고 쓴 문장도 그대로다.** 다시 보낼 수 있어야 한다.
  await expect(입력창).toHaveValue("문을 연다");
  await expect(page.getByRole("button", { name: "보내기" })).toBeEnabled();
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
        reason: "pii",
        guide: { expression: "compass_dim", line: "나침반이 그 말은 못 알아듣네. 다르게 말해줄래?" },
        today: { cards_done: 1, cap: 5, locked: false },
      },
    }),
  );
  await page.goto("/");

  const 입력창 = page.getByLabel(CARD.prompt_label);
  await 입력창.fill("문을 열고 들어간다");
  await page.getByRole("button", { name: "보내기" }).click();

  await expect(page.getByText("다르게 말해줄래?")).toBeVisible();
  await expect(입력창).toHaveValue("문을 열고 들어간다");

  // 오류 화면으로 때우지 않는다 — 아이는 자기가 뭘 잘못했는지 모른 채 막히면 안 된다.
  await expect(page.getByRole("button", { name: "다시 열기" })).toHaveCount(0);
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

  const 다시열기 = page.getByRole("button", { name: "다시 열기" });
  await expect(다시열기).toBeVisible();

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
  const 보내기 = page.getByRole("button", { name: "보내기" });

  await 입력창.fill("등대지기한테 010-1234-5678 로 전화한다");

  // 번호는 사라지고 나머지 문장은 그대로다. **전송을 막지 않는다** (대표 판정 2026-09-07).
  await expect(입력창).toHaveValue("등대지기한테 [보안 필터] 로 전화한다");
  await expect(보내기).toBeEnabled();

  // 가린 이유를 말해주는 유일한 자리다. **혼내는 말이 아니어야 한다.**
  const 안내 = page.getByRole("status");
  await expect(안내).toHaveText("전화번호는 안 써도 돼서 가렸어!");
  expect(await 안내.innerText()).not.toMatch(/안 돼요|하지 마|틀렸|나쁜/);

  // **다음 글자를 쳐도 안내가 남아 있어야 한다.** 한 번의 타이핑에 사라지면
  // 아이가 읽기도 전에 없어져, 자기 글자가 왜 바뀌었는지 알 방법이 사라진다.
  await 입력창.fill("등대지기한테 [보안 필터] 로 전화한다 그리고 문을 연다");
  await expect(안내).toHaveText("전화번호는 안 써도 돼서 가렸어!");

  // 서버로 가는 것도 **가린 문장**이다. 서버는 이걸 책 콘텐츠로 저장한다.
  let 보낸것: Record<string, unknown> = {};
  await page.route(ATTEMPTS, (route) => {
    보낸것 = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: 결과(CARD.guide) });
  });
  await 보내기.click();
  await expect(page.getByText(CARD.guide.line)).toBeVisible();
  expect(보낸것.text).toBe("등대지기한테 [보안 필터] 로 전화한다 그리고 문을 연다");
});

test("가린 자리는 아이가 지울 수 있다 — 덩어리가 아니라 평범한 글자다", async ({ page }) => {
  await page.route(CARDS_NEXT, (route) =>
    route.fulfill({ status: 200, json: CARD }),
  );
  await page.route(EVENTS, (route) => route.fulfill({ status: 204 }));
  await page.goto("/");

  const 입력창 = page.getByLabel(CARD.prompt_label);
  await 입력창.fill("010-1234-5678");
  await expect(입력창).toHaveValue("[보안 필터]");

  // 지워지지 않는 덩어리면 아이가 자기 문장을 못 고친다. 한 글자씩 지워져야 한다.
  await 입력창.press("End");
  await 입력창.press("Backspace");
  await expect(입력창).toHaveValue("[보안 필터");
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
  await expect(입력창).toHaveValue("우리 학교는 [보안 필터]야");
});
