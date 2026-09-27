"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { components } from "@/api/types.gen";
import { ArtworkFrame } from "@/components/artwork";
import { BookLink } from "@/components/book-link";
import { BookOrigin, useAdventureState, useAdventureRequest, useAdventureSession } from "@/components/book-journey";
import { AttemptInput } from "@/components/attempt-input";
import { 턴문구 } from "@/components/turn-copy";
import { CompassIntroduction, SkippableStage } from "@/components/compass-introduction";
// **`문구.md` 1.4b 의 그 문장**이다. 카드와 본편이 같은 문장을 쓰므로 상수도 하나다.
import { 글쓰기질문, 소개와질문, 챕터동료소개 as 나침반소개문장 } from "@/components/chapter-writing";
import { GameConsole, StageCompass } from "@/components/game-console";
import { GuideFigure } from "@/components/guide";
import { LeaveButton } from "@/components/leave";
import { ChapterDoor } from "@/components/chapter-door";
import { SceneCard } from "@/components/scene-card";
import { SessionEnding } from "@/components/session-ending";
import { StoryOpening, StoryReading } from "@/components/story-opening";
import { TierBadge } from "@/components/tier-badge";
import { WrittenLine } from "@/components/written-line";
import {
  ApiError,
  NetworkError,
  apiGet,
  apiPost,
  역할이다르다,
  인증이풀렸다,
} from "@/lib/api";
import { useArtwork } from "@/lib/artwork";
import { 끊겨서보낼곳 } from "@/lib/kicked";
import type { PiiKind } from "@/lib/pii";

import { 버튼, 못닿음 } from "./copy";
import { 상태표시 } from "./status-copy";
import { 모험문 } from "./chapter-door-copy";
import { T2권유를띄울까, 튜토리얼문구, 튜토리얼차례 } from "./tutorial-copy";

type Card = components["schemas"]["Card"];
type ChildMe = components["schemas"]["ChildMe"];
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
  | { kind: "card"; card: Card; guide: Guide; 카드첫말인가: boolean }
  /** 보내는 중. 같은 화면을 두고 버튼만 잠근다 — 쓴 것이 사라지면 아이는 날아간 줄 안다. */
  | { kind: "sending"; card: Card; guide: Guide; 카드첫말인가: boolean }
  /**
   * 결과를 받았다. **응답을 통째로 들고 있는다** — 삽화 참조·등급·하이라이트가 전부 여기 있고,
   * 연출이 붙을 때마다 화면 상태를 다시 고치지 않기 위해서다.
   *
   * **아직 그리는 것은 삽화와 가이드뿐이다.** 등급·하이라이트는 다음 조각이다.
   */
  /**
   * **카드를 같이 들고 있는다** (2026-09-15, 「다시 써보기」가 붙으면서).
   * **결과에서 같은 장면으로 돌아가려면 그 장면이 있어야 한다** — 다시 부르면
   * **다른 카드가 오고**, 그건 「다시 써보기」가 아니라 「다음 장면」이다.
   */
  | { kind: "sent"; card: Card; result: AttemptResult }
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

type PreviousResult = { screen: Extract<Screen, { kind: "sent" }>; text: string };
const 다시쓰기취소라벨 = "다시 쓰기 취소";
/**
 * **⛔ 2026-09-22 에 없어졌다** (사용자 지시). 튜토리얼 마지막의 「다른 장면 써보기」와
 * 일반 카드의 「새 이야기 만나기」는 **같은 일을 한다** — 지금 카드 말고 다른 카드를 연다.
 * **문구를 하나로 모았다**: `버튼.다른이야기써보기`.
 */

/**
 * **나침반 소개를 이 카드에서 보일까** (2026-09-22 사용자 결정 · `문구.md` 1.4b).
 *
 * **아이에게 한 번만 보인다 — 짧은 카드와 본편을 합쳐서다.**
 *
 * **⛔ 새 저장 구조를 만들지 않았다.** 판단에 쓰는 것 둘 다 이미 있던 것이다 —
 * **어느 튜토리얼 카드인가**(카드 응답)와 **`first_experience_complete`**(`GET /child/me`).
 * 뒤엣것은 **서버가 아이별로 DB 를 보고 계산**하므로 **새로고침해도 유지되고 아이마다 다르다.**
 *
 * **⚠ 모르는 동안(`null`)에는 안 보인다.** 뒤늦게 나타나는 쪽이, 떴다가 사라지는 쪽보다 낫다.
 */
/**
 * **이 화면에서 래서판다가 실제로 할 말** (2026-09-22 사용자 지시).
 *
 * **⛔ 한 곳에서 정한다.** 연출(`CompassIntroduction`)과 캐릭터(`GuideFigure`)가
 * **다른 대사를 보면** 연출이 감춘 문장을 그대로 그린다 — 실측으로 잡은 자리다.
 */
function 화면대사(
  screen: { guide: Guide; card: Card; 카드첫말인가: boolean },
  첫경험완료: boolean | null,
): Guide {
  if (screen.카드첫말인가 && !소개를보인다(screen.guide.line, screen.card.card_id, 첫경험완료)) {
    return { expression: "default", line: 글쓰기질문 };
  }
  /**
   * ## ⛔ 소개를 보이는 화면에서는 소개가 질문을 겸한다 (2026-09-23 사용자 확정 · `문구.md` 1.4b)
   *
   * **⛔ 그 화면에만 눈에 보이는 행동 안내가 없었다.** 말풍선은 나침반을 설명하고,
   * 쓰는 칸의 흐린 글자는 **칸이 비었을 때만** 보인다 — **한 글자라도 치면 사라진다.**
   * 쓰다 멈춘 아이에게는 무엇을 하라는 말이 화면에 하나도 없었다.
   *
   * **되살린 이유는 걷은 전제가 사라져서다.** 09-22 에 이 질문을 걷은 근거가
   * **「바로 아래 입력 라벨이 같은 질문을 되풀이해서」**였는데, **그 라벨이 그 뒤에
   * 화면에서 감춰졌다**(`attempt-input.tsx` — 읽어 주는 기계에만 간다). **겹칠 상대가 없다.**
   *
   * **⭐ 새 문장을 안 지었다** — 둘째 장부터 이미 쓰는 값 그대로다. **값이 같아야
   * 아이가 화면마다 다른 질문을 받지 않는다.**
   *
   * **⛔ 앞에 붙이지 않고 뒤에 붙인다** — 「여기 이 나침반,」으로 시작하는 것이
   * 나침반 연출의 열쇠다(`compass-introduction.tsx` 가 그 낱말에서 멈춘다).
   */
  if (screen.카드첫말인가 && screen.guide.line === 나침반소개문장) {
    return { ...screen.guide, line: 소개와질문 };
  }
  return screen.guide;
}

function 소개를보인다(대사: string, cardId: string, 첫경험완료: boolean | null): boolean {
  // **⛔ 소개 문장이 아니면 손대지 않는다** (2026-09-22 실측으로 잡았다).
  // 서버가 카드와 함께 싣는 첫 대사가 **늘 나침반 소개인 것은 아니다.** 감추는 조건을
  // 「첫 대사인가」로 잡았더니 **소개가 아닌 대사까지 통째로 사라졌다.**
  // **감추는 것은 「되풀이되는 소개」 하나**다.
  if (대사 !== 나침반소개문장) return true;
  const 차례 = 튜토리얼차례(cardId);
  // 튜토리얼 첫 장 — 이 아이가 처음 보는 화면이다.
  if (차례 === "t1") return true;
  // 둘째·셋째 장에서는 이미 봤다.
  if (차례 !== null) return false;
  // 튜토리얼이 꺼져 있으면 **첫 일반 카드**가 처음 보는 화면이다.
  return 첫경험완료 === false;
}

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
  const loadOnce = useAdventureRequest();
  const isCurrent = useAdventureSession();
  const [screen, setScreen] = useAdventureState<Screen>("/", "screen", { kind: "loading" });
  const [restored] = useState(screen.kind !== "loading");
  // 아이가 쓰는 중인 문장. **여기서 나가는 곳은 화면뿐이다** — 로그·리포터로 흘리지 않는다 (PRD 1.1b).
  const [text, setText] = useAdventureState("/", "text", "");
  // 다시 열기를 누르면 값이 바뀌어 아래 효과가 한 번 더 돈다.
  const [attempt, setAttempt] = useState(0);
  /** 보내기가 서버에 못 닿았다. **카드 자리에 머문 채** 입력칸 곁에 알린다 (`문구.md` 2.4). */
  const [sendError, setSendError] = useAdventureState<string | null>("/", "sendError", null);
  const [previousResult, setPreviousResult] = useAdventureState<PreviousResult | null>("/", "previousResult", null);
  const submitting = useRef(false);
  const [restoredCard] = useState(restored && screen.kind === "card" ? screen.card.card_id : null);
  /** 이미 올린 종류. **세션 안에서 종류마다 한 번만** 보낸다 — 한 글자마다 보내면 폭주한다. */
  const 올린종류 = useRef(new Set<PiiKind>());

  /**
   * **다시 쓰는 중이면 앞 시도의 `attempt_id`** (`Stage0.md` 4절 · `문구.md` 2.2).
   *
   * **일일 카운트가 이 값에 걸려 있다.** 비워 보내면 서버가 카운트를 올려
   * **아이가 오늘 카드를 한 장 더 쓴 셈**이 된다 — 재시도는 **카드를 소모하지 않는 것**이
   * 설계다 (`MVP_PRD.md` 75행).
   *
   * **되묻기가 와도 안 비운다.** 되묻기는 **시도가 끝난 것이 아니라 같은 시도의 연장**이고
   * (`Stage0.md` 4절), **그 연장도 여전히 재시도**다. 비우는 자리는 **결과를 받았을 때와
   * 다음 장면으로 갈 때** 둘뿐이다.
   */
  const [재시도원본, set재시도원본] = useAdventureState<string | null>("/", "retryOf", null);
  /**
   * **튜토리얼 닫는말을 이 아이에게 이미 했나** (2026-09-23 사용자 확정).
   *
   * **⛔ 「다시 써보기」로 같은 장면을 또 보내면 닫는말이 또 나왔다.** 그 말은
   * **세 장면을 다 채웠다는 알림**이라 **두 번 할 자리가 아니다** — 두 번째부터는
   * 이미 아는 사실을 되풀이하는 것이고, 그 아래 「긴 모험 시작하기」도 같이 되풀이된다.
   *
   * **⭐ 「보였다」가 아니라 「다시 쓰러 갔다」에서 켠다.** 보이는 순간에 켜면
   * **그 화면이 스스로를 감춘다** — 켜자마자 다시 그려져 한 번도 못 본다.
   * **T3 결과를 떠나는 길은 「다시 써보기」 하나**이므로 그 자리가 정확하다.
   *
   * **⛔ 새 저장 구조를 안 만들었다** — 화면 상태 저장은 이 파일이 이미 쓰는 것이고,
   * 새로고침과 `/book` 왕복을 넘긴다.
   */
  const [닫는말봤나, set닫는말봤나] = useAdventureState("/", "tutorialClosingSeen", false);

  /**
   * **지금 누구인지** (`문구.md` **2.6**, 2026-09-15 신설 · 결과 ⑨).
   *
   * **한 브라우저에 아이 세션이 30일 남는다.** 어른이 다음 아이에게 기기를 넘겼는데
   * **앞 아이 세션이 그대로**였고, **그 아이가 쓴 글이 앞 아이 책에 들어갔다** (관찰 회차).
   *
   * **모르면 `null` 이고 그 자리를 아예 안 그린다.** 「탐험가」 같은 기본값을 넣으면
   * **다음 아이가 그 화면을 보고 자기 판이라고 읽는다** — 없느니만 못하다.
   */
  const [이름, set이름] = useAdventureState<string | null>("/", "name", null);
  const [첫경험완료, set첫경험완료] = useState<boolean | null>(null);


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

  /**
   * **카드와 따로 부른다.** 이름은 **카드가 바뀌어도 안 바뀌고**, 못 받아도
   * **모험이 막히면 안 된다** — 그래서 실패를 삼킨다(화면에 오류를 안 낸다).
   * **들어왔는지 아닌지는 `/cards/next` 쪽이 판정한다** — 여기서 두 번 판정하면 갈린다.
   */
  useEffect(() => {
    let alive = true;
    apiGet<ChildMe>("/child/me")
      .then((me) => {
        if (alive) {
          set이름(me.nickname);
          set첫경험완료(me.first_experience_complete !== false);
        }
      })
      .catch(() => {
        // 삼킨다. **이름을 모르는 것과 못 들어온 것은 다르다.**
      });
    return () => {
      alive = false;
    };
  }, [attempt, set이름]);

  useEffect(() => {
    // 책을 보는 중 도착한 다음 장면도 같은 메모리에 남긴다.
    if (restored && attempt === 0) return;
    loadOnce("cards/next", () => apiGet<Card>("/cards/next"))
      .then((card) => {
        if (!isCurrent()) return;
        setScreen({ kind: "card", card, guide: card.guide, 카드첫말인가: true });
      })
      .catch((e: unknown) => {
        if (!isCurrent()) return;
        // **401 은 화면이 아니라 자리 문제다** (2026-09-08 실기기, PM 판정).
        // 매니페스트 `start_url` 이 `/` 라 **아이가 홈 화면 아이콘을 처음 누르면 여기로 온다.**
        // 문구만 띄우면 **들어갈 문이 없는 화면**이 된다 — 버튼도 없었다.
        // **`문구.md` 2.1 의 문장을 고치지 않는다.** 문장이 틀린 게 아니라 **보여주는 자리가 틀렸다** —
        // 고치면 자리 문제가 문장 문제로 위장된다.
        // **⛔ 403 도 같이 받는다** (2026-09-15, 아동 3명 회차 준비에서 나왔다 — 결과 ⑪).
        // **부모가 코드를 받아 아이에게 넘기고 아이가 링크(`/`)를 여는 것이 진짜 흐름**인데
        // (`adr/0014` 결정 3), 그 브라우저에는 **부모 쿠키가 살아 있어 403** 이 온다.
        // 그러면 「여기는 지금 들어갈 수 없어요」에서 끝나 **코드 입력으로 가는 길이 없었다.**
        //
        // **어제 `/child/auth` 만 고쳤다.** 정작 아이가 **먼저 닿는 화면이 여기**다 —
        // **낱개로 고쳐서 다음이 또 나온 자리**이고, 그래서 `/book` 도 같이 고쳤다.
        if (인증이풀렸다(e) || 역할이다르다(e)) {
          // 인증 화면이 나머지를 안다 — 401 이든 403 이든 **코드 입력을 연다.**
          // **이미 서 있는 화면이라 새로 만들 것이 없다.**
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

  }, [attempt, restored, router, setScreen, loadOnce, isCurrent]);

  const send = async (card: Card, guide: Guide) => {
    if (submitting.current || screen.kind !== "card" || text.trim() === "") return;
    submitting.current = true;
    setSendError(null);
    // **보내는 중에도 말풍선 규칙이 그대로여야 한다** — 값을 잃으면 감춰 뒀던 첫 말이
    // 보내는 순간 다시 나타난다.
    setScreen({ kind: "sending", card, guide, 카드첫말인가: screen.카드첫말인가 });
    try {
      const outcome = await apiPost<AttemptOutcome>("/attempts", {
        card_id: card.card_id,
        text,
        // **되묻기 뒤 고쳐 보낼 때는 비운다** — 되묻기는 시도가 끝난 것이 아니라
        // **같은 시도의 연장**이라, 채우면 그 카드만 하루 5장에서 안 빠진다.
        // **채우는 것은 결과를 받은 뒤 같은 카드를 다시 풀 때다** (`Stage0.md` 4절) —
        // **2026-09-15 에 그 자리가 생겼다.** 그전에는 항상 `null` 이었고
        // 주석은 「그건 W4 다」였는데 **W4 는 지났고 버튼이 없어서 아무도 못 눌렀다**(결과 ④).
        retry_of: 재시도원본,
        prompted: false,
      });
      if (!isCurrent()) return;

      // 되묻기·차단은 **카드를 소모하지 않는다.** 화면을 넘기지 않고 가이드만 바꿔 그 자리에 머문다 —
      // 입력창이 그대로 있고 **쓴 문장도 그대로 있다.** 차단도 마찬가지다: 이유도 모른 채
      // 공들여 쓴 글이 사라지면 그것 자체가 벌이 된다 (`Stage0.md` 4절).
      if (outcome.outcome === "result") {
        // **결과를 받았으면 재시도가 끝났다.** 안 비우면 **다음에 보내는 것이 또 앞 시도에 붙는다.**
        set재시도원본(null);
        setPreviousResult(null);
        // 일반 카드의 결과를 받은 뒤에야 이 탭에서 다음 놀이 길을 연다.
        if (튜토리얼차례(card.card_id) === null) set첫경험완료(true);
        setScreen({ kind: "sent", card, result: outcome });
      } else {
        setScreen({ kind: "card", card, guide: outcome.guide, 카드첫말인가: false });
      }
    } catch (e) {
      if (!isCurrent()) return;
      // **보내는 쪽도 같이 보낸다.** 여기서 401 이 오면 문구만 띄우는 것으로는 안 된다 —
      // 「나가기」도 인증 확인 뒤에만 그려서 **누를 것이 하나도 없고 아이가 갇힌다.**
      //
      // **⚠ 401 의 뜻이 둘이고 아이 쪽에서는 구분되지 않는다** (2026-09-12 정정).
      // ① **자녀 삭제** — 세션이 **실제로 사라졌다** (`문구.md` 3.9)
      // ② **접속 코드 재발급** — `token_version` 이 올라 **남아 있는 기기가 전부 끊긴다**
      //    (`공통규약.md` 「폐기」). **계정은 멀쩡하고 새 코드만 받으면 돌아온다**
      //
      // **종전 주석은 ①만 알고 「세션이 실제로 사라진 것」이라고 단정했다.** ②가 더 흔하다 —
      // **2026-09-12 파일럿에서 실제로 돈 경로**이고, 학부모가 코드를 다시 받을 때마다 일어난다.
      //
      // **쓰던 문장은 잃는다.** ②면 되돌릴 수 있는 자리이긴 하지만 **여기서 안 만든다** —
      // 아이 원문을 기기에 새로 보관하는 일이라 **결정할 사람이 따로 있고**(PRD 1.1b),
      // 지금은 결정 잠금 중이다 (`adr/0011` — 「더 낫다」는 여는 조건이 아니다).
      if (인증이풀렸다(e) || 역할이다르다(e)) {
        // **끊겼다는 표식을 달아 보낸다** (`문구.md` 3.3 · `lib/kicked.ts`).
        // **여기는 확신이 있는 자리다** — 카드를 받아 쓰고 있었으니 **들어와 있었던 것이 확실하다.**
        // **위 마운트 401 에는 안 단다**: `start_url` 이 `/` 라 **처음 온 아이도 그리로 온다.**
        router.replace(역할이다르다(e) ? "/child/auth" : 끊겨서보낼곳);
        return;
      }
      if (e instanceof ApiError) {
        // **카드를 부르는 쪽과 같은 함수를 쓴다.** 전에는 여기만 `e.서버문구` 라
        // **보내는 쪽만 앱 목소리로 떨어졌다** — 하루 상한은 **여섯 번째 문장을 보낼 때도**
        // 오고(A0-5), 그때 아이는 가이드가 하던 말이 갑자기 존댓말이 되는 것을 본다.
        if (e.code === "DAILY_CAP_REACHED") setScreen(거절화면(e));
        else {
          setSendError(e.서버문구 || 못닿음.보내기);
          setScreen({ kind: "card", card, guide, 카드첫말인가: false });
        }
        return;
      }
      if (e instanceof NetworkError) {
        // **화면을 넘기지 않는다.** 넘기면 「다시 열기」가 **다른 카드**를 불러오고,
        // 입력칸에 남은 문장이 **앞 장면에 쓴 글인 채로 새 장면에 붙는다.**
        // 되묻기·차단이 그 자리에 머무는 것과 같은 이유다 — **공들여 쓴 글이 사라지면 그것 자체가 벌**이다.
        setSendError(못닿음.보내기);
        setScreen({ kind: "card", card, guide, 카드첫말인가: false });
        return;
      }
      throw e;
    } finally {
      submitting.current = false;
    }
  };

  /**
   * **훅이라 조건 밖에서 부른다.** 결과 화면이 아닐 때는 `null` 을 넘겨 아무것도 안 물어본다.
   *
   * `useArtwork` 가 `artwork_id` 를 결과에 함께 담으므로, 카드가 바뀌면
   * **앞 장면 그림이 새 결과 화면에 뜨는 일이 없다.**
   */
  const 삽화 = useArtwork(screen.kind === "sent" ? screen.result.artwork : null);

  /**
   * **다음 장면을 받는다.**
   *
   * **⛔ 입력칸을 비운다** (2026-09-15 결함). 안 비우면 **앞 장면에 쓴 글이 새 장면 아래
   * 그대로 붙어 있다** — `copy.ts` 의 「다시 열기」 주석이 **바로 그 위험을 적어 두고 있었는데**
   * 2026-09-12 에 붙은 이 문이 **같은 자리를 다시 밟았다.** 검사로 잡았다.
   *
   * **재시도 표식도 비운다** — 새 카드를 앞 시도의 재시도로 실어 보내면
   * 그 카드가 **하루 5장에서 빠지지 않는다.**
   */
  const retry = () => {
    setText("");
    set재시도원본(null);
    setPreviousResult(null);
    setSendError(null);
    setScreen({ kind: "loading" });
    setAttempt((n) => n + 1);
  };

  /**
   * **같은 장면을 다시 쓴다** (`문구.md` **2.2** · `adr/0015` ②).
   *
   * **쓴 문장을 남긴다** — 되묻기·차단이 그 자리에 머무는 것과 같은 규칙이다.
   * 태블릿에서 **처음부터 다시 치게 하면 아이는 그냥 그만둔다.**
   *
   * **카드를 다시 부르지 않는다** — 부르면 **다른 장면**이 오고 그건 「다음 장면」이다.
   * 그래서 `sent` 가 카드를 들고 있다.
   *
   * **가이드는 그 장면의 것으로 돌아간다** — 결과 대사는 **방금 받은 등급에 대한 반응**이라,
   * 다시 쓰는 화면에 그대로 두면 **아직 안 보낸 문장에 미리 반응하는 얼굴**이 된다.
   */
  const 다시쓰기 = (card: Card, 앞시도: string) => {
    if (screen.kind !== "sent") return;
    // 닫는말을 이미 본 아이다. 다시 보낸 결과에서는 그 말을 되풀이하지 않는다.
    if (튜토리얼차례(card.card_id) === "t3") set닫는말봤나(true);
    setPreviousResult({ screen, text });
    set재시도원본(앞시도);
    setSendError(null);
    setScreen({ kind: "card", card, guide: card.guide, 카드첫말인가: true });
  };

  const 다시쓰기취소 = () => {
    if (!previousResult || submitting.current) return;
    setText(previousResult.text);
    setScreen(previousResult.screen);
    set재시도원본(null);
    setPreviousResult(null);
    setSendError(null);
  };

  const writingScene = screen.kind === "card" || screen.kind === "sending";
  const resultScene = screen.kind === "sent";
  const endingScene = screen.kind === "done";
  const gameScene = writingScene || resultScene || endingScene;

  return (
    <BookOrigin path="/">
    <div className={gameScene ? `game-shell${resultScene ? " game-shell--result" : ""}${endingScene ? " game-shell--ending" : ""}` : "contents"}>
      {/* **지금 누구인지** (`문구.md` **2.6** · 결과 ⑨). **이름만 쓴다 — 라벨도 꾸밈말도 없다.**
          「별명」은 학부모 화면 말이고(`용어사전.md`), **「탐험가」는 아이가 스스로를 부르는 말**이지
          이름 앞에 붙이는 직함이 아니다.

          **자리가 맨 위인 것이 조건이다.** 신설 때는 「「나가기」와 같은 줄」이었는데
          **「나가기」는 `<footer>` 맨 아래**이고 그 자리는 2.3 이 정한 것이다 —
          **같은 날 ③ 이 「맨 아래는 안 보이는 자리」임을 세 뷰포트에서 증명했다.**
          **확인하라고 둔 표식을 안 보이는 자리에 두면 그것은 표식이 아니다** (PM 정정, 2.6).

          이름만 그대로 보여주되, 게임 화면에서는 오른쪽 위에 또렷하게 둔다. */}
      {(이름 !== null || 인증확인됨(screen)) && (
        <header className={gameScene ? "game-stage-header" : "page-frame adventure-header flex justify-end gap-3 pt-3"}>
          {이름 !== null && (
            <p data-탐험가이름 title={이름} className="text-sm text-[var(--muted)]">
              {이름}
            </p>
          )}
          {/* ⛔ **나가는 길이 이름 옆으로 올라왔다** (2026-09-22 사용자 지시).
              종전에는 화면 맨 아래 `<footer>` 였고, 그 자리의 근거는 「아이 눈에 띄는
              자리에 두지 않는다」였다. **눈에 덜 띄게 하는 일은 이제 생김새가 맡는다** —
              맨 글자 버튼이라 옆의 진행 버튼과 굵기가 다르다. */}
          {/* ⛔ **보내는 동안에는 못 누른다** (2026-09-24 사용자 지시). 같은 순간
              「내 책 펼치기」는 이미 잠겨 있었는데 **되돌릴 수 없는 나가기만 열려 있었다.** */}
          {인증확인됨(screen) && (
            <LeaveButton 쓰던글있나={text.trim().length > 0} 잠금={screen.kind === "sending"} />
          )}
        </header>
      )}
      {/* 쓰는 장면은 숲속, 결과는 삽화가 돋보이는 크래프트지 무대로 이어진다. */}
      <main className={gameScene ? `game-stage${resultScene ? " result-stage" : ""}${endingScene ? " session-ending-stage" : ""}` : "page-frame adventure-main flex flex-1 flex-col justify-center py-3 sm:py-6"}>
        {screen.kind === "loading" && (
          // 글자만 둔다. 여기에 가이드 캐릭터를 세우면 표정을 프론트가 고르는 것이 된다
          // (`docs/api/Stage0.md` 3절 — 표정 4종은 서버가 정한다).
          <p className="text-center text-[var(--muted)]">{상태표시.장면부르는중}</p>
        )}

        {(screen.kind === "card" || screen.kind === "sending") && (
          // 상황 소개 → 동료와 나침반의 말 → 아이가 쓰는 자리 순서로 화면을 연다.
          <CompassIntroduction
            /* ⛔ **연출과 캐릭터가 같은 대사를 봐야 한다** (2026-09-22 실측으로 잡았다).
               여기에 원본을 넘기고 캐릭터에만 갈아 끼운 것을 넘겼더니, **연출이 소개
               문장을 한 글자씩 그리고 있어** 감춘 소개가 화면에 그대로 남았다. */
            guide={화면대사(screen, 첫경험완료)}
            situation={screen.card.situation}
            cardId={screen.card.card_id}
            skipOpening={screen.card.card_id === restoredCard || previousResult !== null}
          >
          {/* **모험으로 들어가는 문** (`문구.md` 1.25 · W7 18번).
              **⛔ 튜토리얼 중에는 안 그린다** — T1~T3 는 **첫 5~7분**이고
              **A-6 이 「잠금·관문 없음」으로 세운 자리**다. 여기에 다른 길을 같이 내면
              **아이가 무엇부터 할지 고르게 되고 그 5~7분이 관문이 된다.**
              **T3 를 끝낸 뒤에 열린다** — 아래 결과 화면과 여기 둘 다.

              ## ⛔ 무대 밖으로 꺼냈다 (2026-09-23 사용자 확정 · 실측으로 잡았다)

              **종전에는 이 띠가 무대(`.game-stage__world`) 안에 있었다.** 띠는
              `position: absolute` 라 **가장 가까운 자리 잡힌 조상**에 붙는데 그것이 무대였고,
              **무대는 세로 가운데 맞춤을 받는다.** 그래서 **글자가 찍히는 동안** — 쓰는 칸이
              아직 없어 묶음이 짧을 때 — **무대가 아래로 내려가면서 문도 따라 내려갔다.**

              실측(연출 중): **390×844 에서 272.8 · 1280×800 에서 227.2** 로,
              「왼쪽 위에 있다」의 한계(화면 높이의 20%)를 크게 넘었다. **연출이 끝나면
              한계 안으로 돌아온다** — 즉 **아이가 보는 첫 몇 초에만 문이 화면 가운데로 흘렀다.**

              ⭐ **무대 밖으로 꺼내 무대(`.game-stage`)에 붙인다.** 이름 띠가 이미 그렇게
              서 있어 안 움직인다 — **본편도 이미 이 모양**이라(`chapter/page.tsx`) 두 화면이
              같아진다. **덮이는 문제는 이미 `z-index: 4` 가 막고 있다**(`game-stage.css` 주석).

              ⛔ **무대의 위 안쪽 여백은 그대로 둔다** — 띠가 떠 있는 자리를 비워 두는 일은
              문이 어디 붙든 그대로 필요하다. */}
          <div className="game-stage__toolbar">
            {첫경험완료 === true && 튜토리얼차례(screen.card.card_id) === null && (
              text.length === 0 && previousResult === null && screen.kind === "card"
                ? <ChapterDoor /> : <BookLink disabled={screen.kind === "sending"} />
            )}
          </div>
          {/* 글자가 찍히는 동안에는 무대 어디를 눌러도 건너뛴다 (⑥ㄴ · `SkippableStage` 주석). */}
          <SkippableStage className="game-stage__world">
            {/* **⛔ 화면 맨 위의 튜토리얼 여는 말을 걷어냈다** (2026-09-21 사용자 판정).
                「나침반이 아직 자고 있어」가 **아래 말풍선의 「네가 이야기를 쓰면 반짝여」와 뜻이
                겹쳤고**, 자고 있다·깨어난다·반짝인다 **세 설정이 한 화면에 섞였다.**
                **나침반이 이미 화면에 보이는데 「아직 자고 있다」는 눈에 보이는 것과 안 맞는다.**
                **⛔ 다른 것으로 채우지 않는다** — 덜어낸 자리다. 화면 이름을 대신 넣는 방안이
                거론됐으나 그건 **없던 문구를 새로 세우는 것**이라 같은 판정에 걸린다. */}
            <div className="game-story">
              <SceneCard card={screen.card} />
            </div>
            {/* 표정도 대사도 **서버가 마지막에 준 것**이다. 되묻기면 여기가 그 질문 자리가 된다.

                ⛔ **나침반 소개는 아이에게 한 번만 한다** (2026-09-22 사용자 결정).
                서버는 **카드를 줄 때마다** 같은 첫 말을 싣는다(`문구.md` 1.4b) — 그건
                **소개**인데 둘째·셋째 카드에서도 그대로 나왔다.

                **⛔ 앞서 `previousResult` 로 판단한 것은 틀렸다** (같은 날 실측으로 잡았다).
                그 값은 **「다시 써보기」를 누른 동안에만** 채워지고 결과를 받거나 다음 카드를
                열 때 비워진다 — **「이미 본 아이인가」와 아무 상관이 없었고**, 그래서
                **감추는 자리가 정반대**였다.

                **⭐ 지금은 아이별 서버 상태로 판단한다. 새 저장 구조를 만들지 않았다.**
                ① **튜토리얼 첫 장(T1)** 이면 보인다 — 그 아이가 처음 보는 화면이다
                ② **튜토리얼이 꺼져 있는 아이**는 `first_experience_complete` 가 거짓일 때만
                   보인다 — **카드를 한 장도 안 썼다**는 뜻이다(`api/app/api/v1/child.py`)
                ③ 나머지는 안 보인다. **새로고침해도 같다** — 화면 기억이 아니라 서버 값이다
                ⛔ **되묻기·차단은 안 감춘다** — `카드첫말인가` 가 거짓이다.

                **⛔ 2026-09-22 오후에 감추는 대신 갈아 끼우게 됐다** (사용자 지시).
                종전에는 되풀이되는 소개를 **말풍선째 감췄는데**, 그러면 **큰 래서판다가
                말풍선 없이** 서서 **조용한 동행자가 아니라 빠진 화면**으로 보였다.
                **지금은 「이제 어떻게 할까?」로 바꾼다** — 글쓰기 화면에서 래서판다가
                하는 일은 **묻는 것**이고, 그건 어느 카드에서나 같다. */}
            <GuideFigure
              guide={화면대사(screen, 첫경험완료)}
              stage
              compass={<StageCompass length={text.length} />}
            />
          </SkippableStage>
          <GameConsole>
            {/* 입력창은 **아래 전폭**이다. 오른쪽 절반에 가두면 줄이 짧아지고,
                짧은 칸은 짧게 쓰게 만든다 — H2 합격선이 회당 150자다. */}
            <AttemptInput
              showCompass={false}
              label={screen.card.prompt_label}
              /* ⛔ **2026-09-22 에 카드 화면에도 안내글을 넣었다** (사용자 지시 — 글쓰기 화면
                 역할 통일). 종전에 안 넣은 근거는 **「물음(`prompt_label`)이 바로 위에
                 보인다」**였는데, 같은 지시로 **그 제목을 화면에서 감췄다**(`sr-only`).
                 그래서 **쓰는 칸에 아무 말도 없는 상태**가 됐다 — 2048×1152 에서 실측했다.
                 ⭐ **묻는 것은 래서판다 하나, 쓸 자리를 가리키는 것은 이 한 줄**이다.
                 본편과 같은 상수를 쓴다. */
              안내글={턴문구.입력안내}
              value={text}
              onChange={setText}
              onMasked={가림알림}
              disabled={screen.kind === "sending"}
              /* ⛔ **보내는 동안에도 글자를 안 바꾼다** (2026-09-23 사용자 지시).
                 종전에는 「그림을 준비하는 중…」으로 갈렸는데, **같은 순간 입력칸 아래에서
                 「네 이야기를 읽고 있어.」가 이미 진행 상태를 말하고 있었다.** 둘이
                 **서로 다른 단계**를 말해서 지금 무엇을 하는 중인지가 오히려 흐려졌다.
                 ⛔ **프론트는 서버가 어느 단계인지 모른다** — `POST /attempts` 는 요청 하나다. */
              보내기라벨={버튼.그림으로보기}
              보내는중={screen.kind === "sending"}
              // **글자 수로 잠그지 않는다.** 30자는 격려일 뿐 관문이 아니다
              // (`web/tasks/W2.md` 메모). 막는 것은 「아직 아무것도 안 썼다」와 「보내는 중」뿐이다.
              보낼수있나={text.trim() !== "" && screen.kind !== "sending"}
              onSend={() => void send(screen.card, screen.guide)}
            />
            {/* **입력칸 곁이다.** 무엇에 대한 말인지 아이가 찾지 않아도 되게 —
                자녀 인증 화면이 오류를 입력칸 곁에 두는 것과 같다. */}
            {previousResult !== null && (
              <button type="button" data-다시쓰기취소 onClick={다시쓰기취소}
                disabled={screen.kind === "sending"} className="pressable action-quiet self-start">
                {다시쓰기취소라벨}
              </button>
            )}
            {sendError && screen.kind === "card" && (
              <p data-보내기못닿음 className="text-xl/relaxed">
                {sendError}
              </p>
            )}
            {/* **⛔ 이 자리가 비어 있었다** (`문구.md` 2.5 넷째, 2026-09-16). 보내는 동안
                **입력창이 잠기고 버튼이 흐려질 뿐 아무 말도 안 했다** — 2.9초지만
                **눌렸는지 아닌지를 화면이 말해 주지 않는 것**은 길이와 별개다.
                **가이드가 말을 거는 자리가 아니다** — 평가가 도는 중이라
                **무슨 말이든 판정을 예고하는 것처럼 읽힌다**(2.5 근거 ②). */}
            {screen.kind === "sending" && <StoryReading />}
          </GameConsole>
          </CompassIntroduction>
        )}

        {screen.kind === "sent" && (
          <div className="result-spread" data-artwork-state={삽화.kind}>
            {/* ## ⛔ 읽는 순서를 아이 글부터로 바꿨다 (2026-09-23 사용자 확정)
                종전에는 **그림이 왼쪽 · 아이 글이 오른쪽인 좌우 2열**이었다. 한국어는
                왼쪽에서 읽으므로 **아이 눈에 먼저 닿는 것이 그림**이고, 그 그림을 만든
                **원인(아이 문장)이 뒤**였다 — **결과가 원인보다 먼저** 보였다.
                ⭐ **본편이 이미 쓰던 순서로 맞춘다** — 아이 글 → 삽화 → 배지 → 반응 →
                다음 행동. 두 화면이 같은 순서라 아이가 한 번 배운 것을 다시 안 배운다.
                ⛔ **좌우 2열의 근거를 문서에서 못 찾았다** — `문구.md`·PRD·`adr/` 에 없고
                이 파일과 `result-stage.css` 주석뿐이라 **내부 구현 판단으로 바꿨다**
                (PM 이 같은 결론을 확인했다).
                ⚠ **아동 3명 회차에서 이미 쓰인 화면이다** — 바꾸면 그때 관찰과 조건이
                달라진다. 알고 바꾸는 것이다. */}
            <div className="result-reading">
              {/* 그림을 기다릴 때는 액자 안 대사만 보인다. 못 받은 경우에는
                  빈 액자 없이 아이의 원문과 서버의 반응을 그대로 보여준다. */}
              {삽화.kind !== "기다림" && (
                <WrittenLine text={text} highlights={screen.result.highlights} />
              )}
              {/* ## ⛔ 배지를 액자와 한 묶음에 둔다 (2026-09-24 사용자 확정)
                  **읽는 차례는 그대로다** — 아이 글 → 액자 → 배지 → 반응. 묶음만 생겼다.
                  **왜 묶나** — 배지를 **액자 모서리나 액자 옆**에 놓으려면 **액자를 기준으로
                  자리를 잡아야** 하는데, 형제로 떨어져 있으면 기준이 될 상자가 없다.
                  ⛔ **액자 높이를 CSS 가 모르기 때문**이다 — 액자 폭은 `--result-frame-size`
                  로 정해지지만 **높이는 오는 그림의 비율이 정한다**(`lib/artwork-frame.ts` —
                  1:1 과 0.58 두 모양이 공존한다). 그래서 「액자 높이만큼 위로」 같은 계산이
                  성립하지 않고, **액자를 감싸는 상자 안에서 위·아래를 잡는 것**만 성립한다. */}
              <div className="result-artwork-row">
                <ArtworkFrame 상태={삽화} waitingContent={<StoryOpening />} />
                {/* **⛔ 배지 아래 「첫 안내」 줄을 걷어냈다** (2026-09-21 사용자 판정).
                    **설명이 세 겹이었다** — 배지에 올리면 툴팁, 누르면 설명 창,
                    그 아래 또 한 줄. **조건은 앞의 둘이 살아 있는 것**이었고
                    `tier-badge.tsx` 의 `role="tooltip"` 과 `TierBadgeHelp` 가 그대로다. */}
                {삽화.kind !== "기다림" && <TierBadge tier={screen.result.tier} />}
              </div>
              {삽화.kind !== "기다림" && (
                <div className="result-content">
                  <GuideFigure guide={screen.result.guide} stage />
                </div>
              )}
            </div>

            {/* ⛔ **다음에 할 행동을 화면 아래에 못 박지 않는다** (2026-09-23 사용자 확정).
                종전에는 이 묶음이 **결과 영역 밖에서 아래에 고정**돼 있었다. 그래서
                ① 390×844 에서 **래서판다 반응과 버튼 사이가 129.7px 비었고**
                ② **반응을 못 본 채로 버튼을 누를 수 있었다** — 작은 화면에서는 반응이
                   화면 밖이라 실제로 그랬다.
                ⭐ **반응 바로 뒤에 둔다.** 아이가 「네 낱말이 좋았어」를 지나야 다음으로 간다. */}
            {삽화.kind !== "기다림" && (
              <div className="result-controls">
                {튜토리얼차례(screen.card.card_id) === "t2" &&
                  T2권유를띄울까(screen.result.tier) && (
                  <p data-튜토리얼안내 className="text-center text-lg/relaxed text-accent">
                    {튜토리얼문구.다시쓰기권유}
                  </p>
                )}
                {/* ⛔ **닫는말은 한 번만 한다** (2026-09-23 사용자 확정 · `문구.md` 1.22).
                    「세 장면을 모두 완성했어!」는 **다 채웠다는 알림**이라, 「다시 써보기」로
                    같은 장면을 또 보낸 결과에서 되풀이할 자리가 아니다. 그 아래 문도 같이
                    되풀이됐다. **문장은 안 바꿨고 조건만 붙였다.** */}
                {튜토리얼차례(screen.card.card_id) === "t3" && !닫는말봤나 && (
                  <div className="result-invitation">
                    <p data-튜토리얼안내 className="text-center text-lg/relaxed text-accent">
                      {튜토리얼문구.닫는말}
                    </p>
                    <div className="flex justify-center">
                      <Link
                        href="/chapter"
                        data-모험문버튼
                        className="pressable action-primary"
                      >
                        {모험문.떠나기}
                      </Link>
                    </div>
                  </div>
                )}

                {/* 다시쓰기 → 다음 장면 → 내 책 순서와 각 동작은 그대로다.
                    튜토리얼 권유나 결과의 종류에 따라 다시쓰기를 강조하거나 숨기지 않는다. */}
                <div className="result-actions">
                  <button
                    type="button"
                    data-다시써보기
                    onClick={() => 다시쓰기(screen.card, screen.result.attempt_id)}
                    className="pressable action-secondary"
                  >
                    {버튼.다시써보기}
                  </button>
                  <button
                    type="button"
                    data-다음장면
                    onClick={retry}
                    className={`pressable ${튜토리얼차례(screen.card.card_id) === "t3" ? "action-secondary" : "action-primary"}`}
                  >
                    {버튼.다른이야기써보기}
                  </button>
                  {/* ⛔ **튜토리얼 중에는 안 그린다** (2026-09-21 사용자 판정).
                      **T1~T3 는 책에 안 쌓인다** (`api/app/api/v1/attempts.py` — 석 장이
                      실리면 아이 책의 첫 세 장이 연습이 된다). 그런데 이 버튼만 떠 있어서
                      **아이가 열면 빈 책을 본다.** 실제로 그렇게 났다 — `t1` 을 전설로 쓰고
                      책을 열었는데 0쪽이었다.
                      **⚠ 화면 위쪽의 같은 버튼은 이미 튜토리얼을 가리고 있었다** (`toolbar`).
                      **여기만 빠져 있었다.**
                      **⛔ 이것만으로는 안 끝난다** — 가이드가 「이 장면은 네 책에 남아」라고
                      말하는 것이 남아 있고 **그건 백엔드 몫**이다(`api/app/guide_lines.py`). */}
                  {튜토리얼차례(screen.card.card_id) === null && <BookLink />}
                </div>
              </div>
            )}
          </div>
        )}

        {screen.kind === "done" && (
          // **가이드가 배웅한다.** 표정도 서버가 준 것 그대로다 (`session_end`) —
          // 표정 4종 중 **이 자리를 위해 만든 얼굴**이고, 대사만 꺼내 쓰면 영영 안 나온다.
          <SessionEnding guide={screen.guide} line={screen.line} />
        )}

        {screen.kind === "refused" && (
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
              className="pressable action-primary"
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

      {/* **나가기는 `<main>` 밖이다.** 게임 화면에서는 패널 바깥 오른쪽 아래에 둔다.
          확인 대화창과 로그아웃 동작은 유지한다.

          **들어온 뒤에만 그린다** (2026-09-08 실기기, PM 판정). **로그인 전 화면에 나가는 문만
          있었다** — 들어온 적 없는 아이에게 「다시 들어오려면 부모님께 새 접속 코드를 받아야 해요」는
          **겁만 주고 사실도 아니다**(잃을 세션이 없다). **문장은 맞고 자리가 틀렸다.**
          **로딩 중에도 안 그린다** — 리다이렉트 전 찰나에 보이고, 아이는 그 찰나에 누른다.

          **인증된 뒤에는 상태를 안 가린다 — 어느 상태에서든 그 자리에 있다.** 「보내는 중」에만
          숨기는 규칙을 두려다 접었다: **오락가락하는 컨트롤이 오히려 눌러보게 만든다.**
          **두 규칙은 축이 다르다** — 앞은 「들어왔나」이고 뒤는 「들어온 뒤 무엇을 하는 중인가」다. */}

    </div>
    </BookOrigin>
  );
}
