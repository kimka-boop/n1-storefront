"use client";

/**
 * N°1 — 반응형 쇼핑몰 (시트 실시간 연동 + Lookbook 슬라이드 + 구매 페이지)
 * 이미지 소스: 구글 드라이브 (오프라인 대비 로컬 폴백 없음 — 배포 환경 공통)
 */
import { useEffect, useState, useCallback } from "react";

interface Product {
  id: string;
  name: string;
  category: string;
  supplier: string;
  supplierUrl: string;
  price: number;
  stockStatus: string;
  lookbookImage: string; // drive folder URL
  lookbookStatus?: string;
  lookbookDrive?: string;
  lookbookLocal?: string;
}

const SHOT_FILES = ["01_full.jpg", "02_45deg.jpg", "03_90deg.jpg", "04_back.jpg", "05_product.png"];
const SHOT_LABELS = ["전체샷", "45도", "90도", "후면", "제품만"];

function folderIdFromUrl(url: string): string | null {
  const m = url.match(/drive\.google\.com\/drive\/folders\/([\w-]+)/);
  return m ? m[1] : null;
}

function driveImgUrl(fileId: string, w = 800) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${w}`;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [slide, setSlide] = useState(0);
  const [slideIds, setSlideIds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setProducts(data.products);
        setError("");
      } else setError(data.error || "시트 조회 실패");
    } catch {
      setError("서버 연결 실패");
    }
  }, []);

  useEffect(() => {
    fetchProducts();
    const t = setInterval(fetchProducts, 30_000);
    return () => clearInterval(t);
  }, [fetchProducts]);

  // 스크롤 리빌 애니메이션
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

  // 상세 열기: 드라이브 폴더의 5장 file_id 조회
  const openDetail = useCallback(async (p: Product) => {
    const fid = folderIdFromUrl(p.lookbookImage);
    if (!fid) return;
    try {
      const res = await fetch(`/api/lookbook-files?folder=${fid}`);
      const data = await res.json();
      if (data.ok) {
        // 파일명 순서대로 정렬 (01→05)
        const order: Record<string, number> = { "01_full": 1, "02_45deg": 2, "03_90deg": 3, "04_back": 4, "05_product": 5 };
        const sorted = data.files.sort((a: any, b: any) => (order[a.name.replace(/\.\w+$/, "")] || 9) - (order[b.name.replace(/\.\w+$/, "")] || 9));
        setSlideIds(sorted.map((f: any) => f.id));
        setSelected(p);
        setSlide(0);
      }
    } catch {
      // 폴백 없음
    }
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
          const fid = folderIdFromUrl(p.lookbookImage);
          const thumb = fid ? `https://drive.google.com/thumbnail?id=${fid}&sz=w600` : null;
          const ready = p.lookbookStatus === "생성완료" && fid;
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
                <div className="placeholder"><span>PREPARING</span></div>
              )}
              <div className="card-body">
                <p className="category">{p.category}</p>
                <h2>{p.name}</h2>
                <p className="price">₩{p.price.toLocaleString("ko-KR")}</p>
                <div className="card-foot">
                  <span className="stock">{p.stockStatus}</span>
                  {p.supplierUrl && (
                    <a className="supplier" href={p.supplierUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      SUPPLIER ↗
                    </a>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {/* ── 구매 상세 모달 ── */}
      {selected && (
        <div className="modal" onClick={closeDetail}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeDetail}>✕</button>
            <div className="slider">
              {slideIds[slide] && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={slide}
                  src={driveImgUrl(slideIds[slide], 1000)}
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
              <div className="thumbs">
                {slideIds.map((fid, n) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={fid}
                    src={driveImgUrl(fid, 200)}
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
