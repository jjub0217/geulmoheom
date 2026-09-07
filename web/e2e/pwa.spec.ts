import { expect, test } from "@playwright/test";

/**
 * PWA 껍데기 — **서비스워커가 오리진 루트에 있고 scope 가 `/` 인지**만 본다.
 *
 * **이 검사가 없으면 배포가 조용히 깨진다.** 워커를 `src/lib/` 에 두고 번들하면
 * `/_next/static/...` 에서 서빙되고, scope 를 `/` 로 넓히는 것은 Next 가 붙여주는
 * `Service-Worker-Allowed: /` 헤더에 달려 있다. **`output: "export"` 는 `headers()` 를
 * 지원하지 않아** 정적 호스트에서 그 헤더가 사라진다 — 화면은 멀쩡한데 **홈 화면 추가만
 * 안 되고**, 아무도 안 본다. 그래서 배치를 `public/sw.js` 로 바꿨고 여기서 붙잡는다.
 *
 * **다른 스펙과 달리 api 를 가로채지 않는다.** 이 화면은 워커 등록까지만 보므로
 * 첫 요청이 실패해도 상관없다 — 등록은 화면 상태와 무관하게 layout 에서 돈다.
 */

/** 이 값이 바뀌면 정적 배포에서 scope 가 좁아진다. 상수로 둬 의도를 남긴다. */
const SW_PATH = "/sw.js";
const SW_SCOPE = "/";

test("서비스워커는 오리진 루트에서 등록된다 — scope 가 `/` 다", async ({
  page,
  baseURL,
}) => {
  await page.goto("/");

  const registration = await page.evaluate(async () => {
    // 등록은 layout 의 클라이언트 컴포넌트가 마운트되며 시작한다. `ready` 가 그것을 기다린다.
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, scriptURL: r.active?.scriptURL ?? null };
  });

  // scope 를 절대 URL 로 비교한다 — 브라우저가 그렇게 돌려준다.
  expect(registration.scope).toBe(new URL(SW_SCOPE, baseURL).href);
  expect(registration.scriptURL).toBe(new URL(SW_PATH, baseURL).href);
});

test("워커 스크립트가 `_next` 아래에 있지 않다 — 헤더에 기대지 않는다", async ({
  request,
}) => {
  const response = await request.get(SW_PATH);

  expect(response.status()).toBe(200);
  // **헤더가 없어도 되는 것이 요점이다.** 있어도 틀린 것은 아니지만,
  // 없는 상태로 통과하는 것이 `public/` 배치가 성립한다는 증거다.
  expect(response.url()).not.toContain("/_next/");
});
