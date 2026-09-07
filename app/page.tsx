"use client";

/**
 * N°1 — 메인 페이지 (2026-09-07 Redesign)
 *
 * 감사 판정 (KEEP/REFINE/REBUILD/REMOVE):
 * - KEEP: 인증 네비, Smart Fit(모달·프리셋), 빠른 주문 모달+주문 플로우, 스크롤 리빌, 페이퍼 팔레트
 * - REFINE: 히어로(한국어 태그라인+마감 안내 통합), 성별 탭(스티키 글래스 내비+enum 버그 수정),
 *           상품 카드(편집형 2열 디스커버리 — PDP 라우트 연결)
 * - REBUILD: 상품 탐색 섹션(준비된 컬렉션만 공개 + 준비 중 카운트), 브랜드 스토리 섹션
 * - REMOVE: 60장 placeholder 벽(미생성 상품 카드), "[D-x]" 괄호 카운트다운
 *
 * Liquid Glass 원칙: 유리는 장식이 아니라 행동 — 스티키 내비가 스크롤에 반응해 나타나고,
 * 나머지 영역은 여백과 콘텐츠가 지배한다.
 */
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import FitProfileModal from "@/components/FitProfileModal";
import AuthNav from "@/components/AuthNav";
import { useAuth } from "@/components/AuthProvider";
import { genderKo, genderTabOf, categoryShort, colorLabel, noticeQualityText, noticeAsText, materialText } from "@/lib/display";

interface FitInfo { thickness: string; stretch: string; sheer: string; lining: string; shape: string; }
interface NoticeInfo { manufacturer: string; madeAt: string; colorSize: string; quality: string; as: string; }
interface Product {
  id: string;
  name: string;
  category: string;
  gender?: string;
  price: number;
  stockStatus: string;
  lookbookStatus: string;
  lookbookImage: string;
  material?: string;
  washingInfo?: string;
  sizeChart?: string;
  modelInfo?: string;
  fit?: FitInfo;
  origin?: string;
  notice?: NoticeInfo;
  colorOptions?: string[];
  sizeOptions?: string[];
  optionStock?: Record<string, number>;
}


// ═══ STEP 3: 스마트 핏 사이즈 프리셋 엔진 ═══
// B유형(세미오버): 아우터류 +1치수 / C유형(오버핏): +1~2 / A유형: 기준 그대로
const OUTER_KW = /(블루종|자켓|점퍼|가디건|코트|아우터|항공점퍼|패딩|야상)/i;
const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL"];

// 숫자(95/100/105/110) → 문자(S/M/L/XL) 환산
const NUM_TO_ALPHA: Record<string, string> = { "95": "S", "100": "L", "105": "XL", "110": "2XL" };

function smartFitPreset(product: Product, getProfile: () => any): string {
  const profile = getProfile();
  if (!profile || !product.sizeOptions?.length) return "";
  const { size: rawSize, fit } = profile;
  if (!rawSize) return "";

  const opts = product.sizeOptions;
  const isOuter = OUTER_KW.test(product.name);

  let baseAlpha = NUM_TO_ALPHA[rawSize] || rawSize;
  let baseIdx = SIZE_ORDER.indexOf(baseAlpha);
  if (baseIdx === -1) {
    return "";
  }

  let targetIdx = baseIdx;
  if (fit === "B" && isOuter) targetIdx = baseIdx + 1;          // 세미오버 + 아우터: +1
  else if (fit === "C") targetIdx = baseIdx + (isOuter ? 2 : 1); // 오버핏: +1~2

  targetIdx = Math.max(0, Math.min(targetIdx, SIZE_ORDER.length - 1));
  const targetAlpha = SIZE_ORDER[targetIdx];

  const hit = opts.find((o) => o.toUpperCase() === targetAlpha);
  if (hit) return hit;
  return "";
}

// 프리셋 사유 뱃지 텍스트
function fitBadge(product: Product, profile: any): string {
  if (!profile) return "";
  const isOuter = OUTER_KW.test(product.name);
  const label = { A: "스탠다드", B: "세미오버", C: "오버핏" }[profile.fit as "A"|"B"|"C"] || "";
  if (profile.fit === "B" && isOuter) return `${profile.size} 기준 — 자켓 여유핏 +1추천`;
  if (profile.fit === "C") return `${profile.size} 기준 — 오버핏 +${isOuter ? 2 : 1}추천`;
  return `${profile.size} 기준 추천`;
}

// 상품정보제공고시 — 빈값 기본 강제 매핑 ('상세페이지 참조' 문구 시스템적 금지)
const DEFAULTS: Record<string, string> = {
  제조연월: "2026년 1월 이후 상시제조",
  제품소재: "혼용률 상세 문의는 고객센터",
  색상: "단일 색상",
  치수: "단일 사이즈",
  제조자: "N°1 협력업체",
  원산지: "상담 문의",
};
function orRef(v?: string, key?: string): string {
  const s = (v || "").trim();
  if (s && s !== "상세페이지 참조") return s;
  return (key && DEFAULTS[key]) || "고객센터 문의";
}

/** 실측사이즈 문자열 → 가독용 표 */
function parseSizeChart(chart: string): { cols: string[]; rows: { label: string; vals: string[] }[] } | null {
  if (!chart || !chart.trim()) return null;
  const cleaned = chart.replace(/\s*\((?:한국사이즈|단위)[\s\S]*$/, "").trim();
  const groups = cleaned.split(/\s*\|\s*|\s+(?=[A-Z0-9가-힣]+\(|\d+[-~]\d+)/).filter(Boolean);
  const rows: { label: string; vals: string[] }[] = [];
  const colSet = new Set<string>();
  const parsed = groups.map((g) => {
    const m = g.match(/^([^:：-]+)[-:：]\s*([^:：]+)$/);
    if (!m) return null;
    const label = m[1].trim();
    const items: [string, string][] = [];
    for (const part of m[2].split(/[,，·\/|]/)) {
      const kv = part.match(/([가-힣A-Za-z()앞뒤~\s]+?)\s*([0-9]+(?:\.[0-9]+)?(?:-[0-9]+(?:\.[0-9]+)?)?)\s*(?:cm)?\s*$/);
      if (kv) items.push([kv[1].trim(), kv[2].trim()]);
    }
    return { label, items };
  }).filter(Boolean) as { label: string; items: [string, string][] }[];
  if (parsed.length < 1 || !parsed.some((p) => p.items.length >= 2)) return null;
  parsed.forEach((p) => p.items.forEach(([k]) => colSet.add(k)));
  const cols = Array.from(colSet);
  parsed.forEach((p) => {
    const vals = cols.map((c) => p.items.find(([k]) => k === c)?.[1] ?? "-");
    rows.push({ label: p.label, vals });
  });
  return { cols, rows };
}

function SizeChartTable({ chart }: { chart?: string }) {
  const parsed = parseSizeChart(chart || "");
  if (!parsed) {
    return (
      <div className="info-row"><span className="nowrap">실측 사이즈</span><b>{orRef(chart)}</b></div>
    );
  }
  return (
    <div className="size-table-wrap">
      <span className="size-table-title">실측사이즈 (단위 cm)</span>
      <table className="size-table">
        <thead>
          <tr><th>사이즈</th>{parsed.cols.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {parsed.rows.map((r) => (
            <tr key={r.label}><td>{r.label}</td>{r.vals.map((v, i) => <td key={i}>{v}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {chart.includes("오차") || chart.includes("차이") ? null : (
        <p className="size-note">· 측정 위치와 방법에 따라 1~3cm의 오차가 있을 수 있습니다</p>
      )}
    </div>
  );
}

/** 배송/교환/반품 탭 안내 */
function PolicyTabs() {
  const [tab, setTab] = useState<"shipping" | "exchange" | "return">("shipping");
  const TABS = [
    { key: "shipping", label: "배송" },
    { key: "exchange", label: "교환" },
    { key: "return", label: "반품" },
  ] as const;
  return (
    <div className="spec-block">
      <h3 className="spec-title">배송 · 교환 · 반품 안내</h3>
      <div className="policy-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`policy-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="policy-content">
        {tab === "shipping" && (
          <ul className="policy-list">
            <li>· 파스토 당일출고 — <b>오후 1시 이전 결제 시 당일 출고</b> (전국 택배, 평균 1~3일 소요)</li>
            <li>· 배송비: 기본 3,000원 — 5만원 이상 구매 시 무료배송</li>
            <li className="policy-highlight">· 제주 및 도서·산간 지역은 3,000원의 추가 배송비가 발생합니다.</li>
          </ul>
        )}
        {tab === "exchange" && (
          <ul className="policy-list">
            <li>· 상품 수령 후 7일 이내 고객센터로 신청 가능</li>
            <li>· 사이즈/색상 교환 1회 무료 (재고 있을 시)</li>
            <li>· 왕복 배송비 6,000원 고객 부담 (단순 변심 기준)</li>
            <li>· 택 제거·착용 흔적·세탁·향수 냄새가 있으면 교환이 불가합니다</li>
          </ul>
        )}
        {tab === "return" && (
          <ul className="policy-list">
            <li>· 상품 수령 후 7일 이내 신청 가능</li>
            <li>· 단순 변심 반품 편도 배송비 3,000원 고객 부담</li>
            <li>· 교환/반품 불가: 택 제거·착용 흔적·세탁/향수 냄새 등 상품 가치 훼손 시, 모니터 색상 차이, 시간 경과 개봉 상품</li>
            <li>· 표기·광고 내용과 상이한 상품은 전자상거래법에 따라 청약철회 가능합니다</li>
          </ul>
        )}
      </div>
    </div>
  );
}

const SHOT_LABELS = ["전체샷", "45도", "90도", "후면", "제품만"];

function folderIdFromUrl(url: string): string | null {
  const m = url.match(/drive\.google\.com\/drive\/folders\/([\w-]+)/);
  return m ? m[1] : null;
}

function driveImg(fileId: string, w = 1000) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${w}&v=${Math.floor(Date.now() / 600000)}`;
}

export default function Home() {
  const { profile: authProfile } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({}); // pid → 대표 이미지 URL
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [slide, setSlide] = useState(0);
  const [slideIds, setSlideIds] = useState<string[]>([]);
  // ── 주간 드롭 카운트다운 (매주 일요일 자정 마감) ──
  const [dDay, setDDay] = useState("");
  useEffect(() => {
    const calc = () => {
      const now = new Date();
      const next = new Date(now);
      const day = now.getDay(); // 0=일
      let daysLeft = (7 - day) % 7;
      if (daysLeft === 0) daysLeft = 7; // 일요일 당일은 마감일로 D-Day
      next.setDate(now.getDate() + daysLeft);
      next.setHours(24, 0, 0, 0);
      const diff = Math.floor((next.getTime() - now.getTime()) / 86400000);
      setDDay(daysLeft === 0 ? "D-DAY" : `D-${diff}`);
    };
    calc();
    const t = setInterval(calc, 60000);
    return () => clearInterval(t);
  }, []);

  // ── STEP 1: 성별 퀵 필터 (localStorage 기억) ──
  const [genderTab, setGenderTab] = useState<"all" | "male" | "female" | "genderless">("all");
  useEffect(() => {
    const saved = localStorage.getItem("n1_gender_tab");
    if (saved === "male" || saved === "female" || saved === "genderless") setGenderTab(saved);
  }, []);
  const changeTab = (t: "all" | "male" | "female" | "genderless") => {
    setGenderTab(t);
    if (t === "all") localStorage.removeItem("n1_gender_tab");
    else localStorage.setItem("n1_gender_tab", t);
  };

  // ── 컬렉션: 이미지가 준비된 상품만 공개 (미생성은 카드 벽 대신 카운트로) ──
  const readyProducts = products.filter(
    (p) => p.lookbookStatus === "생성완료" && (p.lookbookImage || "").trim() !== ""
  );
  const upcomingCount = products.length - readyProducts.length;

  const filteredProducts = genderTab === "all"
    ? readyProducts
    : readyProducts.filter((p) => genderTabOf(p.gender) === genderTab);
  const genderCount = (g: "male" | "female" | "genderless") =>
    readyProducts.filter((p) => genderTabOf(p.gender) === g).length;

  // ── STEP 2/3: 스마트 핏 프로필 (localStorage) ──
  const [fitProfile, setFitProfile] = useState<{gender: string; size: string; fit: string} | null>(null);
  const [showFitModal, setShowFitModal] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("n1_fit_profile");
      if (raw) setFitProfile(JSON.parse(raw));
    } catch {}
  }, []);
  const saveFitProfile = (p: {gender: string; size: string; fit: string}) => {
    setFitProfile(p);
    localStorage.setItem("n1_fit_profile", JSON.stringify(p));
    setShowFitModal(false);
  };
  // auth 프로필 동기화 (로그인 시 프로필 표시)
  useEffect(() => { if (authProfile) setFitProfile(authProfile); }, [authProfile]);

  // ── 옵션 선택 상태 (D2C 구매 UI) ──
  const [selColor, setSelColor] = useState("");
  const [selSize, setSelSize] = useState("");
  const [optTouched, setOptTouched] = useState(false);
  // ── 주문 폼 상태 (모듈 2: 계좌이체) ──
  const [orderStage, setOrderStage] = useState<"options" | "form" | "done">("options");
  const [orderForm, setOrderForm] = useState({ name: "", phone: "", address: "", depositor: "" });
  const [orderResult, setOrderResult] = useState<{ order_id: string; total: number; type: string; notice?: string; bank: string; account: string; holder: string } | null>(null);
  const [orderError, setOrderError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) setProducts(data.products);
      else setError(data.error || "시트 조회 실패");
    } catch {
      setError("서버 연결 실패");
    }
  }, []);

  // 대표이미지 로딩 (Drive 폴더형만 — FASHN 직접 URL은 lookbookImage를 그대로 사용)
  const loadThumb = useCallback(async (p: Product) => {
    const fid = folderIdFromUrl(p.lookbookImage);
    if (!fid || thumbs[p.id]) return;
    try {
      const res = await fetch(`/api/lookbook-files?folder=${fid}`);
      const data = await res.json();
      if (data.ok && data.thumb) {
        setThumbs((prev) => ({ ...prev, [p.id]: data.thumb }));
      }
    } catch {}
  }, [thumbs]);

  useEffect(() => {
    fetchProducts();
    const t = setInterval(fetchProducts, 30_000);
    return () => clearInterval(t);
  }, [fetchProducts]);

  // Drive 폴더형 제품의 대표이미지 순차 로딩
  useEffect(() => {
    const pending = readyProducts.filter((p) => !thumbs[p.id] && folderIdFromUrl(p.lookbookImage));
    pending.slice(0, 4).forEach((p) => loadThumb(p));
  }, [readyProducts, thumbs, loadThumb]);

  // 카드 이미지 소스 — Drive 썸네일 우선, 없으면 FASHN 원본 URL 직접
  const imageOf = (p: Product): string | null => thumbs[p.id] || p.lookbookImage || null;

  // 스크롤 리빌
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const el = e.target as HTMLElement;
            el.classList.add("revealed");
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll("[data-reveal]:not(.revealed)").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [filteredProducts.length]);

  const openDetail = useCallback(async (p: Product) => {
    const fid = folderIdFromUrl(p.lookbookImage);
    if (!fid) {
      // 신형 룩북(fashn.ai 직접 URL): Drive 폴더가 없어 대표 이미지 단일 슬라이드로 개방
      setSelected(p);
      setSlide(0);
      setSlideIds([]);
      setSelColor(p.colorOptions?.length === 1 ? colorLabel(p.colorOptions[0]) : "");
      // STEP 3: 스마트 핏 프리셋 — 프로필이 있으면 사이즈 자동 선택
      const presetSize = smartFitPreset(p, () => authProfile);
      setSelSize(presetSize || (p.sizeOptions?.length === 1 ? p.sizeOptions[0] : ""));
      setOptTouched(false);
      setOrderStage("options");
      setOrderResult(null);
      setOrderError("");
      return;
    }
    try {
      const res = await fetch(`/api/lookbook-files?folder=${fid}`);
      const data = await res.json();
      if (data.ok) {
        setSlideIds(data.files.map((f: any) => f.id));
        setSelected(p);
        setSlide(0);
        setSelColor(p.colorOptions?.length === 1 ? colorLabel(p.colorOptions[0]) : "");
        const presetSize = smartFitPreset(p, () => authProfile);
        setSelSize(presetSize || (p.sizeOptions?.length === 1 ? p.sizeOptions[0] : ""));
        setOptTouched(false);
        setOrderStage("options");
        setOrderResult(null);
        setOrderError("");
      }
    } catch {}
  }, [authProfile]);

  // PDP 구매 CTA → /?product=<id> 진입 시 상세 모달 자동 오픈
  useEffect(() => {
    if (!products.length) return;
    const pid = new URLSearchParams(window.location.search).get("product");
    if (!pid) return;
    const p = products.find((x) => x.id === pid);
    if (p) {
      openDetail(p);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [products, openDetail]);

  // 선택된 옵션의 재고 수 — 신형 키(색상_사이즈) 우선, 구형 키(사이즈) 폴백
  const colorOptionsLabeled = (selected?.colorOptions || []).map(colorLabel);
  const selectedStock = (() => {
    if (!selected?.optionStock) return null;
    const os = selected.optionStock;
    const pairKey = selColor && selSize ? `${selColor}_${selSize}` : "";
    const pairKeyNs = pairKey.replace(/\s/g, "");
    if (pairKey && os[pairKey] !== undefined) return os[pairKey];
    if (pairKeyNs && os[pairKeyNs] !== undefined) return os[pairKeyNs];
    if (selSize && os[selSize] !== undefined) return os[selSize];
    if (selColor && os[selColor] !== undefined) return os[selColor];
    const vals = Object.values(os);
    return vals.length ? Math.min(...vals) : null;
  })();
  const lowStock = selectedStock !== null && selectedStock > 0 && selectedStock <= 5;
  const optionsReady = (!colorOptionsLabeled.length || selColor) && (!selected?.sizeOptions?.length || selSize);

  // ── 주문 제출 (모듈 2: /api/orders) ──
  const submitOrder = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    setOrderError("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: {
            name: orderForm.name,
            phone: orderForm.phone,
            address: orderForm.address,
            depositor: orderForm.depositor || orderForm.name,
          },
          items: [{
            sku: selected.id,
            color: selColor,
            colorIndex: (selected.colorOptions || []).findIndex((c) => colorLabel(c) === selColor),
            size: selSize,
            qty: 1,
          }],
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setOrderResult({
          order_id: data.order_id,
          total: data.total_amount,
          type: data.shipping.type,
          notice: data.shipping.notice,
          bank: data.deposit_info.bank,
          account: data.deposit_info.account,
          holder: data.deposit_info.holder,
        });
        setOrderStage("done");
        fetchProducts(); // 재고 반영 새로고침
      } else {
        setOrderError(data.error || "주문 처리 중 오류가 발생했습니다");
      }
    } catch {
      setOrderError("서버 연결 실패 — 잠시 후 다시 시도해주세요");
    } finally {
      setSubmitting(false);
    }
  }, [selected, orderForm, selColor, selSize, fetchProducts]);

  const closeDetail = () => setSelected(null);
  const nextSlide = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSlide((s) => (s + 1) % Math.max(slideIds.length, 1));
  };
  const prevSlide = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSlide((s) => (s - 1 + slideIds.length) % Math.max(slideIds.length, 1));
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
      if (e.key === "ArrowRight") setSlide((s) => (s + 1) % slideIds.length);
      if (e.key === "ArrowLeft") setSlide((s) => (s - 1 + slideIds.length) % slideIds.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, slideIds.length]);

  return (
    <main>
      <AuthNav />

      {/* ── 히어로: 브랜드 + 이번 컬렉션 마감 (한 문장으로) ── */}
      <header className="hero">
        <div className="hero-brand" data-reveal>
          <h1>N°1</h1>
          <p className="hero-tag">20 Pieces · Selected by AI</p>
          <p className="hero-tagline">매주 일요일, 마음에 드는 몇 벌만 골라 보여드립니다</p>
        </div>
        <p className="hero-drop" data-reveal>
          이번 컬렉션 마감 {dDay || "—"} · 매주 일요일 자정에 새 컬렉션이 열립니다
        </p>
      </header>

      {error && <p className="error">⚠️ {error}</p>}

      {/* ── 컬렉션 내비 (sticky glass — 스크롤 시 상단에 얇게 떠오른다) ── */}
      <nav className="collection-nav" aria-label="컬렉션 필터">
        <span className="nav-brand">N°1</span>
        <button className={`gtab ${genderTab === "all" ? "active" : ""}`} onClick={() => changeTab("all")}>
          전체 <span className="gcount">({readyProducts.length})</span>
        </button>
        <button className={`gtab ${genderTab === "male" ? "active" : ""}`} onClick={() => changeTab("male")}>
          남성 <span className="gcount">({genderCount("male")})</span>
        </button>
        <button className={`gtab ${genderTab === "female" ? "active" : ""}`} onClick={() => changeTab("female")}>
          여성 <span className="gcount">({genderCount("female")})</span>
        </button>
        <button className={`gtab ${genderTab === "genderless" ? "active" : ""}`} onClick={() => changeTab("genderless")}>
          젠더리스 <span className="gcount">({genderCount("genderless")})</span>
        </button>
        <button className="gtab gtab-fit" onClick={() => setShowFitModal(true)}>
          {fitProfile
            ? `Smart Fit — ${fitProfile.size}${fitProfile.fit ? " · " + ({A:"Standard",B:"Semi-Over",C:"Overfit"}[fitProfile.fit as "A"|"B"|"C"] ?? "") : ""}`
            : "Smart Fit"}
        </button>
      </nav>

      {/* ── 컬렉션: 준비된 상품만, 하나씩 발견하는 편집형 그리드 ── */}
      <section className="collection">
        <div className="collection-head" data-reveal>
          <h2 className="collection-title">이번 컬렉션</h2>
          <p className="collection-sub">
            {readyProducts.length}벌이 준비되어 있습니다
            {genderTab !== "all" && " · " + ({male:"남성",female:"여성",genderless:"젠더리스"}[genderTab])}
          </p>
        </div>

        {filteredProducts.length ? (
          <div className="pieces">
            {filteredProducts.map((p, idx) => {
              const img = imageOf(p);
              const soldOut = p.stockStatus === "품절";
              return (
                <Link
                  key={p.id}
                  href={`/product/${p.id}`}
                  className="piece"
                  data-reveal
                  style={{ transitionDelay: `${(idx % 2) * 80}ms` }}
                >
                  <div className={`piece-media ${img ? "" : "empty"}`}>
                    {img ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={img} alt={`${p.name} 대표 이미지`} loading={idx < 2 ? "eager" : "lazy"} />
                    ) : (
                      <span>이미지 준비 중</span>
                    )}
                    {soldOut && <span className="piece-soldout">품절</span>}
                  </div>
                  <div className="piece-caption">
                    <p className="piece-eyebrow">
                      {[genderKo(p.gender), categoryShort(p.category)].filter(Boolean).join(" · ")}
                    </p>
                    <h3 className="piece-name">{p.name}</h3>
                    <p className="piece-price">₩{p.price.toLocaleString("ko-KR")}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="collection-empty">
            이번 컬렉션에는 해당하는 상품이 없습니다 — 다음 컬렉션에서 만나요.
          </p>
        )}

        {upcomingCount > 0 && (
          <p className="collection-upcoming">
            다음 컬렉션의 {upcomingCount}벌이 준비 중입니다 — 매주 일요일에 공개됩니다.
          </p>
        )}
      </section>

      {/* ── 브랜드 스토리 (조용한 한 문단 + Smart Fit 유도) ── */}
      <section className="story" data-reveal>
        <h2 className="story-title">괜찮은 것만 보여드립니다</h2>
        <p className="story-body">
          N°1은 모든 상품을 한자리에 쏟아놓지 않습니다. 소재와 치수를 하나씩 확인하고,
          남을 만한 것만 컬렉션에 올립니다. 사진은 직접 만든 착용컷으로, 정보는 확인한
          것만 적습니다. 스크롤이 길어도 보이는 것은 몇 벌뿐입니다 — 눈이 편한 쇼핑을 위해서입니다.
        </p>
        <button className="story-cta" onClick={() => setShowFitModal(true)}>
          내 핏 프로필 만들기 →
        </button>
      </section>

      <footer>© N°1 — 매주 일요일, 새로운 컬렉션</footer>

      {/* ── STEP 2: 스마트 핏 온보딩 모달 (15초 3문 3답) ── */}
      {showFitModal && (
        <FitProfileModal
          initial={fitProfile}
          onSave={saveFitProfile}
          onClose={() => setShowFitModal(false)}
        />
      )}

      {/* ── 빠른 주문 모달 (PDP 구매하기 / ?product= 진입) ── */}
      {selected && (
        <div className="modal" onClick={closeDetail}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeDetail}>✕</button>
            <div className="slider">
              {slideIds[slide] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={slide}
                  src={driveImg(slideIds[slide], 1000)}
                  alt={`${selected.name} — ${SHOT_LABELS[slide]}`}
                  className="slide-img"
                />
              ) : selected.lookbookImage ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={selected.lookbookImage}
                  alt={`${selected.name} — 대표컷`}
                  className="slide-img"
                />
              ) : null}
              <button className="nav prev" onClick={prevSlide} aria-label="이전">‹</button>
              <button className="nav next" onClick={nextSlide} aria-label="다음">›</button>
              <div className="slide-label">
                {slideIds.length
                  ? `${SHOT_LABELS[slide]} (${slide + 1}/${slideIds.length})`
                  : "대표컷"}
              </div>
            </div>
            <div className="detail-info">
              <p className="category">{[genderKo(selected.gender), categoryShort(selected.category)].filter(Boolean).join(" · ")}</p>
              <h2>{selected.name}</h2>
              <p className="detail-price">₩{selected.price.toLocaleString("ko-KR")}</p>
              <div className="buy-box">
                <p className="safe-fit-note">
                  💡 체형 맞춤 추천: AI 스마트 핏과 실측 단면(cm)을 확인해 주세요.<br />
                  (수령 후 7일 이내 규정 교환·반품 가능)
                </p>
                {/* ── 옵션 선택 (색상/사이즈) ── */}
                {colorOptionsLabeled.length > 0 && (
                  <div className="option-row">
                    <label className="option-label">색상</label>
                    <select
                      className="option-select"
                      value={selColor}
                      onChange={(e) => { setSelColor(e.target.value); setOptTouched(true); }}
                    >
                      {colorOptionsLabeled.length > 1 && <option value="">색상을 선택하세요</option>}
                      {colorOptionsLabeled.map((c) => (
                        <option key={c} value={c} disabled={(() => {
                          // 색상 단위 품절: 해당 색상의 모든 조합이 0일 때
                          const raw = (selected.colorOptions || []).find((x) => colorLabel(x) === c) ?? c;
                          const entries = Object.entries(selected.optionStock || {});
                          const rel = entries.filter(([k]) => selSize ? k === `${raw}_${selSize}` || k.replace(/\s/g,"") === `${raw}_${selSize}` : k === raw || k.startsWith(`${raw}_`));
                          if (!rel.length) return false;
                          return rel.every(([, v]) => v === 0);
                        })()}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {selected.sizeOptions && selected.sizeOptions.length > 0 && (
                  <div className="option-row">
                    <label className="option-label">사이즈</label>
                    {fitProfile && selSize && (
                      <span className="fit-badge">✨ {fitBadge(selected, fitProfile)}</span>
                    )}
                    <select
                      className="option-select"
                      value={selSize}
                      onChange={(e) => { setSelSize(e.target.value); setOptTouched(true); }}
                    >
                      {selected.sizeOptions.length > 1 && <option value="">사이즈를 선택하세요</option>}
                      {selected.sizeOptions.map((s) => {
                        const st = (() => {
                          const os = selected.optionStock || {};
                          const rawColor = (selected.colorOptions || []).find((x) => colorLabel(x) === selColor) ?? selColor;
                          const pairKey = rawColor ? `${rawColor}_${s}` : "";
                          const pairKeyNs = pairKey.replace(/\s/g, "");
                          if (pairKey && os[pairKey] !== undefined) return os[pairKey];
                          if (pairKeyNs && os[pairKeyNs] !== undefined) return os[pairKeyNs];
                          if (os[s] !== undefined) return os[s];
                          return undefined;
                        })();
                        return (
                          <option key={s} value={s} disabled={st === 0}>
                            {s}{st === 0 ? " (품절)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}

                {/* ── 품절 임박 (재고 5개 이하, 마스터 DB 실시간 연동) ── */}
                {optionsReady && lowStock && (
                  <p className="stock-alert">품절 임박! 남은 수량: {selectedStock}개</p>
                )}

                {/* ── 주문 플로우: 옵션 → 주문폼 → 입금안내 ── */}
                {orderStage === "options" && (
                  <>
                    <div className="stock-line">
                      <span className={`stock-badge ${selected.stockStatus === "판매중" ? "in" : "out"}`}>
                        {selected.stockStatus}
                      </span>
                    </div>
                    <button
                      className="buy-btn"
                      disabled={selected.stockStatus !== "판매중" || !optionsReady || selectedStock === 0}
                      onClick={() => setOrderStage("form")}
                    >
                      {selected.stockStatus !== "판매중" ? "품절"
                        : !optionsReady ? (optTouched ? "옵션을 선택해 주세요" : "옵션 선택")
                        : selectedStock === 0 ? "품절"
                        : "구매하기"}
                    </button>
                    <p className="buy-note">결제 완료 후 신속하게 출고됩니다</p>
                  </>
                )}

                {orderStage === "form" && (
                  <div className="order-form">
                    <h4 className="order-form-title">주문 정보 입력</h4>
                    <input className="order-input" placeholder="주문자명" value={orderForm.name}
                      onChange={(e) => setOrderForm({ ...orderForm, name: e.target.value })} />
                    <input className="order-input" placeholder="연락처 (010-0000-0000)" type="tel" value={orderForm.phone}
                      onChange={(e) => setOrderForm({ ...orderForm, phone: e.target.value })} />
                    <input className="order-input" placeholder="배송지 주소" value={orderForm.address}
                      onChange={(e) => setOrderForm({ ...orderForm, address: e.target.value })} />
                    <input className="order-input" placeholder="입금자명 (주문자명과 같으면 비워도 됨)" value={orderForm.depositor}
                      onChange={(e) => setOrderForm({ ...orderForm, depositor: e.target.value })} />
                    <p className="order-summary">
                      {selected.name} · {selColor}{selSize && ` / ${selSize}`} · <b>₩{selected.price.toLocaleString("ko-KR")}</b>
                    </p>
                    {orderError && <p className="stock-alert">{orderError}</p>}
                    <div className="order-form-btns">
                      <button className="order-btn-back" onClick={() => setOrderStage("options")}>← 이전</button>
                      <button className="buy-btn order-btn-submit"
                        disabled={submitting || !orderForm.name || !orderForm.phone || !orderForm.address}
                        onClick={submitOrder}>
                        {submitting ? "처리 중..." : "주문하기 (계좌이체)"}
                      </button>
                    </div>
                  </div>
                )}

                {orderStage === "done" && orderResult && (
                  <div className="order-done">
                    <p className="order-done-title">✓ 주문이 접수되었습니다</p>
                    <div className="deposit-box">
                      <div className="info-row"><span>주문번호</span><b>{orderResult.order_id}</b></div>
                      <div className="info-row"><span>입금 금액</span><b>₩{orderResult.total.toLocaleString("ko-KR")}</b></div>
                      <div className="info-row"><span>입금 계좌</span><b>{orderResult.bank} {orderResult.account}</b></div>
                      <div className="info-row"><span>예금주</span><b>{orderResult.holder}</b></div>
                      <div className="info-row"><span>입금 기한</span><b>24시간 이내</b></div>
                    </div>
                    <p className="buy-note">입금 확인 후 출고됩니다. 주문번호를 보관해주세요.</p>
                    {orderResult.notice && (
                      <p className="split-notice">📦 {orderResult.notice}</p>
                    )}
                  </div>
                )}
              </div>
              <div className="info-rows">
                <div className="info-row"><span>품번</span><b>{selected.id}</b></div>
                <div className="info-row"><span>배송</span><b>파스토 당일출고 (오후 1시 이전 결제 시)</b></div>
              </div>

              {/* ── 소재 / 핏 / 사이즈 ── */}
              <div className="spec-block">
                <h3 className="spec-title">소재 &amp; 핏</h3>
                <div className="info-row"><span>소재</span><b className="material-inline">{orRef(materialText(selected.material))}</b></div>
                {selected.fit && (
                  <div className="fit-grid">
                    {([["두께감", selected.fit.thickness], ["신축성", selected.fit.stretch],
                       ["비침", selected.fit.sheer], ["안감", selected.fit.lining],
                       ["핏감", selected.fit.shape]] as const).map(([k, v]) => (
                      <div className="fit-cell" key={k}><span>{k}</span><b>{orRef(v)}</b></div>
                    ))}
                  </div>
                )}
                <div className="info-row"><span>세탁/취급</span><b>{orRef(selected.washingInfo)}</b></div>
                <SizeChartTable chart={selected.sizeChart} />
                {selected.modelInfo && selected.modelInfo.trim() && (
                  <div className="info-row"><span>모델착용</span><b>{selected.modelInfo}</b></div>
                )}
              </div>

              {/* ── 상품정보제공고시 (전자상거래법 필수) ── */}
              <div className="spec-block">
                <h3 className="spec-title">상품정보제공고시</h3>
                <div className="notice-table">
                  <div className="info-row"><span>제품 소재</span><b className="material-inline">{orRef(materialText(selected.material))}</b></div>
                  <div className="info-row"><span>색상</span><b>{colorOptionsLabeled.length ? colorOptionsLabeled.join(", ") : orRef(undefined, "색상")}</b></div>
                  <div className="info-row"><span>치수</span><b>{selected.sizeOptions?.length ? selected.sizeOptions.join(", ") : orRef(undefined)}</b></div>
                  <div className="info-row"><span>제조자(수입자)</span><b>N°1 협력업체</b></div>
                  <div className="info-row"><span>제조국(원산지)</span><b>{orRef(selected.origin, "원산지")}</b></div>
                  <div className="info-row"><span>제조연월</span><b>{orRef(selected.notice?.madeAt, "제조연월")}</b></div>
                  <div className="info-row">
                    <span>품질보증기준</span>
                    <b className="quality-tip">
                      수령 후 7일 이내 청약철회 가능(사용·훼손 제외)
                      <span className="tooltip">
                        수령 후 7일 이내 청약철회 요청이 가능합니다(사용·훼손된 경우 제외). 전자상거래법상 소비자 청약철회 가능 범위를 준수합니다.
                      </span>
                    </b>
                  </div>
                  <div className="info-row"><span>A/S 책임자</span><b>{noticeAsText(selected.notice?.as) || "N°1 고객센터"}</b></div>
                </div>
              </div>

              {/* ── 배송 / 교환 / 반품 (탭형) ── */}
              <PolicyTabs />

              <div className="thumbs">
                {slideIds.map((fid, n) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={fid}
                    src={driveImg(fid, 200)}
                    alt={SHOT_LABELS[n]}
                    className={`thumb ${n === slide ? "active" : ""}`}
                    onClick={() => setSlide(n)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
