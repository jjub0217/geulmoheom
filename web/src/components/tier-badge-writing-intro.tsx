"use client";

import { useId, useSyncExternalStore } from "react";

import { 티어이름 } from "@/components/tier-badge";
import { TierBadgeCrest } from "@/components/tier-badge-crest";
import { createBadgeAcknowledgement } from "@/components/tier-badge-help";

/** `docs/문구.md` 1.8. 입력하기 전에 배지와 행동 묘사의 관계를 볼 수 있게 한다. */
export const 배지쓰기안내 = {
  제목: "글을 쓰면 만나는 배지",
  설명: "무엇을 할지, 어떻게 할지, 어떤 기분인지 써 봐. 길게 쓰지 않아도 돼.",
  예시: "예시 보기",
  처음예시: "문을 연다.",
  자세한예시: "문 너머가 궁금해서 손잡이를 천천히 돌린다.",
  확인: "알겠어",
} as const;

/** 튜토리얼 T2 결과에서만 보이는 선택형 다시 쓰기 안내다. */
export const 다시쓰기안내 = "어떻게 했는지, 어떤 기분이었는지 더 써 보고 싶다면 이 장면을 다시 써 볼 수 있어.";

export const 배지쓰기안내저장키 = "geulmoheom:tier-badge-prewriting-v1";
const { 확인했나, 확인하기, 구독 } = createBadgeAcknowledgement(배지쓰기안내저장키);
const 서버에서는숨김 = () => true;

/** 입력이 열릴 때 함께 마운트한다. 안내를 확인하지 않아도 바로 쓰고 보낼 수 있다. */
export function TierBadgeWritingIntroduction({ onConfirm }: { onConfirm?: () => void }) {
  const titleId = useId();
  const 이미확인함 = useSyncExternalStore(구독, 확인했나, 서버에서는숨김);
  if (이미확인함) return null;

  return (
    <section data-배지쓰기안내 className="tier-badge-writing-intro" aria-labelledby={titleId}>
      <div className="tier-badge-writing-heading">
        <h2 id={titleId}>{배지쓰기안내.제목}</h2>
        <div className="tier-badge-writing-preview">
          <span className="tier-badge tier-badge-crest tier-basic"><TierBadgeCrest name={티어이름.basic} /></span>
          <span className="tier-badge tier-badge-crest tier-rare"><TierBadgeCrest name={티어이름.rare} /></span>
          <span className="tier-badge tier-badge-crest tier-legendary"><TierBadgeCrest name={티어이름.legendary} /></span>
        </div>
      </div>
      <p>{배지쓰기안내.설명}</p>
      <div className="tier-badge-writing-actions">
        <details data-배지쓰기예시>
          <summary>{배지쓰기안내.예시}</summary>
          <div className="tier-badge-writing-examples" tabIndex={0}>
            <p>{배지쓰기안내.처음예시}</p>
            <span aria-hidden="true">↓</span>
            <p>{배지쓰기안내.자세한예시}</p>
          </div>
        </details>
        <button
          type="button"
          data-배지쓰기확인
          onClick={() => {
            확인하기();
            onConfirm?.();
          }}
        >
          {배지쓰기안내.확인}
        </button>
      </div>
    </section>
  );
}
