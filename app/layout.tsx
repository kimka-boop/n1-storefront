import type { Metadata } from "next";
import "./globals.css";
import FloatingOrderTracker from "@/components/FloatingOrderTracker";
import { AuthProvider } from "@/components/AuthProvider";
import { CartProvider } from "@/components/CartProvider";
import CartDrawer from "@/components/CartDrawer";
import CsWidget from "@/components/CsWidget";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "N°1 — 60 Pieces. Selected by AI.",
  description: "AI가 선별한 큐레이션 패션 스토어",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AuthProvider>
          <CartProvider>
            <SiteHeader />
            {children}
            <FloatingOrderTracker />
            <CartDrawer />
            <CsWidget />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
