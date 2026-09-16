"use client";

import { useEffect, useRef, useState } from "react";

import type { components } from "@/api/types.gen";
import { AttemptInput } from "@/components/attempt-input";
import { TurnChoices } from "@/components/turn-choices";
import { 턴문구 } from "@/components/turn-copy";
import { ApiError, NetworkError, apiGet, apiPost } from "@/lib/api";
import type { PiiKind } from "@/lib/pii";

import { 버튼, 못닿음 } from "../copy";
import { 상태표시 } from "../status-copy";

type ChapterView = components["schemas"]["ChapterView"];
type TurnResult = components["schemas"]["TurnResult"];

/**
 * 챕터 턴 화면 (백로그 A-3 · W7 **7번**).
 *
 * ## ⛔ 이 조각의 범위 — 「턴이 넘어간다」까지다
 *
 * **선택지로도, 직접 써서도 턴이 넘어간다**가 7번의 완료 조건이다.
 * **서사 영역·시련 화면·완결 화면은 8번**이고 **백엔드 3번 뒤**다 — 여기서는 서사를
 * **그대로 한 덩이로** 놓는다. **8번이 그 자리를 가져간다.**
 *
 * ## ⛔ 아직 아이에게 켜지 않는다
 *
 * **`api/Stage1.md` 2절의 11단계가 하나도 안 돈다** — **입력 Moderation · PII 마스킹 ·
 * GM 출력 검사가 없다**(2026-09-16 백엔드). 지금 붙은 것은 **목**이다.
 * **켜는 것은 A-1 이 서고 그 검사가 붙은 뒤다.** 화면을 만드는 것과 켜는 것은 다르다.
 *
 * ## 고정값에 기대지 않는다
 *
 * 목의 `narrative`·선택지 라벨·`grade`·`state` 는 **A-1 이 서면 GM 것으로 바뀐다.**
 * **모양만 쓰고 값에 의존하지 않는다** — 검사에도 그 값들을 안 박았다.
 */
type Screen =
  | { kind: "loading" }
  /** 쓰는 중 · 고르는 중. **둘이 같은 화면**이다 — 계약이 엔드포인트를 안 가른 것과 짝이다. */
  | { kind: "turn"; view: 턴상태 }
  /** 보내는 중. 같은 화면을 두고 잠그기만 한다 — 쓴 것이 사라지면 아이는 날아간 줄 안다. */
  | { kind: "sending"; view: 턴상태 }
  /** 챕터가 끝났다. **완결 연출은 8번**이다 — 여기서는 끝났다는 것만 잡아 둔다. */
  | { kind: "done" }
  | { kind: "unreachable" };

/**
 * 화면이 그리는 데 필요한 것만 추린 모양.
 *
 * **`ChapterView` 와 `TurnResult` 를 하나로 받는다** — 둘 다 「지금 무엇을 보여줄까」를
 * 담고 있는데 필드 이름이 같다. **갈라 두면 화면이 두 갈래를 따로 그리게 된다.**
 */
type 턴상태 = {
  chapterId: string;
  turn: number;
  /** **⛔ 8번이 가져갈 자리다.** 지금은 있는 그대로 놓는다 */
  narrative: string | null;
  choices: components["schemas"]["Choice"][];
  /** 되묻기. 오면 **턴이 안 늘고** `narrative` 는 `null` 이다 (계약이 그렇게 박았다) */
  scaffold: string | null;
};

function 턴상태로(v: ChapterView): 턴상태 {
  return {
    chapterId: v.chapter_id,
    turn: v.turn,
    narrative: v.narrative,
    choices: v.choices,
    scaffold: null,
  };
}

export default function ChapterPage() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [text, setText] = useState("");
  const [보내기못닿음, set보내기못닿음] = useState(false);
  /** 시작을 **한 번만** 부른다. React 18 개발 모드가 effect 를 두 번 돌린다. */
  const 시작했다 = useRef(false);

  useEffect(() => {
    if (시작했다.current) return;
    시작했다.current = true;

    // **이어하기가 먼저다.** 새로 열기부터 부르면 **돌아온 아이의 챕터를 덮는다.**
    apiGet<ChapterView>("/chapters/current")
      .then((v) => setScreen({ kind: "turn", view: 턴상태로(v) }))
      .catch(async (e) => {
        // 진행 중인 챕터가 없으면 연다. **그 외의 오류는 삼키지 않는다.**
        if (e instanceof ApiError && e.status === 404) {
          try {
            const v = await apiPost<ChapterView>("/chapters", {});
            setScreen({ kind: "turn", view: 턴상태로(v) });
          } catch {
            setScreen({ kind: "unreachable" });
          }
          return;
        }
        setScreen({ kind: "unreachable" });
      });
  }, []);

  /**
   * 턴 하나를 보낸다.
   *
   * **⛔ `choice_id` 와 `text` 중 정확히 하나다** — 둘 다 보내거나 둘 다 안 보내면 **422** 다.
   * **목에서도 진짜로 막는다.** 그래서 **부르는 자리를 하나로 두고 인자로 가른다** —
   * 두 함수로 두면 **한쪽만 고치는 날이 온다.**
   */
  const 턴을보낸다 = async (몸: { choice_id: string } | { text: string }) => {
    if (screen.kind !== "turn") return;
    const view = screen.view;
    set보내기못닿음(false);
    setScreen({ kind: "sending", view });

    try {
      const r = await apiPost<TurnResult>("/turns", { chapter_id: view.chapterId, ...몸 });

      if (r.chapter_done) {
        setScreen({ kind: "done" });
        return;
      }

      // **되묻기면 쓴 것을 안 지운다** — 고쳐 쓰라는 말인데 칸을 비우면 처음부터 쓰게 된다.
      const 되묻는다 = r.scaffold != null;
      if (!되묻는다) setText("");

      setScreen({
        kind: "turn",
        view: {
          chapterId: view.chapterId,
          turn: r.turn,
          narrative: r.narrative ?? null,
          // **되묻기일 때 선택지를 안 갈아치운다** — 계약상 그 턴은 안 는다.
          choices: r.choices ?? view.choices,
          scaffold: r.scaffold ?? null,
        },
      });
    } catch (e) {
      // **화면을 안 버린다.** 쓴 것을 그대로 두고 한 줄로만 알린다 —
      // 못 닿은 것은 **다시 보내면 되는 일**이고, 화면을 갈아치우면 다시 보낼 칸이 사라진다.
      if (e instanceof NetworkError) set보내기못닿음(true);
      else set보내기못닿음(true);
      setScreen({ kind: "turn", view });
    }
  };

  if (screen.kind === "loading") {
    // **새 문구를 안 짓는다.** 챕터를 여는 것도 **장면을 펼치는 일**이라 2.5 의 그 줄이
    // 그대로 맞는다 — 「챕터를 여는 중…」을 지으면 **같은 뜻에 두 벌**이 생긴다(1.21 과 같은 판단).
    return <p role="status">{상태표시.장면부르는중}</p>;
  }

  if (screen.kind === "unreachable") {
    // 장면을 못 연 것이라 **`장면` 갈래**다. 보내기 실패와 다른 문장인 것이 맞다.
    return <p role="status">{못닿음.장면}</p>;
  }

  if (screen.kind === "done") {
    // **완결 화면은 8번이다**(`문구.md` 1.20). 여기서 문장을 지어내지 않는다.
    return <p role="status" data-testid="chapter-done" />;
  }

  const view = screen.view;
  const 보내는중 = screen.kind === "sending";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8">
      {/* **⛔ 8번이 가져갈 자리다.** 지금은 서사를 있는 그대로 놓는다 —
          여기에 연출을 넣기 시작하면 8번이 그것을 걷어내며 시작하게 된다. */}
      {view.narrative && <p className="text-xl/relaxed">{view.narrative}</p>}

      {/* 되묻기는 **가이드가 하는 말**이라 선택지 위에 온다 — 아이가 방금 쓴 것에 대한 대답이다. */}
      {view.scaffold && (
        <p role="status" className="text-lg text-brass">
          {view.scaffold}
        </p>
      )}

      {/* **선택지가 먼저, 「아니면」이 그 아래다** (`문구.md` 1.18).
          순서를 뒤집으면 「아니면」이 가리킬 것이 아직 없다. */}
      <TurnChoices
        choices={view.choices}
        disabled={보내는중}
        onChoose={(id) => void 턴을보낸다({ choice_id: id })}
      />

      <AttemptInput
        // **물음은 선택지가 이미 했다.** 여기 라벨을 또 두면 같은 말을 두 번 한다.
        label=""
        안내글={턴문구.입력안내}
        value={text}
        onChange={setText}
        onMasked={(kinds: PiiKind[]) => void kinds}
        onSend={() => void 턴을보낸다({ text })}
        보낼수있나={text.trim().length > 0 && !보내는중}
        // **2.5 넷째가 이 자리를 위해 쓰인 문장이다** — W6 26번에서 「보내기와 결과 사이가
        // 비어 있다」로 내려온 그 줄이고, 턴 보내기가 **같은 상황**이다.
        보내기라벨={보내는중 ? 상태표시.읽는중 : 버튼.보내기}
        disabled={보내는중}
      />

      {보내기못닿음 && (
        <p role="status" className="text-lg text-brass">
          {못닿음.보내기}
        </p>
      )}
    </main>
  );
}
