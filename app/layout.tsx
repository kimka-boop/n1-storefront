import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "N°1 — 20 Pieces. Selected by AI.",
  description: "Minimalist high-end fashion magazine, curated by AI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}