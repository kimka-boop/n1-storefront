"use client";

/**
 * N°1 V2 — COS/SSENSE 감성 미니멀 아이콘 세트
 * 기존 이모티콘(🛒 💬)을 1.5px stroke 벡터로 전면 교체
 *
 * 이 프로젝트는 Tailwind을 사용하지 않으므로 w-/h- 유틸리티 클래스가 없다.
 * SVG에 명시적 width/height를 지정하지 않으면 아이콘이 0px로 붕괴해
 * 장바구니 버튼이 빈 원으로 보이는 문제가 발생했다(2026-09-07 수정).
 */

export function CartIcon({ size = 20 }: { size?: number }) {
  return (
    <svg style={{ display: "block" }} fill="none" stroke="currentColor" strokeWidth={1.5}
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
}

export function ChatIcon({ size = 20 }: { size?: number }) {
  return (
    <svg style={{ display: "block" }} fill="none" stroke="currentColor" strokeWidth={1.5}
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  );
}

export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg style={{ display: "block" }} fill="none" stroke="currentColor" strokeWidth={1.5}
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.75" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.9 15.9L20.6 20.6" />
    </svg>
  );
}

export function CardIcon({ size = 14 }: { size?: number }) {
  return (
    <svg style={{ display: "block" }} fill="none" stroke="currentColor" strokeWidth={1.5}
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 21.75z" />
    </svg>
  );
}
