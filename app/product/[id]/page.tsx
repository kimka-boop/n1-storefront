"use client";

/**
 * N°1 — Product Detail Experience V2 (/product/[id])
 * 스펙: N1_ASTRA_TO_ZCODE_HANDOFF.md · docs/N1_REDESIGN_MISSION.md
 *
 * V2 변경 (2026-09-08):
 * - 챕터별 실제 샷 바인딩(기존 1장 반복 → 정면/45°/옆면/후면/제품컷, lib/media.ts)
 * - 각도는 수동 선택(자동 회전 금지), 전환은 200ms 크로스페이드
 * - M-51 45° 컷 제외(라운드넥 불일치), W-52 스트립은 1컷만(변환 단계)
 * - purchaseState(ready/choose/soldout/unconfirmed) 기반 정직한 구매 상태 —
 *   재고 데이터가 없으면 구매 가능처럼 보이지 않는다 (미션 §10)
 * - 선택 색상의 원시 값(raw)이 구매 모달까지 전달 (quickBuyUrl)
 * - 소재 영역 AI 이미지 고지(스타일링 참고용)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ImageCrop, { CROP_HERO, CROP_FULL, CROP_DETAIL } from "@/components/product/ImageCrop";
import SceneSection from "@/components/product/SceneSection";
import TonePanel from "@/components/product/TonePanel";
import SizeTable from "@/components/product/SizeTable";
import StickyBuyBar from "@/components/product/StickyBuyBar";
import MaterialComposition from "@/components/MaterialComposition";
import SmartFitFlow from "@/components/SmartFitFlow";
import { useAuth } from "@/components/AuthProvider";
import { useCart } from "@/components/CartProvider";
import { stashBuyNow } from "@/lib/checkout";
import type { CartItem } from "@/lib/cart";
import { PRODUCT_STORY } from "@/lib/productContent";
import { mediaFor } from "@/lib/media";
import { productColors, purchaseState, quickBuyUrl } from "@/lib/experience";
import {
  pdpStockState,
  effectiveBuyState,
  STOCK_LOOKUP_FAILURE_NOTE,
  StockViewLite,
} from "@/lib/stockDisplay";
import { interpretFit, categoryOf } from "@/lib/fit";
import {
  genderKo,
  categoryShort,
  noticeQualityText,
  noticeAsText,
  sizeSummary,
  washingText,
} from "@/lib/display";
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
  sizeOptions?: string[];
  optionStock?: Record<string, number>;
}

function clean(value?: string): string {
  const v = (value || "").trim();
  if (!v || v.toUpperCase() === "UNKNOWN" || v === "상세페이지 참조") return "";
  return v;
}

function won(price: number): string {
  return new Intl.NumberFormat("ko-KR").format(price) + "원";
}

export default function ProductPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params?.id : "";

  const [product, setProduct] = useState<Product | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const [selColor, setSelColor] = useState(""); // 원시(raw) 색상 값
  const [selSize, setSelSize] = useState("");
  const [viewKey, setViewKey] = useState<string>("front");
  const [heroVisible, setHeroVisible] = useState(true);
  const heroRef = useRef<HTMLDivElement>(null);
  const decisionRef = useRef<HTMLDivElement>(null);

  // ── [SESSION H · TASK 11] B 재고 파이프라인(n1.stock.v1) 뷰 — 검증된 값만 표시에 쓴다 ──
  const [stockView, setStockView] = useState<StockViewLite | null>(null);
  const [stockLookupFailed, setStockLookupFailed] = useState(false);

  // ── 나에게 맞게 보기: Smart Fit V2 Fit Context (훅은 early return 이전에 unconditional) ──
  const { fit: authFit } = useAuth();
  const { add: addCartLine, setOpen: setCartOpen } = useCart();
  const router = useRouter();
  const [showFitFlow, setShowFitFlow] = useState(false);
  const [buyQty, setBuyQty] = useState(1);

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
        const colors = productColors(p.colorOptions);
        setSelColor(colors[0]?.value ?? "");
        setSelSize(p.sizeOptions?.length === 1 ? p.sizeOptions[0] : "");
        setBuyQty(1);
      })
      .catch(() => alive && setState("notfound"));
    return () => {
      alive = false;
    };
  }, [id]);

  // ── [SESSION H] /api/stock?sku= 조회 — ok:true + unknown 레코드도 정상(미스테이징)이며,
  //    통신 실패(non-ok·파싱 실패)만 lookup 실패로 별도 truthful fallback 한다 (TASK H7) ──
  const productId = product?.id;
  useEffect(() => {
    if (state !== "ready" || !productId) return;
    let alive = true;
    setStockView(null);
    setStockLookupFailed(false);
    fetch(`/api/stock?sku=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`stock ${r.status}`);
        return r.json() as Promise<{ ok?: boolean; stocks?: Record<string, StockViewLite> }>;
      })
      .then((d) => {
        if (!alive) return;
        if (!d || d.ok !== true || typeof d.stocks !== "object" || d.stocks === null) {
          throw new Error("stock contract");
        }
        setStockView(d.stocks[productId] ?? null); // 미스테이징 sku도 unknown 레코드로 온다
      })
      .catch(() => {
        if (alive) setStockLookupFailed(true); // 조회 실패 — 미확인과 구분되는 안내로만 표시
      });
    return () => {
      alive = false;
    };
  }, [state, productId]);

  useEffect(() => {
    const el = heroRef.current;
    if (!el || !product) return;
    const io = new IntersectionObserver((entries) => {
      setHeroVisible(entries.some((e) => e.isIntersecting));
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [product]);

  // ── [SESSION H · TASK 11] 재고 표시/구매 판정 — B 파이프라인 우선, 시트 폴백.
  //    hooks는 early return 이전에 전부 실행되어야 한다(loading→ready 전환 시 훅 수 불변). ──
  const stockUi = useMemo(
    () => pdpStockState(stockView, stockLookupFailed, selColor, selSize),
    [stockView, stockLookupFailed, selColor, selSize],
  );
  const sheetBuy = useMemo(
    () => (product ? purchaseState(product, selColor, selSize) : ("unconfirmed" as const)),
    [product, selColor, selSize],
  );
  // 사이즈 후보 — 시트 sizeOptions 우선, 재고 파이프라인이 확인한 사이즈로 보완
  const sizeChoices = useMemo(() => {
    const base = product?.sizeOptions ?? [];
    const extra = stockUi.sizes.filter((s) => !base.includes(s));
    return [...base, ...extra];
  }, [product, stockUi]);
  useEffect(() => {
    if (!selSize && sizeChoices.length === 1) setSelSize(sizeChoices[0]);
  }, [selSize, sizeChoices]);
  const maxQty = stockUi.capQty; // 확인된 수량이면 그 값으로 cap — 반드시 실패할 주문을 미리 막는다
  useEffect(() => {
    if (buyQty > maxQty) setBuyQty(maxQty);
  }, [maxQty, buyQty]);

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
  const media = mediaFor(product.id, product.lookbookImage);

  // ── 나에게 맞게 보기: interpretFit 4층 해석 (FACT → CONTEXT → INTERPRETATION →
  //    LIMITATION 순서, lib/fit.ts). 컨텍스트는 AuthProvider가 소유하므로 Scene을
  //    벗어나 돌아와도 즉시 재계산되고, 상품을 바꿔도 설정은 유지된다 (§22). ──
  const fitInput = {
    name: product.name,
    category: product.category,
    fitShape: (product as { fit?: FitInfo }).fit?.shape,
    stretch: (product as { fit?: FitInfo }).fit?.stretch,
    sizeChart: product.sizeChart,
    sizeOptions: product.sizeOptions,
    optionStock: product.optionStock,
    stockStatus: product.stockStatus,
    modelInfo: product.modelInfo,
  };
  const fitCategory = categoryOf({ name: product.name, category: product.category });
  const fitInterp = authFit ? interpretFit(fitInput, authFit) : null;
  const material = clean(product.material);
  const materialKnown = material !== "";
  const fit = product.fit ?? {};
  const origin = clean(product.origin);
  const manufacturer = clean(product.notice?.manufacturer);
  const washing = washingText(product.washingInfo);
  const sizes = sizeSummary(product.sizeChart);
  const genderLabel = genderKo(product.gender);
  const categoryLabel = categoryShort(product.category);

  const colors = productColors(product.colorOptions); // {value: 원시, label: 표시}
  const activeView = media?.views.find((v) => v.key === viewKey) ?? media?.views[0];
  const effBuy = effectiveBuyState(sheetBuy, stockUi, sizeChoices, selSize);

  // ── 구매 (미션 §6): 장바구니에 담기 / 바로 구매 — 원시 옵션 값 그대로 전달 (미션 §8) ──
  const variantStockSnap =
    stockUi.count ??
    (typeof product.optionStock?.[selColor && selSize ? `${selColor}_${selSize}` : selSize] === "number"
      ? product.optionStock![selColor && selSize ? `${selColor}_${selSize}` : selSize]
      : null);
  const buildCartItem = (): CartItem => ({
    sku: product.id,
    name: product.name,
    color: selColor, // 원시 값 (표시 라벨과 분리)
    size: selSize,
    qty: buyQty,
    unit_price: product.price,
    image: media?.front,
    stock_snapshot: variantStockSnap,
  });
  const handleAddToCart = () => {
    addCartLine(buildCartItem());
    setCartOpen(true); // 담기 즉시 카트 경험 오픈
  };
  const handleBuyNow = () => {
    stashBuyNow(buildCartItem()); // 현재 선택만 — 카트의 다른 상품 미포함
    router.push("/checkout");
  };

  const scrollToDecision = () =>
    decisionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const openCs = () => window.dispatchEvent(new Event("n1:open-cs"));

  return (
    <main className={styles.page}>
      {/* ── Scene 1 FIRST IMPRESSION — 정면샷 대표 크롭 (높이 상한: 이름이 첫 화면에) ── */}
      <div ref={heroRef}>
        <SceneSection id="scene1">
          <div className={styles.heroCap}>
            {media ? (
              <ImageCrop
                src={media.front}
                alt={`${product.id} 착용 대표컷`}
                token={CROP_HERO}
                eager
              />
            ) : (
              <div className={styles.heroEmpty}>이미지 준비 중</div>
            )}
          </div>
          <p className={styles.heroKicker}>
            {[genderLabel, categoryLabel].filter(Boolean).join(" · ")}
          </p>
          <h1 className={styles.heroName}>{product.name}</h1>
        </SceneSection>
      </div>

      {/* ── Scene 2 WHY + VIEWPOINTS — 서사 + 각도는 수동 선택 ── */}
      <SceneSection id="scene2" kicker="Why this product" title="왜 이 상품인가">
        <div className={styles.twoCol}>
          <div>
            {story ? (
              <p className={styles.lede}>{story.description}</p>
            ) : (
              <p className={styles.lede}>{product.name}</p>
            )}
            {media && media.views.length > 1 ? (
              <div className={styles.viewBlock}>
                <div className={styles.viewStage} aria-live="polite">
                  <ImageCrop
                    key={activeView?.key}
                    src={activeView?.src ?? ""}
                    alt={`${product.id} ${activeView?.label ?? ""} 착용컷`}
                    token={CROP_FULL}
                    className={styles.viewFade}
                  />
                </div>
                <div className={styles.viewRow} role="tablist" aria-label="각도 선택">
                  {media.views.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      role="tab"
                      aria-selected={viewKey === v.key}
                      className={`${styles.viewBtn} ${viewKey === v.key ? styles.viewBtnOn : ""}`}
                      onClick={() => setViewKey(v.key)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                {media.unavailableNote ? (
                  <p className={styles.viewNote}>{media.unavailableNote}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </SceneSection>

      {/* ── Scene 3 MATERIAL — 제품 단독컷 + 소재 구성 + 톤 패널 ── */}
      <SceneSection id="scene3" kicker="Material" title="소재">
        <div className={styles.twoCol}>
          {media?.productOnly ? (
            <ImageCrop
              src={media.productOnly}
              alt={`${product.id} 제품 단독 컷`}
              token={CROP_DETAIL}
              className={styles.sideMedia}
            />
          ) : (
            <ImageCrop
              src={media?.front ?? ""}
              alt={`${product.id} 소재 디테일`}
              token={CROP_DETAIL}
              className={styles.sideMedia}
            />
          )}
          <div>
            {materialKnown ? (
              <div className={styles.materialBlock}>
                <MaterialComposition material={material} />
              </div>
            ) : (
              <p className={styles.lede}>소재 정보가 보강 중입니다.</p>
            )}
            <TonePanel fit={fit} />
            {media && (
              <p className={styles.aiDisclosure}>
                이미지는 스타일링 참고용 AI 컷입니다 — 실측·소재는 표기 정보로 확인해 주세요.
              </p>
            )}
          </div>
        </div>
      </SceneSection>

      {/* ── Scene 4 FIT — 정면 전신 실루엣 + 치수 ── */}
      <SceneSection id="scene4" kicker="Fit" title="핏">
        {media ? (
          <ImageCrop
            src={media.front}
            alt={`${product.id} 정면 착용컷`}
            token={CROP_FULL}
          />
        ) : null}
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
        {/* 개인 해석층 — 상품 사실(위) 아래에서 FACT → CONTEXT → INTERPRETATION →
            LIMITATION 순서 유지. 결과는 상품 설명을 대체하지 않는다 (§21) */}
        {fitInterp && fitInterp.evidence !== "UNAVAILABLE" ? (
          <div className={styles.yourFit}>
            <p className={styles.yourFitKicker}>Your fit</p>
            <p className={styles.yourFact}>{fitInterp.productFact}</p>
            <p className={styles.yourFitNote}>내 설정 — {fitInterp.yourContext}</p>
            <p className={styles.yourFitText}>{fitInterp.interpretation}</p>
            {fitInterp.sizeHint ? <p className={styles.yourFitNote}>{fitInterp.sizeHint}</p> : null}
            <p className={styles.yourFitNote}>{fitInterp.limitation}</p>
            <button className={styles.yourFitEntry} style={{ marginTop: 14 }} onClick={() => setShowFitFlow(true)}>
              수정하기 →
            </button>
          </div>
        ) : fitInterp ? (
          <div className={styles.yourFit}>
            <p className={styles.yourFitKicker}>Your fit</p>
            <p className={styles.yourFitText}>{fitInterp.interpretation}</p>
            <button className={styles.yourFitEntry} style={{ marginTop: 14 }} onClick={() => setShowFitFlow(true)}>
              스마트 핏 →
            </button>
          </div>
        ) : (
          <button className={styles.yourFitEntry} onClick={() => setShowFitFlow(true)}>
            스마트 핏 →
          </button>
        )}
      </SceneSection>

      {showFitFlow && (
        <SmartFitFlow
          onClose={() => setShowFitFlow(false)}
          product={fitInput}
          needCategory={fitCategory === "bottom" ? "bottom" : "top"}
        />
      )}

      {/* ── Scene 5 INFO — 확인된 정보의 조용한 요약 ── */}
      <SceneSection id="scene5" kicker="Info" title="핵심 정보">
        <dl className={styles.facts}>
          {materialKnown ? (
            <>
              <dt>소재 구성</dt>
              <dd><MaterialComposition material={material} /></dd>
            </>
          ) : null}
          {sizes ? (
            <>
              <dt>치수</dt>
              <dd>{sizes}{(product.sizeChart || "").trim() ? " — 위 표 참조" : ""}</dd>
            </>
          ) : (
            <>
              <dt>치수</dt>
              <dd>수치표 미제공 — 착용컷으로 확인</dd>
            </>
          )}
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
        </dl>
      </SceneSection>

      {/* ── Scene 6 DECISION — 옵션 · 상태 · 구매 (Glass ③ — 불투명 패널) ── */}
      <div ref={decisionRef}>
        <SceneSection id="scene6" kicker="Decision" title="구매">
          <div className={styles.optionLayer}>
            {colors.length ? (
              <div className={styles.colorRow} role="radiogroup" aria-label="색상 선택">
                {colors.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={selColor === c.value}
                    className={`${styles.colorChip} ${selColor === c.value ? styles.colorChipOn : ""}`}
                    onClick={() => setSelColor(c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            ) : null}
            {sizeChoices.length ? (
              <div className={styles.sizeRow} role="radiogroup" aria-label="사이즈 선택">
                {sizeChoices.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={selSize === s}
                    className={`${styles.sizeChip} ${selSize === s ? styles.colorChipOn : ""}`}
                    onClick={() => setSelSize(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
            {/* [SESSION H · TASK 11] 검증된 숫자 옵션 재고만 표시 — 작고 조용한 metadata.
                binary/unknown/stale은 countLabel이 null — 숫자를 만들지 않는다 (TASK H2·H3). */}
            {stockUi.countLabel ? (
              <p className={styles.stockCount}>{stockUi.countLabel}</p>
            ) : null}
            <p className={styles.price}>{won(product.price)}</p>

            {effBuy === "soldout" || soldOut ? (
              <>
                <button type="button" className={styles.cta} disabled>품절</button>
                <p className={styles.holdNotice}>공급 확인 정보가 보강 중인 상품입니다.</p>
              </>
            ) : effBuy === "choose" ? (
              <button type="button" className={styles.cta} disabled>옵션을 선택해 주세요</button>
            ) : effBuy === "unconfirmed" ? (
              <>
                <button type="button" className={`${styles.cta} ${styles.ctaQuiet}`} onClick={openCs}>
                  재고 확인 후 구매 가능
                </button>
                {/* [SESSION H · TASK 14] 정상 재고 파이프라인(조회 성공)에서는 기존 "옵션 재고가
                    확인 중입니다…" copy를 내보내지 않는다. 조회 실패(lookup failure)일 때만
                    별도의 truthful fallback — 실패 사실을 실패대로 말한다. */}
                {stockUi.lookup === "failed" ? (
                  <p className={styles.holdNotice}>{STOCK_LOOKUP_FAILURE_NOTE}</p>
                ) : null}
              </>
            ) : (
              <>
                <div className={styles.qtyRow} role="group" aria-label="수량 선택">
                  <button
                    type="button"
                    className={styles.qtyBtn}
                    onClick={() => setBuyQty((q) => Math.max(1, q - 1))}
                    disabled={buyQty <= 1}
                    aria-label="수량 줄이기"
                  >
                    −
                  </button>
                  <span className={styles.qtyVal}>{buyQty}</span>
                  <button
                    type="button"
                    className={styles.qtyBtn}
                    onClick={() => setBuyQty((q) => Math.min(maxQty, q + 1))}
                    disabled={buyQty >= maxQty}
                    aria-label="수량 늘리기"
                  >
                    ＋
                  </button>
                  <span className={styles.qtyTotal}>{won(product.price * buyQty)}</span>
                </div>
                <div className={styles.buyRow}>
                  <button type="button" className={styles.cta} onClick={handleAddToCart}>
                    장바구니에 담기
                  </button>
                  <button type="button" className={`${styles.cta} ${styles.ctaBuyNow}`} onClick={handleBuyNow}>
                    바로 구매
                  </button>
                </div>
              </>
            )}
            {clean(product.notice?.colorSize) ? (
              <p className={styles.colorSize}>{clean(product.notice?.colorSize)}</p>
            ) : null}
          </div>
        </SceneSection>
      </div>

      {/* ── 상품 정보 ── */}
      <SceneSection id="facts" kicker="Info" title="상품 정보">
        <dl className={styles.facts}>
          {materialKnown ? (
            <>
              <dt>소재</dt>
              <dd><MaterialComposition material={material} /></dd>
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
              <dd>{noticeQualityText(product.notice.quality)}</dd>
            </>
          ) : null}
          {product.notice?.as ? (
            <>
              <dt>문의</dt>
              <dd>{noticeAsText(product.notice.as)}</dd>
            </>
          ) : null}
        </dl>
        <p className={styles.homeLinkWrap}>
          {/* SESSION F §4: '전체 상품 보기'는 항상 '전체' 컬렉션 — 저장된 탭(남성 등)보다 ?tab=all이 이긴다 */}
          <Link href="/?tab=all" className={styles.homeLink}>
            N°1 전체 상품 보기
          </Link>
        </p>
      </SceneSection>

      <StickyBuyBar
        name={product.name}
        price={product.price}
        soldOut={soldOut || effBuy === "soldout"}
        heroVisible={heroVisible}
        onBuy={scrollToDecision}
      />

      {/* ── 페어 컨텍스트 — 구매 뒤, 조용한 추천 (§52: CTA 앞에서 강요하지 않는다) ── */}
      <PairSuggestion productId={product.id} />
    </main>
  );
}

interface CatalogPairInfo {
  pairId: string;
  collectionScope: string;
  topProductId: string;
  bottomProductId: string;
  pairReasonShort: string;
}

/** 함께 추천된 페어 — 사전 계산된 mapping만 읽는다 (§37·§47). 스코어 노출 금지(§40). */
function PairSuggestion({ productId }: { productId: string }) {
  const [suggestion, setSuggestion] = useState<{
    productId: string;
    name: string;
    price: number;
    gender?: string;
    image: string | null;
    reason: string;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/products", { cache: "no-store" });
        const data = await res.json();
        if (!data.ok || !alive) return;
        const products: Product[] = data.products || [];
        const pairs: CatalogPairInfo[] = data.pairs || [];
        const pair = pairs.find(
          (p) => p.topProductId === productId || p.bottomProductId === productId
        );
        if (!pair) return;
        const otherId = pair.topProductId === productId ? pair.bottomProductId : pair.topProductId;
        const other = products.find((p) => p.id === otherId);
        if (!other) return;
        const img = mediaFor(other.id, other.lookbookImage)?.front || null;
        setSuggestion({
          productId: other.id,
          name: other.name,
          price: other.price,
          gender: other.gender,
          image: img,
          reason: pair.pairReasonShort,
        });
      } catch {
        /* 페어 제안은 실패해도 조용히 사라진다 — 구매 흐름을 방해하지 않는다 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [productId]);

  if (!suggestion) return null;
  return (
    <SceneSection id="pair" kicker="Styled with" title="함께 보기">
      <Link href={`/product/${suggestion.productId}`} className={styles.pairLink} data-reveal>
        {suggestion.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={suggestion.image} alt={`${suggestion.name} 이미지`} loading="lazy" className={styles.pairImage} />
        ) : (
          <span className={styles.pairImageEmpty}>이미지 준비 중</span>
        )}
        <span className={styles.pairInfo}>
          <span className={styles.pairName}>{suggestion.name}</span>
          <span className={styles.pairPrice}>₩{suggestion.price.toLocaleString("ko-KR")}</span>
          {suggestion.reason ? <span className={styles.pairReason}>{suggestion.reason}</span> : null}
        </span>
      </Link>
    </SceneSection>
  );
}
