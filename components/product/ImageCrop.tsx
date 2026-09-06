"use client";

/**
 * ImageCrop — 샷 크롭 토큰 적용 (N1_PRODUCT_DETAIL_EXPERIENCE_V1.md §4)
 * 원본 URL을 변형하지 않고 object-position / 종횡비 토큰으로 프레밍만 한다.
 * 파일 재생성·누끼 대체 금지.
 */
export interface CropToken {
  /** object-position 값 (예: "50% 18%") */
  position: string;
  /** 컨테이너 종횡비 (예: "4 / 5") */
  aspect: string;
}

/** 대표컷: 상의 = 턱~하반신 일부 (핏 중심 전달) */
export const CROP_HERO: CropToken = { position: "50% 18%", aspect: "4 / 5" };
/** 전신 정면 */
export const CROP_FULL: CropToken = { position: "50% 50%", aspect: "3 / 4" };
/** 소재 디테일 클로즈업 */
export const CROP_DETAIL: CropToken = { position: "50% 38%", aspect: "1 / 1" };

export default function ImageCrop({
  src,
  alt,
  token,
  eager = false,
  className = "",
}: {
  src: string;
  alt: string;
  token: CropToken;
  eager?: boolean;
  className?: string;
}) {
  if (!src) return null;
  return (
    <span
      className={className}
      style={{ display: "block", aspectRatio: token.aspect, overflow: "hidden" }}
    >
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        // LCP: Scene 1 대표컷은 브라우저 힌트로 우선 로딩
        fetchPriority={eager ? "high" : "auto"}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: token.position,
          display: "block",
        }}
      />
    </span>
  );
}
