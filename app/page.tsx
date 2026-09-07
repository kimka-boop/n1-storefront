"use client";

/**
 * N°1 — 메인 페이지 (Editorial Experience V2, 2026-09-08)
 * 스펙: N1_ASTRA_TO_ZCODE_HANDOFF.md · docs/N1_REDESIGN_MISSION.md
 *
 * V2:
 * - 에디토리얼 위계: LEAD(대형) → SUPPORTING(2) → QUIET(잔잔) — 동일 카드 벽 제거
 * - selectCollection(준비된 상품만·정확 성별 enum·컬렉션 내 검색)
 * - 미디어: 로컬 에디토리얼 샷 우선(public/editorial-media) → 폴백 체인
 * - 구매 상태: purchaseState(ready/choose/soldout/unconfirmed) — 재고 미확정은
 *   구매 가능처럼 보이지 않고 CS 문의로 안내 (미션 §10·§16)
 * - 색상 원시 값이 PDP → 모달 → 주문까지 전달 (quickBuyUrl)
 * - 고시 기본값 판성 데이터 제거 — 확인된 사실만 표기
 * - 모션: fog depth(접근 전 opacity .93) + 상태 전이 크로스페이드만
 */
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import FitProfileModal from "@/components/FitProfileModal";
import { useAuth } from "@/components/AuthProvider";
import { mediaFor } from "@/lib/media";
import {
  productColors,
  purchaseState,
  selectCollection,
} from "@/lib/experience";
import { PRODUCT_STORY } from "@/lib/productContent";
import {
  genderKo,
  categoryShort,
  noticeQualityText,
  noticeAsText,
  materialText,
  washingText,
} from "@/lib/display";

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

// ═══ 스마트 핏 사이즈 프리셋 엔진 (기존 로직 유지) ═══
const OUTER_KW = /(블루종|자켓|점퍼|가디건|코트|아우터|항공점퍼|패딩|야상)/i;
const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL"];
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
  if (baseIdx === -1) return "";
  let targetIdx = baseIdx;
  if (fit === "B" && isOuter) targetIdx = baseIdx + 1;
  else if (fit === "C") targetIdx = baseIdx + (isOuter ? 2 : 1);
  targetIdx = Math.max(0, Math.min(targetIdx, SIZE_ORDER.length - 1));
  return opts.find((o) => o.toUpperCase() === SIZE_ORDER[targetIdx]) ?? "";
}

function fitBadge(product: Product, profile: any): string {
  if (!profile) return "";
  const isOuter = OUTER_KW.test(product.name);
  if (profile.fit === "B" && isOuter) return `${profile.size} 기준 — 자켓 여유핏 +1추천`;
  if (profile.fit === "C") return `${profile.size} 기준 — 오버핏 +${isOuter ? 2 : 1}추천`;
  return `${profile.size} 기준 추천`;
}

function orRef(v?: string): string {
  const s = (v || "").trim();
  if (s && s !== "상세페이지 참조") return s;
  return "";
}

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
    rows.push({ label: p.label, vals: cols.map((c) => p.items.find(([k]) => k === c)?.[1] ?? "-") });
  });
  return { cols, rows };
}

function SizeChartTable({ chart }: { chart?: string }) {
  const parsed = parseSizeChart(chart || "");
  if (!parsed) {
    const v = orRef(chart);
    return v ? <div className="info-row"><span className="nowrap">실측 사이즈</span><b>{v}</b></div> : null;
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
          <button key={t.key} className={`policy-tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
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

type GenderKey = "all" | "male" | "female" | "genderless";
const GENDER_API: Record<Exclude<GenderKey, "all">, string> = {
  male: "MALE", female: "FEMALE", genderless: "GENDERLESS",
};

/** 에디토리얼 순서: 스토리 보유 → 색상 풍부함 (편집적 강약의 근거) */
function editorialWeight(p: Product): number {
  const hasStory = PRODUCT_STORY[p.id] ? 1 : 0;
  const colors = productColors(p.colorOptions).length;
  return hasStory * 100 + colors;
}

export default function Home() {
  const { profile: authProfile } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [slide, setSlide] = useState(0);
  const [slideIds, setSlideIds] = useState<string[]>([]);
  const [dDay, setDDay] = useState("");

  useEffect(() => {
    const calc = () => {
      const now = new Date();
      const day = now.getDay();
      let daysLeft = (7 - day) % 7;
      if (daysLeft === 0) daysLeft = 7;
      const next = new Date(now);
      next.setDate(now.getDate() + daysLeft);
      next.setHours(24, 0, 0, 0);
      const diff = Math.floor((next.getTime() - now.getTime()) / 86400000);
      setDDay(daysLeft === 0 ? "D-DAY" : `D-${diff}`);
    };
    calc();
    const t = setInterval(calc, 60000);
    return () => clearInterval(t);
  }, []);

  // ── 컬렉션 필터: 성별(정확 enum) + 컬렉션 내 검색 ──
  const [genderTab, setGenderTab] = useState<GenderKey>("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const saved = localStorage.getItem("n1_gender_tab");
    if (saved === "male" || saved === "female" || saved === "genderless") setGenderTab(saved);
  }, []);
  const changeTab = (t: GenderKey) => {
    setGenderTab(t);
    if (t === "all") localStorage.removeItem("n1_gender_tab");
    else localStorage.setItem("n1_gender_tab", t);
  };

  const readyAll = selectCollection(products, "all");
  const collection = selectCollection(
    products,
    genderTab === "all" ? "all" : GENDER_API[genderTab],
    query
  ).sort((a, b) => editorialWeight(b) - editorialWeight(a));
  const upcomingCount = products.length - readyAll.length;
  const genderCount = (g: Exclude<GenderKey, "all">) =>
    selectCollection(products, GENDER_API[g]).length;

  // 에디토리얼 역할 배분: 첫 편성 = LEAD, 다음 2 = SUPPORTING, 나머지 = QUIET
  const withRoles = collection.map((p, i) => ({
    product: p,
    role: (i === 0 ? "lead" : i <= 2 ? "supporting" : "quiet") as "lead" | "supporting" | "quiet",
  }));

  // ── 스마트 핏 ──
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
  useEffect(() => { if (authProfile) setFitProfile(authProfile); }, [authProfile]);

  // ── 빠른 주문 상태 (원시 색상/사이즈 값) ──
  const [selColor, setSelColor] = useState("");
  const [selSize, setSelSize] = useState("");
  const [optTouched, setOptTouched] = useState(false);
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

  const loadThumb = useCallback(async (p: Product) => {
    const fid = folderIdFromUrl(p.lookbookImage);
    if (!fid || thumbs[p.id]) return;
    try {
      const res = await fetch(`/api/lookbook-files?folder=${fid}`);
      const data = await res.json();
      if (data.ok && data.thumb) setThumbs((prev) => ({ ...prev, [p.id]: data.thumb }));
    } catch {}
  }, [thumbs]);

  useEffect(() => {
    fetchProducts();
    const t = setInterval(fetchProducts, 30_000);
    return () => clearInterval(t);
  }, [fetchProducts]);

  useEffect(() => {
    const pending = readyAll.filter((p) => !thumbs[p.id] && folderIdFromUrl(p.lookbookImage));
    pending.slice(0, 4).forEach((p) => loadThumb(p));
  }, [readyAll, thumbs, loadThumb]);

  // 카드 이미지: 에디토리얼 로컬 샷 → Drive 썸네일 → API 원본
  const imageOf = (p: Product): string | null =>
    mediaFor(p.id, p.lookbookImage)?.front || thumbs[p.id] || p.lookbookImage || null;

  // fog depth — 접근 전엔 살짝 옅게, 가까워지면 또렷하게 (Liquid Glass 문법)
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("revealed");
            observer.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll("[data-reveal]:not(.revealed)").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [collection.length]);

  const openDetail = useCallback(async (p: Product, preset?: { color?: string; size?: string }) => {
    const fid = folderIdFromUrl(p.lookbookImage);
    const colors = productColors(p.colorOptions);
    const apply = () => {
      setSelColor(preset?.color || (colors.length === 1 ? colors[0].value : ""));
      const presetSize = smartFitPreset(p, () => authProfile);
      setSelSize(preset?.size || presetSize || (p.sizeOptions?.length === 1 ? p.sizeOptions[0] : ""));
      setOptTouched(false);
      setOrderStage("options");
      setOrderResult(null);
      setOrderError("");
    };
    if (!fid) {
      setSelected(p);
      setSlide(0);
      setSlideIds([]);
      apply();
      return;
    }
    try {
      const res = await fetch(`/api/lookbook-files?folder=${fid}`);
      const data = await res.json();
      if (data.ok) setSlideIds(data.files.map((f: any) => f.id));
      setSelected(p);
      setSlide(0);
      apply();
    } catch {
      setSelected(p);
      setSlide(0);
      setSlideIds([]);
      apply();
    }
  }, [authProfile]);

  // PDP 구매 CTA → /?product=<id>&color=<raw>&size=<raw> 진입 시 모달 자동 오픈 + 원시값 선선택
  useEffect(() => {
    if (!products.length) return;
    const sp = new URLSearchParams(window.location.search);
    const pid = sp.get("product");
    if (!pid) return;
    const p = products.find((x) => x.id === pid);
    if (p) {
      openDetail(p, { color: sp.get("color") || undefined, size: sp.get("size") || undefined });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [products, openDetail]);

  const colorPairs = selected ? productColors(selected.colorOptions) : [];
  const buyState = selected ? purchaseState(selected, selColor, selSize) : "choose";
  const variantStock = (() => {
    if (!selected?.optionStock) return null;
    const os = selected.optionStock;
    const pairKey = selColor && selSize ? `${selColor}_${selSize}` : "";
    const pairKeyNs = pairKey.replace(/\s/g, "");
    if (pairKey && os[pairKey] !== undefined) return os[pairKey];
    if (pairKeyNs && os[pairKeyNs] !== undefined) return os[pairKeyNs];
    if (selSize && os[selSize] !== undefined) return os[selSize];
    if (selColor && os[selColor] !== undefined) return os[selColor];
    return null;
  })();
  const lowStock = variantStock !== null && variantStock > 0 && variantStock <= 5;

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
            color: selColor, // 원시 값 그대로 주문에 전달
            colorIndex: (selected.colorOptions || []).reduce<number>((acc, raw, i) => {
              const parts = raw.includes("·") ? raw.split("·") : raw.split(/\s+\/\s+/);
              const hit = parts.map(s => s.trim()).find(s => s === selColor);
              return hit !== undefined ? i : acc;
            }, -1),
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
        fetchProducts();
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
  const nextSlide = (e?: React.MouseEvent) => { e?.stopPropagation(); setSlide((s) => (s + 1) % Math.max(slideIds.length, 1)); };
  const prevSlide = (e?: React.MouseEvent) => { e?.stopPropagation(); setSlide((s) => (s - 1 + slideIds.length) % Math.max(slideIds.length, 1)); };
  const openCs = () => window.dispatchEvent(new Event("n1:open-cs"));

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
      <header className="hero">
        <div className="hero-brand">
          <h1>N°1</h1>
          <p className="hero-tag">20 Pieces · Selected by AI</p>
          <p className="hero-tagline">매주 일요일, 마음에 드는 몇 벌만 골라 보여드립니다</p>
        </div>
        <p className="hero-drop">
          이번 컬렉션 마감 {dDay || "—"} · 매주 일요일 자정에 새 컬렉션이 열립니다
        </p>
      </header>

      {error && <p className="error">⚠️ {error}</p>}

      {/* ── 컬렉션 내비 (sticky glass rail) ── */}
      <nav className="collection-nav" aria-label="컬렉션 필터">
        <span className="nav-brand">N°1</span>
        <button className={`gtab ${genderTab === "all" ? "active" : ""}`} onClick={() => changeTab("all")}>
          전체 <span className="gcount">({readyAll.length})</span>
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

      {/* ── 컬렉션: 에디토리얼 위계 ── */}
      <section className="collection">
        <div className="collection-head">
          <h2 className="collection-title">이번 컬렉션</h2>
          <p className="collection-sub">
            {readyAll.length}벌이 준비되어 있습니다
            {genderTab !== "all" && " · " + ({male:"남성",female:"여성",genderless:"젠더리스"}[genderTab])}
          </p>
          <div className="collection-search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="검색"
              aria-label="검색"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")}>초기화</button>
            ) : null}
          </div>
        </div>

        {withRoles.length ? (
          <div className="pieces">
            {withRoles.map(({ product: p, role }) => {
              const img = imageOf(p);
              const soldOut = p.stockStatus === "품절";
              return (
                <Link
                  key={p.id}
                  href={`/product/${p.id}`}
                  className={`piece piece-${role}`}
                  data-reveal
                >
                  <div className={`piece-media ${img ? "" : "empty"}`}>
                    {img ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={img} alt={`${p.name} 대표 이미지`} loading={role === "lead" ? "eager" : "lazy"} />
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
            {query
              ? "검색 결과가 없습니다 — 다른 이름으로 찾아보세요."
              : "이번 컬렉션에는 해당하는 상품이 없습니다 — 다음 컬렉션에서 만나요."}
          </p>
        )}

        {upcomingCount > 0 && (
          <p className="collection-upcoming">
            이번 주 컬렉션은 남성 20 · 여성 20 · 젠더리스 20, 총 60벌입니다 —
            지금은 확인을 마친 {readyAll.length}벌이 공개되어 있습니다.
          </p>
        )}
      </section>

      {/* ── 브랜드 스토리 ── */}
      <section className="story">
        <h2 className="story-title">괜찮은 것만 보여드립니다</h2>
        <p className="story-body">
          N°1은 모든 상품을 한자리에 쏟아놓지 않습니다.
          <br />
          눈이 편한 쇼핑을 위해서입니다.
        </p>
        <button className="story-cta" onClick={() => setShowFitModal(true)}>
          내 핏 프로필 만들기 →
        </button>
      </section>

      <footer>© N°1 — 매주 일요일, 새로운 컬렉션</footer>

      {showFitModal && (
        <FitProfileModal
          initial={fitProfile}
          onSave={saveFitProfile}
          onClose={() => setShowFitModal(false)}
        />
      )}

      {/* ── 빠른 주문 모달 (PDP 구매 진입점) ── */}
      {selected && (
        <div className="modal" onClick={closeDetail}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeDetail}>✕</button>
            <div className="slider">
              {slideIds[slide] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={slide} src={driveImg(slideIds[slide], 1000)}
                  alt={`${selected.name} — ${SHOT_LABELS[slide]}`} className="slide-img" />
              ) : imageOf(selected) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={imageOf(selected)!} alt={`${selected.name} — 대표컷`} className="slide-img" />
              ) : null}
              {slideIds.length > 1 ? (
                <>
                  <button className="nav prev" onClick={prevSlide} aria-label="이전">‹</button>
                  <button className="nav next" onClick={nextSlide} aria-label="다음">›</button>
                  <div className="slide-label">{SHOT_LABELS[slide]} ({slide + 1}/{slideIds.length})</div>
                </>
              ) : null}
            </div>
            <div className="detail-info">
              <p className="category">{[genderKo(selected.gender), categoryShort(selected.category)].filter(Boolean).join(" · ")}</p>
              <h2>{selected.name}</h2>
              <p className="detail-price">₩{selected.price.toLocaleString("ko-KR")}</p>
              <div className="buy-box">
                {/* ── 옵션 선택 (원시 값 기준) ── */}
                {colorPairs.length > 0 && (
                  <div className="option-row">
                    <label className="option-label" htmlFor="opt-color">색상</label>
                    <select id="opt-color" className="option-select"
                      value={selColor}
                      onChange={(e) => { setSelColor(e.target.value); setOptTouched(true); }}>
                      {colorPairs.length > 1 && <option value="">색상을 선택하세요</option>}
                      {colorPairs.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
                    </select>
                  </div>
                )}
                {selected.sizeOptions && selected.sizeOptions.length > 0 && (
                  <div className="option-row">
                    <label className="option-label" htmlFor="opt-size">사이즈</label>
                    {fitProfile && selSize && (
                      <span className="fit-badge">✨ {fitBadge(selected, fitProfile)}</span>
                    )}
                    <select id="opt-size" className="option-select"
                      value={selSize}
                      onChange={(e) => { setSelSize(e.target.value); setOptTouched(true); }}>
                      {selected.sizeOptions.length > 1 && <option value="">사이즈를 선택하세요</option>}
                      {selected.sizeOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
                    </select>
                  </div>
                )}

                {buyState === "ready" && lowStock && (
                  <p className="stock-alert">품절 임박! 남은 수량: {variantStock}개</p>
                )}

                {/* ── 구매 상태 — purchaseState 기준 정직한 분기 ── */}
                {orderStage === "options" && (
                  <>
                    <div className="stock-line">
                      <span className={`stock-badge ${selected.stockStatus === "판매중" ? "in" : "out"}`}>
                        {buyState === "unconfirmed" ? "재고 확인 중" : selected.stockStatus}
                      </span>
                    </div>
                    {buyState === "ready" ? (
                      <button className="buy-btn" onClick={() => setOrderStage("form")}>구매하기</button>
                    ) : buyState === "soldout" ? (
                      <button className="buy-btn" disabled>품절</button>
                    ) : buyState === "choose" ? (
                      <button className="buy-btn" disabled>{optTouched ? "옵션을 선택해 주세요" : "옵션 선택"}</button>
                    ) : (
                      <div className="unconfirmed-box">
                        <p className="unconfirmed-note">
                          옵션별 재고가 확인 중입니다 — 고객센터로 문의해 주시면 준비를 도와드립니다.
                        </p>
                        <button className="buy-btn buy-btn-quiet" onClick={openCs}>고객센터로 문의하기</button>
                      </div>
                    )}
                    {buyState === "ready" && <p className="buy-note">결제 완료 후 신속하게 출고됩니다</p>}
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
                      {selected.name} · {colorPairs.find(c => c.value === selColor)?.label ?? selColor}
                      {selSize && ` / ${selSize}`} · <b>₩{selected.price.toLocaleString("ko-KR")}</b>
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
                    {orderResult.notice && (<p className="split-notice">📦 {orderResult.notice}</p>)}
                  </div>
                )}
              </div>
              <div className="info-rows">
                <div className="info-row"><span>품번</span><b>{selected.id}</b></div>
                <div className="info-row"><span>배송</span><b>파스토 당일출고 (오후 1시 이전 결제 시)</b></div>
              </div>

              <div className="spec-block">
                <h3 className="spec-title">소재 &amp; 핏</h3>
                {orRef(materialText(selected.material)) ? (
                  <div className="info-row"><span>소재</span><b className="material-inline">{materialText(selected.material)}</b></div>
                ) : null}
                {selected.fit && (
                  <div className="fit-grid">
                    {([["두께감", selected.fit.thickness], ["신축성", selected.fit.stretch],
                       ["비침", selected.fit.sheer], ["안감", selected.fit.lining],
                       ["핏감", selected.fit.shape]] as const).map(([k, v]) => (
                      orRef(v) ? <div className="fit-cell" key={k}><span>{k}</span><b>{orRef(v)}</b></div> : null
                    ))}
                  </div>
                )}
                {washingText(selected.washingInfo) ? (
                  <div className="info-row"><span>세탁/취급</span><b>{washingText(selected.washingInfo)}</b></div>
                ) : null}
                <SizeChartTable chart={selected.sizeChart} />
                {orRef(selected.modelInfo) ? (
                  <div className="info-row"><span>모델착용</span><b>{selected.modelInfo}</b></div>
                ) : null}
              </div>

              {/* ── 상품정보제공고시 — 확인된 값만 (기본값 판성 금지) ── */}
              <div className="spec-block">
                <h3 className="spec-title">상품정보제공고시</h3>
                <div className="notice-table">
                  {orRef(materialText(selected.material)) ? (
                    <div className="info-row"><span>제품 소재</span><b className="material-inline">{materialText(selected.material)}</b></div>
                  ) : null}
                  {colorPairs.length ? (
                    <div className="info-row"><span>색상</span><b>{colorPairs.map(c => c.label).join(", ")}</b></div>
                  ) : null}
                  {selected.sizeOptions?.length ? (
                    <div className="info-row"><span>치수</span><b>{selected.sizeOptions.join(", ")}</b></div>
                  ) : null}
                  {orRef(selected.notice?.manufacturer) ? (
                    <div className="info-row"><span>제조자(수입자)</span><b>{selected.notice!.manufacturer}</b></div>
                  ) : null}
                  {orRef(selected.origin) ? (
                    <div className="info-row"><span>제조국(원산지)</span><b>{selected.origin}</b></div>
                  ) : null}
                  {orRef(selected.notice?.madeAt) ? (
                    <div className="info-row"><span>제조연월</span><b>{selected.notice!.madeAt}</b></div>
                  ) : null}
                  <div className="info-row">
                    <span>품질보증기준</span>
                    <b className="quality-tip">
                      수령 후 7일 이내 청약철회 가능
                      <span className="tooltip">
                        수령 후 7일 이내에 청약철회를 요청하실 수 있습니다. 이미 사용했거나 훼손된 상품은 청약철회 대상에서 제외됩니다. 전자상거래법상 소비자 청약철회 가능 범위를 준수합니다.
                      </span>
                    </b>
                  </div>
                  <div className="info-row"><span>A/S 책임자</span><b>{noticeAsText(selected.notice?.as) || "N°1 고객센터"}</b></div>
                </div>
              </div>

              <PolicyTabs />

              <div className="thumbs">
                {slideIds.map((fid, n) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img key={fid} src={driveImg(fid, 200)} alt={SHOT_LABELS[n]}
                    className={`thumb ${n === slide ? "active" : ""}`} onClick={() => setSlide(n)} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
