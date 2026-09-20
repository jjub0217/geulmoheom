"use client";

import Image from "next/image";
import { useEffect, useState, type Ref } from "react";

import type { components } from "@/api/types.gen";
import { 챕터다음안내, 챕터동료소개 } from "@/components/chapter-writing";
import { CompassGlow } from "@/components/compass-glow";
import { StoryReading } from "@/components/story-opening";

type Guide = components["schemas"]["Guide"];

/** 동료의 말과 그 말이 가리키는 나침반을 같은 입력 곁에 둔다. */
export function ChapterCompanion({ guide, length, sending, first, introductionEnded, messageRef }: {
  guide: Guide | null;
  length: number;
  sending: boolean;
  first: boolean;
  introductionEnded: boolean;
  messageRef?: Ref<HTMLDivElement>;
}) {
  const [pulseFinished, setPulseFinished] = useState(false);

  useEffect(() => {
    // 동작 줄이기에서는 움직이지 않는 빛으로 가리키고, 쓰기 시작하면 바로 끝낸다.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setPulseFinished(true), 800);
    return () => window.clearTimeout(timer);
  }, []);

  const expression = sending ? "default" : guide?.expression ?? "default";
  const line = guide?.line ?? (first ? 챕터동료소개 : 챕터다음안내);
  const introducing = first && !introductionEnded && !sending && !pulseFinished;

  return (
    <figure className="guide-figure chapter-companion" data-chapter-companion data-expression={expression}>
      <Image
        src={`/guide/${expression}-stage.png`}
        alt=""
        width={256}
        height={256}
        className="guide-image chapter-companion-image"
        priority
      />
      {/* 새 대사는 새 스크롤 박스에서 시작한다. 직전 End 키의 관성이 다음 말을 넘기지 않는다. */}
      <figcaption className="guide-line chapter-companion-bubble">
        <div key={sending ? "reading" : line} ref={messageRef} className="chapter-companion-line" tabIndex={-1}>
          {sending ? <StoryReading /> : <p role="status" aria-atomic="true">{line}</p>}
        </div>
      </figcaption>
      {/* 밝기는 쓰는 양에만 반응한다. 문장 판정·캐릭터 표정은 서버의 몫이다. */}
      <div className="game-compass chapter-companion-compass">
        <CompassGlow length={length} introducing={introducing} />
      </div>
    </figure>
  );
}

/** 서버 종료 응답에서 정해진 표정·문장만 꺼낸다. 형태가 다르면 추측하지 않는다. */
export function chapterErrorGuide(detail: unknown): Guide | null {
  if (!detail || typeof detail !== "object") return null;
  const guide = (detail as { guide?: Partial<Guide> }).guide;
  if (!guide || typeof guide.line !== "string") return null;
  if (guide.expression !== "default" && guide.expression !== "compass_dim"
    && guide.expression !== "compass_bright" && guide.expression !== "session_end") return null;
  return { expression: guide.expression, line: guide.line };
}
