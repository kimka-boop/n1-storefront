/**
 * N°1 Editorial Media — 챕터별 실제 샷 바인딩 (2026-09-08)
 *
 * 출처: n1_md/media_pipeline/runs 기존 생성물을 public/editorial-media/로 압축 복사.
 * (변환 상세와 원본 해시는 public/editorial-media/manifest.json 참조 — 원본 불변)
 *
 * 상품별 주의사항(핸드오프 §9):
 * - PRD-M-51: 02_45deg는 라운드넥으로 확정 정면(V넥)과 불일치 → 각도 시퀀스에서 제외.
 * - PRD-W-52: 05는 1024×4096 4컷 스트립이었음 → 변환 시 첫 프레임(1024×1024)만 선택.
 * - G-50/M-55 원본 모델컷은 발이 잘림 → "전신" 표현 금지, 착용 컷으로만 표기.
 * - AI 이미지는 스타일링 참고용 — 실측·소재 증거 아님(상세 영역에 고지).
 */

export interface ViewShot {
  key: "front" | "deg45" | "side" | "back";
  label: string;
  src: string;
}

export interface ProductMedia {
  front: string;
  views: ViewShot[]; // 사용 가능한 각도만 (M-51은 45° 제외)
  productOnly?: string;
  unavailableNote?: string;
}

const shot = (pid: string, name: string) => `/editorial-media/${pid}/${name}`;

export const EDITORIAL_MEDIA: Record<string, ProductMedia> = {
  "PRD-W-52": {
    front: shot("PRD-W-52", "01_front.jpg"),
    views: [
      { key: "front", label: "정면", src: shot("PRD-W-52", "01_front.jpg") },
      { key: "deg45", label: "45°", src: shot("PRD-W-52", "02_45deg.jpg") },
      { key: "side", label: "옆면", src: shot("PRD-W-52", "03_side.jpg") },
      { key: "back", label: "후면", src: shot("PRD-W-52", "04_back.jpg") },
    ],
    productOnly: shot("PRD-W-52", "05_product.jpg"),
  },
  "PRD-G-50": {
    front: shot("PRD-G-50", "01_front.jpg"),
    views: [
      { key: "front", label: "정면", src: shot("PRD-G-50", "01_front.jpg") },
      { key: "deg45", label: "45°", src: shot("PRD-G-50", "02_45deg.jpg") },
      { key: "side", label: "옆면", src: shot("PRD-G-50", "03_side.jpg") },
      { key: "back", label: "후면", src: shot("PRD-G-50", "04_back.jpg") },
    ],
    productOnly: shot("PRD-G-50", "05_product.jpg"),
  },
  "PRD-M-51": {
    front: shot("PRD-M-51", "01_front.jpg"),
    views: [
      { key: "front", label: "정면", src: shot("PRD-M-51", "01_front.jpg") },
      { key: "side", label: "옆면", src: shot("PRD-M-51", "03_side.jpg") },
      { key: "back", label: "후면", src: shot("PRD-M-51", "04_back.jpg") },
    ],
    productOnly: shot("PRD-M-51", "05_product.jpg"),
    unavailableNote: "45° 각도 컷은 확정된 디자인과 일치하지 않아 제공하지 않습니다.",
  },
  "PRD-M-55": {
    front: shot("PRD-M-55", "01_front.jpg"),
    views: [
      { key: "front", label: "정면", src: shot("PRD-M-55", "01_front.jpg") },
      { key: "deg45", label: "45°", src: shot("PRD-M-55", "02_45deg.jpg") },
      { key: "side", label: "옆면", src: shot("PRD-M-55", "03_side.jpg") },
      { key: "back", label: "후면", src: shot("PRD-M-55", "04_back.jpg") },
    ],
    productOnly: shot("PRD-M-55", "05_product.jpg"),
  },
};

/** 상품의 에디토리얼 미디어 — 없으면 API lookbookImage로 폴백 (미생성 상품 등) */
export function mediaFor(pid: string, fallback?: string): ProductMedia | null {
  const m = EDITORIAL_MEDIA[pid];
  if (m) return m;
  const src = (fallback || "").trim();
  // Drive 폴더 링크는 이미지가 아니라 폴더 목록 — img src로 쓰면 깨진다.
  if (!src || /drive\.google\.com\/drive\/folders/.test(src)) return null;
  return {
    front: src,
    views: [{ key: "front", label: "정면", src }],
  };
}
