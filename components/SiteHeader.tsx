"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthNav from "@/components/AuthNav";

/**
 * SiteHeader — 모든 페이지 상단 바 (2026-09-08 Owner 지시 갱신)
 * 홈 이외 페이지: 중앙 브랜드 블록(N°1 / 44 Pieces · 20 Outfits)을
 * 클릭하면 메인 홈으로 돌아간다. 기존 좌측 상단의 작은 N°1은 제거.
 * 홈에서는 바로 아래 히어로 브랜드가 같은 역할을 하므로 헤더에는
 * 로그인/회원가입 메뉴만 둔다.
 */
export default function SiteHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  return (
    <header className="site-header">
      {!isHome && (
        <Link href="/" className="site-brand-block" aria-label="N°1 메인 페이지로 가기">
          <span className="site-brand-mark">N°1</span>
          <span className="site-brand-tag">44 Pieces · 20 Outfits</span>
        </Link>
      )}
      <AuthNav />
    </header>
  );
}
