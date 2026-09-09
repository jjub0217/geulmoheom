import type { Page } from "@playwright/test";

/**
 * 홈 화면 앱으로 연 것처럼 만든다.
 *
 * **Playwright 는 `display-mode` 를 직접 흉내 내지 못한다** (`emulateMedia` 는 print/screen 과
 * 색 구성만 본다). 그래서 질의 자체를 갈아끼운다 — 화면이 보는 신호가 정확히 이것이다.
 *
 * **스펙 파일이 아니라 여기 둔다.** 자녀 인증 화면과 **들어가는 문**(`entry.spec.ts`)이 같은
 * 흉내를 내는데, 각자 복사하면 **한쪽만 고쳐지는 날 두 검사가 다른 것을 재게 된다.**
 * **이건 우리가 정하는 값이 아니라 우리가 만든 도구라 모으는 것이 맞다** (축 ⑨).
 */
export async function 홈화면앱으로(page: Page) {
  await page.addInitScript(() => {
    const 원래 = window.matchMedia.bind(window);
    window.matchMedia = ((query: string) => {
      if (!query.includes("display-mode: standalone")) return 원래(query);
      // **`MediaQueryList` 를 흉내 내다 말면 안 된다.** 화면이 여기에 구독을 건다 —
      // `addEventListener` 가 없으면 진짜 브라우저에서는 안 나는 오류로 화면이 죽고,
      // 그러면 **테스트가 제품이 아니라 자기 목을 재게 된다.**
      return {
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      } as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
  });
}
