"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthNav from "@/components/AuthNav";
import UtilityDock from "@/components/UtilityDock";

/**
 * SiteHeader — 모든 페이지 상단 바 (Storefront Repair 2026-09-10 갱신)
 * §21 모바일 위계: 상단 유틸리티 행 → 중앙 브랜드 → 서포팅 카피.
 * 브랜드는 grid 중앙 열로 뷰포트/콘텐츠 프레임 기준 중앙 — 좌측 유틸리티가 밀지 않는다.
 * §12·§22 — 문의/장바구니 분할 글래스 컨트롤(UtilityDock)은 fixed overlay라
 * 브랜드 중앙을 침범하지 않는다. 홈 데스크톱에서는 hero 대형 브랜드가 있으므로
 * 헤더 브랜드는 자리만 유지(visibility hidden) — 유틸리티 정렬이 흔들리지 않게.
 */
export default function SiteHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  return (
    <header className={`site-header ${isHome ? "is-home" : ""}`}>
      <Link href="/" className="site-brand-block" aria-label="N°1 메인 페이지로 가기">
        <span className="site-brand-mark">N°1</span>
        {/* 카운트 카피는 홈 hero가 데이터 기준으로 표시 — 헤더는 변하지 않는 브랜드 라인만 */}
        <span className="site-brand-tag">One Wardrobe</span>
      </Link>
      <AuthNav />
      <UtilityDock />
    </header>
  );
}
