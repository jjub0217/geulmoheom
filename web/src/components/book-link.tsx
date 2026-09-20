"use client";

import Link from "next/link";
import { useBookDeparture } from "@/components/book-journey";

/** docs/문구.md 1.17 — 책으로 이동하는 버튼은 누른 뒤의 행동을 함께 말한다. */
export const 책펼치기라벨 = "내 책 펼치기";

/** 결과와 배웅에서 같은 책으로 연결한다. 강조 정도만 색으로 구분한다. */
export function BookLink({ prominent = false, className = "", disabled = false }: {
  prominent?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const remember = useBookDeparture();
  return (
    <Link href="/book" aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}
      onClick={(event) => { if (disabled) event.preventDefault(); }}
      onNavigate={(event) => { if (disabled) event.preventDefault(); else remember(); }}
      className={`book-link pressable ${prominent ? "action-primary" : "action-secondary"} ${className}`}>
      <svg className="book-link__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5.5C9 3.5 5.5 3.5 2 4.5v15c3.5-1 7-1 10 1 3-2 6.5-2 10-1v-15c-3.5-1-7-1-10 1Z" />
        <path d="M12 5.5v15M5.5 8.5c1.2-.1 2.4.1 3.5.5m6 0c1.1-.4 2.3-.6 3.5-.5" />
      </svg>
      {책펼치기라벨}
      <span className="book-link__arrow" aria-hidden="true">→</span>
    </Link>
  );
}
