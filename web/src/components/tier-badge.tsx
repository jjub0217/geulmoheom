"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { components } from "@/api/types.gen";
import { TierBadgeCrest } from "@/components/tier-badge-crest";
import { TierBadgeHelp, 배지안내 } from "@/components/tier-badge-help";

type Tier = components["schemas"]["AttemptResult"]["tier"];

/**
 * 티어 배지 문구 (`docs/문구.md` **1.8** · `용어사전.md` 36행 **아이 화면** 열).
 *
 * 사용자 승인: 명사형 게임 보상 이름인 탐험가·영웅·전설을 함께 쓴다.
 * 서버 키·판정은 그대로 두고 결과·책·설명 창이 이 이름을 함께 쓴다.
 * 「티어」는 내부 용어라 아이 화면에 붙이지 않는다.
 */
export const 티어이름: Record<Tier, string> = {
  basic: "탐험가",
  rare: "영웅",
  legendary: "전설",
};

/**
 * 셋을 **같은 크기·같은 모양**으로 둔다. 색만 다르다 —
 * **「탐험가」를 작게 하거나 흐리게 하면 그것이 곧 「부족하다」**가 된다.
 * 금지어를 낱말로 안 쓰고 **연출로 말하는 자리**라, 폴백을 안 알리는 것과 같은 규칙이다.
 */
const 색: Record<Tier, string> = {
  basic: "tier-basic",
  rare: "tier-rare",
  legendary: "tier-legendary",
};

/**
 * **그림과 함께 열린다.** 굽는 동안에는 안 그린다 — 그림 전에 등급을 알면 보상의 순간이 죽는다
 * (`문구.md` 1.5). **그림을 못 받았을 때는 그린다**: 아이는 자기 문장이 통했다는 것을
 * 알아야 하고, 그림은 「내 책」에서 다시 본다 (1.7).
 */
export function TierBadge({ tier }: { tier: Tier }) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);
  const tooltipVisible = !open && !tooltipDismissed && (hovered || focused);

  useEffect(() => {
    if (!tooltipVisible) return;
    // 마우스로만 올린 경우에도 Escape로 설명을 가릴 수 있다.
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setTooltipDismissed(true);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [tooltipVisible]);

  const close = () => {
    setOpen(false);
    // 다른 배지 설명으로 옮겨 연 경우에는 그 창의 포커스를 지킨다.
    if (!document.querySelector("dialog[data-배지설명][open]")) {
      button.current?.focus();
    }
  };

  return (
    <span className="tier-badge-with-help">
      <span
        className="tier-badge-trigger"
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          setHovered(true);
          setTooltipDismissed(false);
        }}
        onPointerLeave={() => setHovered(false)}
      >
        <button
          ref={button}
          type="button"
          data-티어배지
          aria-label={`${티어이름[tier]} 뱃지, ${배지안내.제목}`}
          aria-haspopup="dialog"
          aria-describedby={tooltipVisible ? tooltipId : undefined}
          // 세 배지 모두 같은 글자 크기·모양이다. 뜻은 아이가 눌렀을 때만 연다.
          className={`tier-badge tier-badge-crest tier-badge-button ${색[tier]}`}
          onFocus={(event) => {
            // 터치로 설명창을 닫고 돌아왔을 때 툴팁이 따라 뜨지 않게 한다.
            if (!event.currentTarget.matches(":focus-visible")) return;
            setFocused(true);
            setTooltipDismissed(false);
          }}
          onBlur={() => setFocused(false)}
          onClick={() => {
            setTooltipDismissed(true);
            setOpen(true);
          }}
        >
          <TierBadgeCrest name={티어이름[tier]} />
        </button>
        {tooltipVisible && (
          <span id={tooltipId} role="tooltip" className="tier-badge-tooltip">
            <span>{배지안내.제목}</span>
          </span>
        )}
      </span>
      {open && createPortal(
        <TierBadgeHelp names={티어이름} onClose={close} />,
        document.body,
      )}
    </span>
  );
}
