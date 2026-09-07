/**
 * 「서버에 못 닿음」의 **가능한 원인**을 개발자에게 짚어준다.
 *
 * **개발 빌드 전용이다.** 아이 화면은 이 파일이 있든 없든 똑같다 — 아이에게는 서버가 준
 * 문구나 화면이 정한 한 줄만 보이고, 여기 문장은 **개발자용**이라 `docs/용어사전.md`
 * 「아이 화면」 열과 무관하다. 새 아이 문구를 짓는 자리가 아니다.
 *
 * **왜 만들었나.** 2026-09-07 하루에 같은 화면이 **세 번** 나왔다 — 헤더에 한글이 들어가 `fetch` 가
 * 요청을 못 보낸 것, 환경 변수 이름이 어긋난 것, `.env` 가 web 까지 안 온 것. **셋 다 브라우저는
 * 아무 말도 안 해준다.** 실패한 `fetch` 의 예외는 어느 경우든 사실상 같은 문자열이라
 * **예외로는 구분할 수 없다.** 그래서 실패한 시점의 **주소와 프로토콜로 후보를 좁힌다.**
 *
 * 단정하지 않는다. 돌려주는 것은 **확정된 원인이 아니라 의심 순서**다.
 */

/**
 * @param base 우리가 부른 api 주소 (`NEXT_PUBLIC_API_BASE_URL`). 상대 경로일 수 있다.
 * @param pageOrigin 화면이 떠 있는 오리진 (`location.origin`).
 */
export function 못닿음원인(base: string, pageOrigin: string): string[] {
  // **의심이 먼저, 사실은 나중.** 주소는 단서지 원인이 아니다 —
  // 목록 맨 앞은 「무엇부터 뜯어볼지」여야 한다.
  const 원인: string[] = [];

  // 상대 경로면 언제나 같은 오리진이다 — 아래 두 의심이 성립하지 않는다.
  const 절대주소 = /^https?:\/\//.test(base);

  if (절대주소) {
    // ① 가장 먼저 짚는다. **브라우저가 요청 자체를 막아** 서버 로그에도 안 남는다.
    if (pageOrigin.startsWith("https://") && base.startsWith("http://")) {
      원인.push(
        "mixed content — 화면은 https 인데 api 주소가 http 다. 브라우저가 요청 자체를 막는다",
      );
    }

    const apiOrigin = new URL(base).origin;
    if (apiOrigin !== pageOrigin) {
      // **포트도 오리진의 일부다.** `:3000` 을 빼면 preflight 가 통과하지 않는다.
      원인.push(
        `CORS — api 오리진(${apiOrigin})이 화면 오리진과 다르다. 서버 허용 목록에 ${pageOrigin} 이 있는지 본다. 포트도 오리진의 일부다`,
      );
    }

    if (new URL(base).hostname.endsWith(".test")) {
      원인.push(
        "인증서·hosts — `.test` 주소는 `make certs` 가 깔아준다. 안 돌렸으면 이름부터 안 풀린다",
      );
    }
  }

  // ② 마지막에 둔다. 제일 흔하지만, 위 둘은 서버가 떠 있어도 실패한다.
  원인.push("서버가 떠 있는지 — `make dev-api`");

  원인.push(`부른 곳: ${base}  ·  화면: ${pageOrigin}`);
  return 원인;
}
