"use client";

/**
 * SceneSection — 1뷰포트 1관념 챕터 래퍼.
 * 등장 모션 토큰: opacity+translateY 12px, 400ms ease-out, 뷰포트 진입 1회.
 * prefers-reduced-motion 시 즉시 표시 (CSS에서 처리).
 */
import { useEffect, useRef, useState } from "react";
import styles from "@/app/product/[id]/product.module.css";

export default function SceneSection({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.18 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      id={id}
      ref={ref}
      className={`${styles.scene} ${seen ? styles.sceneIn : ""}`}
      aria-label={title || kicker || id}
    >
      {kicker ? <p className={styles.kicker}>{kicker}</p> : null}
      {title ? <h2 className={styles.sceneTitle}>{title}</h2> : null}
      {children}
    </section>
  );
}
