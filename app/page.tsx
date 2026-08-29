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
  supplier: string;
  supplierUrl: string;
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
}

// 상품정보제공고시 (전자상거래법) — 시트값 없으면 "상세페이지 참조"로 표기
function orRef(v?: string): string {
  return v && v.trim() ? v : "상세페이지 참조";
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
      }
    } catch {}
  }, []);

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
                <div className="stock-line">
                  <span className={`stock-badge ${selected.stockStatus === "판매중" ? "in" : "out"}`}>
                    {selected.stockStatus}
                  </span>
                </div>
                <button
                  className="buy-btn"
                  disabled={selected.stockStatus !== "판매중"}
                  onClick={() => window.open(selected.supplierUrl, "_blank")}
                >
                  {selected.stockStatus === "판매중" ? "구매하기" : "품절"}
                </button>
                <p className="buy-note">도매 공급사 페이지로 연결됩니다</p>
              </div>
              <div className="info-rows">
                <div className="info-row"><span>품번</span><b>{selected.id}</b></div>
                <div className="info-row"><span>공급사</span><b>{selected.supplier}</b></div>
                <div className="info-row"><span>배송</span><b>도매공급사 직배송</b></div>
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
                <div className="info-row"><span>실측사이즈</span><b>{orRef(selected.sizeChart)}</b></div>
                {selected.modelInfo && selected.modelInfo.trim() && (
                  <div className="info-row"><span>모델착용</span><b>{selected.modelInfo}</b></div>
                )}
              </div>

              {/* ── 상품정보제공고시 (전자상거래법 필수) ── */}
              <div className="spec-block">
                <h3 className="spec-title">상품정보제공고시</h3>
                <div className="notice-table">
                  <div className="info-row"><span>제품 소재</span><b>{orRef(selected.material)}</b></div>
                  <div className="info-row"><span>색상 / 치수</span><b>{orRef(selected.notice?.colorSize)}</b></div>
                  <div className="info-row"><span>제조자(수입자)</span><b>{orRef(selected.notice?.manufacturer)}</b></div>
                  <div className="info-row"><span>제조국(원산지)</span><b>{orRef(selected.origin)}</b></div>
                  <div className="info-row"><span>제조연월</span><b>{orRef(selected.notice?.madeAt)}</b></div>
                  <div className="info-row"><span>품질보증기준</span><b>{selected.notice?.quality || "전자상거래법 규정 소비자청약철회 범위 준수"}</b></div>
                  <div className="info-row"><span>A/S 책임자</span><b>{selected.notice?.as || "N°1 고객센터"}</b></div>
                </div>
              </div>

              {/* ── 배송 / 교환 / 반품 ── */}
              <div className="spec-block">
                <h3 className="spec-title">배송 · 교환 · 반품 안내</h3>
                <ul className="policy-list">
                  <li>· 배송: 도매공급사 직배송 (평균 2~5일 소요)</li>
                  <li>· 배송비: 공급사별 상이 — 구매 전 공급사 페이지 확인</li>
                  <li>· 교환/반품: 구매확정 이전 공급사 협의를 통해 신청 가능</li>
                  <li>· 교환/반품 불가: 택 제거·착용 흔적·세탁/향수 냄새 등 상품 가치 훼손 시, 모니터 색상 차이, 시간 경과 개봉 상품</li>
                  <li>· 표기 광고 내용과 상이한 상품은 전자상거래법에 따라 청약철회 가능</li>
                </ul>
              </div>

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
