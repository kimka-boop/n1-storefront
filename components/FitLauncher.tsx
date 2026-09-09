"use client";

/**
 * [스마트 핏 전역 런처] — §5 (Storefront Repair 2026-09-10)
 * 스마트 핏은 카테고리 행에서 제거되고 상단 유틸리티(AuthNav)로 이동했다.
 * 어느 페이지에서든 `n1:open-fit` 이벤트 하나로 같은 Smart Fit Flow를 연다 —
 * 진입 경로가 여러 개여도 플로우 인스턴스는 이 런처 하나가 소유한다.
 * (홈 story CTA·AuthNav·PDP의 제품 컨텍스트 진입은 각각 유지)
 */
import { useEffect, useState } from "react";
import SmartFitFlow from "@/components/SmartFitFlow";

export default function FitLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openEv = () => setOpen(true);
    window.addEventListener("n1:open-fit", openEv);
    return () => window.removeEventListener("n1:open-fit", openEv);
  }, []);

  if (!open) return null;
  return <SmartFitFlow onClose={() => setOpen(false)} />;
}
