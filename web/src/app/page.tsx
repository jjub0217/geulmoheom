"use client";

import { useEffect, useRef, useState } from "react";

import type { components } from "@/api/types.gen";
import { AttemptInput } from "@/components/attempt-input";
import { GuideFigure } from "@/components/guide";
import { LeaveButton } from "@/components/leave";
import { SceneCard } from "@/components/scene-card";
import { ApiError, NetworkError, apiGet, apiPost } from "@/lib/api";
import type { PiiKind } from "@/lib/pii";

import { 버튼, 못닿음 } from "./copy";
import { 상태표시 } from "./status-copy";

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
  /**
   * 쓰는 중. `guide` 는 **서버가 마지막에 준 것**이다 —
   * 처음엔 카드의 것(`default`)이고, 되묻기·차단이 오면 그 응답의 것으로 바뀐다.
   */
  | { kind: "card"; card: Card; guide: Guide }
  /** 보내는 중. 같은 화면을 두고 버튼만 잠근다 — 쓴 것이 사라지면 아이는 날아간 줄 안다. */
  | { kind: "sending"; card: Card; guide: Guide }
  /** 결과를 받았다. **연출(삽화·하이라이트·티어)은 W4 A0-3** 이고 여기는 최소 전이다. */
  | { kind: "sent"; guide: Guide }
  /** 오늘 카드를 다 썼다 (409 `DAILY_CAP_REACHED`). 서버가 함께 준 대사를 그대로 보여준다. */
  | { kind: "done"; line: string }
  /** 서버가 형식을 갖춰 거절했다. `message` 가 아이가 읽을 문구다. */
  | { kind: "refused"; line: string }
  /**
   * **장면을 못 불러왔다.** 서버가 아무 말도 못 했으므로 화면이 고르지만 짓지는 않는다 —
   * 문장은 `문구.md` 2.4 에 등록돼 있다 (`./copy.ts`).
   *
   * **보내기 실패는 여기 안 온다.** 그건 카드 자리에 머문다 — 화면을 넘기면 쓴 문장을 잃는다.
   */
  | { kind: "unreachable"; hints: string[] };

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
  /** 보내기가 서버에 못 닿았다. **카드 자리에 머문 채** 입력칸 곁에 알린다 (`문구.md` 2.4). */
  const [보내기못닿음, set보내기못닿음] = useState(false);
  /** 이미 올린 종류. **세션 안에서 종류마다 한 번만** 보낸다 — 한 글자마다 보내면 폭주한다. */
  const 올린종류 = useRef(new Set<PiiKind>());

  /**
   * 입력창이 개인정보를 가렸다 (E-2 클라이언트 1차). `pii_masked` 를 남긴다 —
   * **종류만 싣는다. 아이 문장도, 가려진 값도 싣지 않는다** (`Stage0.md` 7절 「원문 필드 없음」).
   *
   * 실패해도 아이 화면은 건드리지 않는다. 이건 아이가 기다리는 일이 아니다.
   */
  const 가림알림 = (kinds: PiiKind[]) => {
    const 처음 = kinds.filter((k) => !올린종류.current.has(k));
    if (처음.length === 0) return;
    처음.forEach((k) => 올린종류.current.add(k));

    void apiPost("/events", {
      events: 처음.map((kind) => ({
        event: "pii_masked",
        ts: new Date().toISOString(),
        layer: "client",
        kind,
      })),
    }).catch(() => {
      // 삼킨다. 실패 이유를 남기려면 요청 정보를 들고 있어야 하는데, 그 안에 아이 문장이 있다.
    });
  };

  useEffect(() => {
    // 화면이 사라진 뒤 도착한 응답으로 상태를 건드리지 않는다.
    let alive = true;

    apiGet<Card>("/cards/next")
      .then((card) => {
        if (alive) setScreen({ kind: "card", card, guide: card.guide });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError) {
          const line = guideLineOf(e.detail) ?? e.서버문구;
          setScreen(
            e.code === "DAILY_CAP_REACHED"
              ? { kind: "done", line }
              : { kind: "refused", line },
          );
          return;
        }
        if (e instanceof NetworkError) {
          setScreen({ kind: "unreachable", hints: e.hints });
          return;
        }
        throw e;
      });

    return () => {
      alive = false;
    };
  }, [attempt]);

  const send = async (card: Card, guide: Guide) => {
    set보내기못닿음(false);
    setScreen({ kind: "sending", card, guide });
    try {
      const outcome = await apiPost<AttemptOutcome>("/attempts", {
        card_id: card.card_id,
        text,
        // **항상 `null` 이다.** 일일 카운트가 이 값에 걸려 있어서, 되묻기를 거친 카드에
        // 이전 `attempt_id` 를 채우면 그 카드만 하루 5장에서 안 빠진다 — 카드는 푼 것이 맞는데도.
        // H2 도 같다: 되묻기 전 짧은 입력을 별도 회차로 세면 **되묻기가 잘 될수록 회당 평균이 내려간다**.
        // 채우는 것은 결과를 받은 뒤 같은 카드를 다시 풀 때뿐이고 그건 W4 다 (`Stage0.md` 4절).
        retry_of: null,
        prompted: false,
      });

      // 되묻기·차단은 **카드를 소모하지 않는다.** 화면을 넘기지 않고 가이드만 바꿔 그 자리에 머문다 —
      // 입력창이 그대로 있고 **쓴 문장도 그대로 있다.** 차단도 마찬가지다: 이유도 모른 채
      // 공들여 쓴 글이 사라지면 그것 자체가 벌이 된다 (`Stage0.md` 4절).
      if (outcome.outcome === "result") {
        setScreen({ kind: "sent", guide: outcome.guide });
      } else {
        setScreen({ kind: "card", card, guide: outcome.guide });
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setScreen({ kind: "refused", line: e.서버문구 });
        return;
      }
      if (e instanceof NetworkError) {
        // **화면을 넘기지 않는다.** 넘기면 「다시 열기」가 **다른 카드**를 불러오고,
        // 입력칸에 남은 문장이 **앞 장면에 쓴 글인 채로 새 장면에 붙는다.**
        // 되묻기·차단이 그 자리에 머무는 것과 같은 이유다 — **공들여 쓴 글이 사라지면 그것 자체가 벌**이다.
        set보내기못닿음(true);
        setScreen({ kind: "card", card, guide });
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
    <>
      <main className="page-frame flex flex-1 flex-col justify-center gap-8 py-10">
        {screen.kind === "loading" && (
          // 글자만 둔다. 여기에 가이드 캐릭터를 세우면 표정을 프론트가 고르는 것이 된다
          // (`docs/api/Stage0.md` 3절 — 표정 4종은 서버가 정한다).
          <p className="text-center opacity-70">{상태표시.장면부르는중}</p>
        )}

        {(screen.kind === "card" || screen.kind === "sending") && (
          <div className="flex flex-col gap-8">
            {/* 표정도 대사도 **서버가 마지막에 준 것**이다. 되묻기면 여기가 그 질문 자리가 된다. */}
            <SceneCard card={screen.card}>
              <GuideFigure guide={screen.guide} />
            </SceneCard>
            {/* 입력창은 **아래 전폭**이다. 오른쪽 절반에 가두면 줄이 짧아지고,
                짧은 칸은 짧게 쓰게 만든다 — H2 합격선이 회당 150자다. */}
            <AttemptInput
              label={screen.card.prompt_label}
              value={text}
              onChange={setText}
              onMasked={가림알림}
              disabled={screen.kind === "sending"}
            />
            {/* **입력칸 곁이다.** 무엇에 대한 말인지 아이가 찾지 않아도 되게 —
                자녀 인증 화면이 오류를 입력칸 곁에 두는 것과 같다. */}
            {보내기못닿음 && screen.kind === "card" && (
              <p data-보내기못닿음 className="text-xl/relaxed">
                {못닿음.보내기}
              </p>
            )}
            <button
              type="button"
              // **글자 수로 잠그지 않는다.** 30자는 격려일 뿐 관문이 아니다
              // (`web/tasks/W2.md` 메모). 막는 것은 「아직 아무것도 안 썼다」와 「보내는 중」뿐이다.
              disabled={text.trim() === "" || screen.kind === "sending"}
              onClick={() => void send(screen.card, screen.guide)}
              className="self-end rounded-full bg-scarf px-10 py-3 text-xl text-markings
                disabled:opacity-40"
            >
              {버튼.보내기}
            </button>
          </div>
        )}

        {screen.kind === "sent" && (
          // 최소 전이다. 삽화·하이라이트·티어 연출과 「다음 장면」은 W4(A0-3) 자리다.
          <div className="flex justify-center">
            <GuideFigure guide={screen.guide} />
          </div>
        )}

        {(screen.kind === "done" || screen.kind === "refused") && (
          // 서버가 준 문구를 그대로 보여준다. 프론트가 다듬거나 덧붙이지 않는다.
          <p className="text-center text-2xl/relaxed">{screen.line}</p>
        )}

        {screen.kind === "unreachable" && (
          <div className="flex flex-col items-center gap-6 text-center">
            {/* **`문구.md` 2.4 다.** 서버가 아무 말도 못 했으므로 화면이 고르지만 짓지는 않는다.
                **앱 목소리라 캐릭터를 옆에 세우지 않는다** — 가이드가 앱 사정을 말하면
                PRD C-1 「역할 경계」를 넘고, 그쪽이 말투가 갈리는 것보다 세계관을 크게 깬다 (0장). */}
            <p className="text-2xl/relaxed">{못닿음.장면}</p>
            <button
              type="button"
              onClick={retry}
              className="rounded-full bg-scarf px-8 py-3 text-markings"
            >
              {버튼.다시열기}
            </button>
            {screen.hints.length > 0 && (
              // **개발 빌드 전용이다.** 운영에서는 `hints` 가 비어 있어 이 블록이 아예 안 그려진다.
              // 아이에게 보이는 말이 아니라 **개발자에게 보이는 단서**다 — 위 두 줄과 톤이 다른 것이 맞다.
              // 2026-09-07 하루에 이 화면이 세 번 나왔고 셋 다 원인이 달랐다.
              <ul
                data-dev-hints
                className="max-w-xl list-disc space-y-1 rounded-xl border border-dashed
                  border-brass/50 p-4 text-left text-sm opacity-70"
              >
                {screen.hints.map((원인) => (
                  <li key={원인}>{원인}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>

      {/* **나가기는 `<main>` 밖 맨 아래다.** 본문이 `flex-1` 이라 여기가 화면 바닥에 붙는다
          (`layout.tsx` 의 `flex min-h-dvh flex-col`). 「아이 눈에 띄는 자리에 두지 않는다」를
          **자리로 지킨 것**이고, 글자를 못 읽게 줄인 것이 아니다.

          **화면 상태를 안 가린다 — 어느 상태에서든 그 자리에 있다.** 「보내는 중」에만 숨기는
          규칙을 두려다 접었다: **오락가락하는 컨트롤이 오히려 눌러보게 만든다.**
          실수로 누르는 것은 확인 창이 막는다 — 그것이 되묻기를 둔 이유 전부다. */}
      <footer className="page-frame flex justify-center pb-6">
        <LeaveButton />
      </footer>
    </>
  );
}
