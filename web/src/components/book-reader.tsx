"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

import type { components } from "@/api/types.gen";
import { BookPageFrame } from "@/components/book-page";

type BookPage = components["schemas"]["BookPage"];

// 사용자 승인으로 더한 쪽 넘기기 문구. docs/문구.md에 의미를 함께 기록한다.
export const 책이전쪽라벨 = "이전 쪽";
export const 책다음쪽라벨 = "다음 쪽";
export const 책쪽이동라벨 = "책 쪽 넘기기";

/** 한 장면의 삽화와 원문을 정사각 면에 담는다. 긴 원문은 읽어 내려가고 인쇄는 전부 보여준다. */
export function BookReader({ pages }: { pages: BookPage[] }) {
  const [readingIndex, setReadingIndex] = useState(0);
  // 폭과 관계없이 같은 장면을 읽는다. 화면의 면 번호는 서버의 장면 번호와 구분한다.
  const currentIndex = Math.min(readingIndex, Math.max(0, pages.length - 1));
  const pagesId = useId();
  const pagesRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const pendingButton = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    const button = pendingButton.current;
    if (!button) return;
    pendingButton.current = null;

    // 끝 쪽에서 누른 버튼이 비활성화되면 반대 버튼으로 이어 준다. 포커스가 본문 밖으로 빠지지 않는다.
    const focusTarget = button.disabled
      ? (button === nextRef.current ? previousRef.current : nextRef.current)
      : button;
    focusTarget?.focus({ preventScroll: true });

    // 긴 쪽을 읽고 넘겼을 때는 새 쪽의 처음을 보여 준다. 이미 책 시작이 보이면 스크롤하지 않는다.
    const book = pagesRef.current;
    if (book) {
      book.querySelector<HTMLElement>('.book-reader-page[data-current="true"] [data-책문장]')
        ?.scrollTo({ top: 0, behavior: "instant" });
      const top = book.getBoundingClientRect().top;
      if (top < 0 || top >= window.innerHeight) {
        book.scrollIntoView({ behavior: "instant", block: "start" });
      }
    }
  }, [currentIndex]);

  if (pages.length === 0) return null;

  const numberedPages: { page: BookPage; startPageNumber: number; endPageNumber: number }[] = [];
  for (const page of pages) {
    const startPageNumber = (numberedPages.at(-1)?.endPageNumber ?? 0) + 1;
    // 아직 굽는 대표 삽화도 완성되면 같은 면에 들어온다. 책을 연 순간의 URL 유무로
    // 쪽 수가 바뀌면 읽던 위치가 흔들린다.
    const hasArtwork = (page.artwork !== null && page.artwork !== undefined) || page.artwork_url !== null;
    const endPageNumber = startPageNumber + (hasArtwork ? 1 : 0);
    numberedPages.push({ page, startPageNumber, endPageNumber });
  }
  const { startPageNumber, endPageNumber } = numberedPages[currentIndex];
  const location = startPageNumber === endPageNumber
    ? `${startPageNumber}쪽`
    : `${startPageNumber}–${endPageNumber}쪽`;

  function moveTo(index: number, button: HTMLButtonElement) {
    pendingButton.current = button;
    setReadingIndex(index);
  }

  return (
    <div className="book-reader">
      <div id={pagesId} ref={pagesRef} className="book-pages">
        {numberedPages.map(({ page, startPageNumber }, index) => (
          <div
            key={page.page_no}
            className="book-reader-page"
            data-current={index === currentIndex}
          >
            <BookPageFrame page={page} startPageNumber={startPageNumber} />
          </div>
        ))}
      </div>

      <nav className="book-pagination print:hidden" aria-label={책쪽이동라벨}>
        <button
          ref={previousRef}
          type="button"
          data-book-previous
          aria-controls={pagesId}
          className="book-page-turn pressable"
          disabled={currentIndex === 0}
          onClick={(event) => moveTo(Math.max(0, currentIndex - 1), event.currentTarget)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="m14 6-6 6 6 6" />
          </svg>
          {책이전쪽라벨}
        </button>

        <p data-book-location className="sr-only" role="status" aria-atomic="true">
          {location}
        </p>

        <button
          ref={nextRef}
          type="button"
          data-book-next
          aria-controls={pagesId}
          className="book-page-turn pressable"
          disabled={currentIndex === pages.length - 1}
          onClick={(event) => moveTo(currentIndex + 1, event.currentTarget)}
        >
          {책다음쪽라벨}
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="m10 6 6 6-6 6" />
          </svg>
        </button>
      </nav>
    </div>
  );
}
