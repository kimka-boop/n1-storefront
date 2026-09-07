import Link from "next/link";
import AuthNav from "@/components/AuthNav";

/**
 * SiteHeader — 모든 페이지 상단의 얇은 식별 바 (2026-09-08 Owner 지시)
 * PDP에서도 브랜드 진입점과 로그인/회원가입이 보여야 한다.
 * 홈의 큰 히어로 브랜드는 이 바 아래에 별도로 존재한다.
 */
export default function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="site-brand" aria-label="N°1 홈">
        N°1
      </Link>
      <AuthNav />
    </header>
  );
}
