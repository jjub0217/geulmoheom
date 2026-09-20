"use client";

import Link from "next/link";
import { useBookReturnPath } from "@/components/book-journey";

// 사용자 UI 검수로 확정한 문구. docs/문구.md 1.13·1.17을 따른다.
export const 책인쇄라벨 = "책 인쇄하기";
export const 모험복귀라벨 = "이야기 계속 쓰기";

export function BookPrintButton({ prominent = false }: { prominent?: boolean }) {
  return (
    <button
      type="button"
      data-보내기
      onClick={() => window.print()}
      className={`book-print-button pressable ${prominent ? "action-primary" : "action-secondary"} print:hidden`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
        <path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z" />
        <path d="M16 11h1" strokeLinecap="round" />
      </svg>
      {책인쇄라벨}
    </button>
  );
}

export function BookReturnLink() {
  const returnPath = useBookReturnPath();
  return (
    <Link href={returnPath} data-쓰러가기 className="book-return-link pressable action-secondary print:hidden">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="m10 5-7 7 7 7M3 12h18" />
      </svg>
      {모험복귀라벨}
    </Link>
  );
}
