"use client";

import Image from "next/image";
import { type Ref } from "react";

import type { components } from "@/api/types.gen";
import { 글쓰기질문, 본편시작알림, 챕터다음안내, 챕터동료소개 } from "@/components/chapter-writing";
import { GuideFigure } from "@/components/guide";
import { StageCompass } from "@/components/game-console";
import { StoryReading } from "@/components/story-opening";

type Guide = components["schemas"]["Guide"];

/**
 * 이 화면에서 래서판다가 할 말.
 *
 * **⛔ 글쓰기 단계에서는 늘 「이제 어떻게 할까?」다** (2026-09-22 사용자 지시 · `문구.md` 1.4b).
 * 서버가 준 대사는 **결과 단계의 반응**이라 글쓰기 화면까지 들고 있으면 되풀이가 된다.
 *
 * **⛔ 되묻기·차단은 예외다.** 그때 서버가 준 말이 **지금 무엇을 고쳐 쓰라는 말**이고,
 * 화면도 글쓰기 단계에 머물러 있다 — 그 대사를 덮으면 **아이가 왜 막혔는지 모른다.**
 *
 * **⛔ 본편 최초 진입에서만 한 줄이 앞선다** — `본편시작알림` (`문구.md` 1.4b).
 * 그 뒤에 질문이 붙어 **한 말풍선**이 된다. 같은 뜻을 두 자리에서 되풀이하지 않기 위해서다.
 */
export function chapterGuide(
  guide: Guide | null,
  first: boolean,
  { 글쓰기단계 = false, 결과대사인가 = false }: { 글쓰기단계?: boolean; 결과대사인가?: boolean } = {},
): Guide {
  if (글쓰기단계 && (guide === null || 결과대사인가)) {
    return {
      expression: "default",
      line: first ? `${본편시작알림} ${글쓰기질문}` : 글쓰기질문,
    };
  }
  return guide ?? { expression: "default", line: first ? 챕터동료소개 : 챕터다음안내 };
}

/** 동료의 말과 그 말이 가리키는 나침반을 같은 입력 곁에 둔다. */
export function ChapterCompanion({ guide, length, sending, messageRef, 말풍선없이 = false, 나침반없이 = false }: {
  guide: Guide;
  length: number;
  sending: boolean;
  messageRef?: Ref<HTMLDivElement>;
  /**
   * **말풍선 없이 래서판다와 나침반만 세운다** (2026-09-22 사용자 지시).
   *
   * **글쓰기 단계가 쓴다.** 그 단계에서 들고 있는 대사는 **결과 단계에서 이미 한 말**이라
   * 되풀이가 되는데, **래서판다와 나침반은 남아야 한다** — 나침반이 **글자 수에 반응**해서
   * 아이에게 「쓰고 있다」를 보여 주는 자리다(`web/CLAUDE.md`).
   */
  말풍선없이?: boolean;
  /**
   * **나침반을 안 그린다** (2026-09-22 사용자 지시 — 결과 화면을 한 묶음으로).
   *
   * **결과 단계가 쓴다.** 나침반은 **아이가 쓰는 글자 수에 반응하는 장치**인데
   * 그 단계에는 **입력칸이 없어 반응할 것이 없다.** 그런데 자리는 차지해서,
   * **말풍선 아래 → 다음 버튼 위**가 106~156px 벌어졌다(실측). 아이가 읽는 흐름은
   * **말풍선 다음 버튼**이라 그 사이에 뜻 없는 것이 끼면 한 묶음으로 안 읽힌다.
   *
   * **⛔ 글쓰기 단계에서는 그대로 둔다** — 거기서는 실제로 반응한다.
   */
  나침반없이?: boolean;
}) {
  if (!sending) {
    return (
      <GuideFigure
        guide={guide}
        stage
        compass={나침반없이 ? undefined : <StageCompass length={length} />}
        className="chapter-companion"
        messageRef={messageRef}
        messageClassName="chapter-companion-line"
        figureData={{ "data-chapter-companion": "" }}
        말풍선없이={말풍선없이}
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
