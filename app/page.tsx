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

// 상품정보제공고시 (전자상거래법) — 시트값 없으면 "상세페이지 참조"로 표기
function orRef(v?: string): string {
  return v && v.trim() ? v : "상세페이지 참조";
}

/** 실측사이즈 문자열 → 가독용 표 ("M-총장66/가슴단면48/..." 또는 "M: 총장 66, 가슴 48..." 형식 파싱) */
function parseSizeChart(chart: string): { cols: string[]; rows: { label: string; vals: string[] }[] } | null {
  if (!chart || !chart.trim()) return null;
  // 사이즈 그룹 분리: " | " 또는 " / " 앞에 사이즈명이 오는 패턴
  const groups = chart.split(/\s*\|\s*|\s+(?=[A-Z0-9가-힣]+\(|\d+[-~]\d+)/).filter(Boolean);
  const rows: { label: string; vals: string[] }[] = [];
  const colSet = new Set<string>();
  const parsed = groups.map((g) => {
    const m = g.match(/^([^:：-]+)[-:]([^:：]+)$/);
    if (!m) return null;
    const label = m[1].trim();
    const items: [string, string][] = [];
    for (const part of m[2].split(/[,，·]/)) {
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
      <div className="info-row"><span>실측사이즈</span><b>{orRef(chart)}</b></div>
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
            <li>· 전국 택배 배송 (결제 완료 후 신속 출고, 평균 1~3일 소요)</li>
            <li>· 배송비: 기본 3,000원 — 5만원 이상 구매 시 무료배송</li>
            <li>· 도서·산간 지역은 추가 배송비가 발생할 수 있습니다</li>
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
      }
    } catch {}
  }, []);

  // 선택된 옵션의 재고 수 (옵션별재고 맵)
  const selectedStock = (() => {
    if (!selected?.optionStock) return null;
    const key = selSize || selColor;
    if (key && selected.optionStock[key] !== undefined) return selected.optionStock[key];
    const vals = Object.values(selected.optionStock);
    return vals.length ? Math.min(...vals) : null;
  })();
  const lowStock = selectedStock !== null && selectedStock > 0 && selectedStock <= 5;
  const optionsReady = (!selected?.colorOptions?.length || selColor) && (!selected?.sizeOptions?.length || selSize);

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
                        <option key={c} value={c} disabled={(selected.optionStock?.[c] ?? 1) === 0}>
                          {c}{selected.optionStock?.[c] === 0 ? " (품절)" : ""}
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
                        const st = selected.optionStock?.[s];
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

                <div className="stock-line">
                  <span className={`stock-badge ${selected.stockStatus === "판매중" ? "in" : "out"}`}>
                    {selected.stockStatus}
                  </span>
                </div>
                <button
                  className="buy-btn"
                  disabled={selected.stockStatus !== "판매중" || !optionsReady || selectedStock === 0}
                  onClick={() => setOptTouched(true)}
                >
                  {selected.stockStatus !== "판매중" ? "품절"
                    : !optionsReady ? (optTouched ? "옵션을 선택해 주세요" : "옵션 선택")
                    : selectedStock === 0 ? "품절"
                    : "구매하기"}
                </button>
                <p className="buy-note">결제 완료 후 신속하게 출고됩니다</p>
              </div>
              <div className="info-rows">
                <div className="info-row"><span>품번</span><b>{selected.id}</b></div>
                <div className="info-row"><span>배송</span><b>전국 택배 (결제 완료 후 신속 출고)</b></div>
              </div>

              {/* ── 소재 / 핏 / 사이즈 ── */}
              <div className="spec-block">
                <h3 className="spec-title">소재 &amp; 핏</h3>
                <div className="info-row"><span>소재</span><b>{orRef(selected.material)}</b></div>
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
                  <div className="info-row"><span>제품 소재</span><b>{orRef(selected.material)}</b></div>
                  <div className="info-row"><span>색상</span><b>{selected.colorOptions?.length ? selected.colorOptions.join(", ") : orRef(undefined)}</b></div>
                  <div className="info-row"><span>치수</span><b>{selected.sizeOptions?.length ? selected.sizeOptions.join(", ") : orRef(undefined)}</b></div>
                  <div className="info-row"><span>제조자(수입자)</span><b>{orRef(selected.notice?.manufacturer)}</b></div>
                  <div className="info-row"><span>제조국(원산지)</span><b>{orRef(selected.origin)}</b></div>
                  <div className="info-row"><span>제조연월</span><b>{orRef(selected.notice?.madeAt)}</b></div>
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
