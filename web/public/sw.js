/// <reference lib="webworker" />

// 「홈 화면에 추가」가 되는 최소 서비스워커.
// 오프라인 캐싱 전략은 아직 없다 — 캐시를 붙일 때 이 파일에 fetch 전략을 넣는다.
//
// **`public/` 에 있는 것이 요점이다.** 이 파일은 번들되지 않고 오리진 루트(`/sw.js`)에서
// 그대로 나간다. 서비스워커의 기본 scope 는 자기가 서빙된 경로라, 루트에서 나가면
// **`Service-Worker-Allowed` 헤더 없이도 scope 가 `/` 다.**
//
// 전에는 `src/lib/` 에 두고 Next 가 번들해 `/_next/static/` 으로 내보내면서 붙여주는
// `Service-Worker-Allowed: /` 헤더에 기대고 있었다. **`output: "export"` 는 `headers()` 를
// 지원하지 않아** 그 헤더가 사라진다 — 정적 호스트에서 scope 가 `/_next/static/...` 으로
// 좁아져 등록이 실패한다. 그래서 둘을 같은 커밋에 넣었다.
// (참고: node_modules/next/dist/docs/01-app/02-guides/static-exports.md 「Unsupported Features」)
//
// **여기는 번들러가 안 지나간다.** import·TypeScript·환경변수 치환이 없다 —
// 브라우저가 읽는 그대로의 JavaScript 만 쓴다.

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
