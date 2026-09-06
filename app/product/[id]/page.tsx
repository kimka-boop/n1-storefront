"use client";

/**
 * N°1 — Product Detail Experience V1 (/product/[id])
 * 설계: N1_PRODUCT_DETAIL_EXPERIENCE_V1.md · 구현: N1_ZCODE_IMPLEMENTATION_HANDOFF.md
 * Scene 1 FIRST IMPRESSION → 2 WHY → 3 MATERIAL → 4 FIT → 5 VERIFICATION → 6 DECISION → Facts
 * 규칙: 상품 문구 창작 금지(API + D2 승인 스토리만) · Glass 3용도 한정 · 모션 토큰 준수
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ImageCrop, { CROP_HERO, CROP_FULL, CROP_DETAIL } from "@/components/product/ImageCrop";
import SceneSection from "@/components/product/SceneSection";
import TonePanel from "@/components/product/TonePanel";
import SizeTable from "@/components/product/SizeTable";
import VerificationDrawer, { VerificationItem } from "@/components/product/VerificationDrawer";
import StickyBuyBar from "@/components/product/StickyBuyBar";
import { PRODUCT_STORY } from "@/lib/productContent";
import styles from "./product.module.css";

interface FitInfo {
  thickness: string;
  stretch: string;
  sheer: string;
  lining: string;
  shape: string;
}
interface NoticeInfo {
  manufacturer: string;
  madeAt: string;
  colorSize: string;
  quality: string;
  as: string;
}
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
}

/** 색상 옵션 파싱: "·" 구분 우선(G-50 투톤), 없으면 " / " 구분(W-52 9색, M-51 3색). */
function parseColors(colorOptions?: string[]): string[] {
  if (!colorOptions?.length) return [];
  const flat = colorOptions.join(" · ");
  const parts = flat.includes("·")
    ? flat.split("·")
    : flat.split("/");
  return parts
    .map((s) => s.trim())
    .filter((s) => s && s.toUpperCase() !== "UNKNOWN" && !s.startsWith("UNKNOWN"));
}

/** 시트의 미확정 플레이스홀더("UNKNOWN" 등)는 고객 화면에서 공백 취급한다. */
function clean(value?: string): string {
  const v = (value || "").trim();
  if (!v || v.toUpperCase() === "UNKNOWN") return "";
  return v;
}

function won(price: number): string {
  return new Intl.NumberFormat("ko-KR").format(price) + "원";
}

export default function ProductPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";

  const [product, setProduct] = useState<Product | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const [colors, setColors] = useState<string[]>([]);
  const [selColor, setSelColor] = useState<string | null>(null);
  const [heroVisible, setHeroVisible] = useState(true);
  const heroRef = useRef<HTMLDivElement>(null);
  const decisionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch("/api/products")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (!alive) return;
        const list: Product[] = Array.isArray(data)
          ? (data as Product[])
          : ((data as { products?: Product[] })?.products ?? []);
        const p = list.find((x) => x.id === id) ?? null;
        if (!p) {
          setState("notfound");
          return;
        }
        setProduct(p);
        setState("ready");
        const cs = parseColors(p.colorOptions);
        setColors(cs);
        setSelColor(cs[0] ?? null);
      })
      .catch(() => alive && setState("notfound"));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const el = heroRef.current;
    if (!el || !product) return;
    const io = new IntersectionObserver((entries) => {
      setHeroVisible(entries.some((e) => e.isIntersecting));
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [product]);

  if (state === "loading") {
    return <main className={styles.page}><p className={styles.loading}>불러오는 중</p></main>;
  }
  if (state === "notfound" || !product) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>상품을 찾을 수 없습니다.</p>
        <p className={styles.loading}>
          <Link href="/" className={styles.homeLink}>N°1 홈으로</Link>
        </p>
      </main>
    );
  }

  const soldOut = (product.stockStatus || "").trim() === "품절";
  const story = PRODUCT_STORY[product.id];
  const material = clean(product.material);
  const materialKnown = material !== "";
  const fit = product.fit ?? {};
  const origin = clean(product.origin);
  const manufacturer = clean(product.notice?.manufacturer);
  const washing = clean(product.washingInfo);

  // Scene 5 — 데이터에 있는 확인 항목만 (공백 = 비표시; 창작 금지)
  const verifications: VerificationItem[] = [];
  if (origin)
    verifications.push({ label: "Source checked", fact: `원산지 ${origin} 확인` });
  if (manufacturer)
    verifications.push({ label: "Source checked", fact: `제조사 ${manufacturer} 확인` });
  if (materialKnown)
    verifications.push({ label: "Material verified", fact: "소재 표기 상세 판독으로 확인" });
  if ((product.sizeChart || "").trim())
    verifications.push({ label: "Size confirmed", fact: "치수 실측치 공개" });
  else verifications.push({ label: "Size confirmed", fact: "수치표 미제공 — 착용컷으로 확인" });

  const scrollToDecision = () =>
    decisionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <main className={styles.page}>
      {/* ── Scene 1 FIRST IMPRESSION — 대표컷 + 이름 (가격·CTA 없음) ── */}
      <div ref={heroRef}>
        <SceneSection id="scene1">
          <ImageCrop
            src={product.lookbookImage}
            alt={`${product.id} 착용 대표컷`}
            token={CROP_HERO}
            eager
          />
          <p className={styles.heroKicker}>
            {product.gender || ""} {product.category ? `· ${product.category}` : ""}
          </p>
          <h1 className={styles.heroName}>{product.name}</h1>
        </SceneSection>
      </div>

      {/* ── Scene 2 WHY THIS PRODUCT — D2 승인 Description만 ── */}
      {story ? (
        <SceneSection id="scene2" kicker="Why this product" title="왜 이 상품인가">
          <div className={styles.twoCol}>
            <div>
              <p className={styles.lede}>{story.description}</p>
            </div>
            <ImageCrop
              src={product.lookbookImage}
              alt={`${product.id} 착용컷`}
              token={CROP_FULL}
              className={styles.sideMedia}
            />
          </div>
        </SceneSection>
      ) : null}

      {/* ── Scene 3 MATERIAL — 톤 패널 (텍스처 이미지 금지) ── */}
      <SceneSection id="scene3" kicker="Material" title="소재">
        <div className={styles.twoCol}>
          <ImageCrop
            src={product.lookbookImage}
            alt={`${product.id} 소재 디테일`}
            token={CROP_DETAIL}
            className={styles.sideMedia}
          />
          <div>
            {materialKnown ? (
              <p className={styles.lede}>{material}</p>
            ) : (
              <p className={styles.lede}>소재 정보가 보강 중입니다.</p>
            )}
            <TonePanel fit={fit} />
          </div>
        </div>
      </SceneSection>

      {/* ── Scene 4 FIT — 모델 샷 + 치수 (미제공 분기) ── */}
      <SceneSection id="scene4" kicker="Fit" title="핏">
        <ImageCrop
          src={product.lookbookImage}
          alt={`${product.id} 정면 착용컷`}
          token={CROP_FULL}
        />
        {product.modelInfo ? (
          <p className={styles.lede}>모델 {product.modelInfo}</p>
        ) : null}
        {(product.sizeChart || "").trim() ? (
          <SizeTable raw={product.sizeChart!} />
        ) : (
          <p className={styles.sizeMissing}>
            수치표 미제공 — 착용컷으로 확인하실 수 있습니다.
          </p>
        )}
      </SceneSection>

      {/* ── Scene 5 VERIFICATION — 조용한 확인 기록 (Glass ②) ── */}
      <SceneSection id="scene5" kicker="Verification" title="확인 기록">
        <VerificationDrawer items={verifications} />
      </SceneSection>

      {/* ── Scene 6 DECISION — 옵션 · 가격 · 구매 (Glass ③) ── */}
      <div ref={decisionRef}>
        <SceneSection id="scene6" kicker="Decision" title="구매">
          <div className={styles.optionLayer}>
            {colors.length ? (
              <div className={styles.colorRow} role="radiogroup" aria-label="색상 선택">
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={selColor === c}
                    className={`${styles.colorChip} ${selColor === c ? styles.colorChipOn : ""}`}
                    onClick={() => setSelColor(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}
            <p className={styles.price}>{won(product.price)}</p>
            {soldOut ? (
              <>
                <button type="button" className={styles.cta} disabled>
                  품절
                </button>
                <p className={styles.holdNotice}>
                  공급 확인 정보가 보강 중인 상품입니다.
                </p>
              </>
            ) : (
              <button type="button" className={styles.cta} onClick={scrollToDecision}>
                구매하기
              </button>
            )}
            <p className={styles.colorSize}>{product.notice?.colorSize}</p>
          </div>
        </SceneSection>
      </div>

      {/* ── Facts — 스토리 끝의 사실 ── */}
      <SceneSection id="facts" kicker="Facts">
        <dl className={styles.facts}>
          {materialKnown ? (
            <>
              <dt>소재</dt>
              <dd>{material}</dd>
            </>
          ) : null}
          {washing ? (
            <>
              <dt>세탁 안내</dt>
              <dd>{washing}</dd>
            </>
          ) : null}
          {origin ? (
            <>
              <dt>원산지</dt>
              <dd>{origin}</dd>
            </>
          ) : null}
          {manufacturer ? (
            <>
              <dt>제조사</dt>
              <dd>{manufacturer}</dd>
            </>
          ) : null}
          {product.notice?.quality ? (
            <>
              <dt>교환·반품</dt>
              <dd>{product.notice.quality}</dd>
            </>
          ) : null}
          {product.notice?.as ? (
            <>
              <dt>문의</dt>
              <dd>{product.notice.as}</dd>
            </>
          ) : null}
        </dl>
        <p className={styles.homeLinkWrap}>
          <Link href="/" className={styles.homeLink}>
            N°1 전체 상품 보기
          </Link>
        </p>
      </SceneSection>

      <StickyBuyBar
        name={product.name}
        price={product.price}
        soldOut={soldOut}
        heroVisible={heroVisible}
        onBuy={scrollToDecision}
      />
    </main>
  );
}
