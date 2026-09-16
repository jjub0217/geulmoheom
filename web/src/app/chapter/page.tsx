"use client";

import { useEffect, useRef, useState } from "react";

import type { components } from "@/api/types.gen";
import { ArtworkFrame } from "@/components/artwork";
import { AttemptInput } from "@/components/attempt-input";
import { GuideFigure } from "@/components/guide";
import { TurnChoices } from "@/components/turn-choices";
import { 턴문구 } from "@/components/turn-copy";
import { ApiError, NetworkError, apiGet, apiPost } from "@/lib/api";
import { useArtwork } from "@/lib/artwork";
import { 액자에둘것 } from "@/lib/chapter-artwork";
import type { PiiKind } from "@/lib/pii";

import { 버튼, 못닿음 } from "../copy";
import { 상태표시 } from "../status-copy";

type ChapterView = components["schemas"]["ChapterView"];
type TurnResult = components["schemas"]["TurnResult"];
type ArtworkRef = components["schemas"]["ArtworkRef"];
type Guide = components["schemas"]["Guide"];
type Choice = components["schemas"]["Choice"];

/**
 * 챕터 화면 — 서사·시련·완결 (백로그 A-3 후속 · W7 **8번**).
 *
 * ## ⛔ `outcome` 셋을 다 그린다 — 하나를 오류로 때우지 않는다
 *
 * **`result` 진행 · `scaffold` 되묻기 · `blocked` 차단.** Stage 0 의 `/attempts` 와 같은
 * 모양이고 **셋 다 화면이 있다.**
 *
 * **⛔ `blocked` 를 오류 갈래로 보내지 않는다.** `Stage0.md` 148행 —
 * **「차단 시 아이가 쓴 문장을 지우지 않는다. 입력창에 그대로 남긴다. 이유도 모른 채
 * 공들여 쓴 글이 사라지면 그것 자체가 벌로 읽힌다.」** 오류로 보내면 그 규칙이 깨진다.
 * **`200` 이고 정상 응답**이다(2026-09-16 계약 정정).
 *
 * **⛔ 자해 신호를 따로 그리지 않는다** (`문구.md` 1.2). `outcome`·`reason`·표정이 전부
 * 같고 **대사 한 줄만 다르다** — 응답에 구분할 방법이 **일부러 없다.** 전용 화면을 만들면
 * **아이가 자기 신호가 특별히 취급됐다는 것을 알아챈다.**
 *
 * ## ⛔ 진행도를 숫자로 그리지 않는다
 *
 * `trial_progress` 가 오지만 **바·퍼센트·「n/3」으로 그리지 않는다.** 「점수」는 금지어이고,
 * **시련 진행은 서사로 말한다**(`Stage1.md` 3절). 이 화면이 그 값으로 하는 일은 **없다** —
 * 받되 안 그린다. **경로별 색·아이콘도 없다**(`문구.md` 1.19): 네 경로가 동등한데
 * 화면이 갈라 그리면 **문구 규칙을 화면이 깨는 자리**가 된다.
 */
type Screen =
  | { kind: "loading" }
  /** 쓰는 중 · 고르는 중. **되묻기·차단도 여기다** — 갈래를 따로 만들지 않는다. */
  | { kind: "turn"; view: 턴상태 }
  | { kind: "sending"; view: 턴상태 }
  /** 챕터가 끝났다. **가이드가 1.20 을 말한다** — 프론트가 문장을 안 짓는다. */
  | { kind: "done"; guide: Guide | null }
  | { kind: "unreachable" };

type 턴상태 = {
  chapterId: string;
  narrative: string | null;
  choices: Choice[];
  /** 되묻기·차단이 오면 서버가 준 가이드. **대사를 프론트가 짓지 않는다.** */
  guide: Guide | null;
  /** **액자에 지금 걸려 있는 것.** 새 그림이 올 때만 바뀐다 (`lib/chapter-artwork.ts`). */
  artwork: ArtworkRef | null;
};

export default function ChapterPage() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [text, setText] = useState("");
  const [보내기못닿음, set보내기못닿음] = useState(false);
  const 시작했다 = useRef(false);

  useEffect(() => {
    if (시작했다.current) return;
    시작했다.current = true;

    const 열린것으로 = (v: ChapterView) =>
      setScreen({
        kind: "turn",
        view: {
          chapterId: v.chapter_id,
          narrative: v.narrative,
          choices: v.choices,
          guide: null,
          // **첫 화면에는 직전이 없다.** 1턴이 핵심 씬이라 보통 여기서 온다.
          artwork: 액자에둘것(null, v.artwork),
        },
      });

    // **이어하기가 먼저다.** 새로 열기부터 부르면 **돌아온 아이의 챕터를 덮는다.**
    apiGet<ChapterView>("/chapters/current")
      .then(열린것으로)
      .catch(async (e) => {
        if (e instanceof ApiError && e.status === 404) {
          try {
            열린것으로(await apiPost<ChapterView>("/chapters", {}));
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
   * **⛔ `choice_id` 와 `text` 중 정확히 하나다** — 둘 다 또는 둘 다 없으면 **422** 다.
   * **부르는 자리를 하나로 두고 인자로 가른다** — 두 함수로 두면 **한쪽만 고치는 날이 온다.**
   */
  const 턴을보낸다 = async (몸: { choice_id: string } | { text: string }) => {
    if (screen.kind !== "turn") return;
    const view = screen.view;
    set보내기못닿음(false);
    setScreen({ kind: "sending", view });

    try {
      const r = await apiPost<TurnResult>("/turns", { chapter_id: view.chapterId, ...몸 });

      if (r.chapter_done) {
        setScreen({ kind: "done", guide: r.guide ?? null });
        return;
      }

      // **진행했을 때만 입력창을 비운다.** 되묻기는 고쳐 쓰라는 말이고,
      // **차단은 아이 글을 지우지 않는 것이 규칙**이다 (`Stage0.md` 148행).
      if (r.outcome === "result") setText("");

      setScreen({
        kind: "turn",
        view: {
          chapterId: view.chapterId,
          narrative: r.narrative ?? null,
          // **되묻기·차단은 선택지를 안 갈아치운다** — 그 턴은 안 갔다.
          choices: r.choices?.length ? r.choices : view.choices,
          guide: r.guide ?? null,
          // **⛔ 여덟 턴은 `artwork` 가 없다. 비우지 않는다.**
          artwork: 액자에둘것(view.artwork, r.artwork),
        },
      });
    } catch (e) {
      // **화면을 안 버린다.** 쓴 것을 그대로 두고 한 줄로만 알린다 —
      // 화면을 갈아치우면 **다시 보낼 칸이 사라진다.**
      void (e instanceof NetworkError);
      set보내기못닿음(true);
      setScreen({ kind: "turn", view });
    }
  };

  if (screen.kind === "loading") {
    // **새 문구를 안 짓는다** — 챕터를 여는 것도 **장면을 펼치는 일**이다.
    return <p role="status">{상태표시.장면부르는중}</p>;
  }

  if (screen.kind === "unreachable") {
    return <p role="status">{못닿음.장면}</p>;
  }

  if (screen.kind === "done") {
    // **완결 문장은 서버가 준다** (`문구.md` 1.20 · `guide.line`).
    // **⛔ 「이어서 더 하기」를 안 만든다 — 없는 것이 결정이다** (D-1 · 페르소나 7.1).
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8">
        {screen.guide && <GuideFigure guide={screen.guide} />}
      </main>
    );
  }

  const view = screen.view;
  const 보내는중 = screen.kind === "sending";

  return (
    /* **⛔ 화면을 두 칸으로 나눈다 — 읽는 곳과 하는 곳** (W6 14번 판정 · W7 8번 ④).
       **「그 화면에 온 사람이 해야 할 일은 첫 화면에 있어야 한다.」**
       챕터 화면에서 아이가 해야 할 일은 **고르거나 쓰는 것**이고, 그게 밖에 있으면
       **아이에게는 없는 것**이다.

       **왜 필요한가 — 서사 길이를 우리가 못 정한다.** GM 이 **150~300자**를 쓴다(PRD 4.1).
       그냥 쌓으면 **긴 서사에서 쓰는 칸이 밀려난다** — 실측으로 **1024×768 에서 421px 밖**이었다
       (2026-09-16). **짧은 서사로 자리를 맞췄으면 긴 것이 오는 날 처음 알았을 것이다.**

       **⭐ 읽는 것은 스크롤해도 된다.** 글을 읽다 내리는 것은 아이가 아는 동작이다 —
       **모르는 것은 「아래에 버튼이 있다」**이고, 그건 W6 에서 아이 셋이 다 못 찾았다.
       그래서 **서사는 접어 두고 하는 자리를 고정한다.**

       **`100svh` 다** (`100vh` 가 아니다). 모바일 주소창이 들락거리면 `vh` 가 거짓이 된다 —
       W6 에서 액자를 `45svh` 로 둔 것과 같은 이유다. */
    <main className="mx-auto flex h-[100svh] w-full max-w-2xl flex-col gap-4 px-5 py-4">
      {/* ── 읽는 곳. **여기만 넘친다** ─────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {/* **액자가 맨 위다** — 09-14 에 세운 우선순위(삽화 → 아이 문장 → 나가는 길 → 가이드).
            **없는 동안은 아예 안 그린다** — 빈 상자를 두면 「뭔가 오는데 안 왔다」로 읽힌다. */}
        {view.artwork && <ChapterArtwork 참조={view.artwork} />}

        {view.narrative && <p className="text-xl/relaxed">{view.narrative}</p>}

        {/* 되묻기·차단이 오면 **서버가 준 가이드 그대로**다. 표정도 대사도 프론트가 안 고른다.
            **차단과 자해가 같은 모양으로 온다** — 여기서 갈라 그리지 않는 것이 그 결정이다. */}
        {view.guide && <GuideFigure guide={view.guide} />}
      </div>

      {/* ── 하는 곳. **밀려나지 않는다** ───────────────────────────── */}
      <div className="flex shrink-0 flex-col gap-3">
      <TurnChoices
        choices={view.choices}
        disabled={보내는중}
        onChoose={(id) => void 턴을보낸다({ choice_id: id })}
      />

      <AttemptInput
        label=""
        안내글={턴문구.입력안내}
        value={text}
        onChange={setText}
        onMasked={(kinds: PiiKind[]) => void kinds}
        onSend={() => void 턴을보낸다({ text })}
        보낼수있나={text.trim().length > 0 && !보내는중}
        // **2.5 넷째가 이 자리를 위해 쓰인 문장이다** (W6 26번).
        보내기라벨={보내는중 ? 상태표시.읽는중 : 버튼.보내기}
        disabled={보내는중}
      />

      {보내기못닿음 && (
        <p role="status" className="text-lg text-brass">
          {못닿음.보내기}
        </p>
      )}
      </div>
    </main>
  );
}

/**
 * 액자 하나. **폴링은 기존 훅이 그대로 한다** (`lib/artwork.ts` · `Stage0.md` 5절) —
 * 챕터라고 새 규약을 만들지 않는다.
 *
 * **훅을 쓰려면 컴포넌트가 따로 있어야 한다** — 참조가 바뀔 때마다 훅이 다시 돌아야 하고,
 * 부모에서 조건부로 부르면 **훅 규칙을 깬다.**
 *
 * **⛔ prop 이름을 `ref` 로 두면 안 된다** — React 예약어라 `react-hooks/refs` 가
 * 「Cannot access refs during render」로 **일곱 줄을 한 번에** 뱉는다(2026-09-16 실측).
 * `web/CLAUDE.md` 의 한글 식별자 항목과 같은 자리다 — **규칙의 예외가 아니라 도구의 제약**이다.
 */
function ChapterArtwork({ 참조 }: { 참조: ArtworkRef }) {
  const 상태 = useArtwork(참조);
  return <ArtworkFrame 상태={상태} />;
}
