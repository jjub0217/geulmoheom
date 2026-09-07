"use client";

import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import { AttemptInput } from "@/components/attempt-input";
import { GuideFigure } from "@/components/guide";
import { SceneCard } from "@/components/scene-card";
import { ApiError, NetworkError, apiGet, apiPost } from "@/lib/api";

type Card = components["schemas"]["Card"];
/** 세 형태가 한 응답에 온다 (`outcome`). 이번 조각은 **보내는 것까지**고, 3분기 연출은 다음 항목이다. */
type AttemptOutcome =
  | components["schemas"]["AttemptResult"]
  | components["schemas"]["AttemptScaffold"]
  | components["schemas"]["AttemptBlocked"];
type Guide = components["schemas"]["Guide"];

/**
 * 오늘의 모험 화면 (백로그 A0-2).
 *
 * 이번 조각은 **장면 카드까지**다 — 가이드·자유 입력창·나침반 빛은 다음 조각에서 붙는다
 * (`web/tasks/W2.md` 1번).
 *
 * 상태는 넷이고 **넷 다 화면이 있다.** 빈 화면으로 두는 자리를 만들지 않는다 —
 * 아이는 왜 아무 일도 안 일어나는지 알 방법이 없다.
 */
type Screen =
  | { kind: "loading" }
  | { kind: "card"; card: Card }
  /** 보내는 중. 같은 화면을 두고 버튼만 잠근다 — 쓴 것이 사라지면 아이는 날아간 줄 안다. */
  | { kind: "sending"; card: Card }
  /** 보냈다. **연출은 다음 항목**이고 지금은 서버 대사만 보여준다. */
  | { kind: "sent"; line: string }
  /** 오늘 카드를 다 썼다 (409 `DAILY_CAP_REACHED`). 서버가 함께 준 대사를 그대로 보여준다. */
  | { kind: "done"; line: string }
  /** 서버가 형식을 갖춰 거절했다. `message` 가 아이가 읽을 문구다. */
  | { kind: "refused"; line: string }
  /** 서버에 닿지 못했다. 아이에게 줄 문구가 서버에서 오지 않는다 — 아래 문구는 화면 것이다. */
  | { kind: "unreachable" };

/** 409 의 `detail.guide` 에서 대사만 꺼낸다. 형태가 다르면 아무것도 꺼내지 않는다. */
function guideLineOf(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null) return null;
  const guide = (detail as { guide?: Partial<Guide> }).guide;
  return typeof guide?.line === "string" ? guide.line : null;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  // 아이가 쓰는 중인 문장. **여기서 나가는 곳은 화면뿐이다** — 로그·리포터로 흘리지 않는다 (PRD 1.1b).
  const [text, setText] = useState("");
  // 다시 열기를 누르면 값이 바뀌어 아래 효과가 한 번 더 돈다.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // 화면이 사라진 뒤 도착한 응답으로 상태를 건드리지 않는다.
    let alive = true;

    apiGet<Card>("/cards/next")
      .then((card) => {
        if (alive) setScreen({ kind: "card", card });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError) {
          const line = guideLineOf(e.detail) ?? e.childMessage;
          setScreen(
            e.code === "DAILY_CAP_REACHED"
              ? { kind: "done", line }
              : { kind: "refused", line },
          );
          return;
        }
        if (e instanceof NetworkError) {
          setScreen({ kind: "unreachable" });
          return;
        }
        throw e;
      });

    return () => {
      alive = false;
    };
  }, [attempt]);

  const send = async (card: Card) => {
    setScreen({ kind: "sending", card });
    try {
      const outcome = await apiPost<AttemptOutcome>("/attempts", {
        card_id: card.card_id,
        text,
        retry_of: null,
        prompted: false,
      });
      // `outcome` 3분기(result·scaffold·blocked)를 화면으로 나누는 것은 **다음 항목**이다.
      // 지금은 셋 다 서버 대사를 그대로 보여주는 데까지만 간다 — 빈 화면으로 두지 않기 위한 최소선이다.
      setScreen({ kind: "sent", line: outcome.guide.line });
    } catch (e) {
      if (e instanceof ApiError) {
        setScreen({ kind: "refused", line: e.childMessage });
        return;
      }
      if (e instanceof NetworkError) {
        setScreen({ kind: "unreachable" });
        return;
      }
      throw e;
    }
  };

  const retry = () => {
    setScreen({ kind: "loading" });
    setAttempt((n) => n + 1);
  };

  return (
    <main className="page-frame flex flex-1 flex-col justify-center gap-8 py-10">
      {screen.kind === "loading" && (
        // 글자만 둔다. 여기에 가이드 캐릭터를 세우면 표정을 프론트가 고르는 것이 된다
        // (`docs/api/Stage0.md` 3절 — 표정 4종은 서버가 정한다).
        <p className="text-center opacity-70">장면을 펼치는 중…</p>
      )}

      {(screen.kind === "card" || screen.kind === "sending") && (
        <div className="flex flex-col gap-8">
          {/* 표정은 서버가 정한 것을 그대로 넘긴다. 카드 응답은 `default` 다. */}
          <SceneCard card={screen.card}>
            <GuideFigure guide={screen.card.guide} />
          </SceneCard>
          {/* 입력창은 **아래 전폭**이다. 오른쪽 절반에 가두면 줄이 짧아지고,
              짧은 칸은 짧게 쓰게 만든다 — H2 합격선이 회당 150자다. */}
          <AttemptInput
            label={screen.card.prompt_label}
            value={text}
            onChange={setText}
            disabled={screen.kind === "sending"}
          />
          <button
            type="button"
            // **글자 수로 잠그지 않는다.** 30자는 격려일 뿐 관문이 아니다
            // (`web/tasks/W2.md` 메모). 막는 것은 「아직 아무것도 안 썼다」와 「보내는 중」뿐이다.
            disabled={text.trim() === "" || screen.kind === "sending"}
            onClick={() => void send(screen.card)}
            className="self-end rounded-full bg-scarf px-10 py-3 text-xl text-markings
              disabled:opacity-40"
          >
            보내기
          </button>
        </div>
      )}

      {screen.kind === "sent" && (
        <p className="text-center text-2xl/relaxed">{screen.line}</p>
      )}

      {(screen.kind === "done" || screen.kind === "refused") && (
        // 서버가 준 문구를 그대로 보여준다. 프론트가 다듬거나 덧붙이지 않는다.
        <p className="text-center text-2xl/relaxed">{screen.line}</p>
      )}

      {screen.kind === "unreachable" && (
        <div className="flex flex-col items-center gap-6 text-center">
          {/* 서버에 닿지 못했으니 서버 문구가 없다. 이 두 줄은 화면이 정한 것이고,
              가이드 대사가 아니다 — 그래서 캐릭터를 옆에 세우지 않는다.
              확정 문안은 W3 대사 세트(C-1)에서 온다. */}
          <p className="text-2xl/relaxed">
            길이 잠깐 흐려졌어. 조금 뒤에 다시 열어볼까?
          </p>
          <button
            type="button"
            onClick={retry}
            className="rounded-full bg-scarf px-8 py-3 text-markings"
          >
            다시 열기
          </button>
        </div>
      )}
    </main>
  );
}
