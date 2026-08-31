"use client";
/**
 * N°1 — Scroll Exploration Detail (Prototype)
 *
 * 구조:
 *  [sticky visual]  4각도 crossfade — 스크롤 진행도 = 카메라 궤도
 *  [info sections]  기본정보 → 소재/세탁/실측 → 옵션+CTA
 *
 * 폴백: reduced-motion 또는 LOW DATA → 슬라이드 모드(prev/next)
 * 이미지 로딩: FRONT 즉시, 45 preload, 90/BACK은 스크롤 50% 도달 시 (동시 다운로드 회피)
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { PROTO_ANGLES, prefersReducedMotion, isLowData } from "@/lib/proto";

export interface ProtoProduct {
  id: string; name: string; category: string; price: number;
  colorOptions?: string[]; sizeOptions?: string[]; optionStock?: Record<string, number>;
  material?: string; washingInfo?: string; sizeChart?: string; fit?: { shape?: string };
}

interface Props {
  product: ProtoProduct;
  fileIds: string[];        // lookbook-files API 정렬 순서 (01→06)
  onClose: () => void;
  detailsChildren?: React.ReactNode; // PHASE 04 — 소재/핏/사이즈
  fitChildren?: React.ReactNode;     // PHASE 05 — 옵션/Smart Fit/CTA
}

export default function ProtoDetail({ product, fileIds, onClose, detailsChildren, fitChildren }: Props) {
  // 4각도 file id 매핑 (files: 01,02,03,04,05,06 순서)
  const angleIds = PROTO_ANGLES.map((_, i) => fileIds[i]).filter(Boolean);

  const [fallback, setFallback] = useState(false);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({ 0: false });
  const [progress, setProgress] = useState(0);        // 0~1 스크롤 진행도
  const [slide, setSlide] = useState(0);              // 폴백 모드용
  const [lowData, setLowData] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const triggered = useRef<Set<number>>(new Set([0, 1])); // 0(FRONT), 1(45) 즉시 로드

  // ── 폴백 판정 ──
  useEffect(() => {
    setLowData(isLowData());
    if (prefersReducedMotion() || isLowData()) setFallback(true);
  }, []);

  // ── 지연 로딩: 스크롤 진행도에 따라 90(2), BACK(3) 로드 ──
  useEffect(() => {
    if (fallback) return;
    const need = progress > 0.4 ? [2, 3] : progress > 0.15 ? [2] : [];
    for (const i of need) {
      if (!triggered.current.has(i)) {
        triggered.current.add(i);
        const img = new Image();
        const fid = angleIds[i];
        if (fid) {
          img.src = `https://drive.google.com/thumbnail?id=${fid}&sz=w800`;
          img.onload = () => setLoaded((p) => ({ ...p, [i]: true }));
        }
      }
    }
  }, [progress, fallback, angleIds]);

  // ── 스크롤 진행도 측정 (컨테이너 .proto-detail 스크롤 대응) ──
  const onScroll = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    const passed = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
    setProgress(Math.min(passed / Math.max(total, 1), 1));
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fallback) return;
    // 컨테이너(.proto-detail)와 window 둘 다 리스닝 — 구조 변경에 유연
    const container = containerRef.current;
    container?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      container?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
    };
  }, [fallback, onScroll]);

  // ── 활성 각도 인덱스 (progress 0~1 → 0~3) ──
  const activeIdx = fallback
    ? slide
    : Math.min(Math.floor(progress * 4), 3);

  // FRONT는 항상 즉시 로드
  useEffect(() => {
    const img = new Image();
    if (angleIds[0]) {
      img.src = `https://drive.google.com/thumbnail?id=${angleIds[0]}&sz=w800`;
      img.onload = () => setLoaded((p) => ({ ...p, 0: true }));
    }
  }, [angleIds]);

  // 45 preload (FRONT 로드 후 1초)
  useEffect(() => {
    if (fallback || !angleIds[1]) return;
    const t = setTimeout(() => {
      if (triggered.current.has(1)) return;
      triggered.current.add(1);
      const img = new Image();
      img.src = `https://drive.google.com/thumbnail?id=${angleIds[1]}&sz=w800`;
      img.onload = () => setLoaded((p) => ({ ...p, [1]: true }));
    }, 1000);
    return () => clearTimeout(t);
  }, [fallback, angleIds]);

  const esc = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (fallback && e.key === "ArrowRight") setSlide((s) => Math.min(s + 1, 3));
    if (fallback && e.key === "ArrowLeft") setSlide((s) => Math.max(s - 1, 0));
  }, [fallback, onClose]);
  useEffect(() => {
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [esc]);

  return (
    <div className="proto-detail" data-proto ref={containerRef}>
      {/* ── 헤더 (최소 UI: 종료/브랜드/저데이터) ── */}
      <header className="proto-head">
        <button className="proto-back" onClick={onClose} aria-label="상품 목록으로 돌아가기">← 목록</button>
        <span className="proto-brand">N°1</span>
        <button
          className={`proto-lowdata ${lowData ? "on" : ""}`}
          onClick={() => { const v = !lowData; setLowData(v); setFallback(v || prefersReducedMotion()); localStorage.setItem("n1_lowdata", v ? "1" : "0"); }}
          aria-label="저데이터 모드 전환"
        >
          LOW DATA {lowData ? "ON" : "OFF"}
        </button>
      </header>

      {/* ── PHASE 01~02: 상품을 본다 → 돌아본다 (sticky 회전 스테이지) ── */}
      <div className="proto-stage" ref={stageRef}>
        <div className="proto-sticky">
          <div className="proto-visual">
            {PROTO_ANGLES.map((a, i) => {
              const fid = angleIds[i];
              if (!fid) return null;
              const isActive = fallback ? i === slide : i === activeIdx;
              const isNeighbor = Math.abs(i - (fallback ? slide : activeIdx)) === 1;
              const shouldRender = fallback
                ? i === slide
                : triggered.current.has(i) || i === activeIdx;
              if (!shouldRender) return null;
              return (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={a.order}
                  src={`https://drive.google.com/thumbnail?id=${fid}&sz=w800`}
                  alt={`${product.name} — ${a.kr}`}
                  className={`proto-img ${isActive ? "active" : isNeighbor ? "neighbor" : ""}`}
                  data-angle={a.order}
                  style={{ zIndex: isActive ? 2 : 1 }}
                />
              );
            })}
            {/* EN=상태 라벨 / KR=행동 안내 (언어 시스템) */}
            <div className="proto-angle-label">
              {fallback
                ? `${PROTO_ANGLES[slide].label} (${slide + 1}/4)`
                : PROTO_ANGLES[activeIdx].label}
              <span className="proto-angle-kr">{PROTO_ANGLES[activeIdx].kr}</span>
            </div>
            {/* 스크롤 진행 트랙 */}
            <div className="proto-track" role="progressbar" aria-label="상품 둘러보기 진행" aria-valuenow={Math.round((fallback ? slide / 3 : progress) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="proto-track-fill" style={{ width: `${(fallback ? slide / 3 : progress) * 100}%` }} />
            </div>
          </div>

          {/* 폴백: prev/next */}
          {fallback && (
            <div className="proto-fallback-nav">
              <button onClick={() => setSlide((s) => Math.max(0, s - 1))} disabled={slide === 0} aria-label="이전 각도">‹</button>
              <span>{slide + 1} / 4</span>
              <button onClick={() => setSlide((s) => Math.min(3, s + 1))} disabled={slide === 3} aria-label="다음 각도">›</button>
            </div>
          )}
        </div>

        {/* 스크롤 여백 — 회전 궤도 (모바일에서 축소됨) */}
        {!fallback && <div className="proto-orbit" aria-hidden style={{ height: "260vh" }} />}
      </div>

      {/* ── PHASE 03~05: 정보 5단계 계층 (스크롤 시 단계 등장) ── */}
      <section className="proto-info">
        {/* PHASE 03: 상품 기본 */}
        <div className="proto-phase" data-phase>
          <p className="category">{product.category}</p>
          <h2>{product.name}</h2>
          <p className="detail-price">₩{product.price.toLocaleString("ko-KR")}</p>
        </div>

        {/* PHASE 04: 소재/핏/사이즈 — DETAILS */}
        <div className="proto-phase" data-phase>
          <h3 className="proto-phase-title">DETAILS <span>소재 · 핏 · 사이즈</span></h3>
          {detailsChildren}
        </div>

        {/* PHASE 05: 가격/CTA — 구매 안내 */}
        <div className="proto-phase proto-phase-cta" data-phase>
          <h3 className="proto-phase-title">SMART FIT <span>내 사이즈로 보기</span></h3>
          {fitChildren}
        </div>

        <div className="proto-hint">
          {fallback
            ? "저데이터 모드 — 화살표로 각도를 넘겨보세요"
            : "스크롤하면 상품을 둘러볼 수 있습니다"}
        </div>
      </section>
    </div>
  );
}
