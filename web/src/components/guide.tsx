"use client";

import Image from "next/image";
import type { ReactNode, Ref } from "react";

import type { components } from "@/api/types.gen";
import { useCompassIntroduction } from "@/components/compass-introduction";

type Guide = components["schemas"]["Guide"];

/** 문장 끝에서만 단락을 나눈다. 서버 원문과 타이핑의 글자 순서는 유지한다. */
function GuideText({ text, visible = text, caret = false }: { text: string; visible?: string; caret?: boolean }) {
  const ends = [...text.matchAll(/[.!?…][”’"']*\s+/g)].map((match) => match.index + match[0].length);
  if (ends.at(-1) !== text.length) ends.push(text.length);
  return ends.map((end, index) => {
    const start = index === 0 ? 0 : ends[index - 1];
    const sentence = text.slice(start, end);
    const count = Math.max(0, Math.min(sentence.length, visible.length - start));
    const active = visible.length >= start && (visible.length < end || index === ends.length - 1);
    return (
      <span className="guide-sentence" data-unspoken={sentence.slice(count)} key={start}>
        {sentence.slice(0, count)}
        {caret && active && <span className="guide-caret" aria-hidden="true" />}
      </span>
    );
  });
}

/**
 * 가이드 캐릭터. **서버가 준 `guide` 객체를 그대로 쓴다.**
 *
 * 프론트가 하는 일은 `expression` → PNG 매핑 하나뿐이다. 표정을 고르지도, 대사를 지어내지도 않는다
 * (`docs/api/Stage0.md` 3절). 특히 `compass_bright`·`compass_dim` 은 **평가 결과**를 뜻하므로
 * 제출 전에는 어떤 이유로도 켜지 않는다 — 입력 중 화면은 `default` 를 넘긴다.
 */
export function GuideFigure({
  guide,
  stage = false,
  compass,
  className = "",
  messageRef,
  messageClassName = "",
}: {
  guide: Guide;
  stage?: boolean;
  compass?: ReactNode;
  className?: string;
  messageRef?: Ref<HTMLDivElement>;
  messageClassName?: string;
}) {
  const introduction = useCompassIntroduction();
  const dialogue = introduction?.line === guide.line ? introduction : null;
  const speaking = dialogue !== null && dialogue.phase !== "narrative" && dialogue.phase !== "complete";
  const partial = dialogue !== null && dialogue.visible !== guide.line;
  return (
    <figure className={`guide-figure${className ? ` ${className}` : ""}`} data-guide-phase={dialogue?.phase}>
      {stage && <span className="compass-source" data-compass-source aria-hidden="true" />}
      <Image
        // 무대용은 같은 표정의 투명 배경본이다. 서버가 고른 표정은 그대로 둔다.
        src={`/guide/${guide.expression}${stage ? "-stage" : ""}.png`}
        alt=""
        width={256}
        height={256}
        // **원형으로 자르지 않는다.** 자르면 고글·크로스백·파란 스카프가 잘려 나가는데,
        // 아동 4명이 2판을 고른 이유가 정확히 그 셋이다 — 잘라내면 확인받은 것이 제품에 없는 셈이다.
        // **작은 화면에서 줄인다** (2026-09-15 PM 판정 · 결과 ⑭ 옆). 화면의 우선순위는
        // **삽화 → 아이 문장 → 나가는 길 셋 → 가이드**이고 **가이드가 가장 뒤**다 —
        // 삽화는 보상 그 자체이고, **나가는 길은 안 보이면 없는 것**이다(③ 이 증명했다).
        //
        // **표정 4종을 64px 로 줄여 눈으로 봤다** (2026-09-15). 고글·스카프·나침반 빛은 살아 있고
        // **`compass_bright` 와 `session_end` 는 또렷하다.**
        // **⚠ 다만 `default` 와 `compass_dim` 은 자세 차이뿐이라 이 크기에서 약하다.**
        // 대사가 늘 같이 서므로(되묻기는 질문 문장이 온다) **뜻이 사라지지는 않지만**,
        // **여기가 하한이다 — 더 줄이면 표정이 아니라 장식이 된다.** PM 에게 알렸다.
        className="guide-image"
        priority
      />
      {/* 서버 문장은 그대로다. 소개 중에도 전체 높이를 미리 잡아 입력창이 밀리지 않는다.
          스크린리더에는 한 글자씩 알리지 않고 처음부터 전체 문장 하나를 제공한다. */}
      <figcaption className="guide-line">
        {messageRef ? (
          <div ref={messageRef} className={messageClassName} tabIndex={-1}>
            {dialogue ? (
              <span
                data-guide-dialogue
                className={`guide-dialogue${speaking ? " pressable" : ""}`}
                role={speaking ? "button" : undefined}
                tabIndex={speaking ? 0 : undefined}
                aria-label={speaking ? guide.line : undefined}
                onClick={speaking ? dialogue.advance : undefined}
                onKeyDown={speaking ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    dialogue.advance();
                  }
                } : undefined}
              >
                <span className="guide-dialogue-space" aria-hidden="true"><GuideText text={guide.line} visible="" /></span>
                <span className="guide-dialogue-typed" data-guide-typed aria-hidden={partial ? true : undefined}>
                  <GuideText text={guide.line} visible={dialogue.visible} caret={dialogue.phase === "prefix" || dialogue.phase === "rest"} />
                </span>
                {partial && <span className="sr-only">{guide.line}</span>}
              </span>
            ) : stage ? <GuideText text={guide.line} /> : guide.line}
          </div>
        ) : dialogue ? (
          <span
            data-guide-dialogue
            className={`guide-dialogue${speaking ? " pressable" : ""}`}
            role={speaking ? "button" : undefined}
            tabIndex={speaking ? 0 : undefined}
            aria-label={speaking ? guide.line : undefined}
            onClick={speaking ? dialogue.advance : undefined}
            onKeyDown={speaking ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                dialogue.advance();
              }
            } : undefined}
          >
            <span className="guide-dialogue-space" aria-hidden="true"><GuideText text={guide.line} visible="" /></span>
            <span className="guide-dialogue-typed" data-guide-typed aria-hidden={partial ? true : undefined}>
              <GuideText text={guide.line} visible={dialogue.visible} caret={dialogue.phase === "prefix" || dialogue.phase === "rest"} />
            </span>
            {partial && <span className="sr-only">{guide.line}</span>}
          </span>
        ) : stage ? <GuideText text={guide.line} /> : guide.line}
      </figcaption>
      {compass}
    </figure>
  );
}
