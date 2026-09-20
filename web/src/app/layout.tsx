import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { Waker } from "@/components/wake";
import { BookJourneyProvider } from "@/components/book-journey";

import { 앱 } from "./app-copy";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// **매니페스트도 apple-* 메타도 없다** (2026-09-14, `adr/0014`).
// 홈 화면 추가 자체는 못 막는다 — Safari 공유 메뉴는 무엇을 지우든 거기 있다.
// **막을 수 있는 것은 「그것이 격리된 컨텍스트로 열리는 것」**이고 그 스위치가 `appleWebApp` 이었다.
// 없으면 iOS 가 홈 화면 아이콘을 **Safari 탭으로 열어 쿠키가 공유되고**,
// **1회용 코드 함정이 존재하지 않게 된다.** 추가해도 **아무 일도 안 일어나는 상태**가 목표다.
//
// **아이콘은 남긴다** — 탭 파비콘과 링크 미리보기에 쓰이고, 그건 설치와 무관하다.
export const metadata: Metadata = {
  title: {
    default: 앱.이름,
    template: 앱.제목틀,
  },
  description: 앱.설명,
  applicationName: 앱.이름,
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  // 상태바·브라우저 크롬 색을 실제 배경과 맞춘다 — globals.css 의 --background 와 같은 값이다.
  // **홈 화면 앱을 버린 뒤에도 남긴다** — 모바일 브라우저가 주소창을 이 색으로 칠한다.
  themeColor: [
    // globals.css의 명도 단계: markings 65% + 흰색, scarf-deep 43% + 검정.
    { media: "(prefers-color-scheme: light)", color: "#F9F1E8" },
    { media: "(prefers-color-scheme: dark)", color: "#122030" },
  ],
  // 노치·홈 인디케이터 영역까지 배경을 깔기 위한 것. **가로 모드 탭에서도 그대로 걸린다.**
  viewportFit: "cover",
  // 확대를 막지 않는다.
  initialScale: 1,
  width: "device-width",
};

// 기준 골격은 여기서 「무대」까지만 잡는다 — 화면 높이, 세로 흐름, 글꼴.
// 헤더·네비게이션은 두지 않고, <main> 도 두지 않는다 (각 page 가 자기 <main> 을 가진다).
// 기준 폭·좌우 여백은 globals.css 의 `page-frame` 유틸리티이고, 화면마다 붙인다 —
// 삽화를 화면 끝까지 깔아야 하는 화면이 있어 레이아웃에서 강제하지 않는다.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      {/* min-h-dvh — 모바일 세로에서 주소창이 접혔다 펴져도 높이가 맞는다.
          100vh 는 접힌 상태 기준이라 세로에서 화면이 잘린다. */}
      <body className="flex min-h-dvh flex-col">
        <BookJourneyProvider>{children}</BookJourneyProvider>
        <ServiceWorkerRegistrar />
        {/* **식은 서버를 깨운다** (`lib/wake.ts` · W6 15번). **아무것도 안 그린다.**
            모든 화면에 붙는 이유는 **다음 요청이 기동 32초를 맞는 것이 어느 화면에서나 같기** 때문이다. */}
        <Waker />
      </body>
    </html>
  );
}
