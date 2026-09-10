"use client";

/**
 * N°1 — 메인 페이지 (Editorial Experience V2, 2026-09-08)
 * 스펙: N1_ASTRA_TO_ZCODE_HANDOFF.md · docs/N1_REDESIGN_MISSION.md
 *
 * V2:
 * - 에디토리얼 위계: LEAD(대형) → SUPPORTING(2) → QUIET(잔잔) — 동일 카드 벽 제거
 * - selectCollection(전체 상품·정확 성별 enum·컬렉션 내 검색 — 룩북 미생성은 플레이스홀더)
 * - 미디어: 로컬 에디토리얼 샷 우선(public/editorial-media) → 폴백 체인
 * - 구매 상태: purchaseState(ready/choose/soldout/unconfirmed) — 재고 미확정은
 *   구매 가능처럼 보이지 않고 CS 문의로 안내 (미션 §10·§16)
 * - 색상 원시 값이 PDP → 모달 → 주문까지 전달 (quickBuyUrl)
 * - 고시 기본값 판성 데이터 제거 — 확인된 사실만 표기
 * - 모션: fog depth(접근 전 opacity .93) + 상태 전이 크로스페이드만
 */
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { SearchIcon } from "@/components/Icons";
import { mediaFor } from "@/lib/media";
import { FIT_LABEL, fitPresetSize, preferenceShift, categoryOf, interpretFit, type FitProductInput } from "@/lib/fit";
import { pairFitLine } from "@/lib/fitDisplay";
import {
  productColors,
  purchaseState,
  selectCollection,
  buildCollectionPairs,
  type CollectionPair,
} from "@/lib/experience";
import { PRODUCT_STORY } from "@/lib/productContent";
import {
  WEEKLY_TAGLINE,
  WEEKLY_CLOSE_LABEL,
  WEEKLY_OPEN_LABEL,
  FOOTER_LABEL,
  PDP_SHIPPING_COPY,
} from "@/lib/businessRules";
import { PostcodeSearch, emptyAddress, type AddressValue } from "@/components/PostcodeSearch";
import {
  genderKo,
  categoryShort,
  noticeQualityText,
  noticeAsText,
  materialText,
  washingText,
  originDisplay,
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

// ═══ 스마트 핏 — 엔진은 lib/fit.ts (취향 기준 안내, 근거 없는 정밀 추천 금지) ═══

function orRef(v?: string): string {
  const s = (v || "").trim();
  if (s && s !== "상세페이지 참조") return s;
  return "";
}

/** interpretFit 입력 조립 — 페어 카드 상품별 해석에 쓴다 (TASKS 27·28) */
function fitInputOf(p: Product): FitProductInput {
  return {
    name: p.name,
    category: p.category,
    fitShape: p.fit?.shape,
    stretch: p.fit?.stretch,
    sizeChart: p.sizeChart,
    sizeOptions: p.sizeOptions,
    optionStock: p.optionStock,
    stockStatus: p.stockStatus,
    modelInfo: p.modelInfo,
  };
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
            {/* §18 — 검증되지 않은 SLA(당일출고)·할증액 절대 표기 금지. lib/businessRules 정직 카피 */}
            <li>· {PDP_SHIPPING_COPY[0]}</li>
            <li>· 배송비: 기본 3,000원 — 5만원 이상 구매 시 무료배송</li>
            <li className="policy-highlight">· {PDP_SHIPPING_COPY[2]}</li>
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

// N°1은 카테고리가 아니다(SESSION F) — 브랜드 내비는 홈 hero·SiteHeader 브랜드 블록 전용.
type GenderKey = "all" | "male" | "female" | "genderless";
const GENDER_API: Record<"male" | "female" | "genderless", "MALE" | "FEMALE" | "GENDERLESS"> = {
  male: "MALE", female: "FEMALE", genderless: "GENDERLESS",
};

/** 에디토리얼 순서: 스토리 보유 → 색상 풍부함 (편집적 강약의 근거) */
function editorialWeight(p: Product): number {
  const hasStory = PRODUCT_STORY[p.id] ? 1 : 0;
  const colors = productColors(p.colorOptions).length;
  return hasStory * 100 + colors;
}
void editorialWeight; // 페어 뷰 전환 후 예비 — 스코어 정렬은 서버(Pairs 시트) 소관

export default function Home() {
  // ── 스마트 핏 — 컨텍스트는 AuthProvider 단일 진실(게스트 즉시 저장, §8) ──
  const { fit } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [pairs, setPairs] = useState<CollectionPair[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  // [SESSION L · TASK 29] 최초 로딩과 진짜 빈 컬렉션을 구분한다 —
  // 로딩 중 "상품이 없습니다"를 보여주는 거짓 빈 상태 금지
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [slide, setSlide] = useState(0);
  const [slideIds, setSlideIds] = useState<string[]>([]);
  const [dDay, setDDay] = useState("");

  useEffect(() => {
    // §4B — 릴리즈는 월요일 00:00 KST. 카운트다운도 다음 월요일을 겨냥한다.
    // (1=Monday): 남은 일수 = (1 - day + 7) % 7, day==1이면 7일 뒤 차기 월요일.
    const calc = () => {
      const now = new Date();
      const day = now.getDay();
      let daysLeft = (8 - day) % 7;
      if (daysLeft === 0) daysLeft = 7;
      const next = new Date(now);
      next.setDate(now.getDate() + daysLeft);
      next.setHours(0, 0, 0, 0);
      const diff = Math.ceil((next.getTime() - now.getTime()) / 86400000);
      setDDay(daysLeft === 0 ? "D-DAY" : `D-${diff}`);
    };
    calc();
    const t = setInterval(calc, 60000);
    return () => clearInterval(t);
  }, []);

  // ── 스티키 감지 (Mobile Regression Repair §2): 카테고리 내비 직전의 sentinel가
  // 뷰포트 밖으로 나가는 순간 = 내비가 stuck — html 플래그를 토글해 상단 분할
  // 글래스 유틸리티가 카테고리 밴드에 도킹한다(HEADER_STATE → CATEGORY_DOCKED_STATE).
  // scrollY 매직넘버 아님 — IntersectionObserver 기하 판정. 플래그는 fixed 독의
  // 시각 상태만 바꾸므로 문서 레이아웃(·스크롤 위치)은 전혀 흔들리지 않는다(§21).
  const catSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = catSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        document.documentElement.classList.toggle("n1-cat-stuck", !entries[0].isIntersecting);
      },
      { threshold: 0 }
    );
    io.observe(sentinel);
    return () => {
      io.disconnect();
      document.documentElement.classList.remove("n1-cat-stuck");
    };
  }, []);

  // ── 컬렉션 필터: 성별(정확 enum) + 컬렉션 내 검색 ──
  const [genderTab, setGenderTab] = useState<GenderKey>("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    // §8: '전체'가 collection 기본 — 탭은 세션에 저장/복원한다(브랜드 진입과 무관).
    // PDP 'N°1 전체 상품 보기'(/?tab=all)는 저장된 탭보다 항상 이긴다 — 어느 탭을
    // 보고 있었든 '전체' 컬렉션으로 착지해야 한다(SESSION F §4).
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("tab");
    if (t === "all" || t === "male" || t === "female" || t === "genderless") {
      setGenderTab(t);
      if (t === "all") localStorage.removeItem("n1_gender_tab");
      else localStorage.setItem("n1_gender_tab", t);
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    const saved = localStorage.getItem("n1_gender_tab");
    if (saved === "male" || saved === "female" || saved === "genderless") setGenderTab(saved);
  }, []);
  const changeTab = (t: GenderKey, opts?: { fromDrag?: boolean }) => {
    // 드래그 종료 직후에 오는 synthetic click은 탭 전환으로 이중 처리된다 — 그것만 무시
    if (!opts?.fromDrag && suppressTabClickRef.current) { suppressTabClickRef.current = false; return; }
    setGenderTab(t);
    if (t === "all") localStorage.removeItem("n1_gender_tab");
    else localStorage.setItem("n1_gender_tab", t);
  };

  // ── 페어 컬렉션: 한 row = 추천 코디 1쌍 (LEFT=TOP, RIGHT=BOTTOM) ──
  // N1_PAIRING_POLICY_V1 — HERMES가 사전 계산한 mapping만 소비, 프론트에서 조합 생성 금지.
  const scope = genderTab === "all" ? "all" : GENDER_API[genderTab];
  const { rows: pairRows, singles } = buildCollectionPairs(products, pairs, scope, query);
  // §10 — 단품 구간도 LEFT=TOP / RIGHT=BOTTOM 구조를 유지한다 (무작위 혼합 금지)
  const singlesByRole = (() => {
    const tops: Product[] = [];
    const bottoms: Product[] = [];
    for (const p of singles) {
      if (categoryOf({ name: p.name, category: p.category }) === "bottom") bottoms.push(p);
      else tops.push(p);
    }
    const rows: { left?: Product; right?: Product }[] = [];
    const len = Math.max(tops.length, bottoms.length);
    for (let i = 0; i < len; i++) rows.push({ left: tops[i], right: bottoms[i] });
    return rows;
  })();
  const genderCount = (g: "male" | "female" | "genderless") =>
    selectCollection(products, GENDER_API[g]).length;

  // ── Liquid Glass 탭 셀렉터 — glass 자체가 드래그되는 살아 있는 selection material ──
  // 상태 소스는 genderTab 단일(중복 내비 상태 없음). 렌즈 배치는 React state
  // (Glass Lab TabZoneDemo와 동일 패턴 — DOM 직접 조작의 리렌더 경합 제거).
  // 드래그 중엔 lens DOM을 직접 조작(리렌더 없음), 놓으면 가장 가까운 탭으로 스냅.
  // 그룹은 순수 카테고리 4개 — N°1 브랜드는 렌즈 destination이 아니다(SESSION F §5).
  const GLASS_TABS: GenderKey[] = ["all", "male", "female", "genderless"];
  const trackRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; baseLeft: number; active: boolean; lastHover: number } | null>(null);
  // §2 — 드래그 직후 발생하는 click(버튼 위에서 시작한 드래그)을 한 번 무시하기 위한 플래그
  const suppressTabClickRef = useRef(false);
  const [lensPlacement, setLensPlacement] = useState<{ left: number; width: number } | null>(null);

  const syncLens = useCallback(() => {
    const track = trackRef.current;
    // 활성 탭 버튼을 못 찾는 비정상 상황에만 동일 컬렉션의 '전체'로 폴백 (정상 경로엔 미동작)
    const btn =
      track?.querySelector<HTMLElement>(`[data-tab="${genderTab}"]`) ??
      track?.querySelector<HTMLElement>('[data-tab="all"]');
    if (!track || !btn) return;
    // Mobile Regression Repair §5 — 렌즈 폭 = 라벨(+카운트) 폭 + 정준 패딩 20px.
    // zone(이웃 탭 중점 사이 경계)의 94%를 경질 상한: 렌즈가 이웃 탭 영역을
    // 침범하지 않는다. 폭이 정준이므로 렌즈 가장자리↔이웃 버튼 경계의 시각
    // 간격은 활성 탭과 무관하게 항상 일정. offsetLeft는 track(offsetParent)
    // 기준이라 rect 방식보다 안정적.
    const labels = Array.from(track.querySelectorAll<HTMLElement>("[data-tab]"));
    const trackW = track.clientWidth;
    const centers = labels.map((c) => c.offsetLeft + c.offsetWidth / 2);
    const i = labels.indexOf(btn);
    const zoneL = i > 0 ? (centers[i - 1] + centers[i]) / 2 : 0;
    const zoneR = i < centers.length - 1 ? (centers[i] + centers[i + 1]) / 2 : trackW;
    const zone = zoneR - zoneL;
    const w = Math.max(48, Math.min(btn.offsetWidth + 20, zone * 0.94));
    // 렌즈는 zone 안에서 중심 정렬 — track 밖으로도 절대 나가지 않는다(§1)
    const left = Math.max(zoneL, Math.min(centers[i] - w / 2, zoneR - w));
    setLensPlacement((prev) =>
      prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.width - w) < 0.5 ? prev : { left, width: w });
  }, [genderTab]);
  useEffect(() => { syncLens(); }, [syncLens, products.length]); // 카운트 변화로 탭 폭 변해도 재계산
  useEffect(() => {
    // 폰트 로딩 전 측정한 offsetWidth 고착 방지 — 로딩 완료 시점에 재계산
    if (document.fonts?.ready) document.fonts.ready.then(() => syncLens()).catch(() => {});
  }, [syncLens]);
  useEffect(() => {
    // dev-lab 디버그: 콘솔에서 __glabPlace()로 재계산 강제 가능 (제거 예정)
    (window as unknown as Record<string, unknown>).__glabPlace = () => syncLens();
  }, [syncLens]);
  useEffect(() => {
    // 리사이즈 감지: documentElement/track 관찰 + 분기 전환(matchMedia) 보강
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncLens());
    ro.observe(document.documentElement);
    ro.observe(trackRef.current!);
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => syncLens();
    mq.addEventListener?.("change", onChange);
    return () => { ro.disconnect(); mq.removeEventListener?.("change", onChange); };
  }, [syncLens]);

  // §2 — 포인터down은 트랙 레벨에서 잡는다: 렌즈 가장자리뿐 아니라 활성 탭 라벨 위에서
  // 시작한 드래그도 렌즈 드래그가 된다(버튼이 렌즈 중앙을 덮는 z 구조 때문에 렌즈 단독
  // 핸들러로는 중앙 드래그가 닿지 않았다). tap(무이동)은 click 경로가 그대로 처리한다.
  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const lens = lensRef.current;
    if (!lens) return;
    suppressTabClickRef.current = false; // 새 제스처 — 이전 드래그의 미소비 억제 플래그는 버린다
    // 주의: 여기서 setPointerCapture 하면 tap의 click이 트랙으로 리타깃되어 버튼 선택이 깨진다.
    // 캡처는 드래그가 활성화된 시점(pointerMove)에만 건다.
    dragRef.current = {
      pointerId: e.pointerId, startX: e.clientX,
      baseLeft: lensPlacement?.left ?? 0, active: false, lastHover: -1,
    };
  };
  const onLensPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const ds = dragRef.current;
    const lens = lensRef.current, track = trackRef.current;
    if (!ds || !lens || !track || e.pointerId !== ds.pointerId) return;
    const dx = e.clientX - ds.startX;
    if (!ds.active) {
      if (Math.abs(dx) < 6) return; // 수평 의도 확인 전엔 무동작 (세로 스크롤 보호)
      ds.active = true;
      lens.classList.add("dragging");
      // 드래그 확정 시점에만 캡처 — 이후 click은 트랙으로 가 버튼 이중 선택도 막힌다
      try { track.setPointerCapture(e.pointerId); } catch { /* 합성 포인터 등 — 없어도 동작 */ }
    }
    const maxX = Math.max(0, track.offsetWidth - lens.offsetWidth);
    const left = Math.max(0, Math.min(ds.baseLeft + dx, maxX));
    lens.style.transform = `translate3d(${left}px, 0, 0)`;
    // 렌즈 아래 텍스트 미세 반응 (레이아웃 변화 없이 색만)
    const center = left + lens.offsetWidth / 2;
    const btns = GLASS_TABS.map((k) => track.querySelector<HTMLElement>(`[data-tab="${k}"]`));
    let hover = -1;
    btns.forEach((b, i) => {
      if (b && center >= b.offsetLeft && center <= b.offsetLeft + b.offsetWidth) hover = i;
    });
    if (hover !== ds.lastHover) {
      btns.forEach((b) => b?.classList.remove("lens-hover"));
      if (hover >= 0 && btns[hover]) btns[hover].classList.add("lens-hover");
      ds.lastHover = hover;
    }
  };
  const onLensPointerEnd = (e: React.PointerEvent<HTMLSpanElement>) => {
    const ds = dragRef.current;
    const lens = lensRef.current, track = trackRef.current;
    dragRef.current = null;
    lens?.classList.remove("dragging");
    track?.querySelectorAll(".lens-hover").forEach((el) => el.classList.remove("lens-hover"));
    if (!ds || !ds.active || !lens || !track || e.pointerId !== ds.pointerId) return;
    // 가장 가까운 탭으로 스냅 — 기존 상태 로직 재사용 (glass state == category state)
    const lensLeft = parseFloat(lens.style.transform.match(/translate3d\(([-\d.]+)px/)?.[1] ?? "0") || 0;
    const center = lensLeft + lens.offsetWidth / 2;
    let best: GenderKey = genderTab, bestD = Infinity;
    GLASS_TABS.forEach((k) => {
      const b = track.querySelector<HTMLElement>(`[data-tab="${k}"]`);
      if (!b) return;
      const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - center);
      if (d < bestD) { bestD = d; best = k; }
    });
    if (best !== genderTab) changeTab(best, { fromDrag: true });
    else syncLens(); // 제자리 안정화 스냅
    // 스냅 후 같은 제스처의 click이 활성 버튼을 다시 누르는 것을 막는다 (§2)
    if (ds.active) suppressTabClickRef.current = true;
  };

  // ── 빠른 주문 상태 (원시 색상/사이즈 값) ──
  const [selColor, setSelColor] = useState("");
  const [selSize, setSelSize] = useState("");
  const [optTouched, setOptTouched] = useState(false);
  const [orderStage, setOrderStage] = useState<"options" | "form" | "done">("options");
  const [orderForm, setOrderForm] = useState({ name: "", phone: "", email: "", depositor: "", memo: "" });
  const [orderAddr, setOrderAddr] = useState<AddressValue>(emptyAddress());
  const [orderResult, setOrderResult] = useState<{ order_id: string; total: number; type: string; notice?: string; bank: string; account: string; holder: string } | null>(null);
  const [orderError, setOrderError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const quickOrderReady = Boolean(
    orderForm.name.trim() && orderForm.phone.trim() && orderAddr.postalCode && orderAddr.roadAddress && orderAddr.detailAddress.trim()
  );

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setProducts(data.products);
        setPairs(data.pairs || []);
        setError(""); // [SESSION L] 재폴링 복구 시 실패 문구가 남지 않는다
      } else {
        // [SESSION L] 서버 사유를 그대로 노출하지 않는다 — 실제 상태(지금 못 불러옴)만 안내
        setError("지금 상품 목록을 불러오지 못했어요 — 잠시 후 다시 시도해 주세요");
      }
    } catch {
      setError("서버에 연결하지 못했어요 — 잠시 후 다시 시도해 주세요");
    } finally {
      setProductsLoaded(true);
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
    const pending = products.filter((p) => !thumbs[p.id] && folderIdFromUrl(p.lookbookImage));
    pending.slice(0, 4).forEach((p) => loadThumb(p));
  }, [products, thumbs, loadThumb]);

  // 카드 이미지: 에디토리얼 로컬 샷 → Drive 썸네일 (폴더 URL 원문은 img src로 부적합 — mediaFor가 차단)
  const imageOf = (p: Product): string | null =>
    mediaFor(p.id, p.lookbookImage)?.front || thumbs[p.id] || null;

  // 외부 이미지 로드 실패(FASHN 만료 등) → '이미지 준비 중' 플레이스홀더로 정직하게 폴백
  const [failedImg, setFailedImg] = useState<Record<string, true>>({});

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
  }, [products.length]);

  const openDetail = useCallback(async (p: Product, preset?: { color?: string; size?: string }) => {
    const fid = folderIdFromUrl(p.lookbookImage);
    const colors = productColors(p.colorOptions);
    const apply = () => {
      setSelColor(preset?.color || (colors.length === 1 ? colors[0].value : ""));
      // 사이즈 프리셋 — 카테고리에 맞는 평소 사이즈 기준(§17). sizeOptions가 없으면 조용히 생략.
      const kind = categoryOf({ name: p.name, category: p.category });
      const baseSize = (kind === "bottom" ? fit?.bottomSize : fit?.topSize) || "";
      const presetSize = fitPresetSize(p.name, baseSize, fit?.preferredFit || "", p.sizeOptions || []);
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
  }, [fit]);

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
            email: orderForm.email.trim() || undefined,
            postal_code: orderAddr.postalCode,
            address1: orderAddr.roadAddress,
            address2: orderAddr.detailAddress,
            delivery_memo: orderForm.memo.trim() || undefined,
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
  }, [selected, orderForm, orderAddr, selColor, selSize, fetchProducts]);

  const closeDetail = () => setSelected(null);
  const nextSlide = (e?: React.MouseEvent) => { e?.stopPropagation(); setSlide((s) => (s + 1) % Math.max(slideIds.length, 1)); };
  const prevSlide = (e?: React.MouseEvent) => { e?.stopPropagation(); setSlide((s) => (s - 1 + slideIds.length) % Math.max(slideIds.length, 1)); };
  const openCs = () => window.dispatchEvent(new Event("n1:open-cs"));

  // ── Apple 01 원칙의 N°1 번역: hero 텍스트가 스크롤에 조용히 물러나며
  //    컬렉션으로 핸드오프 — transform/opacity만, rAF 스로틀 ──
  useEffect(() => {
    const brand = document.querySelector<HTMLElement>(".hero-brand");
    const drop = document.querySelector<HTMLElement>(".hero-drop");
    if (!brand) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const t = Math.min(1, Math.max(0, scrollY / 240));
        const eased = t * t * (3 - 2 * t);
        brand.style.opacity = String(1 - eased * 0.55);
        brand.style.transform = `translateY(${-eased * 12}px)`;
        if (drop) drop.style.opacity = String(1 - eased * 0.7);
      });
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => { removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

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
          {/* §43 — 카피는 데이터를 따른다: 60 Pieces · 20 Outfits 카운트는 시트 기준 실시간 */}
          <h1>N°1</h1>
          <p className="hero-tag">{products.length} Pieces · {pairs.length} Outfits</p>
          <p className="hero-tagline">{WEEKLY_TAGLINE}</p>
        </div>
        <p className="hero-drop">
          {WEEKLY_CLOSE_LABEL} {dDay || "—"} · {WEEKLY_OPEN_LABEL}
        </p>
      </header>

      {error && (
        <div className="error" role="alert">
          ⚠️ {error}
          <br />
          <button type="button" className="error-retry" onClick={() => void fetchProducts()}>
            다시 시도
          </button>
        </div>
      )}

      {/* ── 컬렉션 내비 (sticky glass rail + 드래그 가능한 Liquid Glass 셀렉터) ──
          N°1 브랜드 내비는 이 그룹 밖 — 홈은 위 hero 브랜드, 그 외 페이지는 SiteHeader.
          §5 — 스마트 핏은 카테고리 행에서 제거되어 상단 유틸리티(AuthNav)로 이동했다.
          sentinel — 내비 stuck 판정 기준점(높이 0, 레이아웃 영향 없음). */}
      <div ref={catSentinelRef} className="cat-sticky-sentinel" aria-hidden="true" />
      <nav className="collection-nav" aria-label="컬렉션 필터">
        <div
          className="gtab-track"
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onLensPointerMove}
          onPointerUp={onLensPointerEnd}
          onPointerCancel={onLensPointerEnd}
        >
          <span
            ref={lensRef}
            className="gtab-lens"
            aria-hidden="true"
            style={
              lensPlacement
                ? { width: lensPlacement.width, transform: `translate3d(${lensPlacement.left}px, 0, 0)` }
                : undefined
            }
          />
          <button data-tab="all" className={`gtab ${genderTab === "all" ? "active" : ""}`} onClick={() => changeTab("all")}>
            전체 <span className="gcount">({products.length})</span>
          </button>
          <button data-tab="male" className={`gtab ${genderTab === "male" ? "active" : ""}`} onClick={() => changeTab("male")}>
            남성 <span className="gcount">({genderCount("male")})</span>
          </button>
          <button data-tab="female" className={`gtab ${genderTab === "female" ? "active" : ""}`} onClick={() => changeTab("female")}>
            여성 <span className="gcount">({genderCount("female")})</span>
          </button>
          <button data-tab="genderless" className={`gtab ${genderTab === "genderless" ? "active" : ""}`} onClick={() => changeTab("genderless")}>
            젠더리스 <span className="gcount">({genderCount("genderless")})</span>
          </button>
        </div>
      </nav>

      {/* ── 컬렉션: 에디토리얼 위계 ── */}
      <section className="collection">
        <div className="collection-head">
          <h2 className="collection-title">이번 컬렉션</h2>
          {/* §3·§25 — 성별 카운트 나열 금지. 조용한 두 줄 요약만. */}
          <p className="collection-sub">
            {productsLoaded ? `${products.length} Pieces · 추천 코디 ${pairRows.length}쌍` : "불러오는 중 —"}
          </p>
          <div className="collection-search">
            <SearchIcon size={13} />
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

        {pairRows.length ? (
          <div className="pair-collection">
            {/* §11 — 첫 화면 사용자가 경계를 즉시 읽도록: 조용한 eyebrow + 부제.
                 상의/하의는 column header — pair view를 깨는 interactive 탭이 아니다 */}
            <div className="section-eyebrow" data-reveal>
              <p className="section-eyebrow-title">추천 코디</p>
              <p className="section-eyebrow-sub">함께 입기 좋은 조합</p>
            </div>
            <div className="pair-head" aria-hidden="true">
              <span>상의</span>
              <span>하의</span>
            </div>
            {pairRows.map(({ pair, top, bottom }, rowIndex) => (
              <div className="pair-row" key={pair.pairId} data-reveal>
                <div className="pair-cards">
                  {[{ p: top, eager: rowIndex === 0 }, { p: bottom, eager: false }].map(({ p, eager }) => {
                    const img = failedImg[p.id] ? null : imageOf(p);
                    const soldOut = p.stockStatus === "품절";
                    const altShot = img
                      ? mediaFor(p.id, p.lookbookImage)?.views.find((v) => v.src !== img)?.src ?? null
                      : null;
                    // TASKS 27·28 (Session J): 같은 User Fit Context로 이 카드 상품(상의/하의
                    // 슬롯)을 각각 해석 — 페어 전체를 위한 하나의 사이즈는 존재하지 않는다.
                    const fitLine = fit ? pairFitLine(interpretFit(fitInputOf(p), fit)) : "";
                    return (
                      <Link
                        key={p.id}
                        href={`/product/${p.id}`}
                        className="piece pair-piece"
                        data-reveal
                      >
                        <div className={`piece-media ${img ? "" : "empty"}`}>
                          {img ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={img}
                                alt={`${p.name} 대표 이미지`}
                                loading={eager ? "eager" : "lazy"}
                                onError={() =>
                                  setFailedImg((f) => (f[p.id] ? f : { ...f, [p.id]: true }))
                                }
                              />
                              {altShot && (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img className="piece-alt" src={altShot} alt="" aria-hidden="true" loading="lazy" />
                              )}
                            </>
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
                          {fitLine ? <p className="piece-fit">{fitLine}</p> : null}
                        </div>
                      </Link>
                    );
                  })}
                </div>
                {pair.pairReasonShort && (
                  <p className="pair-reason">{pair.pairReasonShort}</p>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {singlesByRole.some((r) => r.left || r.right) ? (
          <div className="pair-singles">
            {/* §11 — 추천 코디와의 경계: hairline + 여백, 그 다음 조용한 eyebrow.
                 §10 — 단품도 LEFT=TOP / RIGHT=BOTTOM 열 구조를 유지한다 */}
            <div className="singles-divider" role="presentation" />
            <div className="section-eyebrow" data-reveal>
              <p className="section-eyebrow-title">개별 셀렉션</p>
            </div>
            <div className="pair-head singles-head" aria-hidden="true">
              <span>상의</span>
              <span>하의</span>
            </div>
            <div className="singles-rows">
              {singlesByRole.map(({ left, right }, rowIndex) => (
                <div className="pair-cards singles-cards" key={`srow-${rowIndex}`}>
                  {[{ p: left, eager: false }, { p: right, eager: false }].map(({ p }, colIdx) =>
                    p ? (
                      <SingleCard key={p.id} p={p} eager={rowIndex === 0 && colIdx === 0} />
                    ) : (
                      <span key={`gap-${rowIndex}-${colIdx}`} aria-hidden="true" />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!pairRows.length && !singles.length && !productsLoaded ? (
          <p className="collection-empty">불러오는 중 — 잠시만 기다려 주세요.</p>
        ) : !pairRows.length && !singles.length ? (
          query ? (
            <p className="collection-empty">
              검색 결과가 없습니다 — 다른 이름으로 찾아보세요.
            </p>
          ) : (
            <p className="collection-empty">
              이번 컬렉션에는 해당하는 상품이 없습니다 — 다음 컬렉션에서 만나요.
            </p>
          )
        ) : null}
      </section>

      {/* ── 브랜드 스토리 — second editorial moment (제품 컷 + 짧은 문장) ── */}
      <section className="story">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="story-shot" src="/editorial-media/PRD-M-51/01_front.jpg" alt="" aria-hidden="true" loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        <h2 className="story-title">괜찮은 것만 보여드립니다</h2>
        <p className="story-body">
          N°1은 모든 상품을 한자리에 쏟아놓지 않습니다.
          <br />
          눈이 편한 쇼핑을 위해서입니다.
        </p>
        <button className="story-cta" onClick={() => window.dispatchEvent(new Event("n1:open-fit"))}>
          {fit
            ? `내 핏 — ${FIT_LABEL[fit.preferredFit as "A"|"B"|"C"] ?? ""} · 수정하기 →`
            : "스마트 핏 →"}
        </button>
      </section>

      <footer>{FOOTER_LABEL}</footer>

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
              ) : (
                <span className="slide-empty">이미지 준비 중</span>
              )}
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
                    <span className="option-label">색상</span>
                    <div className="option-chips" role="group" aria-label="색상 선택">
                      {colorPairs.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          className={`option-chip ${selColor === c.value ? "selected" : ""}`}
                          aria-pressed={selColor === c.value}
                          onClick={() => { setSelColor(c.value); setOptTouched(true); }}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {selected.sizeOptions && selected.sizeOptions.length > 0 && (
                  <div className="option-row">
                    <span className="option-label">사이즈</span>
                    {fit && selSize && (
                      <span className="fit-badge">
                        평소 {(categoryOf({ name: selected.name, category: selected.category }) === "bottom" ? fit.bottomSize : fit.topSize) || fit.topSize || fit.bottomSize} 기준 —{" "}
                        {(() => {
                          const shift = preferenceShift(selected.name, fit.preferredFit);
                          return shift === 0 ? "평소 사이즈 그대로" : shift === 1 ? "한 치수 여유 있게" : "두 치수 여유 있게";
                        })()}
                      </span>
                    )}
                    <div className="option-chips" role="group" aria-label="사이즈 선택">
                      {selected.sizeOptions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`option-chip ${selSize === s ? "selected" : ""}`}
                          aria-pressed={selSize === s}
                          onClick={() => { setSelSize(s); setOptTouched(true); }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
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
                    <input className="order-input" placeholder="받는 분 성함" value={orderForm.name}
                      onChange={(e) => setOrderForm({ ...orderForm, name: e.target.value })} />
                    <input className="order-input" placeholder="연락처 (010-0000-0000)" type="tel" value={orderForm.phone}
                      onChange={(e) => setOrderForm({ ...orderForm, phone: e.target.value })} />
                    <input className="order-input" placeholder="이메일 (주문 안내 발송용)" type="email" value={orderForm.email}
                      onChange={(e) => setOrderForm({ ...orderForm, email: e.target.value })} />
                    {/* §13 — 구조화 주소: 우편번호 찾기 → 공식 주소 선택 → 상세 직접 입력 */}
                    <PostcodeSearch value={orderAddr} onChange={setOrderAddr} compact />
                    <input className="order-input" placeholder="배송 메모 (선택)" value={orderForm.memo}
                      onChange={(e) => setOrderForm({ ...orderForm, memo: e.target.value })} />
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
                        disabled={submitting || !quickOrderReady}
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
                <div className="info-row"><span>배송</span><b>공급처 출고 일정에 따라 배송 시작 · 운송장 안내</b></div>
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
                  {originDisplay(selected.origin) ? (
                    <div className="info-row"><span>제조국(원산지)</span><b>{originDisplay(selected.origin)}</b></div>
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

/** 개별 셀렉션 카드 — 페어에 오르지 않은 상품의 조용한 단품 카드 (§10·§24) */
function SingleCard({ p, eager }: { p: Product; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const img = failed ? null : imageOfCard(p);
  const soldOut = p.stockStatus === "품절";
  const altShot = img
    ? mediaFor(p.id, p.lookbookImage)?.views.find((v) => v.src !== img)?.src ?? null
    : null;
  return (
    <Link href={`/product/${p.id}`} className="piece" data-reveal>
      <div className={`piece-media ${img ? "" : "empty"}`}>
        {img ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img}
              alt={`${p.name} 대표 이미지`}
              loading={eager ? "eager" : "lazy"}
              onError={() => setFailed(true)}
            />
            {altShot && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="piece-alt" src={altShot} alt="" aria-hidden="true" loading="lazy" />
            )}
          </>
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
}

/** 카드 이미지 해상 — 에디토리얼 로컬 샷 → Drive 썸네일 (Home 카드와 동일 폴백 체인) */
function imageOfCard(p: Product): string | null {
  return mediaFor(p.id, p.lookbookImage)?.front || null;
}
