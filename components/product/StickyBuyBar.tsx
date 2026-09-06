"use client";

/**
 * StickyBuyBar — Glass 용도 ①: Scene 1 통과 후 하단에 떠오르는 얇은 층.
 * 이름 · 가격 · 구매(품절 시 비활성). hero 가시성은 부모가 전달한다.
 */
import { useEffect, useState } from "react";
import styles from "@/app/product/[id]/product.module.css";

export default function StickyBuyBar({
  name,
  price,
  soldOut,
  heroVisible,
  onBuy,
}: {
  name: string;
  price: number;
  soldOut: boolean;
  heroVisible: boolean;
  onBuy: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const show = mounted && !heroVisible;
  const won = new Intl.NumberFormat("ko-KR").format(price);
  return (
    <div
      className={`${styles.buyBar} ${show ? styles.buyBarIn : ""}`}
      role="region"
      aria-label="상품 빠른 구매"
      hidden={!show}
    >
      <span className={styles.buyBarName}>{name}</span>
      <span className={styles.buyBarPrice}>{won}원</span>
      <button
        type="button"
        className={styles.buyBarCta}
        disabled={soldOut}
        onClick={onBuy}
      >
        {soldOut ? "품절" : "구매"}
      </button>
    </div>
  );
}
