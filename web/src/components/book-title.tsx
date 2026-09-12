"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { 책이름, 책이름상한 } from "@/app/book/copy";
import { 못닿음 } from "@/app/copy";
import { ApiError, NetworkError, apiPatch, 인증이풀렸다 } from "@/lib/api";
import { PII_MASK, maskPii, 가림안내, type PiiKind } from "@/lib/pii";

/**
 * 책 이름 고치기 (`문구.md` **1.16**, A0-4 후속 · `PATCH /book`).
 *
 * **⛔ 낱말은 「책 이름」이다.** 아이 화면에 「제목」을 쓰지 않는다 (`용어사전.md` 1장) —
 * 변수명·주석은 자유지만 **화면에 렌더되는 문자열**은 `책이름` 상수에서만 온다.
 *
 * **여기 담기는 값은 아이의 창작물이다** — 카드 입력창과 같다 (PRD 1.1b).
 * 로깅·오류 리포터로 흘리지 않고, `onMasked` 로 나가는 것도 **종류뿐이고 문장이 아니다.**
 *
 * **컴포넌트 이름이 영문인 것은 도구 제약이다** — `react-hooks/rules-of-hooks` 가
 * 첫 글자 대문자로 컴포넌트를 판정하는데 **한글에는 대문자가 없다** (`web/CLAUDE.md`).
 */
export function BookTitle({
  title,
  onChanged,
  onUnauthorized,
  onMasked,
}: {
  title: string;
  /** 서버가 **실제로 저장한 값**을 올려보낸다. 아래 주석 참조. */
  onChanged: (title: string) => void;
  onUnauthorized: () => void;
  onMasked?: (kinds: PiiKind[]) => void;
}) {
  const [고치는중, set고치는중] = useState(false);
  const [값, set값] = useState(title);
  const [가림, set가림] = useState<string | null>(null);
  const [알림, set알림] = useState<string | null>(null);
  const [보내는중, set보내는중] = useState(false);

  const 입력칸 = useRef<HTMLInputElement>(null);
  /**
   * **한글 조합 중에는 값을 갈아치우지 않는다.** 조합 중인 글자를 바꿔치기하면
   * IME 가 조합을 잃고 글자가 깨진다 — 카드 입력창과 **같은 함정, 같은 처리**다.
   */
  const 되돌릴커서 = useRef<number | null>(null);

  useLayoutEffect(() => {
    const 자리 = 되돌릴커서.current;
    if (자리 === null || !입력칸.current) return;
    되돌릴커서.current = null;
    입력칸.current.setSelectionRange(자리, 자리);
  }, [값]);

  const 비었다 = 값.trim() === "";

  /**
   * **카드 화면과 같은 규칙이다** (`attempt-input.tsx` 의 `가리고전달`).
   * **여기서 새 분기를 만들지 않는다** — 가린 뒤 값이 그대로 입력칸에 남고,
   * 아이는 자기 글자가 왜 바뀌었는지 읽고 고칠 수 있다.
   */
  const 가리고둔다 = (raw: string, caret: number) => {
    const r = maskPii(raw, caret);
    set값(r.text);
    set알림(null);

    if (r.kinds.length === 0) {
      // **가린 자리가 남아 있는 동안은 안내를 지우지 않는다.** 다음 글자 하나에 사라지면
      // 아이가 읽기 전에 없어진다.
      if (!r.text.includes(PII_MASK)) set가림(null);
      return;
    }
    되돌릴커서.current = r.caret;
    set가림(r.kinds.map((k) => 가림안내[k]).join(" "));
    onMasked?.(r.kinds);
  };

  const 연다 = () => {
    set값(title);
    set가림(null);
    set알림(null);
    set고치는중(true);
  };

  const 보낸다 = async () => {
    // **빈 이름으로는 안 보낸다.** 서버가 조용히 무시하므로 보내면 **아무 일도 안 일어나고
    // 아이는 그것을 고장으로 읽는다** (`문구.md` 1.16).
    //
    // **⚠ `비었다` 갈래는 지금 아무 데서도 안 돈다** (2026-09-12 실측). 아래 제출 버튼이
    // `disabled` 라 **HTML 이 `Enter` 암묵 제출 자체를 안 일으킨다** — 기본 버튼이 막혀 있으면
    // 그렇게 정해져 있다. 그래서 **이 줄을 지워도 검사가 안 깨진다.**
    // **뒤집어 확인하다 나왔다** — 그 전에는 이 줄이 `Enter` 를 막는 줄 알고 그렇게 적어 뒀다.
    //
    // **그래도 남긴다.** 누가 `disabled` 를 떼거나 부르는 자리가 하나 더 생기면 **그때 이 줄이
    // 유일한 바닥**이고, 그 변경은 조용하다. **안 돈다고 적어 두는 것이 지우는 것보다 싸다** —
    // 안 적으면 다음 세션이 「검사가 덮고 있다」고 읽는다.
    if (비었다 || 보내는중) return;
    set보내는중(true);
    set알림(null);
    try {
      const r = await apiPatch<{ title: string }>("/book", { title: 값 });
      // **서버가 돌려준 값을 쓴다. 내가 보낸 값이 아니다.**
      // 서버도 본문과 같은 자리에서 PII 를 가리고(`3dc4bd5`) 120자에서 자른다 —
      // **응답의 `title` 이 실제로 저장된 값**이고, 표지에 인쇄되는 것도 그것이다.
      // 내 값을 그리면 **화면과 책이 갈린다.**
      onChanged(r.title);
      set값(r.title);
      set고치는중(false);
      set가림(null);
      set알림(책이름.바꿨다);
    } catch (e: unknown) {
      // **인증이 풀렸으면 바꾼 척하지 않는다.** 책 화면이 하는 것과 같은 처리다.
      if (인증이풀렸다(e)) {
        onUnauthorized();
        return;
      }
      // **못 닿았는데 「바꿨어」를 말하지 않는다** — 그 한 줄이 성공과 실패를 가르는
      // 유일한 표시라(1.16), 실패에 붙이면 **표시가 거짓말이 된다.**
      set알림(e instanceof ApiError ? e.서버문구 : 못닿음.책이름);
      if (!(e instanceof ApiError) && !(e instanceof NetworkError)) throw e;
    } finally {
      set보내는중(false);
    }
  };

  if (!고치는중) {
    return (
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          data-책이름바꾸기
          onClick={연다}
          className="rounded-full border-2 border-brass/40 px-5 py-2 text-lg opacity-80"
        >
          {책이름.바꾸기}
        </button>
        {/* **바꾼 뒤 한 줄** (1.16). `role="status"` 라 화면 낭독기도 읽는다.
            **닫은 뒤에도 남긴다** — 아이가 결과를 읽기 전에 사라지면 안 말한 것과 같다. */}
        {알림 !== null && (
          <p data-책이름알림 role="status" className="text-lg">
            {알림}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void 보낸다();
      }}
    >
      {/* **라벨을 따로 두지 않는다** — 바로 위가 책 이름이고 버튼이 「이 이름으로 하기」라
          무엇을 쓰는 칸인지 이미 말하고 있다. `문구.md` 1.16 에도 라벨 행이 없다. */}
      <input
        ref={입력칸}
        type="text"
        data-책이름칸
        aria-label={책이름.바꾸기}
        value={값}
        // **더 안 써지게 하는 것이 상한을 말하는 방법이다** (`문구.md` 6.y) —
        // 「30자까지만 쓸 수 있어요」를 띄우면 **그것이 혼내는 말이 된다.**
        maxLength={책이름상한}
        onChange={(e) => 가리고둔다(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        className="w-full rounded-2xl border-2 border-brass/50 bg-markings/70 px-4 py-3
          text-center text-2xl outline-2 outline-offset-2 outline-transparent
          focus:border-glow focus:outline-glow dark:bg-glow-deep/40"
      />

      {/* 가림 안내는 **1.1 그대로**다 — 카드 화면과 같은 문장, 같은 규칙. */}
      {가림 !== null && (
        <p data-책이름가림 role="status" className="text-lg">
          {가림}
        </p>
      )}

      {/* **다 지웠을 때 무슨 일인지 말한다** (1.16). 버튼을 막기만 하면
          **왜 안 눌리는지**를 안 말한다. */}
      {비었다 && (
        <p data-책이름비었다 role="status" className="text-lg">
          {책이름.이름이있어야해}
        </p>
      )}

      {알림 !== null && (
        <p data-책이름알림 role="status" className="text-lg">
          {알림}
        </p>
      )}

      <button
        type="submit"
        data-책이름보내기
        disabled={비었다 || 보내는중}
        className="rounded-full bg-scarf px-8 py-3 text-xl text-markings disabled:opacity-50"
      >
        {책이름.이이름으로}
      </button>
    </form>
  );
}
