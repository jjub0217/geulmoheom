"use client";

import { useEffect } from "react";

/**
 * **이미 등록된 서비스워커를 거둔다. 한 번 쓰고 지울 코드다** (`adr/0014`).
 *
 * **2026-09-14 에 홈 화면 앱을 버렸다.** `public/sw.js` 를 지웠으므로 새 방문자에게는
 * 워커가 안 생긴다 — **그런데 이미 설치된 브라우저에는 낡은 워커가 남는다.**
 * `/sw.js` 가 404 가 되면 브라우저가 알아서 해제하지만 **즉시가 아니다.**
 *
 * **왜 급한가** — 서비스워커는 **「낡은 빌드」를 만들 수 있는 장치**다.
 * **2026-09-08 실기기 결함 셋 중 하나가 그것이었다.** 지금은 아무 값도 안 주면서
 * **그 가능성만** 갖고 있다.
 *
 * **`layout.tsx` 에 직접 못 넣는다** — 거기는 서버 컴포넌트다(`metadata` 를 내보낸다).
 * 브라우저에서 도는 코드라 클라이언트 컴포넌트가 있어야 하고, **등록하던 자리를
 * 거두는 자리로 바꾼 것**이 가장 작은 변경이다.
 *
 * **⛔ 2026-10 이후 이 파일을 통째로 지운다.** 그때는 아무도 안 갖고 있다.
 * **지울 때 `layout.tsx` 의 사용처도 같이 지운다** — 안 지우면 빈 컴포넌트만 남는다.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker
      .getRegistrations()
      .then((등록들) => Promise.all(등록들.map((r) => r.unregister())))
      // **실패해도 화면을 막지 않는다.** 거두기는 아이가 기다리는 일이 아니다.
      .catch(() => {});
  }, []);

  return null;
}
