import type { Metadata } from "next";
import "./globals.css";
import FloatingOrderTracker from "@/components/FloatingOrderTracker";
import { AuthProvider } from "@/components/AuthProvider";
import { CartProvider } from "@/components/CartProvider";
import CartDrawer from "@/components/CartDrawer";
import CsWidget from "@/components/CsWidget";
import FitLauncher from "@/components/FitLauncher";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "N°1 — 60 Pieces. One Wardrobe.",
  description: "AI가 선별한 큐레이션 패션 스토어",
  // 2026-09-13 미션 — N°1 favicon (lens + perfume blotter + N°1). ?v=1: 무파비콘 시절 캐시 무효화.
  icons: {
    icon: [
      { url: "/favicon.svg?v=1", type: "image/svg+xml" },
      { url: "/favicon-16x16.png?v=1", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png?v=1", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png?v=1", sizes: "48x48", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png?v=1", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AuthProvider>
          <CartProvider>
            <SiteHeader />
            {children}
            <FitLauncher />
            <FloatingOrderTracker />
            <CartDrawer />
            <CsWidget />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
