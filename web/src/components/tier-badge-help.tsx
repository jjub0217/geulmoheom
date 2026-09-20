"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";

import { TierBadgeCrest } from "@/components/tier-badge-crest";

/** `docs/문구.md` 1.8. 설명은 아이가 원할 때 열고, 첫 안내는 확인 전까지 유지한다. */
export const 배지안내 = {
  첫안내: "네가 쓴 묘사로 얻은 배지야. 배지를 누르면 뜻을 볼 수 있어.",
  확인: "알겠어",
  제목: "배지 알아보기",
  설명: "이야기에 무엇을 했는지뿐 아니라 어떻게 했는지, 무엇이 보이고 들렸는지, 어떤 기분이었는지도 담아 봐. 담은 내용에 따라 받을 수 있는 배지가 달라져.",
  순서: "배지는 탐험가, 영웅, 전설 순서로 이어져.",
  길이안내: "글을 길게 쓰는 것만으로 정해지지는 않아.",
  책안내: "책에는 모험 중에 얻은 배지를 남겨.",
  닫기: "닫기",
} as const;

export const 배지안내저장키 = "geulmoheom:tier-badge-introduced";

/** 확인 여부 하나만 저장한다. 쓰기 전 안내와 결과 안내의 기억은 서로 섞지 않는다. */
export function createBadgeAcknowledgement(storageKey: string) {
  let 확인함 = false;
  const 구독자 = new Set<() => void>();

  function 확인했나() {
    if (확인함) return true;
    try {
      return window.localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  }

  function 확인하기() {
    확인함 = true;
    try {
      window.localStorage.setItem(storageKey, "true");
    } catch {
      // 계정·아이·문장은 저장하지 않는다. 저장소가 막혀도 현재 탭의 확인 상태는 지킨다.
    }
    for (const 알리기 of 구독자) 알리기();
  }

  function 구독(알리기: () => void) {
    구독자.add(알리기);
    const 다른탭확인 = (event: StorageEvent) => {
      if (event.key === storageKey) 알리기();
    };
    window.addEventListener("storage", 다른탭확인);
    return () => {
      구독자.delete(알리기);
      window.removeEventListener("storage", 다른탭확인);
    };
  }

  return { 확인했나, 확인하기, 구독 };
}

const { 확인했나, 확인하기, 구독 } = createBadgeAcknowledgement(배지안내저장키);
const 서버에서는숨김 = () => true;

export function TierBadgeIntroduction({ onConfirm }: { onConfirm: () => void }) {
  const 이미확인함 = useSyncExternalStore(구독, 확인했나, 서버에서는숨김);
  if (이미확인함) return null;

  return (
    <span data-배지첫안내 className="tier-badge-introduction">
      <span>{배지안내.첫안내}</span>
      <button
        type="button"
        data-배지안내확인
        onClick={() => {
          확인하기();
          onConfirm();
        }}
      >
        {배지안내.확인}
      </button>
    </span>
  );
}

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
        확인하기();
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
