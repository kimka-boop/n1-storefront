"use client";

/**
 * TonePanel — 소재 물성 4지표를 톤 온도로 표현 (게이지 바·텍스처 이미지 금지).
 * MATERIAL 원칙: 물성은 "빛 받는 방식" — 저대비 단색 2톤 단차로만.
 * 데이터에 없는 지표는 숨기지 않고 "정보 없음" 중립 패널로.
 */
import styles from "@/app/product/[id]/product.module.css";

type Level = 0 | 1 | 2 | null; // 0=왼쪽 성질, 2=오른쪽 성질, null=정보 없음

interface Metric {
  label: string;
  left: string;
  right: string;
  level: Level;
  caption: string;
}

/** 값 → 톤 레벨 매핑. 알 수 없는 값은 null(정보 없음)로 처리 — 재단 금지. */
function mapLevel(field: string, value: string): Level {
  const v = (value || "").trim();
  if (!v || v === "UNKNOWN") return null;
  if (field === "thickness") {
    if (/도톰|기모|두께/.test(v) && /두께감|도톰/.test(v)) return 2;
    if (/얇/.test(v)) return 0;
    if (/보통/.test(v)) return 1;
    return null;
  }
  if (field === "stretch") {
    if (/좋음|높음|신축/.test(v)) return 2;
    if (/없음|거의 없|고정/.test(v)) return 0;
    if (/보통|약간/.test(v)) return 1;
    return null;
  }
  if (field === "sheer") {
    if (/없음/.test(v)) return 0;
    if (/있음|약간/.test(v)) return 2;
    return null;
  }
  if (field === "lining") {
    if (/없음/.test(v)) return 0;
    if (/있음/.test(v)) return 2;
    return null;
  }
  return null;
}

export default function TonePanel({
  fit,
}: {
  fit: { thickness?: string; stretch?: string; sheer?: string; lining?: string };
}) {
  const metrics: Metric[] = [
    {
      label: "두께감",
      left: "얇은 공기",
      right: "도톰한 여유",
      level: mapLevel("thickness", fit.thickness || ""),
      caption: fit.thickness || "정보 없음",
    },
    {
      label: "신축성",
      left: "고정된 실루엣",
      right: "흐르는 신축",
      level: mapLevel("stretch", fit.stretch || ""),
      caption: fit.stretch || "정보 없음",
    },
    {
      label: "비침",
      left: "밀실",
      right: "시원한 개방",
      level: mapLevel("sheer", fit.sheer || ""),
      caption: fit.sheer || "정보 없음",
    },
    {
      label: "안감",
      left: "얇은 한 겹",
      right: "있음",
      level: mapLevel("lining", fit.lining || ""),
      caption: fit.lining || "정보 없음",
    },
  ];

  return (
    <div className={styles.toneGrid}>
      {metrics.map((m) => (
        <div key={m.label} className={styles.toneCell}>
          <p className={styles.toneLabel}>{m.label}</p>
          <div
            className={styles.toneScale}
            role="img"
            aria-label={`${m.label}: ${m.caption}`}
          >
            {[0, 1, 2].map((lv) => (
              <span
                key={lv}
                className={`${styles.toneStep} ${
                  m.level === null
                    ? styles.toneUnknown
                    : lv === m.level
                      ? styles.toneActive
                      : styles.toneRest
                }`}
              />
            ))}
          </div>
          <p className={styles.toneCaption}>{m.caption}</p>
        </div>
      ))}
    </div>
  );
}
