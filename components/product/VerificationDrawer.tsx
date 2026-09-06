"use client";

/**
 * VerificationDrawer — Glass 용도 ②: 확인된 사실의 조용한 목록 (접힘/전개 서랍).
 * 배지·인증 그래픽 금지. 데이터에 있는 확인 항목만 렌더 (공백 = 항목 비표시).
 * Quality reviewed / Duplicate checked 는 API 필드 확장(Master) 후 추가 — zcode가 만들지 않는다.
 */
import { useState } from "react";
import styles from "@/app/product/[id]/product.module.css";

export interface VerificationItem {
  label: string;
  fact: string;
}

export default function VerificationDrawer({ items }: { items: VerificationItem[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className={styles.vWrap}>
      <button
        type="button"
        className={styles.vToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        이 상품의 확인 기록 <span className={styles.vCount}>{items.length}</span>
        <span className={styles.vChevron} aria-hidden="true">
          {open ? "—" : "+"}
        </span>
      </button>
      {open ? (
        <ul className={styles.vList}>
          {items.map((it) => (
            <li key={it.label} className={styles.vItem}>
              <span className={styles.vLabel}>{it.label}</span>
              <span className={styles.vFact}>{it.fact}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
