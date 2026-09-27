"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { components } from "@/api/types.gen";
import { ArtworkFrame } from "@/components/artwork";
import { AttemptInput } from "@/components/attempt-input";
import { BookLink } from "@/components/book-link";
import { BookOrigin, useAdventureState, useAdventureRequest, useAdventureSession } from "@/components/book-journey";
import { useBookPageCount } from "@/components/book-progress";
import { LeaveButton } from "@/components/leave";
import { ChapterCompanion, chapterErrorGuide, chapterGuide } from "@/components/chapter-companion";
import { 결과라벨, 그림문구, 단계문구, 챕터구조안내, 챕터다시쓰기라벨, 챕터동료소개, 챕터보내기라벨, 챕터쓰기라벨 } from "@/components/chapter-writing";
import { CompassIntroduction, SkippableStage } from "@/components/compass-introduction";
import { GameConsole } from "@/components/game-console";
import { GuideFigure } from "@/components/guide";
import { SceneCard } from "@/components/scene-card";
import { 턴문구 } from "@/components/turn-copy";
import { WrittenLine } from "@/components/written-line";
import { ApiError, apiGet, apiPost, 인증이풀렸다, 역할이다르다 } from "@/lib/api";
import { 끊겨서보낼곳 } from "@/lib/kicked";
import { useArtwork } from "@/lib/artwork";
import { 액자에둘것 } from "@/lib/chapter-artwork";
import { 그림이할말 } from "@/lib/chapter-artwork-state";
import type { PiiKind } from "@/lib/pii";

import { 버튼, 못닿음 } from "../copy";
import { 상태표시 } from "../status-copy";

type ChapterView = components["schemas"]["ChapterView"];
type TurnResult = components["schemas"]["TurnResult"];
type ArtworkRef = components["schemas"]["ArtworkRef"];
type Guide = components["schemas"]["Guide"];
type Highlight = components["schemas"]["Highlight"];
type ChildMe = components["schemas"]["ChildMe"];

function chapterClosure(error: unknown): { guide: Guide | null; line: string | null } | null {
  if (!(error instanceof ApiError)) return null;
  if ((error.status === 429 && error.code === "TURN_LIMIT")
    || (error.status === 409 && error.code === "CHAPTER_DONE_TODAY")) {
    const guide = chapterErrorGuide(error.detail);
    return { guide, line: guide ? null : error.서버문구 };
  }
  return null;
}

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
  /** 쓰는 중. **되묻기·차단도 여기다** — 갈래를 따로 만들지 않는다. */
  | { kind: "turn"; view: 턴상태 }
  | { kind: "sending"; view: 턴상태 }
  /** 챕터가 끝났다. **가이드가 1.20 을 말한다** — 프론트가 문장을 안 짓는다. */
  | { kind: "done"; guide: Guide | null; line?: string | null; narrative?: string | null }
  | { kind: "unreachable"; line?: string };

type 턴상태 = {
  chapterId: string;
  narrative: string | null;
  /** 되묻기·차단이 오면 서버가 준 가이드. **대사를 프론트가 짓지 않는다.** */
  guide: Guide | null;
  /** **액자에 지금 걸려 있는 것.** 새 그림이 올 때만 바뀐다 (`lib/chapter-artwork.ts`). */
  artwork: ArtworkRef | null;
  /** 이번 응답이 새 그림을 만들기 시작했을 때만 안내를 붙인다. */
  새삽화id: string | null;
  /**
   * **아이가 방금 보낸 문장.** 보낸 뒤 입력칸은 비우지만 **화면에서 없애지는 않는다.**
   *
   * **⛔ 없으면 그림이 원인 없이 나타난다.** 「썼더니 그림이 나왔다」가 이 제품의 한 줄인데
   * 본편에서는 **「썼더니」가 화면에서 사라졌다** — 카드 결과 화면은 아이 문장·삽화·배지를
   * 나란히 두는데 본편만 달랐다. 사용자가 **「아이가 쓴 글이 없는데 왜 삽화가 있나」**로
   * 물어 드러났다 (2026-09-21).
   *
   * **⭐ 서버는 이미 `highlights` 를 보내고 있었다** — 받아서 그릴 자리가 없었을 뿐이다.
   */
  쓴것: { text: string; highlights: readonly Highlight[] } | null;
  /**
   * **이 대사가 「결과 단계」에서 할 말인가** (2026-09-22 사용자 지시).
   *
   * **진행(`result`) 응답의 가이드는 결과 단계의 말**이다 — 「좋아! 이제 무슨 일이
   * 생겼는지 볼까?」. 그 말을 **글쓰기 단계까지 들고 서 있으면** 아이는 **이미 본 이야기
   * 앞에서 같은 말을 또 읽는다.**
   *
   * **⛔ 되묻기·차단은 참이 아니다.** 그때는 **글쓰기 단계에 머물러 있고**, 그 대사가
   * 바로 **지금 무엇을 고쳐 쓰라는 말**이라 반드시 보여야 한다.
   */
  결과대사인가: boolean;
};

export default function ChapterPage() {
  const router = useRouter();
  const loadOnce = useAdventureRequest();
  const isCurrent = useAdventureSession();
  const [screen, setScreen] = useAdventureState<Screen>("/chapter", "screen", { kind: "loading" });
  const [restored] = useState(screen.kind !== "loading");
  const [text, setText] = useAdventureState("/chapter", "text", "");
  const [sendError, setSendError] = useAdventureState<string | null>("/chapter", "sendError", null);
  const [첫안내, set첫안내] = useAdventureState("/chapter", "first", true);
  /**
   * **그림 규칙을 말하는 줄을 2턴에 한 번 더 보였나** (2026-09-23 사용자 확정 · `문구.md` 1.18b).
   *
   * **⛔ 종전에는 첫 턴을 보내면 꺼져서 2~8턴 구간에 그림 규칙을 말하는 문장이 하나도
   * 없었다.** 본편은 **1턴과 9턴에만 그림이 나오는데**(`챕터뼈대_초안.md` — 매 턴 구우면
   * 하루 상한을 한 아이가 혼자 넘긴다), **아이는 카드에서 늘 그림을 받다가** 본편에서
   * 안 나오는 턴을 만난다. 화면이 아무 말도 안 하면 **「이번엔 내가 못 써서」**로 읽을
   * 여지가 있었다.
   *
   * **⭐ 새 문구를 안 지었다** — 이미 있는 둘째 줄(「중요한 순간은 그림으로 남고…」)을
   * **그 한 턴에만 한 번 더** 보인다. 아래 걸러내기가 첫 줄을 빼므로 한 줄이다.
   *
   * **⛔ 매 턴은 안 한다** — 그러면 **없는 것을 세는 화면**이 되고 1.13 과 부딪친다.
   *
   * **자리를 2턴으로 잡은 이유** — 첫 그림을 받은 **직후이자 처음 빠지기 직전**이라
   * 기대를 세우는 자리다. 빠진 뒤에 말하면 변명으로 읽힌다.
   */
  const [그림안내봤나, set그림안내봤나] = useAdventureState("/chapter", "artworkHintSeen", false);
  /**
   * ## 한 턴이 두 단계로 넘어간다 (2026-09-22 사용자 지시)
   *
   * **`글쓰기` → `결과` → 다시 `글쓰기`.** 종전에는 **아이 글·삽화·새 서사·래서판다 반응·
   * 입력칸이 한 화면에 다 펼쳐져** 있어서, 아이가 **무엇을 보고 무엇을 해야 하는지**가
   * 안 갈렸다.
   *
   * **⛔ 중간에 있던 `새장면` 단계를 걷어냈다** (같은 날 오후). 그 단계의 버튼
   * (「어떻게 할지 쓰기」)은 **아무것도 고르게 하지 않고 한 번 더 누르게** 할 뿐이었다.
   * **지금은 글쓰기 단계 안에서 시간 순서로 잇는다** — 새 서사가 한 글자씩 쓰이고,
   * 다 쓰이면 래서판다가 묻고, 그다음에 입력칸이 나온다. **그 순서는 `CompassIntroduction`
   * 이 이미 하던 일**이고 튜토리얼이 같은 것을 쓴다.
   *
   * **⛔ 주소를 나누지 않는다** (사용자 지시). 같은 `/chapter` 안의 **화면 상태**다 —
   * 서버의 챕터 진행도 책 저장도 이 값을 모른다.
   *
   * **⭐ 새로고침하면 `글쓰기` 로 돌아온다. 그것이 맞다** — 결과 단계를 복원하려면
   * **아이가 쓴 글이 있어야 하는데 서버가 그것을 돌려주지 않는다.** 억지로 만들면
   * **글을 다시 제출하거나 삽화를 다시 굽는 길**이 생긴다. 사용자가 그 점을 확인하고
   * **「최근 장면 서사와 다음 글쓰기 단계가 보이는 안전한 상태로 복구」**로 확정했다.
   * `useAdventureState` 는 **메모리에만 있어서** `/book` 왕복은 살아남고 새로고침에는
   * 초기값으로 돌아간다 — 그 성질이 곧 이 규칙이다.
   */
  const [단계, set단계] = useAdventureState<"글쓰기" | "결과">("/chapter", "stage", "글쓰기");
  const [소개끝, set소개끝] = useAdventureState("/chapter", "introductionEnded", false);
  const [처음연출건너뜀, set처음연출건너뜀] = useState(restored && 소개끝);
  /**
   * **되묻기가 올 때마다 올린다.** 입력칸이 이 값을 보고 초점을 잡고 커서를 글 맨 뒤에 놓는다.
   * **횟수를 세는 것이 아니라 「또 왔다」를 알리는 것**이라 같은 값이 두 번 오면 안 된다.
   */
  const [이어쓰기신호, set이어쓰기신호] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  /**
   * **책에 쌓인 것이 있나** (2026-09-22 사용자 지시).
   * **본편은 완결해야 책 한 장이 된다** — 그때까지 책이 비어 있는데 「내 책 펼치기」가
   * 떠 있어서 **아이가 누르면 빈 책**이었다. 실기기에서 실제로 났다.
   * **「없음」일 때만 감춘다** — 못 닿은 것(`모름`)까지 감추면 **카드로 쌓아 둔 책을
   * 통신 한 번 실패로 못 보게 된다.**
   */
  const 책 = useBookPageCount();
  const 책이비었나 = 책 === "없음" || 책 === "로딩";
  /**
   * **나침반 소개를 이 아이가 이미 봤나** (2026-09-22 사용자 결정 · `문구.md` 1.4b).
   *
   * 서버는 **본편을 열 때도 같은 첫 말**을 싣는데, **본편 입구는 카드를 한 번 끝낸 뒤에
   * 열린다** — 그러니 여기 들어온 아이는 **이미 카드 화면에서 그 소개를 봤다.**
   *
   * **⛔ 그래도 예외를 남긴다.** 튜토리얼을 건너뛰고 들어오는 길이 생기면
   * `first_experience_complete` 가 거짓이고, **그때는 여기가 처음 보는 화면**이다.
   * **모르는 동안(`null`)에는 안 보인다** — 떴다 사라지는 것보다 낫다.
   */
  const [첫경험완료] = useAdventureState<boolean | null>("/chapter", "firstExperience", null);
  const 소개를봤나 = 첫경험완료 !== false;
  const submitting = useRef(false);
  const 시작했다 = useRef(false);
  const 이야기칸 = useRef<HTMLDivElement>(null);
  const 마무리칸 = useRef<HTMLDivElement>(null);
  const 쓰는곳 = useRef<HTMLDivElement>(null);
  const 동료말칸 = useRef<HTMLDivElement>(null);
  const 새이야기로 = useRef(false);
  const 새동료말로 = useRef(false);

  useLayoutEffect(() => {
    if (screen.kind === "done") {
      마무리칸.current?.focus({ preventScroll: true });
      return;
    }
    if (screen.kind !== "turn" || !새이야기로.current) return;
    새이야기로.current = false;
    if (동료말칸.current) 동료말칸.current.scrollTop = 0;
    const story = 새동료말로.current ? 동료말칸.current : screen.view.narrative ? 이야기칸.current : 동료말칸.current;
    if (!story) return;
    // 직전 서사를 끝까지 읽었더라도 새 응답은 첫 문장부터 읽는다.
    story.scrollTop = 0;
    story.focus({ preventScroll: true });
    /**
     * ⛔ **페이지를 그 자리로 올린다** (2026-09-22).
     * 종전에는 **읽는 칸이 따로 스크롤**돼서 `scrollTop = 0` 한 줄이 「첫 문장으로」를
     * 다 했다. **그 내부 스크롤을 걷으면서**(사용자 확정 — 글이 다 펼쳐진다)
     * **아래까지 읽고 글을 보낸 아이가 새 이야기의 중간을 보게** 됐다.
     *
     * **⛔ 입력칸으로 스크롤하지 않는다** (사용자 지시). 올리는 곳은 **아이 글과
     * 이야기가 시작되는 자리**다 — 아이는 그것을 읽고 나서 내려온다.
     * **움직임을 안 쓴다**(`behavior` 기본값) — `prefers-reduced-motion` 을 쓰는 아이에게
     * 부드러운 스크롤은 도움이 아니라 방해다.
     */
    story.scrollIntoView({ block: "start" });
  }, [screen]);

  useEffect(() => {
    if (restored && loadAttempt === 0) return;
    if (시작했다.current) return;
    시작했다.current = true;

    const 열린것으로 = (v: ChapterView) => {
      if (!isCurrent()) return;
      /**
       * ⛔ **이어 들어온 판에서는 서사를 다시 타자기로 쓰지 않는다** (2026-09-22 사용자 지시).
       *
       * 새로고침하거나 나갔다 들어오면 서버는 **지금 장면의 서사**를 준다. 1턴이 아니면
       * 그 서사는 **아이가 이미 읽은 글**이고, 그것을 처음부터 다시 쓰면 **읽은 것을
       * 또 기다리게 된다.**
       *
       * **⭐ 「이미 읽었나」를 서버 값으로 안다** — `turn` 이 1보다 크면 아이가 이 챕터에서
       * 적어도 한 번 글을 보냈다는 뜻이다. **프론트 기억은 새로고침에 사라지므로**
       * 그것에 기댈 수 없다.
       */
      if (v.turn > 1) set처음연출건너뜀(true);
      setScreen({
        kind: "turn",
        view: {
          chapterId: v.chapter_id,
          narrative: v.narrative,
          guide: v.guide ?? null,
          // **첫 화면에는 직전이 없다.** 1턴이 핵심 씬이라 보통 여기서 온다.
          artwork: 액자에둘것(null, v.artwork),
          새삽화id: null,
          // 서버는 아이 문장을 안 돌려준다. 이어 들어온 판에서는 비어 있는 게 맞다.
          쓴것: null,
          // 첫 입장의 대사는 **나침반 소개**다. 글쓰기 단계에서 보여야 한다.
          결과대사인가: false,
        },
      });
    };

    // GET → 필요한 경우 POST까지 하나의 작업이다. 재진입해도 옛 도입 응답이 새 턴을 덮지 않는다.
    loadOnce("chapter-entry", async () => {
      try {
        return await apiGet<ChapterView>("/chapters/current");
      } catch (error) {
        if (isCurrent() && error instanceof ApiError && error.status === 404 && error.code === "NO_ACTIVE_CHAPTER") {
          return apiPost<ChapterView>("/chapters", {});
        }
        throw error;
      }
    })
      .then(열린것으로)
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        if (인증이풀렸다(error) || 역할이다르다(error)) {
          router.replace(역할이다르다(error) ? "/child/auth" : 끊겨서보낼곳);
          return;
        }
        const closure = chapterClosure(error);
        setScreen(closure ? { kind: "done", ...closure } : {
          kind: "unreachable", line: error instanceof ApiError ? error.서버문구 : undefined,
        });
      });

  }, [loadAttempt, restored, router, setScreen, loadOnce, isCurrent]);

  /**
   * 턴 하나를 보낸다.
   *
   * 사용자 승인(2026-09-19): 선택지 없이 직접 쓴 글만 보낸다.
   * 문장은 입력창에서 가린 그대로이고, 판정은 서버가 한다.
   */
  const 턴을보낸다 = async () => {
    if (screen.kind !== "turn" || text.trim() === "" || submitting.current) return;
    submitting.current = true;
    const view = screen.view;
    setSendError(null);
    setScreen({ kind: "sending", view });

    try {
      const r = await apiPost<TurnResult>("/turns", { chapter_id: view.chapterId, text });
      if (!isCurrent()) return;

      if (r.chapter_done) {
        setText("");
        setScreen({ kind: "done", guide: r.guide ?? null, narrative: r.narrative });
        return;
      }

      /**
       * ⛔ **보여 줄 새 장면이 없으면 단계를 안 넘긴다** (2026-09-22 사용자 지시).
       *
       * 진행(`result`)인데 **서사가 비어 오면**, 지금 구조로는 결과 단계를 지나
       * **빈 새 장면 화면**에 닿는다. 아이는 **아무것도 없는 화면 앞에서 무엇을 할지 모른다.**
       *
       * **⛔ 지금 서버는 이런 응답을 만들지 않는다** — 진행이면 GM 서사를 그대로 싣는다.
       * **그래도 막는다**: 화면이 빈 채로 나아가는 것은 **서버가 무엇을 보내든** 막아야 한다.
       *
       * **⭐ 기존 실패 처리와 같은 모양이다** — 화면을 갈아치우지 않고, **아이 글을 그대로
       * 두고**, 한 줄로 알린다. **다시 보내는 것은 아이가 고른다** — 자동으로 또 보내지 않는다.
       * **문구도 새로 만들지 않았다** — 「지금은 장면을 열 수 없어요」가 `문구.md` **2.4** 에
       * 이미 등록돼 있고, **여기서 못 연 것이 바로 그 장면**이다.
       */
      if (r.outcome === "result" && (r.narrative ?? "").trim() === "") {
        setSendError(못닿음.장면);
        setScreen({ kind: "turn", view });
        return;
      }

      // **진행했을 때만 입력창을 비운다.** 되묻기는 고쳐 쓰라는 말이고,
      // **차단은 아이 글을 지우지 않는 것이 규칙**이다 (`Stage0.md` 148행).
      if (r.outcome === "result") {
        setText("");
        // 첫 턴을 보내면 첫 안내가 꺼지고, 그다음 턴을 보내면 2턴 안내도 제 할 일을 끝낸다.
        if (첫안내) set첫안내(false);
        else set그림안내봤나(true);
        // **결과 단계로 넘어간다.** ⛔ **되묻기(G0)·차단은 안 넘긴다** — 그때는 아이가
        // **같은 턴을 다시 쓰는 중**이고, 글이 입력칸에 그대로 남아 있다.
        set단계("결과");
      }
      // **되묻기는 이어 쓰라는 말이다** (`MVP_PRD.md` 4.4). 글은 그대로 두고
      // **커서만 맨 뒤로** 보낸다 — 칸을 비우면 「다시 써」를 동작으로 말하는 것이 된다.
      if (r.outcome === "scaffold") set이어쓰기신호((앞) => 앞 + 1);
      // 책에서 돌아온 현재 장면만 건너뛴다. 새 턴은 같은 타자기 순서로 읽힌다.
      set처음연출건너뜀(false);

      새이야기로.current = true;
      새동료말로.current = r.outcome !== "result";
      setScreen({
        kind: "turn",
        view: {
          chapterId: view.chapterId,
          narrative: r.outcome === "result" ? r.narrative ?? null : view.narrative,
          guide: r.guide ?? null,
          // **⛔ 여덟 턴은 `artwork` 가 없다. 비우지 않는다.**
          artwork: 액자에둘것(view.artwork, r.artwork),
          새삽화id: r.artwork?.artwork_id ?? null,
          // **되묻기·차단은 갈아 끼우지 않는다** — 그때 아이 글은 입력칸에 그대로 남아 있고,
          // 같은 문장이 위아래에 두 번 서면 무엇을 고치라는 말인지 흐려진다.
          쓴것: r.outcome === "result" ? { text, highlights: r.highlights ?? [] } : view.쓴것,
          결과대사인가: r.outcome === "result",
        },
      });
    } catch (e) {
      if (!isCurrent()) return;
      if (인증이풀렸다(e) || 역할이다르다(e)) {
        router.replace(역할이다르다(e) ? "/child/auth" : 끊겨서보낼곳);
        return;
      }
      const closure = chapterClosure(e);
      if (closure) {
        setScreen({ kind: "done", ...closure });
        return;
      }
      // **화면을 안 버린다.** 쓴 것을 그대로 두고 한 줄로만 알린다 —
      // 화면을 갈아치우면 **다시 보낼 칸이 사라진다.**
      setSendError(e instanceof ApiError && e.서버문구 ? e.서버문구 : 못닿음.보내기);
      setScreen({ kind: "turn", view });
    } finally {
      submitting.current = false;
    }
  };

  if (screen.kind === "loading") {
    // **새 문구를 안 짓는다** — 챕터를 여는 것도 **장면을 펼치는 일**이다.
    return <ChapterStage status><p role="status" className="chapter-status">{상태표시.장면부르는중}</p></ChapterStage>;
  }

  if (screen.kind === "unreachable") {
    return <ChapterStage status>
      <p role="status" className="chapter-status">{screen.line || 못닿음.장면}</p>
      <button type="button" className="pressable action-primary" onClick={() => {
        시작했다.current = false;
        setScreen({ kind: "loading" });
        setLoadAttempt((n) => n + 1);
      }}>{버튼.다시열기}</button>
    </ChapterStage>;
  }

  if (screen.kind === "done") {
    // **완결 문장은 서버가 준다** (`문구.md` 1.20 · `guide.line`).
    // **⛔ 「이어서 더 하기」를 안 만든다 — 없는 것이 결정이다** (D-1 · 페르소나 7.1).
    return (
      <BookOrigin path="/chapter"><ChapterStage done>
        <div ref={마무리칸} className="chapter-ending" tabIndex={-1}>
          {screen.narrative && <p className="chapter-ending-narrative">{screen.narrative}</p>}
          {screen.guide && <GuideFigure guide={screen.guide} stage />}
          {!screen.guide && screen.line && <p className="chapter-ending-line">{screen.line}</p>}
          <BookLink prominent />
        </div>
      </ChapterStage></BookOrigin>
    );
  }

  const view = screen.view;
  const 보내는중 = screen.kind === "sending";
  const 안내가이드 = chapterGuide(view.guide, 첫안내, {
    글쓰기단계: 단계 === "글쓰기",
    // **이미 본 나침반 소개도 갈아 끼울 대상이다** — 감추면 말풍선 없는 래서판다가 남는다.
    결과대사인가: view.결과대사인가 || (view.guide?.line === 챕터동료소개 && 소개를봤나),
  });

  return (
    /* 튜토리얼과 같은 장면 → 동료 → 글쓰기 순서다.
       긴 서사는 읽기 영역에서 넘기고, 서사가 길면 문서도 자연스럽게 늘어난다.
       고정 높이에 모두 압축해 동료나 입력을 가리지 않는다. */
    <CompassIntroduction
      guide={안내가이드}
      /* ⛔ **결과 단계에는 서사를 안 넘긴다** (2026-09-22 실측으로 잡았다).
         이 연출은 **서사를 한 글자씩 쓰는 동안 래서판다를 감춘다.** 결과 단계에서는
         그 서사를 화면에서 뺐는데 연출은 그대로 돌아서, **래서판다가 투명한 채로
         남았다**(불투명도 0). 결과 단계에 필요한 것은 **짧은 반응 한 마디**다.
         **빈 문자열이면 쓸 글이 없어 연출이 즉시 끝나고 래서판다가 바로 선다.** */
      situation={단계 === "결과" ? "" : view.narrative ?? ""}
      /* ⭐ **단계를 열쇠에 넣어 글쓰기 단계에 들어설 때 연출을 새로 돌린다.**
         **아이가 「그다음 이야기 보기」를 누른 바로 그 자리**가 이 연출이 노리던 순간이다 —
         새 서사가 한 글자씩 쓰이고, 다 쓰이면 래서판다가 묻고, 그다음에 입력칸이 나온다.

         ⛔ **같은 서사를 두 번 쓰지 않는다** (2026-09-22 실측으로 두 번 잡았다).
         한 번은 단계 이름을 그대로 넣어서(127자에 5초, 그동안 래서판다가 투명했다),
         또 한 번은 **새로고침·`/book` 왕복**에서다 — 그건 `처음연출건너뜀` 이 막는다. */
      cardId={`${view.chapterId}:${단계}`}
      skipOpening={처음연출건너뜀}
    ><BookOrigin path="/chapter"><ChapterStage 보내는중={보내는중} bookHidden={책이비었나} 쓰던글있나={text.trim().length > 0}>
      {/* 장면과 동료는 튜토리얼과 같은 숲 위에 남는다. */}
      {/* 글자가 찍히는 동안에는 무대 어디를 눌러도 건너뛴다 (⑥ㄴ). */}
      <SkippableStage className="game-stage__world chapter-world" data-단계={단계}>
        {/* ⛔ **단계가 바뀐 것을 화면을 못 보는 아이에게도 알린다** (사용자 지시).
            **`role="status"` 라 초점을 안 뺏는다** — 읽어 주는 기계가 이 줄을 스스로 읽는다.
            **화면에는 안 보인다** — 보이는 것은 그 단계의 제목과 내용이 이미 말한다. */}
        <p className="sr-only" role="status">
          {단계 === "결과" ? 결과라벨.내글 : 결과라벨.이어진이야기}
        </p>
        {/* ## 한 턴이 세 단계로 넘어간다 (2026-09-22 사용자 지시)

            **결과** — 네가 쓴 글 · (이번 턴에 새 삽화가 있을 때만) 그 삽화 · 짧은 반응
            **글쓰기** — 새 장면 서사가 한 글자씩 → 래서판다가 「이제 어떻게 할까?」 → 입력칸

            ⛔ **새 삽화가 없는 턴에는 결과 단계에 이전 그림을 안 보인다.** 그 그림은
            **이번 턴의 결과가 아니다** — 방금 쓴 글의 결과처럼 두면 2턴부터 아이가
            「내 글로 이게 나왔다」로 읽는다. 그래서 「모험 그림」·「앞에서 만든 그림」
            제목도 이 단계에서는 안 쓴다. */}
        <div className="chapter-reading">
          <div ref={이야기칸} className="game-story chapter-story" tabIndex={-1}>
            {단계 === "결과" && view.쓴것 && (
              <>
                <p className="chapter-part-label">{결과라벨.내글}</p>
                <WrittenLine text={view.쓴것.text} highlights={view.쓴것.highlights} />
              </>
            )}
            {/* **글쓰기 단계의 중심**이다. ⛔ **작은 제목을 안 붙인다** —
                사용자 지시가 **「개발 기능명처럼 보이는 제목을 반드시 붙이지 않아도 된다.
                게임 속에서 새롭게 벌어진 일처럼 보이게 하라」**였다.
                **글쓰기 단계에도 남는다** — 아이가 **무엇에 대응해 쓰는지** 봐야 한다. */}
            {단계 !== "결과" && view.narrative && (
              <SceneCard card={{ situation: view.narrative }} narrativeClassName="chapter-narrative" />
            )}
          </div>
        </div>
        {/* ⛔ **이번 턴에 새로 만든 삽화만, 결과 단계에만 보인다.**
            첫 글 전에는 그 장면의 그림을 보인다 — 그건 **이전 턴의 결과가 아니라
            아이가 지금 대응할 장면**이고, 아이가 그것을 보고 쓴다. */}
        {view.artwork
          && (단계 === "결과" ? view.새삽화id === view.artwork.artwork_id : view.쓴것 === null)
          && (
          <div className="chapter-visual">
            {/* ⛔ **결과 단계에서만 제목과 상태를 말한다.** 글쓰기 단계의 그림은
                **아이가 지금 대응할 장면**이지 결과가 아니다 — 거기에 「모험 그림」이나
                「앞에서 만든 그림」을 달면 **틀린 말**이 된다 (2026-09-22 실측으로 잡았다:
                첫 글 전 화면에 「앞에서 만든 그림」이 떠 있었다). */}
            <ChapterArtwork
              참조={view.artwork}
              이번글로왔나={view.새삽화id === view.artwork.artwork_id}
              말한다={단계 === "결과"}
            />
          </div>
        )}
        {/* ⛔ **래서판다는 두 단계 모두에 선다** (2026-09-22 사용자 지시).
            결과 단계에서는 **짧은 반응**을, 글쓰기 단계에서는 **「이제 어떻게 할까?」**를
            말한다. **말풍선 없는 래서판다를 만들지 않는다** — 조용한 동행자가 아니라
            **말풍선이 빠진 화면**으로 보인다. */}
        {(
          <ChapterCompanion
            guide={안내가이드}
            length={text.length}
            sending={보내는중}
            messageRef={동료말칸}
            /* ⛔ **글쓰기 단계에서는 결과 단계의 말을 되풀이하지 않는다** (2026-09-22
               사용자 지시). 그 말은 **바로 앞 단계에서 이미 했고**, 아이는 지금
               **다음 글을 쓰는 중**이다. **래서판다와 나침반은 남는다** — 나침반이
               글자 수에 반응하는 자리다.
               ⭐ **되묻기·차단은 그대로 말한다** — 그때는 `결과대사인가` 가 거짓이고,
               그 대사가 곧 **무엇을 고쳐 쓰라는 말**이다. */
            /* ⛔ **결과 단계에는 나침반을 안 그린다** — 반응할 입력칸이 없다. */
            나침반없이={단계 === "결과"}
            /* ⛔ **말풍선을 감추지 않는다** (2026-09-22 사용자 지시).
               종전에는 되풀이되는 말을 **말풍선째 감췄는데**, 그러면 **말풍선 없는 래서판다**가
               남아 **조용한 동행자가 아니라 빠진 화면**으로 보였다.
               **지금은 감추는 대신 대사를 갈아 끼운다** (`chapterGuide` · 위 `안내가이드`). */
          />
        )}

        {/* ⛔ **넘기는 것은 아이다.** 자동으로 안 넘어간다 (사용자 지시 — 「긴 자동 대기
            시간을 만들지 않음」·「아이가 버튼을 눌러 다음 단계로 이동」).
            **⛔ 삽화가 준비 중이어도 누를 수 있다** (사용자 확정). 새 서사는 **이미 응답에
            와 있어서** 기다릴 이유가 없고, **삽화 작업은 그대로 이어진다.**
            **늦게 완성돼도 결과 단계로 안 돌아간다** — 단계는 아이가 누른 것만 바꾼다. */}
        {/* ⛔ **누르면 글쓰기 단계로 바로 간다** (2026-09-22 사용자 지시).
            종전에는 **새장면 단계를 한 번 더 거쳤는데**, 거기서 아이가 하는 일이
            **버튼을 한 번 더 누르는 것뿐**이었다. 지금은 **글쓰기 단계 안에서**
            새 서사가 쓰이고 → 래서판다가 묻고 → 입력칸이 나온다.
            **⛔ 삽화가 준비 중이어도 누를 수 있다** (사용자 확정). 새 서사는 **이미 응답에
            와 있어서** 기다릴 이유가 없고, **삽화 작업은 그대로 이어진다.** */}
        {단계 === "결과" && (
          <button
            type="button"
            data-그다음이야기
            onClick={() => {
              // **연출을 다시 돌린다** — 새 서사가 한 글자씩 쓰이는 자리가 여기다.
              set처음연출건너뜀(false);
              set단계("글쓰기");
            }}
            className="pressable action-primary chapter-stage-next"
          >
            {단계문구.그다음이야기}
          </button>
        )}
      </SkippableStage>

      {/* 글쓰기 영역은 동료와 분리하고, 튜토리얼의 공통 콘솔을 재사용한다.
          ⛔ **글쓰기 단계에만 그린다** — 결과 단계에서 입력칸이 같이 서 있으면
          **결과를 보는 것과 다음 글을 쓰는 것이 다시 안 갈린다.** 그것이 이번 변경의 이유다.
          ⭐ **초안은 사라지지 않는다** — `text` 는 단계와 무관한 상태이고 `/book` 왕복도 넘는다. */}
      {단계 === "글쓰기" && (
      /* ⛔ **연출이 끝나야 열린다** (2026-09-22 사용자 지시). 종전에는 이 자리가 그냥
         `<div>` 라 **서사가 쓰이는 동안 입력칸이 이미 서 있었다.** `GameConsole` 은
         **튜토리얼이 쓰던 부품**이고 `hidden` 으로 닫아 둔다 — 새 장치를 만들지 않았다. */
      <GameConsole className="chapter-console">
      <div ref={쓰는곳} className="chapter-console-inner">
        {/* **첫 턴에만 보인다** (2026-09-21 실측).
            이 두 줄은 **「네가 쓴 것이 어디로 가는지」를 알려주는 안내**이지 매 턴의 지시가 아니다.
            그런데 390×844 에서 **87px** 을 매 턴 먹었고, 그 화면의 세로 예산은
            **읽는 묶음 236 · 동료 162 · 콘솔 318 · 바닥 60 = 860px 으로 창(844)보다 이미 컸다.**
            한 번 읽은 말을 열 번 되풀이하느라 **삽화가 53px 로 줄어 있었다.**
            ⭐ `첫안내` 는 첫 턴을 보내면 꺼지고 이어하기에도 남는다 — 이미 있던 상태다. */}
        {/* ⛔ **책이 비어 있어도 첫 턴에만 보인다** (2026-09-22 사용자 지시 — 같은 날
            오전 결정을 오후에 뒤집었다. **기록으로 남긴다**).
            오전에는 **책이 비어 있는 동안 첫 턴 뒤에도 남겼다** — 근거는 「내 책 펼치기」가
            사라져 툴바 한 줄이 비니 그 자리를 쓴다는 것이었다.
            **뒤집은 근거는 「매 턴 반복되는 구조 설명을 없앤다」**이다. 이 두 줄은
            **무슨 일이 일어나는지 한 번 알려 주는 안내**이지 매 턴의 지시가 아니고,
            390×844 에서 **87px** 을 매 턴 먹는다. */}
        {/* ⛔ **2026-09-23 에 한 번을 더 열었다** (사용자 확정 · 1.18b).
            `그림안내봤나` 주석에 근거가 있다. **조건만 넓혔고 문장은 그대로다** —
            아래 걸러내기가 첫 줄을 빼므로 그때 서는 것은 **그림 규칙 한 줄**이다. */}
        {(첫안내 || (!그림안내봤나 && view.쓴것 !== null)) && (
          <div data-chapter-structure-guide className="chapter-writing-guide">
            {/* ⛔ **첫 줄은 첫 글 전에만 말한다** (2026-09-22 사용자 지시 「중복 안내 정리」).
                그 줄과 **결과 단계의 동료 반응**이 거의 같은 말이라, 둘이 한 화면에 서면
                **아이가 어느 것을 읽어야 할지 모른다.** 두 문장은 `문구.md` 1.18b 에 있다.
                ⭐ **둘째 줄은 남긴다** — **어디서도 되풀이되지 않고**, 책이 비어 있는 동안
                **왜 아직 책이 비었나**를 답하는 유일한 문장이다.
                ⚠ **바깥 조건이 `첫안내` 뿐이라 이 묶음 자체가 첫 턴에만 뜬다** — 이 걸러내기는
                **첫 턴 안에서 글을 보내기 전과 후**를 가른다(되묻기·차단으로 머무를 때). */}
            {챕터구조안내
              .filter((줄, i) => i > 0 || view.쓴것 === null)
              .map((줄) => <p key={줄}>{줄}</p>)}
          </div>
        )}
        <div className="game-response">
          <div className="game-response__content chapter-controls" aria-busy={보내는중}>
            <AttemptInput
              // **두 번째 글부터 제목이 바뀐다** (2026-09-22 사용자 지시).
              // 바로 앞 결과 단계에서 동료가 한 마디 한 뒤라, 여기서 같은 질문을
              // 되풀이하면 **처음 보는 화면과 구분이 안 된다.** 두 문장은 `문구.md` 1.18·1.18b.
              // **가르는 것은 「이 챕터에서 글을 한 번이라도 썼나」**이고, 그 증거가
              // 화면에 있는 아이 문장이다 — 서버가 준 것이라 새로고침해도 남는다.
              label={view.쓴것 ? 챕터다시쓰기라벨 : 챕터쓰기라벨}
              안내글={턴문구.입력안내}
              value={text}
              onChange={(value) => {
                setText(value);
                if (value.length > 0) set소개끝(true);
              }}
              onMasked={(kinds: PiiKind[]) => void kinds}
              onSend={() => void 턴을보낸다()}
              보낼수있나={text.trim().length > 0 && !보내는중}
              // **2.5 넷째가 이 자리를 위해 쓰인 문장이다** (W6 26번).
              /* ⛔ **보내는 동안에도 글자를 안 바꾼다** (2026-09-23 사용자 지시).
                 그 순간 **래서판다 말풍선이 이미 진행 상태를 말한다**(`ChapterCompanion` 의
                 보내는 중 갈래). 버튼까지 말하면 같은 일을 두 번 설명하는 것이다. */
              보내기라벨={챕터보내기라벨}
              보내는중={보내는중}
              disabled={보내는중}
              showCompass={false}
              이어쓰기신호={이어쓰기신호}
            />


            {sendError && (
              <p role="status" data-보내기못닿음 className="chapter-send-notice">
                {sendError}
              </p>
            )}
          </div>
        </div>
      </div>
      </GameConsole>
      )}
    </ChapterStage></BookOrigin></CompassIntroduction>
  );
}

/** 서사·응답·완결이 같은 숲에 머문다. 새 모험을 권하는 출구는 만들지 않는다. */
function ChapterStage({ children, done = false, status = false, 보내는중 = false, bookHidden = false, 쓰던글있나 = false }: {
  children: ReactNode;
  done?: boolean;
  status?: boolean;
  /**
   * **글을 보내는 요청이 도는 중인가** (2026-09-24 에 `bookDisabled` 에서 이름을 바꿨다).
   *
   * **⛔ 이름이 「책」만 가리키고 있었다.** 값은 처음부터 `보내는중` 이었는데 이름이
   * 쓰임 하나만 말해서, **나가기도 같이 잠가야 한다는 것이 이름에서 안 보였다.**
   * 이제 **무대 위에서 화면을 떠나는 길 둘**(책·나가기)이 이 하나를 같이 본다.
   */
  보내는중?: boolean;
  /** 책이 비어 있으면 「내 책 펼치기」를 아예 안 그린다 — 눌러도 빈 책이라서다. */
  bookHidden?: boolean;
  /** 입력칸에 아직 안 보낸 글이 있나. **나가기 확인 창이 한 줄을 더 말한다.** */
  쓰던글있나?: boolean;
}) {
  /* **이름은 "/" 와 같은 방법으로 받는다** — `GET /child/me`, 실패는 삼킨다.
     **이름을 모르는 것과 못 들어온 것은 다르다**(`app/page.tsx` 같은 자리). */
  const [이름, set이름] = useAdventureState<string | null>("/chapter", "name", null);
  /**
   * **같은 응답에서 「소개를 이미 봤나」도 꺼낸다** (2026-09-22).
   * **요청을 늘리지 않는다** — 이름을 받는 그 응답에 이미 들어 있다.
   * 화면 위쪽 컴포넌트가 같은 자리(`"/chapter"`·`"firstExperience"`)를 읽는다.
   */
  const [, set첫경험완료] = useAdventureState<boolean | null>("/chapter", "firstExperience", null);
  useEffect(() => {
    let alive = true;
    apiGet<ChildMe>("/child/me")
      .then((me) => {
        if (!alive) return;
        set이름(me.nickname);
        set첫경험완료(me.first_experience_complete ?? null);
      })
      .catch(() => {
        // 삼킨다. 이름이 없어도 모험이 막히면 안 된다.
      });
    return () => {
      alive = false;
    };
  }, [set이름, set첫경험완료]);

  return (
    <div className={`game-shell chapter-shell${done ? " game-shell--ending" : ""}`}>
      <main className={`game-stage chapter-stage${done ? " chapter-stage--done" : ""}${status ? " chapter-stage--status" : ""}`}>
        {/* **"/" 와 같은 자리·같은 클래스다** (2026-09-20 사용자 지시 — 공통 요소는 두 화면이 같아야 한다).
            종전에는 이 헤더가 **「내 책」 버튼**을 들고 있어 **이름이 들어갈 자리가 없었다.**
            "/" 는 **헤더가 이름(오른쪽 위) · 툴바가 「내 책」(가운데 위)**이고, 여기만 달랐다. */}
        {/* ⛔ **나가는 길이 이름 옆으로 올라왔다** (2026-09-22 사용자 지시).
            종전에는 **화면 맨 아래 `<footer>`** 였다 — 근거는 **「아이 눈에 띄는 자리에
            두지 않는다」**(`주차계획/W4.md`)를 **자리로 지킨다**는 것이었다.
            **뒤집은 근거는 「이름과 나가는 행동을 같은 상단 영역에 둔다」**이고,
            **눈에 덜 띄게 하는 일은 자리가 아니라 생김새가 맡는다** — 맨 글자
            버튼(`action-quiet`)이라 옆의 진행 버튼과 굵기가 다르다.
            **이름이 없어도 나가는 길은 있어야 한다** — 이름은 `GET /child/me` 가
            실패하면 비는데, 그때 나가는 길까지 같이 사라지면 아이가 갇힌다. */}
        <header className="game-stage-header">
          {이름 !== null && (
            <p data-탐험가이름 title={이름} className="text-sm text-[var(--muted)]">
              {이름}
            </p>
          )}
          {/* **보내는 동안에는 못 누른다** — 위 카드 화면과 같은 이유다 (2026-09-24). */}
          <LeaveButton 쓰던글있나={쓰던글있나} 잠금={보내는중} />
        </header>
        {/* ⛔ **책이 비었으면 이 버튼을 안 그린다** (2026-09-22 사용자 지시).
            **본편은 완결해야 책 한 장이 된다** — 첫 턴을 쓰고 삽화까지 받은 자리에서
            이 버튼을 누르면 **빈 책**이었다. **저장 규칙이 아니라 화면이 틀린 것이다.**
            **⛔ 쪽이 있으면 그대로 둔다** — 카드로 쌓은 책을 못 보게 하면 안 된다.
            **완결 화면(`done`)에는 그대로 있다** — 그때는 책 한 장이 이미 저장돼 있다. */}
        {!done && !status && !bookHidden && (
          <div className="game-stage__toolbar">
            <BookLink disabled={보내는중} />
          </div>
        )}
        {children}
      </main>
    </div>
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
function ChapterArtwork({ 참조, 이번글로왔나, 말한다 }: {
  참조: ArtworkRef;
  이번글로왔나: boolean;
  /** 제목과 상태 한 줄을 붙이나. **결과 단계에서만 참**이다. */
  말한다: boolean;
}) {
  // **`ready` 로 온 것도 한 번 물어본다** — 기본 그림인지 알아야 말을 고를 수 있다.
  const 상태 = useArtwork(참조, 0, undefined, 말한다);
  /**
   * **무엇을 말할지는 순수 함수가 정한다** (`lib/chapter-artwork-state.ts`).
   * 여기서 조건을 엮으면 **네 갈래를 재려고 화면을 띄워야** 하고, 그러면 안 재게 된다.
   */
  const 할말 = 그림이할말(상태, 이번글로왔나);
  return <>
    {/* ⛔ **제목을 안 붙인다** (2026-09-22 사용자 지시). 「모험 그림」이 **이번 글의
        결과인지 · 지난 그림인지 · 모험 전체의 대표 그림인지**를 안 갈랐다.
        **자리를 설명하는 대신 상태를 말한다** — 아래 세 갈래가 그 일을 한다. */}
    <ArtworkFrame
      상태={상태}
      waitingContent={할말 === "만드는중" ? <p>{그림문구.만드는중}</p> : undefined}
    />
    {/* ⛔ **네 갈래이고 그중 하나는 「아무 말도 안 함」이다** (2026-09-22 사용자 확정).
        기본 삽화에는 아무 말도 안 한다 — **「새 그림이 완성됐어!」는 거짓**이고
        **「기본 그림이야」는 「`fallback` 을 아이에게 알리지 않는다」**(대표 판정)를 깬다.
        **⚠ 「새 그림이 완성됐어!」는 2026-09-21 에 한 번 내렸던 문장이다.** 그때 근거는
        「그림이 오는 것 자체가 그 말이다」였고 **그때는 새 그림뿐이었다.** 지금은
        **이전 그림과 갈라야 해서** 되살아났다 — 같은 문장이지만 하는 일이 다르다. */}
    {말한다 && 할말 === "새로왔다" && (
      <p data-그림상태 role="status" className="chapter-artwork-note chapter-artwork-note--새것">
        {그림문구.새로왔다}
      </p>
    )}
    {말한다 && 할말 === "앞에서만든것" && (
      <p data-그림상태 className="chapter-artwork-note">{그림문구.앞에서만든것}</p>
    )}
    {/* **「새로운 그림이 완성됐어!」를 내렸다** (2026-09-21 사용자 판정).
        **그림이 오는 것 자체가 그 말이다** — 「중요한 순간이야! 네 글로 그림을 만들고 있어.」가
        **액자 안에** 있다가 **그림으로 덮이므로**, 말이 그림으로 바뀌는 것으로 이미 닫힌다.
        한 번 더 말하는 것은 **끝난 이야기를 되풀이하는 것**이고, 액자 밖 좁은 칸에 걸려
        **자리도 어정쩡했다.**
        ⚠ 잃는 것 — 기본 에셋으로 대체됐을 때는 안 뜨던 줄이라, **「진짜 내 글로 만든 그림」과
        「기본 그림」을 화면에서 가를 표시가 없어진다.** 다만 `문구.md` 1.18b 가 그 줄에 건 조건은
        **「기본 삽화가 성공한 것처럼 말하지 않는다」**로 **거짓말을 막는 쪽**이었고,
        **아무 말도 안 하면 거짓말도 아니다.** */}
  </>;
}
