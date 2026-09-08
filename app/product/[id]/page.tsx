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
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ImageCrop, { CROP_HERO, CROP_FULL, CROP_DETAIL } from "@/components/product/ImageCrop";
import SceneSection from "@/components/product/SceneSection";
import TonePanel from "@/components/product/TonePanel";
import SizeTable from "@/components/product/SizeTable";
import StickyBuyBar from "@/components/product/StickyBuyBar";
import MaterialComposition from "@/components/MaterialComposition";
import SmartFitFlow from "@/components/SmartFitFlow";
import { useAuth } from "@/components/AuthProvider";
import { PRODUCT_STORY } from "@/lib/productContent";
import { mediaFor } from "@/lib/media";
import { productColors, purchaseState, quickBuyUrl } from "@/lib/experience";
import { fitGuidance, type FitProfile } from "@/lib/fit";
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

  // ── 나에게 맞게 보기: 핏 개인화 (훅은 early return 이전에 unconditional) ──
  const { profile: authProfile, token: authToken, login: authLogin, updateProfile: authUpdateProfile } = useAuth();
  const [showFitFlow, setShowFitFlow] = useState(false);

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
  const media = mediaFor(product.id, product.lookbookImage);

  // ── 나에게 맞게 보기: 핏 개인화 해석 (FACT → PREFERENCE 순서, lib/fit.ts) ──
  const guidance = fitGuidance(
    { name: product.name, fitShape: (product as { fit?: FitInfo }).fit?.shape, sizeChart: product.sizeChart },
    authProfile as FitProfile | null,
  );
  const saveFitProfile = (p: FitProfile) => {
    localStorage.setItem("n1_fit_profile", JSON.stringify(p));
    if (authToken) authUpdateProfile(p);
  };
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
  const buy = purchaseState(product, selColor, selSize);

  const goToQuickBuy = () =>
    window.location.assign(quickBuyUrl(product.id, selColor, selSize));
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
        {/* 개인 해석층 — 상품 사실(위) 아래에서 '취향 기준'임을 분리해 전달 */}
        {guidance ? (
          <div className={styles.yourFit}>
            <p className={styles.yourFitKicker}>Your preference</p>
            <p className={styles.yourFact}>{guidance.fact}</p>
            <p className={styles.yourFitText}>{guidance.preference}</p>
            <p className={styles.yourFitNote}>{guidance.note}</p>
            <button className={styles.yourFitEntry} style={{ marginTop: 14 }} onClick={() => setShowFitFlow(true)}>
              수정하기 →
            </button>
          </div>
        ) : (
          <button className={styles.yourFitEntry} onClick={() => setShowFitFlow(true)}>
            나에게 맞게 보기 →
          </button>
        )}
      </SceneSection>

      {showFitFlow && (
        <SmartFitFlow
          initial={authProfile as FitProfile | null}
          isLoggedIn={Boolean(authToken)}
          onSave={saveFitProfile}
          onAuthed={(token, email, profile) => {
            authLogin(token, email, profile);
          }}
          onClose={() => setShowFitFlow(false)}
          product={{ name: product.name, fitShape: product.fit?.shape, sizeChart: product.sizeChart }}
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
            {product.sizeOptions?.length ? (
              <div className={styles.sizeRow} role="radiogroup" aria-label="사이즈 선택">
                {product.sizeOptions.map((s) => (
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
            <p className={styles.price}>{won(product.price)}</p>

            {buy === "soldout" || soldOut ? (
              <>
                <button type="button" className={styles.cta} disabled>품절</button>
                <p className={styles.holdNotice}>공급 확인 정보가 보강 중인 상품입니다.</p>
              </>
            ) : buy === "choose" ? (
              <button type="button" className={styles.cta} disabled>옵션을 선택해 주세요</button>
            ) : buy === "unconfirmed" ? (
              <>
                <button type="button" className={`${styles.cta} ${styles.ctaQuiet}`} onClick={openCs}>
                  재고 확인 후 구매 가능
                </button>
                <p className={styles.holdNotice}>
                  옵션 재고가 확인 중입니다 — 고객센터로 문의해 주시면 준비를 도와드립니다.
                </p>
              </>
            ) : (
              <button type="button" className={styles.cta} onClick={goToQuickBuy}>
                구매하기
              </button>
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
          <Link href="/" className={styles.homeLink}>
            N°1 전체 상품 보기
          </Link>
        </p>
      </SceneSection>

      <StickyBuyBar
        name={product.name}
        price={product.price}
        soldOut={soldOut || buy === "soldout"}
        heroVisible={heroVisible}
        onBuy={scrollToDecision}
      />
    </main>
  );
}
