"use client";

import Image from "next/image";
import { type Ref } from "react";

import type { components } from "@/api/types.gen";
import { 챕터다음안내, 챕터동료소개 } from "@/components/chapter-writing";
import { GuideFigure } from "@/components/guide";
import { StageCompass } from "@/components/game-console";
import { StoryReading } from "@/components/story-opening";

type Guide = components["schemas"]["Guide"];

/** 본편도 튜토리얼과 같은 동료 문장·나침반 소개를 쓴다. */
export function chapterGuide(guide: Guide | null, first: boolean): Guide {
  return guide ?? { expression: "default", line: first ? 챕터동료소개 : 챕터다음안내 };
}

/** 동료의 말과 그 말이 가리키는 나침반을 같은 입력 곁에 둔다. */
export function ChapterCompanion({ guide, length, sending, messageRef }: {
  guide: Guide;
  length: number;
  sending: boolean;
  messageRef?: Ref<HTMLDivElement>;
}) {
  if (!sending) {
    return (
      <GuideFigure
        guide={guide}
        stage
        compass={<StageCompass length={length} />}
        className="chapter-companion"
        messageRef={messageRef}
        messageClassName="chapter-companion-line"
      />
    );
  }

  return (
    <figure className="guide-figure chapter-companion" data-chapter-companion data-expression="default">
      <Image
        src="/guide/default-stage.png"
        alt=""
        width={256}
        height={256}
        className="guide-image chapter-companion-image"
        priority
      />
      {/* 새 대사는 새 스크롤 박스에서 시작한다. 직전 End 키의 관성이 다음 말을 넘기지 않는다. */}
      <figcaption className="guide-line chapter-companion-bubble">
        <div ref={messageRef} className="chapter-companion-line" tabIndex={-1}>
          <StoryReading />
        </div>
      </figcaption>
      <StageCompass length={length} />
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
