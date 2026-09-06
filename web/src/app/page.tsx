"use client";

import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import { SceneCard } from "@/components/scene-card";
import { ApiError, NetworkError, apiGet } from "@/lib/api";

type Card = components["schemas"]["Card"];
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

  const retry = () => {
    setScreen({ kind: "loading" });
    setAttempt((n) => n + 1);
  };

  return (
    <main className="page-frame flex flex-1 flex-col justify-center py-10">
      {screen.kind === "loading" && (
        // 글자만 둔다. 여기에 가이드 캐릭터를 세우면 표정을 프론트가 고르는 것이 된다
        // (`docs/api/Stage0.md` 3절 — 표정 4종은 서버가 정한다).
        <p className="text-center opacity-70">장면을 펼치는 중…</p>
      )}

      {screen.kind === "card" && <SceneCard card={screen.card} />}

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
