/// <reference lib="webworker" />

// 「홈 화면에 추가」가 되는 최소 서비스워커.
// 오프라인 캐싱 전략은 아직 없다 — 캐시를 붙일 때 이 파일에 fetch 전략을 넣는다.
//
// Next 16 은 이 파일을 번들해 /_next/static/service-worker/ 로 내보내고
// 그 응답에 Service-Worker-Allowed: / 헤더를 붙인다. 그래서 scope: "/" 로 등록할 수 있다.
// (참고: node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md)

self.addEventListener("install", () => {
  // 새 워커를 대기시키지 않고 바로 넘긴다. 캐시가 없으니 버전 간 충돌도 없다.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 아무것도 가로채지 않는 fetch 핸들러.
// 일부 브라우저는 설치 가능 판정에 fetch 핸들러 존재를 본다. 응답에는 손대지 않으므로
// 네트워크 동작은 워커가 없을 때와 같다. 캐싱을 시작할 때 여기부터 채운다.
self.addEventListener("fetch", () => {});
