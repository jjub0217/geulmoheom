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
  themeColor: "#457B9D",
  // 홈 화면에서 띄운 iPad 의 노치·홈 인디케이터 영역까지 배경을 깔기 위한 것.
  viewportFit: "cover",
  // 확대를 막지 않는다.
  initialScale: 1,
  width: "device-width",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
