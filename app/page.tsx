"use client";

/**
 * N°1 — 반응형 쇼핑몰
 * 대표이미지: 드라이브 01_full (서버 API로 file_id 조회)
 * 클릭: 구매 상세 + 5장 슬라이드
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
  lookbookStatus: string;
  lookbookImage: string;
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
