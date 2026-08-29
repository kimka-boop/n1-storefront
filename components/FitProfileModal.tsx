"use client";

/**
 * [STEP 2] 스마트 핏 온보딩 모달 — 3문 3답 (15초)
 * Q1 성별 → Q2 기준 사이즈(상의/하의 자동 전환) → Q3 핏 취향
 */
import { useState } from "react";

const TOP_SIZES = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
const BOTTOM_SIZES = ["28~29", "30~31", "32~33", "34~35", "FREE"];

// 카테고리→기본 사이즈 축정 (하의 인치 → 상의 사이즈 환산 참고용)
export interface FitProfile { gender: string; size: string; fit: string; }

export default function FitProfileModal({
  initial, onSave, onClose,
}: {
  initial: FitProfile | null;
  onSave: (p: FitProfile) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const [gender, setGender] = useState(initial?.gender || "");
  const [category, setCategory] = useState<"top" | "bottom">("top");
  const [size, setSize] = useState(initial?.size || "");
  const [fit, setFit] = useState(initial?.fit || "");

  const sizeOptions = category === "top" ? TOP_SIZES : BOTTOM_SIZES;

  const canNext = (s: number) => {
    if (s === 1) return !!gender;
    if (s === 2) return !!size;
    return !!fit;
  };

  return (
    <div className="fit-modal-bg" onClick={onClose}>
      <div className="fit-modal" onClick={(e) => e.stopPropagation()}>
        <button className="fit-close" onClick={onClose}>✕</button>
        <p className="fit-progress">스마트 핏 설정 {step}/3</p>

        {step === 1 && (
          <>
            <h3 className="fit-q">Q1. 성별을 선택해주세요</h3>
            <div className="fit-opts">
              {["남성", "여성"].map((g) => (
                <button key={g} className={`fit-opt ${gender === g ? "selected" : ""}`}
                  onClick={() => setGender(g)}>{g}</button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h3 className="fit-q">Q2. 평소 입는 기준 사이즈는?</h3>
            <div className="fit-cat-toggle">
              <button className={category === "top" ? "on" : ""} onClick={() => setCategory("top")}>상의</button>
              <button className={category === "bottom" ? "on" : ""} onClick={() => setCategory("bottom")}>하의</button>
            </div>
            <div className="fit-opts">
              {sizeOptions.map((s) => (
                <button key={s} className={`fit-opt ${size === s ? "selected" : ""}`}
                  onClick={() => setSize(s)}>{s}</button>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h3 className="fit-q">Q3. 선호하는 핏은?</h3>
            <div className="fit-opts fit-vertical">
              {[
                { v: "A", t: "스탠다드 핏", d: "체형에 깔끔하게 딱 맞는 단정한 정사이즈" },
                { v: "B", t: "세미오버 / 내추럴 ⭐", d: "이너·하의는 정사이즈, 자켓은 1치수 여유 (기본 추천)" },
                { v: "C", t: "오버핏 / 와이드", d: "전체적으로 박시한 스트릿·트렌디 핏" },
              ].map((o) => (
                <button key={o.v} className={`fit-opt-v ${fit === o.v ? "selected" : ""}`}
                  onClick={() => setFit(o.v)}>
                  <b>{o.t}</b>
                  <span>{o.d}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="fit-btns">
          {step > 1 && <button className="fit-prev" onClick={() => setStep(step - 1)}>← 이전</button>}
          {step < 3 && (
            <button className="fit-next" disabled={!canNext(step)} onClick={() => setStep(step + 1)}>다음 →</button>
          )}
          {step === 3 && (
            <button className="fit-next" disabled={!canNext(3)}
              onClick={() => onSave({
                gender, size: size.replace(/\(.*\)/, ""), fit,
              })}>
              완료 — 내 사이즈 자동 추천 시작
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
