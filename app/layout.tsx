import type { Metadata } from "next";
import "./globals.css";
import FloatingOrderTracker from "@/components/FloatingOrderTracker";
import { AuthProvider } from "@/components/AuthProvider";
import CsWidget from "@/components/CsWidget";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "N°1 — 20 Pieces. Selected by AI.",
  description: "AI가 선별한 큐레이션 패션 스토어",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AuthProvider>
        <SiteHeader />
        {children}
        </AuthProvider>
        <FloatingOrderTracker />
        <CsWidget />
      </body>
    </html>
  );
}
