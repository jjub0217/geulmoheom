"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { components } from "@/api/types.gen";
import { ArtworkFrame } from "@/components/artwork";
import { AttemptInput } from "@/components/attempt-input";
import { GuideFigure } from "@/components/guide";
import { LeaveButton } from "@/components/leave";
import { SceneCard } from "@/components/scene-card";
import { TierBadge } from "@/components/tier-badge";
import { WrittenLine } from "@/components/written-line";
import { ApiError, NetworkError, apiGet, apiPost, 인증이풀렸다 } from "@/lib/api";
import { useArtwork } from "@/lib/artwork";
import type { PiiKind } from "@/lib/pii";

import { 내책라벨 } from "./book/copy";
import { 버튼, 못닿음 } from "./copy";
import { 상태표시 } from "./status-copy";

type Card = components["schemas"]["Card"];
type AttemptResult = components["schemas"]["AttemptResult"];
/** 세 형태가 한 응답에 온다 (`outcome`). 셋 다 화면이 있다 — `blocked` 를 오류로 때우지 않는다. */
type AttemptOutcome =
  | AttemptResult
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
  /**
   * 결과를 받았다. **응답을 통째로 들고 있는다** — 삽화 참조·등급·하이라이트가 전부 여기 있고,
   * 연출이 붙을 때마다 화면 상태를 다시 고치지 않기 위해서다.
   *
   * **아직 그리는 것은 삽화와 가이드뿐이다.** 등급·하이라이트는 다음 조각이다.
   */
  | { kind: "sent"; result: AttemptResult }
  /**
   * 오늘 카드를 다 썼다 (409 `DAILY_CAP_REACHED`). 서버가 함께 준 **가이드 그대로** 보여준다 —
   * 대사도 **표정도**다. 종료 인사는 `expression: "session_end"` 로 오고, 표정 4종 중
   * **그 자리를 위해 만든 얼굴**이다 (`docs/캐릭터/표정/`).
   *
   * `guide` 가 없으면 서버가 대사를 안 준 것이라 **앱 목소리로 떨어진다** — 그때는
   * 캐릭터를 세우지 않는다 (`문구.md` 0장, 못닿음 화면과 같다).
   */
  | { kind: "done"; guide: Guide | null; line: string }
  /** 서버가 형식을 갖춰 거절했다. `message` 가 아이가 읽을 문구다. */
  | { kind: "refused"; line: string }
  /**
   * **장면을 못 불러왔다.** 서버가 아무 말도 못 했으므로 화면이 고르지만 짓지는 않는다 —
   * 문장은 `문구.md` 2.4 에 등록돼 있다 (`./copy.ts`).
   *
   * **보내기 실패는 여기 안 온다.** 그건 카드 자리에 머문다 — 화면을 넘기면 쓴 문장을 잃는다.
   */
  | { kind: "unreachable"; hints: string[] };

/** `guide.expression` 이 될 수 있는 값. **프론트가 고르지 않고 온 것을 확인만 한다.** */
const 표정들: Guide["expression"][] = [
  "default",
  "compass_bright",
  "compass_dim",
  "session_end",
];

/**
 * 409 의 `detail.guide` 에서 **가이드를 통째로** 꺼낸다. 형태가 다르면 아무것도 꺼내지 않는다.
 *
 * **대사만 꺼내던 자리다.** 그러면 종료 인사의 `session_end` 표정이 **말없이 버려진다** —
 * 표정 4종 중 하나가 **그 자리를 위해 만들어졌는데** 화면에 한 번도 안 나오는 셈이다.
 *
 * **모르는 표정은 안 받는다.** 파일명이 곧 `expression` 이라 그대로 넘기면
 * **없는 PNG 를 부르고 그림이 깨진다** — 계약이 넓어지는 날 조용히 그렇게 된다.
 */
function guideOf(detail: unknown): Guide | null {
  const line = guideLineOf(detail);
  if (line === null) return null;
  const 온것 = (detail as { guide?: Partial<Guide> }).guide?.expression;
  const 표정 = 표정들.find((e) => e === 온것);
  return 표정 ? { expression: 표정, line } : null;
}

/**
 * **대사만 따로 꺼낸다.** 표정을 못 알아봐도 **말은 잃지 않는다** —
 * 얼굴이 낯선 것과 **아이가 왜 못 들어가는지 못 듣는 것**은 다르다.
 * 그때는 캐릭터 없이 문장만 선다.
 */
function guideLineOf(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null) return null;
  const guide = (detail as { guide?: Partial<Guide> }).guide;
  return typeof guide?.line === "string" ? guide.line : null;
}

/**
 * 서버가 형식을 갖춰 거절했다. **하루 상한만 가이드가 말하고 나머지는 앱 목소리다** —
 * 한 화면에 둘이 같이 오면 **`guide.line` 만** 보여준다 (`문구.md` 0장).
 */
function 거절화면(e: ApiError): Screen {
  const guide = guideOf(e.detail);
  const line = guideLineOf(e.detail) ?? e.서버문구;
  return e.code === "DAILY_CAP_REACHED"
    ? { kind: "done", guide, line }
    : { kind: "refused", line };
}

/**
 * **인증이 확인된 상태인가.** 서버가 자녀 쿠키를 보고 답을 준 상태들이다 —
 * 카드가 왔거나(`card`·`sending`·`sent`) 하루 상한을 알려줬거나(`done`).
 *
 * **「모르는 상태」는 전부 거짓이다** — 아직 안 물어본 `loading`, 형식을 갖춰 거절당한
 * `refused`(401 은 위에서 보내 버리므로 여기 오는 것은 403·5xx 다), 못 닿은 `unreachable`.
 * **모르면 안 그리는 쪽으로 접는다** — `실행형태판정` 이 「확신이 없으면 브라우저탭」인 것과 같다.
 */
function 인증확인됨(screen: Screen): boolean {
  return (
    screen.kind === "card" ||
    screen.kind === "sending" ||
    screen.kind === "sent" ||
    screen.kind === "done"
  );
}

export default function Home() {
  const router = useRouter();
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
        // **401 은 화면이 아니라 자리 문제다** (2026-09-08 실기기, PM 판정).
        // 매니페스트 `start_url` 이 `/` 라 **아이가 홈 화면 아이콘을 처음 누르면 여기로 온다.**
        // 문구만 띄우면 **들어갈 문이 없는 화면**이 된다 — 버튼도 없었다.
        // **`문구.md` 2.1 의 문장을 고치지 않는다.** 문장이 틀린 게 아니라 **보여주는 자리가 틀렸다** —
        // 고치면 자리 문제가 문장 문제로 위장된다.
        if (인증이풀렸다(e)) {
          // 인증 화면이 나머지를 안다 — 홈 화면 앱이면 코드 입력, 브라우저 탭이면 설치 안내.
          // **둘 다 이미 서 있는 화면이라 새로 만들 것이 없다.**
          router.replace("/child/auth");
          return;
        }
        if (e instanceof ApiError) {
          setScreen(거절화면(e));
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
  }, [attempt, router]);

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
        setScreen({ kind: "sent", result: outcome });
      } else {
        setScreen({ kind: "card", card, guide: outcome.guide });
      }
    } catch (e) {
      // **보내는 쪽도 같이 보낸다.** 학부모가 자녀를 지우면 **아이 기기는 다음 요청에서
      // 401 로 떨어지는데**(`문구.md` 3.9), 그때 문구만 띄우면 **아이는 지워진 화면에 갇힌다** —
      // 이제 「나가기」도 인증 확인 뒤에만 그려서 **누를 것이 하나도 없다.**
      // **쓰던 문장을 잃지만 되돌릴 방법이 없다** — 세션이 실제로 사라진 것이라 다시 보낼 곳이 없다.
      if (인증이풀렸다(e)) {
        router.replace("/child/auth");
        return;
      }
      if (e instanceof ApiError) {
        // **카드를 부르는 쪽과 같은 함수를 쓴다.** 전에는 여기만 `e.서버문구` 라
        // **보내는 쪽만 앱 목소리로 떨어졌다** — 하루 상한은 **여섯 번째 문장을 보낼 때도**
        // 오고(A0-5), 그때 아이는 가이드가 하던 말이 갑자기 존댓말이 되는 것을 본다.
        setScreen(거절화면(e));
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

  /**
   * **훅이라 조건 밖에서 부른다.** 결과 화면이 아닐 때는 `null` 을 넘겨 아무것도 안 물어본다.
   *
   * `useArtwork` 가 `artwork_id` 를 결과에 함께 담으므로, 카드가 바뀌면
   * **앞 장면 그림이 새 결과 화면에 뜨는 일이 없다.**
   */
  const 삽화 = useArtwork(screen.kind === "sent" ? screen.result.artwork : null);

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
          // **그림이 먼저 오는 자리다.** 등급·하이라이트·「다음 장면」은 아직 없다 (A0-3 다음 조각).
          <div className="flex flex-col gap-8">
            <ArtworkFrame 상태={삽화} />
            {/* **굽는 동안에는 안 그린다.** 표정도 대사도 서버가 준 것 그대로인데,
                결과 응답의 `guide` 는 **이미 등급 반응**이라 그림보다 먼저 뜨면
                **아이가 반응을 읽고 그다음 그림을 본다** — 「등급을 미리 흘리지 않는다」가
                거기서 깨진다 (`문구.md` 1.5). 그 6~8초는 **액자 안 대기 대사**가 맡는다.

                **못 받았을 때는 그린다.** 그림만 없고 나머지는 그대로다 (1.7) — 아이는
                자기 문장이 통했다는 것을 알아야 하고, 그림은 「내 책」에서 다시 본다. */}
            {삽화.kind !== "기다림" && (
              <div className="flex flex-col items-center gap-6">
                {/* **그림과 같이 열린다.** 배지가 먼저 뜨면 그림은 이미 아는 것을 확인하는
                    절차가 된다 — 「등급을 미리 흘리지 않는다」가 낱말이 아니라 순서로 깨진다. */}
                <TierBadge tier={screen.result.tier} />
                <GuideFigure guide={screen.result.guide} />
                {/* **아이가 쓴 그 문장이다** (`text` 는 보낸 것 그대로 남아 있다).
                    하이라이트도 **그림과 같이** 열린다 — 표시가 많고 적은 것 자체가
                    등급을 짐작하게 하는 신호라, 굽는 동안 미리 보이면 안 된다. */}
                <WrittenLine text={text} highlights={screen.result.highlights} />
                {/* **그림을 막 받은 이 자리가 「내 책에 쌓인다」를 가장 잘 말한다** —
                    결과 대사(1.6 기본 2번)가 파는 것이 정확히 그것이다.
                    **나가기 옆에 두지 않는다**: 하나는 눈에 안 띄어야 하고 이건 반대다. */}
                <Link
                  href="/book"
                  className="rounded-full border-2 border-brass/50 px-8 py-3 text-xl"
                >
                  {내책라벨}
                </Link>
              </div>
            )}
          </div>
        )}

        {screen.kind === "done" && screen.guide !== null && (
          // **가이드가 배웅한다.** 표정도 서버가 준 것 그대로다 (`session_end`) —
          // 표정 4종 중 **이 자리를 위해 만든 얼굴**이고, 대사만 꺼내 쓰면 영영 안 나온다.
          <div className="flex justify-center">
            <GuideFigure guide={screen.guide} />
          </div>
        )}

        {((screen.kind === "done" && screen.guide === null) ||
          screen.kind === "refused") && (
          // 서버가 준 문구를 그대로 보여준다. 프론트가 다듬거나 덧붙이지 않는다.
          // **앱 목소리라 캐릭터를 세우지 않는다** — 못닿음 화면과 같은 이유다 (`문구.md` 0장).
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

          **들어온 뒤에만 그린다** (2026-09-08 실기기, PM 판정). **로그인 전 화면에 나가는 문만
          있었다** — 들어온 적 없는 아이에게 「다시 들어오려면 부모님께 새 접속 코드를 받아야 해요」는
          **겁만 주고 사실도 아니다**(잃을 세션이 없다). **문장은 맞고 자리가 틀렸다.**
          **로딩 중에도 안 그린다** — 리다이렉트 전 찰나에 보이고, 아이는 그 찰나에 누른다.

          **인증된 뒤에는 상태를 안 가린다 — 어느 상태에서든 그 자리에 있다.** 「보내는 중」에만
          숨기는 규칙을 두려다 접었다: **오락가락하는 컨트롤이 오히려 눌러보게 만든다.**
          **두 규칙은 축이 다르다** — 앞은 「들어왔나」이고 뒤는 「들어온 뒤 무엇을 하는 중인가」다. */}
      {인증확인됨(screen) && (
        <footer className="page-frame flex justify-center pb-6">
          <LeaveButton />
        </footer>
      )}
    </>
  );
}
