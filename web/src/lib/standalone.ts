import { useSyncExternalStore } from "react";

/**
 * 홈 화면 앱으로 열렸는지 판정한다 (백로그 E-3, `api/공통규약.md` 181).
 *
 * **왜 이 판정이 필요한가.** 접속 코드는 **6자리·24시간·1회용**이다. 브라우저 탭에서 써버리면
 * 그 코드는 죽고, iOS 홈 화면 앱은 Safari 와 쿠키를 공유하지 않아 **아이는 재발급 없이는
 * 홈 화면 앱으로 못 들어간다.** 불편이 아니라 **막힘**이다 — 그래서 탭에서는 코드 입력을
 * 열지 않고 설치 안내만 보여준다.
 *
 * **틀리는 방향이 대칭이 아니다.**
 * - 홈 화면 앱인데 「탭」으로 잘못 보면 → 설치 안내가 한 번 더 뜬다. **되돌릴 수 있다**
 * - 탭인데 「홈 화면 앱」으로 잘못 보면 → 아이가 코드를 써버린다. **되돌리려면 학부모가 재발급해야 한다**
 *
 * 그래서 **확신이 없으면 언제나 `"브라우저탭"`** 이다. 모르는 것을 안전한 쪽으로 접는다.
 */

/** 세 상태다. **2상태로 만들지 않는다** — 첫 페인트에 코드 입력칸이 깜빡이면 아이가 누른다. */
export type 실행형태 = "확인중" | "홈화면앱" | "브라우저탭";

/**
 * 판정에 필요한 것만 받는다. `Window` 를 통째로 받지 않는 이유는 **테스트에서 두 갈래를
 * 다 만들어 보기 위해서**다 — jsdom 의 `matchMedia` 는 기본으로 없고, `navigator.standalone`
 * 은 iOS 전용이라 타입에도 없다.
 */
type 판정대상 = {
  matchMedia?: (query: string) => { matches: boolean };
  /**
   * **`unknown` 으로 받는다.** 표준 `Navigator` 에는 `standalone` 이 없어서
   * `{ standalone?: unknown }` 으로 좁히면 **진짜 `window` 가 안 들어온다** —
   * 전부 선택 속성인 타입은 「공통 속성이 하나도 없다」로 거절된다.
   */
  navigator?: unknown;
};

/**
 * iOS Safari 의 레거시 신호. **`=== true` 로 좁히는 것이 요점**이다 —
 * `"false"` 같은 문자열도 참 같은 값이라, 느슨하게 보면 **위험한 쪽으로** 틀린다.
 */
function iOS홈화면앱인가(nav: unknown): boolean {
  if (typeof nav !== "object" || nav === null) return false;
  return (nav as { standalone?: unknown }).standalone === true;
}

/**
 * 매니페스트가 `display: "standalone"` 이라 이 값만 본다 (`src/app/manifest.ts`).
 * `fullscreen`·`minimal-ui` 를 함께 받지 않는 이유는 **우리가 요청하지 않은 모드**라서다 —
 * 넓히면 위 「틀리는 방향」의 위험한 쪽으로 넓어진다.
 */
const 홈화면앱질의 = "(display-mode: standalone)";

/**
 * **서버(정적 빌드)에서는 `undefined` 를 넘긴다.** 그때 `"확인중"` 이 나와야 첫 HTML 과
 * 하이드레이션이 어긋나지 않는다 — 서버가 `"브라우저탭"` 을 그려 두면 홈 화면 앱으로 들어온
 * 아이에게 설치 안내가 한 번 번쩍인다.
 */
export function 실행형태판정(win: 판정대상 | undefined): 실행형태 {
  if (win === undefined) return "확인중";

  // iOS 26 부터는 아래 미디어 질의도 함께 참이지만, 그 아래 버전에서는 **이것만 참이다.**
  if (iOS홈화면앱인가(win.navigator)) return "홈화면앱";

  // `matchMedia` 자체가 없는 브라우저가 있다. 그때 「아니다」로 단정하지 않고
  // **위험한 쪽이 아닌 곳으로 접는다** — 설치 안내를 한 번 더 보는 것은 되돌릴 수 있다.
  if (typeof win.matchMedia !== "function") return "브라우저탭";

  return win.matchMedia(홈화면앱질의).matches ? "홈화면앱" : "브라우저탭";
}

/**
 * 화면에서 쓰는 형태. **`useState` + `useEffect` 로 하지 않는다** — 효과 본문에서 `setState` 를
 * 부르는 모양이 되고(그건 `react-hooks/set-state-in-effect` 가 막는다), 무엇보다
 * **표시 모드는 실행 중에 바뀔 수 있다.** 아이가 안내를 읽고 홈 화면에 추가한 뒤 돌아오는 것이
 * 정확히 그 경우다 — 구독해 두면 화면이 저절로 코드 입력으로 넘어간다.
 *
 * `useSyncExternalStore` 의 **서버 스냅샷이 `"확인중"`** 이라 첫 HTML 과 하이드레이션이
 * 어긋나지 않는다. 정적 빌드(`output: "export"`)에서 이것이 중요하다.
 */
function 구독(다시그리기: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const 질의 = window.matchMedia(홈화면앱질의);
  // **구독은 있으면 좋은 것이지 없으면 안 되는 것이 아니다.** 판정 자체는 위에서 이미 끝났고,
  // 여기서 던지면 **설치 안내조차 못 보고 화면이 통째로 죽는다.** 못 걸면 안 건다.
  if (typeof 질의.addEventListener !== "function") return () => {};
  질의.addEventListener("change", 다시그리기);
  return () => 질의.removeEventListener("change", 다시그리기);
}

const 지금스냅샷 = (): 실행형태 =>
  실행형태판정(typeof window === "undefined" ? undefined : window);

const 서버스냅샷 = (): 실행형태 => "확인중";

/**
 * **이 이름만 영문인 이유** — `react-hooks/rules-of-hooks` 가 훅 이름을 `use` + **대문자**로
 * 검사하는데 **한글에는 대문자가 없어** `use실행형태` 가 훅으로 인식되지 않는다.
 * 읽는 것은 CSS 의 `display-mode` 라 그 이름을 그대로 썼다.
 */
export function useDisplayMode(): 실행형태 {
  return useSyncExternalStore(구독, 지금스냅샷, 서버스냅샷);
}
