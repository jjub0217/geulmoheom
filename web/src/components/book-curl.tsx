"use client";
/* eslint-disable @next/next/no-img-element -- 전환 중에만 보이는 aria-hidden 종이 복제본이다. */

import { type CSSProperties, useLayoutEffect, useRef } from "react";

import type { components } from "@/api/types.gen";
import {
  BOOK_CURL_DURATION_MS,
  BOOK_CURL_STRIP_COUNT,
  bookCurlStripPoses,
} from "@/components/book-curl-geometry";
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

function TurningLeaf({ direction, front, back, onFinish }: {
  direction: BookCurlDirection;
  front: BookCurlSnapshot;
  back: BookCurlSnapshot;
  onFinish: () => void;
}) {
  const turningRef = useRef<HTMLDivElement>(null);
  const frontIsWriting = direction === "next";
  const strips = Array.from({ length: BOOK_CURL_STRIP_COUNT }, (_, index) => index);

  useLayoutEffect(() => {
    const turning = turningRef.current;
    if (!turning) return;
    const width = turning.getBoundingClientRect().width / 2;
    const stripElements = Array.from(turning.querySelectorAll<HTMLElement>(".book-curl-strip"));
    const frameCount = 33;
    const frames = Array.from({ length: frameCount }, (_, frameIndex) => {
      const offset = frameIndex / (frameCount - 1);
      return { offset, poses: bookCurlStripPoses(direction, offset, width) };
    });
    const animations = stripElements.map((strip, stripIndex) => {
      const animation = strip.animate(frames.map(({ offset, poses }) => ({
        offset,
        transform: `translate3d(${poses[stripIndex].x}px, 0, ${poses[stripIndex].z}px) rotateY(${poses[stripIndex].angle}deg)`,
      })), {
        duration: BOOK_CURL_DURATION_MS,
        easing: "linear",
        fill: "both",
      });
      return animation;
    });
    let cancelled = false;
    Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(() => {
      if (!cancelled) onFinish();
    });
    return () => {
      cancelled = true;
      animations.forEach((animation) => animation.cancel());
    };
  }, [direction, onFinish]);

  return (
    <div
      ref={turningRef}
      className={`book-curl-turning book-curl-turning--${direction}`}
      data-curl-turning-front={front.page.page_no}
      data-curl-turning-back={back.page.page_no}
      data-curl-strip-count={BOOK_CURL_STRIP_COUNT}
    >
      {strips.map((index) => {
        const left = direction === "next"
          ? 50 + index * 50 / BOOK_CURL_STRIP_COUNT
          : index * 50 / BOOK_CURL_STRIP_COUNT;
        const style = {
          left: `${left}%`,
          width: `${50 / BOOK_CURL_STRIP_COUNT}%`,
        } satisfies CSSProperties;
        const frontContentStyle = {
          left: `${-index * 100}%`,
          width: `${BOOK_CURL_STRIP_COUNT * 100}%`,
        } satisfies CSSProperties;
        const backIndex = BOOK_CURL_STRIP_COUNT - index - 1;
        const backContentStyle = {
          left: `${-backIndex * 100}%`,
          width: `${BOOK_CURL_STRIP_COUNT * 100}%`,
        } satisfies CSSProperties;
        return (
          <div className="book-curl-strip" data-curl-strip={index} key={index} style={style}>
            <div className="book-curl-strip-face book-curl-strip-face--front">
              <div className="book-curl-strip-content" style={frontContentStyle}>
                {frontIsWriting ? <CurlWriting snapshot={front} /> : <CurlArtwork snapshot={front} />}
              </div>
              <div className="book-curl-strip-shade" style={frontContentStyle} />
            </div>
            <div className="book-curl-strip-face book-curl-strip-face--back">
              <div className="book-curl-strip-content" style={backContentStyle}>
                {frontIsWriting ? <CurlArtwork snapshot={back} /> : <CurlWriting snapshot={back} />}
              </div>
              <div className="book-curl-strip-shade" style={backContentStyle} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 전환 중에만 보이는 비상호작용 복제본. 실제 읽기·인쇄 DOM을 대신하지 않는다. */
export function BookCurl({ transition, onFinish }: {
  transition: BookCurlTransition | null;
  onFinish: () => void;
}) {
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
          {/* 고정 왼쪽은 아래의 실제 현재 페이지를 그대로 보인다. 같은 이미지를 다시
              그리면 정적 배포와 개발 서버의 이미지 배치 차이가 전환 중 점프로 드러난다. */}
          <div className="book-curl-fixed book-curl-fixed--left" data-curl-fixed-left={faces.fixedLeft!.page.page_no} />
          <div className="book-curl-under book-curl-under--right" data-curl-under-right={faces.underRight!.page.page_no}>
            <CurlWriting snapshot={faces.underRight!} />
          </div>
        </>
      ) : (
        <>
          <div className="book-curl-under book-curl-under--left" data-curl-under-left={faces.underLeft!.page.page_no}>
            <CurlArtwork snapshot={faces.underLeft!} />
          </div>
          {/* 이전 넘김의 고정 오른쪽도 실제 현재 글 면을 그대로 노출한다. */}
          <div className="book-curl-fixed book-curl-fixed--right" data-curl-fixed-right={faces.fixedRight!.page.page_no} />
        </>
      )}
      <div className={`book-curl-cast-shadow book-curl-cast-shadow--${transition.direction}`} />
      <TurningLeaf
        direction={transition.direction}
        front={faces.turningFront}
        back={faces.turningBack}
        onFinish={onFinish}
      />
    </div>
  );
}
