"use client";

import { useEffect } from "react";

import { usePwaStore } from "@/store/pwa";

/**
 * 서비스워커를 등록하는 것 외에는 아무것도 하지 않는다. 렌더 결과가 없다.
 *
 * **워커는 `public/sw.js` 라 오리진 루트에서 그대로 나간다.** 서비스워커의 기본 scope 는
 * 자기가 서빙된 경로이므로 루트에서 나가면 헤더 없이도 scope 가 "/" 다.
 *
 * `new URL("../lib/service-worker.js", import.meta.url)` 로 번들해 넘기던 것을 바꿨다 —
 * 그쪽은 Next 가 붙여주는 `Service-Worker-Allowed: /` 헤더에 기대는데
 * **`output: "export"` 는 `headers()` 를 지원하지 않는다** (`docs/adr/0007` 결정 5).
 */
export function ServiceWorkerRegistrar() {
  const setServiceWorkerStatus = usePwaStore(
    (state) => state.setServiceWorkerStatus,
  );

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setServiceWorkerStatus("unsupported");
      return;
    }

    let cancelled = false;
    setServiceWorkerStatus("registering");

    navigator.serviceWorker
      // 경로를 문자열로 준다. 번들 대상이 아니므로 `new URL(..., import.meta.url)` 이 아니다.
      // scope 는 기본값과 같지만 남겨 둔다 — 이 값이 "/" 여야 한다는 것이 배치의 이유다.
      .register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      .then(() => {
        if (!cancelled) setServiceWorkerStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setServiceWorkerStatus("failed");
        // 등록 실패는 페이지를 막지 않는다. 홈 화면 추가만 안 될 뿐이다.
        console.warn("[pwa] 서비스워커 등록 실패", error);
      });

    return () => {
      cancelled = true;
    };
  }, [setServiceWorkerStatus]);

  return null;
}
