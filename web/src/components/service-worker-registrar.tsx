"use client";

import { useEffect } from "react";

import { usePwaStore } from "@/store/pwa";

/**
 * 서비스워커를 등록하는 것 외에는 아무것도 하지 않는다. 렌더 결과가 없다.
 *
 * 워커 스크립트를 `new URL(..., import.meta.url)` 로 넘기는 것이 Next 16 방식이다 —
 * Next 가 번들해 `Service-Worker-Allowed: /` 헤더와 함께 내보내므로 scope 를 "/" 로 넓힐 수 있다.
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
      .register(new URL("../lib/service-worker.js", import.meta.url), {
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
