"use client";
/* eslint-disable @next/next/no-img-element -- 780ms 동안만 보이는 aria-hidden 종이 복제본이다. */

import type { components } from "@/api/types.gen";
import { bookCurlFaces, type BookCurlDirection } from "@/components/book-curl-model";
import { 티어이름 } from "@/components/tier-badge";
import { TierBadgeCrest } from "@/components/tier-badge-crest";

type BookPage = components["schemas"]["BookPage"];

export type BookCurlSnapshot = {
  page: BookPage;
  artworkUrl: string | null;
  illustrationPageNumber: number;
  writingPageNumber: number;
};

export type BookCurlTransition = {
  direction: BookCurlDirection;
  current: BookCurlSnapshot;
  adjacent: BookCurlSnapshot;
};

function CurlArtwork({ snapshot }: { snapshot: BookCurlSnapshot }) {
  const hasArtwork = snapshot.page.artwork !== null && snapshot.page.artwork !== undefined;
  const hasArtworkFace = hasArtwork || snapshot.artworkUrl !== null || snapshot.page.artwork_url !== null;
  return (
    <div className="book-curl-art-face">
      {snapshot.artworkUrl ? <img src={snapshot.artworkUrl} alt="" /> : hasArtwork && <p>그림을 준비하고 있어.</p>}
      {hasArtworkFace && (
        <span className="book-page-number book-page-number--illustration">
          {snapshot.illustrationPageNumber}
        </span>
      )}
    </div>
  );
}

function CurlWriting({ snapshot }: { snapshot: BookCurlSnapshot }) {
  return (
    <div className="book-page-writing book-curl-writing-face" data-curl-writing-page={snapshot.page.page_no}>
      <div className="book-page-tier">
        <span
          className={`tier-badge tier-badge-crest tier-${snapshot.page.tier}`}
          data-curl-tier-badge
        >
          <TierBadgeCrest name={티어이름[snapshot.page.tier]} />
        </span>
      </div>
      <p className="book-page-text">{snapshot.page.text}</p>
      <footer className="book-page-footer">
        <span className="book-page-number">{snapshot.writingPageNumber}</span>
      </footer>
    </div>
  );
}

function TurningLeaf({ direction, front, back }: {
  direction: BookCurlDirection;
  front: BookCurlSnapshot;
  back: BookCurlSnapshot;
}) {
  const frontIsWriting = direction === "next";
  return (
    <div
      className={`book-curl-turning book-curl-turning--${direction}`}
      data-curl-turning-front={front.page.page_no}
      data-curl-turning-back={back.page.page_no}
    >
      <div className="book-curl-leaf-face book-curl-leaf-face--front">
        {frontIsWriting ? <CurlWriting snapshot={front} /> : <CurlArtwork snapshot={front} />}
        <div className="book-curl-sheen" />
      </div>
      <div className="book-curl-leaf-face book-curl-leaf-face--back">
        {frontIsWriting ? <CurlArtwork snapshot={back} /> : <CurlWriting snapshot={back} />}
        <div className="book-curl-sheen" />
      </div>
    </div>
  );
}

/** 전환 중에만 보이는 비상호작용 복제본. 실제 읽기·인쇄 DOM을 대신하지 않는다. */
export function BookCurl({ transition }: { transition: BookCurlTransition | null }) {
  if (!transition) return null;

  const faces = bookCurlFaces(transition.direction, transition.current, transition.adjacent);
  const next = transition.direction === "next";
  return (
    <div
      className={`book-curl book-curl--${transition.direction}`}
      data-book-curl
      data-curl-direction={transition.direction}
      aria-hidden="true"
    >
      {next ? (
        <>
          <div className="book-curl-fixed book-curl-fixed--left" data-curl-fixed-left={faces.fixedLeft!.page.page_no}>
            <CurlArtwork snapshot={faces.fixedLeft!} />
          </div>
          <div className="book-curl-under book-curl-under--right" data-curl-under-right={faces.underRight!.page.page_no}>
            <CurlWriting snapshot={faces.underRight!} />
          </div>
        </>
      ) : (
        <>
          <div className="book-curl-under book-curl-under--left" data-curl-under-left={faces.underLeft!.page.page_no}>
            <CurlArtwork snapshot={faces.underLeft!} />
          </div>
          <div className="book-curl-fixed book-curl-fixed--right" data-curl-fixed-right={faces.fixedRight!.page.page_no}>
            <CurlWriting snapshot={faces.fixedRight!} />
          </div>
        </>
      )}
      <TurningLeaf direction={transition.direction} front={faces.turningFront} back={faces.turningBack} />
    </div>
  );
}
