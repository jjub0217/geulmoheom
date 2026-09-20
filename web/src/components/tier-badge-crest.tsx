"use client";

import { useId } from "react";

/** 장식은 그림으로, 이름은 실제 글자로 남겨 크기가 달라도 읽을 수 있게 한다. */
export function TierBadgeCrest({ name }: { name: string }) {
  const metalId = useId();
  const glazeId = useId();

  return (
    <>
      <svg className="tier-badge-ornament" aria-hidden="true" focusable="false" viewBox="0 0 136 72" fill="none">
        <defs>
          <linearGradient id={metalId} x1="34" y1="5" x2="95" y2="70" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f4dfa3" />
            <stop offset=".3" stopColor="#cba363" />
            <stop offset=".5" stopColor="#f4dda0" />
            <stop offset=".76" stopColor="#b38443" />
            <stop offset="1" stopColor="#e2c48a" />
          </linearGradient>
          <linearGradient id={glazeId} x1="68" y1="13" x2="68" y2="62" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fffaf0" stopOpacity=".06" />
            <stop offset=".5" stopColor="#142836" stopOpacity=".06" />
            <stop offset="1" stopColor="#142836" stopOpacity=".34" />
          </linearGradient>
        </defs>
        <g fill={`url(#${metalId})`} stroke="#785a36" strokeWidth=".5" strokeLinejoin="round">
          <path d="M24 55C12 49 7 38 13 26C14 24 17 23 19 25C15 25 14 29 15 32C18 28 22 27 25 29C20 30 17 33 16 37C20 33 24 35 25 38C21 36 18 38 18 41C20 46 23 48 27 50ZM13 37C6 36 4 31 6 27C6 32 10 33 14 33ZM16 46C8 46 5 42 6 38C8 42 11 42 15 42Z" />
          <path d="M112 55C124 49 129 38 123 26C122 24 119 23 117 25C121 25 122 29 121 32C118 28 114 27 111 29C116 30 119 33 120 37C116 33 112 35 111 38C115 36 118 38 118 41C116 46 113 48 109 50ZM123 37C130 36 132 31 130 27C130 32 126 33 122 33ZM120 46C128 46 131 42 130 38C128 42 125 42 121 42Z" />
          <path d="M68 6C82 14 101 11 111 18L114 37C114 51 90 61 68 67C46 61 22 51 22 37L25 18C35 11 54 14 68 6Z" />
        </g>
        <path d="M68 11C81 17 98 16 107 21L110 37C110 48 88 57 68 63C48 57 26 48 26 37L29 21C38 16 55 17 68 11Z" fill="var(--tier-bg)" stroke="#624c32" strokeWidth="1" />
        <path d="M68 11C81 17 98 16 107 21L110 37C110 48 88 57 68 63C48 57 26 48 26 37L29 21C38 16 55 17 68 11Z" fill={`url(#${glazeId})`} />
        <path d="M68 15C81 21 97 18 104 24L106 37C106 45 86 54 68 59C50 54 30 45 30 37L32 24C39 18 55 21 68 15Z" stroke="#e2c48a" strokeOpacity=".75" strokeWidth=".65" />
        <path d="M57 11C61 12 65 10 68 7C71 10 75 12 79 11M58 56L68 60L78 56" stroke="#fae8b7" strokeWidth=".9" strokeLinecap="round" />
        <path d="M68 3L71 7L68 11L65 7Z" fill={`url(#${metalId})`} stroke="#785a36" strokeWidth=".5" />
      </svg>
      <span className="tier-badge-caption">
        <span>{name}</span>
      </span>
    </>
  );
}
