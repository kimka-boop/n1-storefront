"use client";

/**
 * N°1 — 반응형 쇼핑몰
 * 대표이미지: 드라이브 01_full (서버 API로 file_id 조회)
 * 클릭: 구매 상세 + 5장 슬라이드
 */
import { useEffect, useState, useCallback } from "react";

interface FitInfo { thickness: string; stretch: string; sheer: string; lining: string; shape: string; }
interface NoticeInfo { manufacturer: string; madeAt: string; colorSize: string; quality: string; as: string; }
interface Product {
  id: string;
  name: string;
  category: string;
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

// 소재 표기 Component Rule: 색상 등 부가정보 제거, 원단 정보만 출력
function cleanMaterial(v?: string): string {
  if (!v) return "";
  return v.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().replace(/[,·\s]+$/, "");
}

/** 실측사이즈 문자열 → 가독용 표 ("M-총장66/가슴단면48/..." 또는 "M: 총장 66, 가슴 48..." 형식 파싱) */
function parseSizeChart(chart: string): { cols: string[]; rows: { label: string; vals: string[] }[] } | null {
  if (!chart || !chart.trim()) return null;
  // 보조 설명 꼬리 제거: "(한국사이즈 ...)", "단위 cm" 등은 표 데이터가 아님
  const cleaned = chart.replace(/\s*\((?:한국사이즈|단위)[\s\S]*$/, "").trim();
  // 사이즈 그룹 분리: " | " 또는 " / " 앞에 사이즈명이 오는 패턴
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
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${w}&v=${Math.floor(Date.now() / 600000)}`; // 10분 캐시버스터
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({}); // pid → 대표 이미지 URL
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [slide, setSlide] = useState(0);
  const [slideIds, setSlideIds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
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

  // 대표이미지 로딩 (생성완료 제품만, 드라이브에서 file_id 조회)
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

  // 생성완료 제품의 대표이미지 순차 로딩
  useEffect(() => {
    const pending = products.filter((p) => p.lookbookStatus === "생성완료" && !thumbs[p.id]);
    pending.slice(0, 4).forEach((p) => loadThumb(p));
  }, [products, thumbs, loadThumb]);

  // 스크롤 리빌
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const idx = Number((e.target as HTMLElement).dataset.idx);
            setRevealed((prev) => new Set(prev).add(idx));
          }
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [products]);

  const openDetail = useCallback(async (p: Product) => {
    const fid = folderIdFromUrl(p.lookbookImage);
    if (!fid) return;
    try {
      const res = await fetch(`/api/lookbook-files?folder=${fid}`);
      const data = await res.json();
      if (data.ok) {
        setSlideIds(data.files.map((f: any) => f.id));
        setSelected(p);
        setSlide(0);
        // 옵션 초기화 — 단일 옵션이면 자동 선택
        setSelColor(p.colorOptions?.length === 1 ? p.colorOptions[0] : "");
        setSelSize(p.sizeOptions?.length === 1 ? p.sizeOptions[0] : "");
        setOptTouched(false);
        setOrderStage("options");
        setOrderResult(null);
        setOrderError("");
      }
    } catch {}
  }, []);

  // 선택된 옵션의 재고 수 — 신형 키(색상_사이즈) 우선, 구형 키(사이즈) 폴백
  const selectedStock = (() => {
    if (!selected?.optionStock) return null;
    const os = selected.optionStock;
    if (selColor && selSize && os[`${selColor}_${selSize}`] !== undefined) return os[`${selColor}_${selSize}`];
    if (selColor && selSize && os[`${selColor}_${selSize}`.replace(/\s/g, "")] !== undefined) return os[`${selColor}_${selSize}`.replace(/\s/g, "")];
    if (selSize && os[selSize] !== undefined) return os[selSize];
    if (selColor && os[selColor] !== undefined) return os[selColor];
    const vals = Object.values(os);
    return vals.length ? Math.min(...vals) : null;
  })();
  const lowStock = selectedStock !== null && selectedStock > 0 && selectedStock <= 5;
  const optionsReady = (!selected?.colorOptions?.length || selColor) && (!selected?.sizeOptions?.length || selSize);

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
      <header className="hero">
        <div className="hero-brand" data-reveal>
          <h1>N°1</h1>
          <p className="hero-tag">20 Pieces. Selected by AI.</p>
        </div>
      </header>

      {error && <p className="error">⚠️ {error}</p>}

      <section className="grid">
        {products.map((p, idx) => {
          const ready = p.lookbookStatus === "생성완료";
          const thumb = thumbs[p.id];
          return (
            <article
              key={p.id}
              data-reveal
              data-idx={idx}
              className={`card ${ready ? "clickable" : ""} ${revealed.has(idx) ? "revealed" : ""}`}
              onClick={ready ? () => openDetail(p) : undefined}
              style={{ transitionDelay: `${(idx % 5) * 60}ms` }}
            >
              {thumb ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={thumb} alt={p.name} className="tryon" loading="lazy" />
              ) : (
                <div className="placeholder"><span>{ready ? "LOADING" : "PREPARING"}</span></div>
              )}
              <div className="card-body">
                <p className="category">{p.category}</p>
                <h2>{p.name}</h2>
                <p className="price">₩{p.price.toLocaleString("ko-KR")}</p>
                <div className="card-foot">
                  <span className="stock">{p.stockStatus}</span>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {/* ── 구매 상세 ── */}
      {selected && (
        <div className="modal" onClick={closeDetail}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeDetail}>✕</button>
            <div className="slider">
              {slideIds[slide] && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={slide}
                  src={driveImg(slideIds[slide], 1000)}
                  alt={`${selected.name} — ${SHOT_LABELS[slide]}`}
                  className="slide-img"
                />
              )}
              <button className="nav prev" onClick={prevSlide} aria-label="이전">‹</button>
              <button className="nav next" onClick={nextSlide} aria-label="다음">›</button>
              <div className="slide-label">{SHOT_LABELS[slide]} ({slide + 1}/{slideIds.length})</div>
            </div>
            <div className="detail-info">
              <p className="category">{selected.category}</p>
              <h2>{selected.name}</h2>
              <p className="detail-price">₩{selected.price.toLocaleString("ko-KR")}</p>
              <div className="buy-box">
                {/* ── 옵션 선택 (색상/사이즈) ── */}
                {selected.colorOptions && selected.colorOptions.length > 0 && (
                  <div className="option-row">
                    <label className="option-label">색상</label>
                    <select
                      className="option-select"
                      value={selColor}
                      onChange={(e) => { setSelColor(e.target.value); setOptTouched(true); }}
                    >
                      {selected.colorOptions.length > 1 && <option value="">색상을 선택하세요</option>}
                      {selected.colorOptions.map((c) => (
                        <option key={c} value={c} disabled={(() => {
                          // 색상 단위 품절: 해당 색상의 모든 조합이 0일 때
                          const entries = Object.entries(selected.optionStock || {});
                          const rel = entries.filter(([k]) => selSize ? k === `${c}_${selSize}` || k.replace(/\s/g,"") === `${c}_${selSize}` : k === c || k.startsWith(`${c}_`));
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
                    <select
                      className="option-select"
                      value={selSize}
                      onChange={(e) => { setSelSize(e.target.value); setOptTouched(true); }}
                    >
                      {selected.sizeOptions.length > 1 && <option value="">사이즈를 선택하세요</option>}
                      {selected.sizeOptions.map((s) => {
                        const st = (() => {
                          const os = selected.optionStock || {};
                          if (selColor && os[`${selColor}_${s}`] !== undefined) return os[`${selColor}_${s}`];
                          if (selColor && os[`${selColor}_${s}`.replace(/\s/g, "")] !== undefined) return os[`${selColor}_${s}`.replace(/\s/g, "")];
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
                <div className="info-row"><span>소재</span><b>{orRef(cleanMaterial(selected.material))}</b></div>
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
                  <div className="info-row"><span>제품 소재</span><b>{orRef(cleanMaterial(selected.material))}</b></div>
                  <div className="info-row"><span>색상</span><b>{selected.colorOptions?.length ? selected.colorOptions.join(", ") : orRef(undefined, "색상")}</b></div>
                  <div className="info-row"><span>치수</span><b>{selected.sizeOptions?.length ? selected.sizeOptions.join(", ") : orRef(undefined)}</b></div>
                  <div className="info-row"><span>제조자(수입자)</span><b>N°1 협력업체</b></div>
                  <div className="info-row"><span>제조국(원산지)</span><b>{orRef(selected.origin, "원산지")}</b></div>
                  <div className="info-row"><span>제조연월</span><b>{orRef(selected.notice?.madeAt, "제조연월")}</b></div>
                  <div className="info-row">
                    <span>품질보증기준</span>
                    <b className="quality-tip">
                      소비자 분쟁해결기준에 따름
                      <span className="tooltip">
                        전자상거래 법에 규정되어 있는 소비자 청약철회 가능 범위를 준수합니다.
                      </span>
                    </b>
                  </div>
                  <div className="info-row"><span>A/S 책임자</span><b>{selected.notice?.as || "N°1 고객센터"}</b></div>
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

      <footer>© N°1 — MINIMALIST FASHION MAGAZINE</footer>
    </main>
  );
}
