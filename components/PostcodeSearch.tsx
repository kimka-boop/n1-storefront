"use client";

/**
 * N°1 — 우편번호 찾기 (미션 §11·§13)
 * 다음(Daum) 우편번호 서비스 — 국내 표준 로드애드레스 조회. 공식 스크립트, 키 불필요.
 * - 검색 → 공식 형식 주소 선택 → 우편번호/도로명(지번) 자동 채움 → 상세주소 직접 입력
 * - 필드는 언제나 직접 수정 가능 (검색 실패·오프라인 환경에서도 수동 입력 유지)
 * - 저장 규격: postal_code / road_address / jibun_address / detail_address 분리 보관
 */
import { useCallback, useEffect, useRef, useState } from "react";

const DAUM_POSTCODE_SRC = "//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

interface DaumPostcodeResult {
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
  autoRoadAddress?: string;
  autoJibunAddress?: string;
}

interface DaumPostcodeConstructor {
  new (options: {
    oncomplete: (data: DaumPostcodeResult) => void;
    width?: string | number;
    height?: string | number;
  }): { open(): void; embed(element: HTMLElement): void };
}

declare global {
  interface Window {
    daum?: { Postcode: DaumPostcodeConstructor };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadDaumPostcode(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.daum?.Postcode) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${DAUM_POSTCODE_SRC}"]`);
    const el = existing ?? document.createElement("script");
    const done = () => resolve();
    if (existing) {
      if (window.daum?.Postcode) return resolve();
      existing.addEventListener("load", done);
      existing.addEventListener("error", () => reject(new Error("postcode script failed")));
      return;
    }
    el.src = DAUM_POSTCODE_SRC;
    el.async = true;
    el.addEventListener("load", done);
    el.addEventListener("error", () => reject(new Error("postcode script failed")));
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export interface AddressValue {
  postalCode: string;
  roadAddress: string;
  jibunAddress?: string;
  detailAddress: string;
}

export function PostcodeSearch({
  value,
  onChange,
  onSearchError,
  compact = false,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  onSearchError?: () => void;
  compact?: boolean;
}) {
  const [embedOpen, setEmbedOpen] = useState(false);
  const [layerError, setLayerError] = useState("");
  const embedRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLInputElement>(null);

  const apply = useCallback(
    (data: DaumPostcodeResult) => {
      const road = data.roadAddress || data.autoRoadAddress || "";
      const jibun = data.jibunAddress || data.autoJibunAddress || "";
      onChange({ ...value, postalCode: data.zonecode || "", roadAddress: road, jibunAddress: jibun });
      setEmbedOpen(false);
      // 주소 선택 직후 상세주소 입력으로 포커스 — 미션 §11 UX 순서
      requestAnimationFrame(() => detailRef.current?.focus());
    },
    [onChange, value]
  );

  const openSearch = useCallback(async () => {
    setLayerError("");
    try {
      await loadDaumPostcode();
      if (!window.daum?.Postcode) throw new Error("not loaded");
      if (compact && embedRef.current) {
        setEmbedOpen(true);
        // embed 모드: 레이어 안에 검색 UI 삽입 (모달 위 z-index 충돌 회피)
        const container = embedRef.current;
        container.innerHTML = "";
        new window.daum.Postcode({ oncomplete: apply, width: "100%", height: 320 }).embed(container);
      } else {
        new window.daum.Postcode({ oncomplete: apply }).open();
      }
    } catch {
      setLayerError("주소 검색을 지금 열 수 없어요 — 아래 칸에 직접 입력해 주세요.");
      onSearchError?.();
    }
  }, [apply, compact, onSearchError]);

  useEffect(() => {
    return () => {
      if (embedRef.current) embedRef.current.innerHTML = "";
    };
  }, []);

  return (
    <div className="pc-wrap" data-qa="postcode-search">
      <div className="pc-row">
        <input
          className="n1-input pc-zip"
          placeholder="우편번호 (5자리)"
          inputMode="numeric"
          maxLength={5}
          value={value.postalCode}
          onChange={(e) => onChange({ ...value, postalCode: e.target.value.replace(/\D/g, "").slice(0, 5) })}
          data-qa="input-postal"
        />
        <button type="button" className="pc-find" onClick={() => void openSearch()} data-qa="btn-postcode-find">
          우편번호 찾기
        </button>
      </div>
      {embedOpen && (
        <div className="pc-embed-frame" data-qa="postcode-embed">
          <div ref={embedRef} className="pc-embed" />
          <button type="button" className="pc-embed-close" onClick={() => setEmbedOpen(false)}>
            검색 닫기
          </button>
        </div>
      )}
      <input
        className="n1-input"
        placeholder="도로명 주소 (예: 서울시 강남구 테헤란로 123)"
        value={value.roadAddress}
        onChange={(e) => onChange({ ...value, roadAddress: e.target.value })}
        data-qa="input-road"
      />
      <input
        ref={detailRef}
        className="n1-input"
        placeholder="상세 주소 (동/호수 등) — 직접 입력"
        value={value.detailAddress}
        onChange={(e) => onChange({ ...value, detailAddress: e.target.value })}
        data-qa="input-detail"
      />
      {value.jibunAddress ? (
        <p className="pc-jibun" data-qa="jibun-hint">지번: {value.jibunAddress}</p>
      ) : null}
      {layerError ? <p className="pc-error">{layerError}</p> : null}
    </div>
  );
}

export function emptyAddress(): AddressValue {
  return { postalCode: "", roadAddress: "", jibunAddress: "", detailAddress: "" };
}
