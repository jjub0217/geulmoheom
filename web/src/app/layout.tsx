import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 매니페스트는 src/app/manifest.ts 가 만들고 <link rel="manifest"> 도 Next 가 넣는다.
// 여기에는 매니페스트가 덮지 못하는 것만 둔다 — iOS 는 홈 화면 추가에 매니페스트가 아니라
// apple-* 메타 태그와 apple-touch-icon 을 본다. 태블릿에 iPad 가 포함되므로 필요하다.
export const metadata: Metadata = {
  title: {
    default: "글모험",
    template: "%s · 글모험",
  },
  description: "내가 쓴 문장이 이야기가 되는 모험",
  applicationName: "글모험",
  appleWebApp: {
    capable: true,
    title: "글모험",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  // 상태바 색은 실제 배경과 맞춘다 — globals.css 의 --background 와 같은 값이다.
  // 어긋나면 홈 화면에서 띄웠을 때 상태바만 다른 색으로 뜨며 경계선이 보인다.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6EADB" },
    { media: "(prefers-color-scheme: dark)", color: "#1B527A" },
  ],
  // 홈 화면에서 띄운 iPad 의 노치·홈 인디케이터 영역까지 배경을 깔기 위한 것.
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
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
