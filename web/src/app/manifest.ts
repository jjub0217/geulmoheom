import type { MetadataRoute } from "next";

// Next 16 App Router 의 manifest 파일 컨벤션.
// 이 파일이 /manifest.webmanifest 를 만들고 <link rel="manifest"> 도 Next 가 자동으로 넣는다.
// (참고: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md)
// 이 파일은 「특별한 라우트 핸들러」다. `output: "export"` 에서는 빌드 때 한 번 굽는다는 것을
// 명시해야 한다 — 없으면 빌드가 `Failed to collect page data for /manifest.webmanifest` 로 죽는다.
// 요청 시점 API 를 안 쓰므로 값이 항상 같다. (2026-09-07 실측)
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "글모험",
    short_name: "글모험",
    description: "내가 쓴 문장이 이야기가 되는 모험",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // orientation 을 두지 않는다(기본값 any). 이 필드는 "선호"가 아니라 방향 「고정」이고,
    // landscape 로 잠그면 PRD A0-2·비기능 접근성의 MUST 「모바일 세로」를 어긴다.
    // 「태블릿 가로 우선」은 CSS 레이아웃으로 한다 — 잠금이 아니다.
    lang: "ko",
    dir: "ltr",
    // 매니페스트는 미디어 쿼리를 못 쓴다. 스플래시는 밝을 때 배경(MARKINGS)으로 고정한다 —
    // 모드별 분기는 layout.tsx 의 themeColor 배열이 맡는다.
    background_color: "#F6EADB",
    theme_color: "#F6EADB",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
