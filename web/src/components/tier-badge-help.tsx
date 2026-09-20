"use client";

import { useEffect, useId, useRef } from "react";

import { TierBadgeCrest } from "@/components/tier-badge-crest";

/**
 * `docs/문구.md` 1.8. **설명은 아이가 원할 때만 연다.**
 *
 * **⛔ 종전 「첫 안내」 줄(「네가 쓴 묘사로 얻은 배지야…」 + 「알겠어」)은
 * 2026-09-21 사용자 판정으로 내렸다** — **설명이 세 겹이었다.**
 * 배지에 올리면 **툴팁**, 누르면 **설명 창**, 그 아래 또 한 줄이 있었다.
 * **조건은 앞의 둘이 살아 있는 것**이었고 둘 다 그대로다(`tier-badge.tsx`).
 * **`문구.md` 1.8 은 아직 그 줄을 들고 있다 — PM 이 지워야 한 벌이 맞는다.**
 */
export const 배지안내 = {
  제목: "배지 알아보기",
  설명: "이야기에 무엇을 했는지뿐 아니라 어떻게 했는지, 무엇이 보이고 들렸는지, 어떤 기분이었는지도 담아 봐. 담은 내용에 따라 받을 수 있는 배지가 달라져.",
  순서: "배지는 탐험가, 영웅, 전설 순서로 이어져.",
  길이안내: "글을 길게 쓰는 것만으로 정해지지는 않아.",
  책안내: "책에는 모험 중에 얻은 배지를 남겨.",
  닫기: "닫기",
} as const;

export function TierBadgeHelp({ names, onClose }: {
  names: Record<"basic" | "rare" | "legendary", string>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // 책에는 여러 배지가 있으므로 설명 창은 한 번에 하나만 연다.
    for (const other of document.querySelectorAll<HTMLDialogElement>("dialog[data-배지설명][open]")) {
      if (other !== element) other.close();
    }
    element.showModal();
    // 작은 화면에서도 설명 첫머리부터 읽고, Tab으로 닫기 버튼에 이어 간다.
    title.current?.focus({ preventScroll: true });
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      data-배지설명
      className="tier-badge-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={(event) => {
        // Strict Mode의 effect 재실행에서 온 이전 close 이벤트는 새 창을 닫지 않는다.
        if (event.currentTarget.open) return;
        onClose();
      }}
    >
      <h2 ref={title} id={titleId} tabIndex={-1}>{배지안내.제목}</h2>
      <div id={descriptionId} className="tier-badge-help-text">
        <p>{배지안내.설명}</p>
        <p>{배지안내.순서}</p>
        <div className="tier-badge-preview" aria-hidden="true">
          <span className="tier-badge tier-badge-crest tier-basic"><TierBadgeCrest name={names.basic} /></span>
          <span className="tier-badge tier-badge-crest tier-rare"><TierBadgeCrest name={names.rare} /></span>
          <span className="tier-badge tier-badge-crest tier-legendary"><TierBadgeCrest name={names.legendary} /></span>
        </div>
        <p>{배지안내.길이안내}</p>
        <p>{배지안내.책안내}</p>
      </div>
      <form method="dialog" className="tier-badge-help-actions">
        <button type="submit" data-배지설명닫기>{배지안내.닫기}</button>
      </form>
    </dialog>
  );
}
