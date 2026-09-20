"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";

import type { components } from "@/api/types.gen";
import { TierBadge } from "@/components/tier-badge";
import { 빈자리비율 } from "@/lib/artwork-frame";
import { 책폴링상한, useArtwork } from "@/lib/artwork";

type BookPage = components["schemas"]["BookPage"];

/** 같은 출처의 API 이미지만 다시 받는다. 외부 주소와 기존 query/서명은 변경하지 않는다. */
function bookArtworkSource(url: string) {
  const imagePath = /^\/api\/v1\/artworks\/[a-zA-Z0-9-]+\/image$/;
  if (imagePath.test(url)) return `${url}?book-layout=square-20260919`;
  if (typeof window === "undefined" || /[?#]/.test(url)) return url;
  try {
    const absolute = new URL(url);
    if (absolute.origin === window.location.origin && imagePath.test(absolute.pathname)
      && !absolute.search && !absolute.hash && !absolute.username && !absolute.password) {
      return `${url}?book-layout=square-20260919`;
    }
  } catch { /* 알 수 없는 주소도 서버 원문 그대로 이미지 로더에 맡긴다. */ }
  return url;
}

/**
 * 서버 책 한 쪽을 하나의 장면으로 보여 준다 (백로그 A0-4).
 * 사용자 승인(2026-09-18): 넓은 화면은 삽화 왼쪽·원문 오른쪽, 좁은 화면은 삽화 위·원문 아래.
 *
 * **문장은 아이 원문 그대로다** (마스킹 뒤 텍스트). 요약도 교정도 하지 않는다 — 이건 로그가
 * 아니라 **창작물**이다 (비전 2장 · `용어사전.md` 54행). 여기 손대면 **책이 아이 것이 아니게 된다.**
 *
 * **하이라이트를 칠하지 않는다.** 결과 화면의 표시는 **그 순간 무엇이 통했는지**를 말하는 것이고,
 * 책은 **문장 자체를 두는 자리**다. 계약도 `highlights` 를 여기 안 준다.
 */
export function BookPageFrame({ page, startPageNumber }: { page: BookPage; startPageNumber: number }) {
  /** 화면 판형은 1:1이고, 실제 원본 비율은 전체 그림을 보존하는 인쇄에 사용한다. */
  const [비율, set비율] = useState(빈자리비율);
  const [다시확인, set다시확인] = useState(0);
  // 준비 중인 대표 삽화도 한 면을 유지한 채 실제 상태를 다시 확인한다.
  const 삽화상태 = useArtwork(page.artwork ?? null, 다시확인, 책폴링상한);
  const 삽화주소 = 삽화상태.kind === "떴다" ? 삽화상태.url : page.artwork_url;
  const 삽화면있음 = (page.artwork !== null && page.artwork !== undefined) || 삽화주소 !== null;
  return (
    // **`data-책쪽` 은 인쇄가 쓴다** (`globals.css` `@media print`) —
    // 한 장면의 삽화와 원문을 함께 인쇄하기 위한 표식이다.
    <article
      data-책쪽
      data-scene-number={page.page_no}
      style={{ "--book-artwork-ratio": 비율 } as CSSProperties}
      className={`book-page${삽화면있음 ? "" : " book-page--text-only"}`}
    >
      {/* 준비 중인 대표 그림도 같은 면을 지킨다. 훅은 서버의 60초 확정 뒤 한 번 더 확인하고,
          완료되면 이 자리에서 바로 실제 그림으로 바뀐다. */}
      {삽화면있음 && (
        <div className="book-page-illustration">
          {/* 승인된 정사각 삽화는 면을 채운다. 구형 비율도 자르거나 늘이지 않는다. */}
          <div className="book-page-artwork">
            {삽화주소 !== null && (
              <Image
              // 같은 출처 API 경로만 판형 버전으로 재검증한다. **`crossOrigin` 을 붙이지 않는다**
              // (`Stage0.md` 5절 ⚠) — 붙는 순간 쿠키가 안 실려 그림이 통째로 안 뜬다.
              src={bookArtworkSource(삽화주소)}
              // 그림의 내용은 같은 장면의 아이 문장이 말한다.
              alt=""
              fill
              // 화면에서 숨긴 쪽도 미리 받아 두어 쪽 넘김과 책 전체 인쇄에서 누락되지 않게 한다.
              loading="eager"
              // 정사각 면 안에서 원본 전체를 보존한다. 바깥 모서리만 책 윤곽을 따른다.
              className="object-contain"
              sizes="(min-width: 72rem) 32rem, (min-width: 56rem) 44vw, 90vw"
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  set비율(img.naturalWidth / img.naturalHeight);
                }
              }}
              />
            )}
            {삽화주소 === null && 삽화상태.kind === "기다림" && (
              <p data-book-artwork-pending role="status" className="book-page-artwork-status">
                그림을 준비하고 있어.
              </p>
            )}
            {삽화주소 === null && 삽화상태.kind === "못받음" && page.artwork && (
              <button
                type="button"
                data-book-artwork-retry
                className="book-page-artwork-retry pressable"
                onClick={() => set다시확인((count) => count + 1)}
              >
                그림 다시 확인하기
              </button>
            )}
          </div>
          <span data-쪽번호 className="book-page-number book-page-number--illustration">
            {startPageNumber}
          </span>
        </div>
      )}

      <div className="book-page-writing">
        <div className="book-page-tier">
          <TierBadge tier={page.tier} />
        </div>

        {/* **아이가 쓴 그 문장이다.** 여기가 이 화면의 주인공이라 가장 크다. */}
        <p data-책문장 className="book-page-text" tabIndex={0}>
          {page.text}
        </p>

        <footer className="book-page-footer">
          {/* 서버의 장면 번호와 별개로, 실제로 표시하는 각 면에 연속 번호를 붙인다. */}
          <span data-쪽번호 className="book-page-number">
            {startPageNumber + (삽화면있음 ? 1 : 0)}
          </span>
        </footer>
      </div>
    </article>
  );
}
