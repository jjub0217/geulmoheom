"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { CompassGlow } from "@/components/compass-glow";
import { PII_MASK, maskPii, type PiiKind } from "@/lib/pii";

/**
 * 자유 입력창. **선택지는 없다** — Stage 0 이 검증하는 것이 「직접 쓴다」이기 때문이다.
 *
 * 라벨은 서버가 준 `prompt_label` 을 그대로 쓴다 (「탐험가는 어떻게 할까?」).
 * 프론트에 문구를 박아두면 서버가 카드마다 다른 물음을 줄 때 화면만 옛말을 하게 된다.
 *
 * **여기 담기는 값은 아이의 창작물이다.** 로깅·오류 리포터에 절대 흘리지 않는다 (PRD 1.1b) —
 * `onChange` 에서 값을 어디로도 보내지 않고, 부모도 화면에 그리는 것 외에 쓰지 않는다.
 * `onMasked` 로 나가는 것도 **종류뿐이고 문장은 아니다.**
 */

/**
 * 가렸을 때 아이가 받는 유일한 설명이다. **혼내는 톤이 아닌 것**이 규칙이다 —
 * 「안 돼」가 아니라 「안 써도 돼」다.
 *
 * **확정본은 `docs/문구.md` 1.1** 이다 (2026-09-07). 클라이언트가 가리는 자리라 서버 값이 없어
 * 여기 있지만, **SSOT 는 문서고 코드가 따라온다.** 여기서 새로 지어내지 않는다.
 */
export const 가림안내: Record<PiiKind, string> = {
  phone: "전화번호는 안 써도 돼서 가렸어!",
  email: "메일 주소는 안 써도 돼서 가렸어!",
  address: "사는 곳은 안 써도 돼서 가렸어!",
  school: "학교 이름은 안 써도 돼서 가렸어!",
};

/**
 * **쓰는 자리 하나가 한 덩어리다** (2026-09-09, 실기기에서 사용자가 보고 고침).
 *
 * 전에는 **라벨·나침반·입력창·「보내기」가 각각 떨어져** 있었다. 그래서 셋이 안 읽혔다 —
 * ① 라벨 옆 나침반이 **무엇에 반응하는 물건인지** 안 보였고 ② 「보내기」가 **오른쪽 아래 멀리**
 * 있어 쓰던 자리와 끊겼고 ③ 칸이 낮아 **짧게 쓰라는 신호**를 줬다.
 *
 * **만 11세는 라벨이 아니라 「가까움」과 「담김」으로 관계를 읽는다.** 그래서 넷을 **테두리 하나 안**에
 * 넣었다 — 물음이 위, 쓰는 칸이 가운데, **나침반과 「보내기」가 같은 바닥 줄**이다.
 * **나침반이 자기 글자 옆에서 밝아지므로** 무엇이 무엇을 움직이는지가 자리로 보인다.
 *
 * **숫자·바·퍼센트는 여전히 없다** (PRD A0-2 MUST). **읽히게 만드는 것과 숫자를 쓰는 것은 다르다** —
 * 바꾼 것은 나침반의 **자리**이지 표시 방식이 아니다.
 */
export function AttemptInput({
  label,
  value,
  onChange,
  onMasked,
  onSend,
  보낼수있나,
  보내기라벨,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** 가린 **종류**만 알린다. 문장은 넘기지 않는다. */
  onMasked?: (kinds: PiiKind[]) => void;
  /** 「보내기」가 이 안에 있다. **쓰던 자리와 보내는 자리를 떼어놓지 않는다.** */
  onSend: () => void;
  보낼수있나: boolean;
  /** `문구.md` 2.2. **여기서 짓지 않는다** — 부모가 상수를 넘긴다. */
  보내기라벨: string;
  disabled?: boolean;
}) {
  const 입력창 = useRef<HTMLTextAreaElement>(null);
  /**
   * **한글 조합 중에는 값을 갈아치우지 않는다.** 조합 중인 글자를 바꿔치기하면
   * IME 가 조합을 잃고 글자가 깨진다 — 취향이 아니라 버그다.
   * 「우리 학교는 한빛초등학교야」처럼 **한글이 섞인 패턴에서 실제로 터진다.**
   */
  const 조합중 = useRef(false);
  /** 치환 뒤 커서를 되돌릴 자리. 값이 바뀐 **다음**에 놓아야 해서 렌더를 한 번 건너뛴다. */
  const 되돌릴커서 = useRef<number | null>(null);
  const [안내, set안내] = useState<string | null>(null);

  // 값이 화면에 반영된 **직후** 커서를 놓는다. `useEffect` 로 하면 한 프레임 동안
  // 커서가 맨 끝에 가 있는 것이 보인다.
  useLayoutEffect(() => {
    const 자리 = 되돌릴커서.current;
    if (자리 === null || !입력창.current) return;
    되돌릴커서.current = null;
    입력창.current.setSelectionRange(자리, 자리);
  }, [value]);

  const 가리고전달 = (raw: string, caret: number) => {
    const r = maskPii(raw, caret);
    onChange(r.text);

    if (r.kinds.length === 0) {
      // **가린 자리가 남아 있는 동안은 안내를 지우지 않는다.** 다음 글자 하나에 사라지면
      // 아이가 읽기 전에 없어지고, 자기 글자가 왜 바뀌었는지 알 방법이 사라진다.
      if (!r.text.includes(PII_MASK)) set안내(null);
      return;
    }
    되돌릴커서.current = r.caret;
    set안내(r.kinds.map((k) => 가림안내[k]).join(" "));
    onMasked?.(r.kinds);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* **테두리가 이 덩어리를 감싼다.** 전에는 테두리가 `textarea` 에만 있어
          「보내기」가 **다른 물건**으로 보였다. 초점 표시도 여기로 올라온다 —
          `focus-within` 이라 **키보드로 들어와도 어느 자리인지 보인다.** */}
      <div
        className="flex flex-col rounded-3xl border-2 border-brass/50 bg-markings/70
          outline-2 outline-offset-2 outline-transparent focus-within:border-glow
          focus-within:outline-glow dark:bg-glow-deep/40"
      >
        <label htmlFor="attempt" className="px-5 pt-4 text-xl">
          {label}
        </label>
        <textarea
        id="attempt"
        ref={입력창}
        value={value}
        onCompositionStart={() => {
          조합중.current = true;
        }}
        onCompositionEnd={(e) => {
          조합중.current = false;
          // 조합이 끝난 지금 검사한다. `onChange` 가 조합 중에 그냥 흘려보냈기 때문이다.
          가리고전달(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onChange={(e) => {
          if (조합중.current) {
            // 조합 중에는 **그대로 흘려보낸다.** 가리는 것은 조합이 끝난 뒤다.
            onChange(e.target.value);
            return;
          }
          가리고전달(e.target.value, e.target.selectionStart);
        }}
          // 보내는 중에는 잠근다. 값은 그대로 두어 **쓴 것이 눈앞에 남아 있게** 한다.
          readOnly={disabled}
          // **칸의 크기는 「얼마나 쓰는가」를 말하는 신호다.** 4줄은 짧게 쓰라는 뜻이었다 —
          // H2 합격선이 **회당 150자**다. 더 키우지 않는 것은 **아이패드에서 자판이 올라오면
          // 화면의 절반이 사라지기 때문**이고, 그때 「보내기」가 밖으로 밀리면 안 된다.
          rows={5}
        // 아이가 쓰는 칸이다. 맞춤법 빨간 줄로 「틀렸다」는 인상을 주지 않는다.
        spellCheck={false}
        autoComplete="off"
        // 테두리는 **비어 있을 때도 보여야 한다.** 배경색만으로 칸을 나타내면
        // 밝은 배경에서 칸이 사라져 아이가 어디에 쓰는지 모른다 — 첫 스크린샷에서 실제로 그랬다.
          // 테두리와 배경은 위 감싸개가 가진다. 여기는 **글자만** 둔다 —
          // 안에 또 테두리를 그리면 **상자 안의 상자**가 되어 덩어리가 다시 갈라진다.
          className="w-full resize-none bg-transparent px-5 py-3 text-xl/relaxed
            text-foreground outline-none"
        />

        {/* **나침반이 「보내기」 바로 왼쪽에 붙는다.**
            처음엔 바닥 줄 양 끝으로 벌려 봤는데(`justify-between`) **화면을 찍어 보니 더 나빴다** —
            큰 빈 상자의 좌하단에 **점 하나가 홀로** 남아, 쓰는 글자와도 「보내기」와도 멀었다.
            **원래 문제(「무엇인지 안 읽힌다」)가 자리만 옮겨 그대로 남은 것**이다.
            붙여 두면 **읽는 순서가 「이게 차오른다 → 여기를 누른다」**가 되고, 아이가 보내려고
            손을 뻗을 때 **반드시 지나가는 자리**에 있다. */}
        <div className="flex items-center justify-end gap-5 px-5 pb-4">
          {/* 길이는 **가린 뒤 문장 기준**이다 — 화면·로그·책이 같은 문자열을 센다. */}
          <CompassGlow length={value.length} />
          <button
            type="button"
            disabled={!보낼수있나}
            onClick={onSend}
            className="rounded-full bg-scarf px-10 py-3 text-xl text-markings
              disabled:opacity-40"
          >
            {보내기라벨}
          </button>
        </div>
      </div>
      {안내 && (
        // 가린 이유를 말해주는 **유일한 자리**다. 전송을 막지 않으므로, 이 한 줄이 없으면
        // 아이는 자기 글자가 왜 바뀌었는지 알 방법이 없다.
        // 가이드 캐릭터 표정은 쓰지 않는다 — 제출 전 표정은 `default` 고정이다 (`Stage0.md` 3절).
        <p role="status" className="text-lg text-brass">
          {안내}
        </p>
      )}
    </div>
  );
}
