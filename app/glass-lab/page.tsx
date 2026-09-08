"use client";
/**
 * N°1 GLASS MATERIAL LAB — dev-only (2026-09-09)
 * 미션: 재질 3종(A Clear/B Water/C Perfume)을 배경 4종 위에서 동시 비교.
 * 프로덕션 storefront와 격리 — 내비 연결 없음, 프로덕션 CSS 무변경.
 *
 * §5: 탭 렌즈 폭은 텍스트가 아니라 "탭 중심 midpoint 사이 zone"의 70~85%.
 * §17: 채움이 아니라 엣지/배경 반응으로 유리를 인식시키는지 스크린샷으로 판정.
 */
import { useEffect, useRef, useState } from "react";
import styles from "./glass-lab.module.css";

const TABS = ["N°1", "전체", "남성", "여성", "젠더리스"];
const MATERIALS = ["clear", "water", "perfume"] as const;
type Material = (typeof MATERIALS)[number];
const MAT_KO: Record<Material, string> = {
  clear: "A — Clear Optical Lens",
  water: "B — Soft Water Lens",
  perfume: "C — Perfume Glass Lens",
};

/** §5 — 탭 중심 midpoint 사이 zone 폭 계산 (렌즈 = zone의 지정 비율).
 *  렌즈 자신은 계산 대상에서 제외하며, 위치는 트랙 기준 offsetLeft/offsetWidth로 산출. */
function tabZones(track: HTMLElement): { left: number; width: number }[] {
  const labels = Array.from(track.querySelectorAll<HTMLElement>("[data-tablabel]"));
  const trackW = track.clientWidth;
  const centers = labels.map((c) => c.offsetLeft + c.offsetWidth / 2);
  return centers.map((c, i) => {
    const prevC = i > 0 ? centers[i - 1] : 0;
    const nextC = i < centers.length - 1 ? centers[i + 1] : trackW;
    const zoneL = (prevC + c) / 2;
    const zoneR = (c + nextC) / 2;
    const zone = zoneR - zoneL;
    const ratio = 0.78; // zone의 78% 점유
    const w = Math.max(56, zone * ratio);
    return { left: c - w / 2, width: w };
  });
}

function TabZoneDemo({ material }: { material: Material }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(1); // "전체"
  const [placed, setPlaced] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const place = () => {
      const track = trackRef.current;
      if (!track) return;
      const z = tabZones(track)[active];
      if (z && Number.isFinite(z.width) && z.width > 0) setPlaced(z);
    };
    place();
    const t1 = setTimeout(place, 350);
    const t2 = setTimeout(place, 1200);
    if (document.fonts?.ready) document.fonts.ready.then(place).catch(() => {});
    const ro = new ResizeObserver(place);
    ro.observe(document.documentElement);
    ro.observe(trackRef.current!);
    return () => { clearTimeout(t1); clearTimeout(t2); ro.disconnect(); };
  }, [active]);

  return (
    <div
      ref={trackRef}
      className={styles.tabDemo}
      style={{ cursor: "pointer" }}
      onClick={(e) => {
        const labels = Array.from(trackRef.current?.querySelectorAll("[data-tablabel]") ?? []);
        const idx = labels.findIndex((l) => l.contains(e.target as Node));
        if (idx >= 0) setActive(idx);
      }}
    >
      {placed && (
        <span
          className={`${styles.lens} ${styles[material]} ${styles.demoLens}`}
          aria-hidden="true"
          style={{ width: placed.width, transform: `translate3d(${placed.left}px, 0, 0)` }}
        />
      )}
      {TABS.map((t, i) => (
        <span key={t} data-tablabel className={`${styles.tabLabel} ${i === active ? styles.on : ""}`}>{t}</span>
      ))}
    </div>
  );
}

function SmartFitDemo({ material }: { material: Material }) {
  const [fit, setFit] = useState("B");
  return (
    <div className={styles.sfBg}>
      <div className={`${styles.sfSurface} ${styles[material]}`}>
        <p className={styles.sfKicker}>Smart Fit — 1 / 3</p>
        <p className={styles.sfQ}>어떤 핏을 좋아하세요?</p>
        <div className={styles.sfOpts}>
          {[
            { v: "A", t: "슬림 · 정핏", d: "깔끔하게 닿는 실루엣" },
            { v: "B", t: "정사이즈 · 세미오버", d: "이너는 정핏, 겉옷은 여유" },
            { v: "C", t: "여유롭게 · 오버", d: "전체적으로 넉넉한 실루엣" },
          ].map((o) => (
            <button key={o.v} type="button" className={`${styles.sfOpt} ${fit === o.v ? styles.on : ""}`} onClick={() => setFit(o.v)}>
              {fit === o.v && <span className={styles.sfOptDensity} aria-hidden="true" />}
              {o.t}
              <span>{o.d}</span>
            </button>
          ))}
        </div>
        <button className={styles.sfNext} type="button">다음 →</button>
      </div>
    </div>
  );
}

export default function GlassLabPage() {
  const img = "/editorial-media/PRD-M-51/01_front.jpg";
  return (
    <main className={styles.lab}>
      <header className={styles.labHeader}>
        <h1 className={styles.labTitle}>N°1 — GLASS MATERIAL LAB</h1>
        <p className={styles.labNote}>
          dev-only · 프로덕션 미연동. 재질 3종(A Clear / B Water / C Perfume) × 배경 4종
          (단색 / 선 / 타이포 / 이미지) 동시 비교. 채움이 아니라 엣지·배경 반응으로 유리를 인식.
        </p>
      </header>

      {/* ── 1. 배경 4종 × 3재질 렌즈 ── */}
      <section>
        <h2 className={styles.labSectionTitle}>1 — Lens over 4 backgrounds (blank / line / type / image)</h2>
        <div className={styles.zones}>
          {(["blank", "line", "type", "img"] as const).map((kind) => (
            <div key={kind} className={`${styles.zone} ${styles[kind === "img" ? "img" : kind]}`}>
              <span className={styles.zoneTag}>
                {kind === "blank" ? "BLANK" : kind === "line" ? "LINE" : kind === "type" ? "TYPOGRAPHY" : "IMAGE"}
              </span>
              {kind === "img" && <img src={img} alt="" aria-hidden="true" />}
              {MATERIALS.map((m, i) => (
                <span
                  key={m}
                  className={`${styles.lens} ${styles[m]}`}
                  style={{ left: `${8 + i * 30}%`, top: "22%", width: "24%", height: "56%" }}
                />
              ))}
            </div>
          ))}
        </div>
        <p className={styles.guide}>
          판정: (1) 채움 없이 엣지·배경 반응으로 유리가 인식되는가 (2) 선·글자가 렌즈 뒤에서
          살짝 다른 밀도로 보이는가 (3) 이미지 위에서 효과가 상품보다 약한가.
        </p>
      </section>

      {/* ── 2. 카테고리 렌즈 — zone 기반, 재질별 ── */}
      <section className={styles.labSection}>
        <h2 className={styles.labSectionTitle}>2 — Category lens over tab interaction zones (midpoint × 78%)</h2>
        {MATERIALS.map((m) => (
          <TabZoneDemo key={m} material={m} />
        ))}
        <p className={styles.guide}>
          탭(텍스트)은 내비 레이어에 존재하고, 렌즈는 별도 optical object로 위를 지난다.
          짧은 탭("전체")도 zone 점유로 쪼그라들지 않는다. 탭 클릭 시 렌즈가 이동(zone 재계산).
        </p>
      </section>

      {/* ── 3. 플로팅 오브 3종 — blank + image 위 ── */}
      <section className={styles.labSection}>
        <h2 className={styles.labSectionTitle}>3 — Floating orb (blank / image)</h2>
        <div className={styles.orbRow}>
          {MATERIALS.map((m) => (
            <div key={m} style={{ textAlign: "center" }}>
              <span className={`${styles.orb} ${styles[m]}`} style={{ background: "#fbfaf7" }}>
                <span className={`${styles.orb} ${styles[m]}`} style={{ position: "absolute", inset: 0 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M8 11V7a4 4 0 118 0v4M5 11h14l-1 9H6l-1-9z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </span>
              <div style={{ fontSize: 9, color: "#a19d92", marginTop: 6, letterSpacing: "0.1em" }}>{m.toUpperCase()}</div>
            </div>
          ))}
          {MATERIALS.map((m) => (
            <div key={m + "i"} style={{ textAlign: "center", position: "relative", width: 52, height: 72 }}>
              <img src={img} alt="" aria-hidden="true"
                style={{ position: "absolute", inset: 0, width: 52, height: 52, objectFit: "cover", borderRadius: "50%" }} />
              <span className={`${styles.orb} ${styles[m]}`} style={{ position: "absolute", inset: 0 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M8 11V7a4 4 0 118 0v4M5 11h14l-1 9H6l-1-9z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div style={{ fontSize: 9, color: "#a19d92", position: "absolute", top: 58, width: 60, letterSpacing: "0.1em" }}>on {m.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 4. 스마트핏 단일 표면 — 뒤 컨텍스트 보존 ── */}
      <section className={styles.labSection}>
        <h2 className={styles.labSectionTitle}>4 — Smart Fit surface (one continuous surface, context behind)</h2>
        <div className={styles.sfRow}>
          {MATERIALS.map((m) => (
            <SmartFitDemo key={m} material={m} />
          ))}
        </div>
        <p className={styles.guide}>
          표면 뒤 텍스트·선·이미지가 보여야 한다. 옵션은 별도 카드가 아니라 재질 밀도
          (.sfOptDensity)가 이동. CTA는 solid black 대신 재질 family의 고밀도 상태.
        </p>
      </section>

      {/* ── 5. Active 상태 스펙 기록 (§20 — 이번 미션에서 수정 안 함) ── */}
      <section className={styles.labSection}>
        <h2 className={styles.labSectionTitle}>5 — Active state spec (기록 전용, production 미수정)</h2>
        <p className={styles.guide}>
          첫 진입: active = 전체, 렌즈 = 전체 zone. N°1 탭은 라우트가 "/"일 때만 active.
          현재 구현은 genderTab이 "home"으로 저장되면 첫 collection 화면에서 N°1이 active로
          표시될 수 있음(원인: changeTab("home")이 localStorage에 home 저장 → 재방문 시 복원).
          이번 미션에서는 수정하지 않고 기록만.
        </p>
      </section>
    </main>
  );
}
