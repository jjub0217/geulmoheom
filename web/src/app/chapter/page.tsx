"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { components } from "@/api/types.gen";
import { ArtworkFrame } from "@/components/artwork";
import { AttemptInput } from "@/components/attempt-input";
import { BookLink } from "@/components/book-link";
import { BookOrigin, useAdventureState, useAdventureRequest, useAdventureSession } from "@/components/book-journey";
import { LeaveButton } from "@/components/leave";
import { ChapterCompanion, chapterErrorGuide, chapterGuide } from "@/components/chapter-companion";
import { 챕터구조안내, 챕터보내기라벨, 챕터보내는중라벨, 챕터쓰기라벨 } from "@/components/chapter-writing";
import { CompassIntroduction } from "@/components/compass-introduction";
import { GuideFigure } from "@/components/guide";
import { SceneCard } from "@/components/scene-card";
import { 턴문구 } from "@/components/turn-copy";
import { WrittenLine } from "@/components/written-line";
import { ApiError, apiGet, apiPost, 인증이풀렸다, 역할이다르다 } from "@/lib/api";
import { 끊겨서보낼곳 } from "@/lib/kicked";
import { useArtwork } from "@/lib/artwork";
import { 액자에둘것 } from "@/lib/chapter-artwork";
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
  const [소개끝, set소개끝] = useAdventureState("/chapter", "introductionEnded", false);
  const [처음연출건너뜀, set처음연출건너뜀] = useState(restored && 소개끝);
  /**
   * **되묻기가 올 때마다 올린다.** 입력칸이 이 값을 보고 초점을 잡고 커서를 글 맨 뒤에 놓는다.
   * **횟수를 세는 것이 아니라 「또 왔다」를 알리는 것**이라 같은 값이 두 번 오면 안 된다.
   */
  const [이어쓰기신호, set이어쓰기신호] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
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
  }, [screen]);

  useEffect(() => {
    if (restored && loadAttempt === 0) return;
    if (시작했다.current) return;
    시작했다.current = true;

    const 열린것으로 = (v: ChapterView) => {
      if (!isCurrent()) return;
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

      // **진행했을 때만 입력창을 비운다.** 되묻기는 고쳐 쓰라는 말이고,
      // **차단은 아이 글을 지우지 않는 것이 규칙**이다 (`Stage0.md` 148행).
      if (r.outcome === "result") {
        setText("");
        set첫안내(false);
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
  const 안내가이드 = chapterGuide(view.guide, 첫안내);

  return (
    /* 튜토리얼과 같은 장면 → 동료 → 글쓰기 순서다.
       긴 서사는 읽기 영역에서 넘기고, 서사가 길면 문서도 자연스럽게 늘어난다.
       고정 높이에 모두 압축해 동료나 입력을 가리지 않는다. */
    <CompassIntroduction
      guide={안내가이드}
      situation={view.narrative ?? ""}
      cardId={view.chapterId}
      skipOpening={처음연출건너뜀}
    ><BookOrigin path="/chapter"><ChapterStage bookDisabled={보내는중}>
      {/* 장면과 동료는 튜토리얼과 같은 숲 위에 남는다. */}
      <div className="game-stage__world chapter-world">
        <div className="chapter-reading">
          {/* 삽화가 있는 장면만 액자를 보인다. 빈 상자를 만들지 않는다. */}
          {view.artwork && (
            <div className="chapter-visual">
              <ChapterArtwork 참조={view.artwork} 새그림={view.새삽화id === view.artwork.artwork_id} />
            </div>
          )}
          <div ref={이야기칸} className="game-story chapter-story" tabIndex={-1}>
            {/* **내가 쓴 것이 먼저, 그래서 벌어진 일이 다음이다.** 읽는 순서가 곧 인과다 —
                카드 결과 화면이 아이 문장과 그림을 나란히 두는 것과 같은 이유이고,
                본편에만 그 자리가 없었다. 묘사어 표시(`highlights`)도 같이 온다. */}
            {view.쓴것 && <WrittenLine text={view.쓴것.text} highlights={view.쓴것.highlights} />}
            {view.narrative && <SceneCard card={{ situation: view.narrative }} narrativeClassName="chapter-narrative" />}
          </div>
        </div>
        <ChapterCompanion
          guide={안내가이드}
          length={text.length}
          sending={보내는중}
          messageRef={동료말칸}
        />
      </div>

      {/* 글쓰기 영역은 동료와 분리하고, 튜토리얼의 공통 콘솔을 재사용한다. */}
      <div ref={쓰는곳} className="game-console chapter-console">
        <div data-chapter-structure-guide className="chapter-writing-guide">
          {챕터구조안내.map((줄) => <p key={줄}>{줄}</p>)}
        </div>
        <div className="game-response">
          <div className="game-response__content chapter-controls" aria-busy={보내는중}>
            <AttemptInput
              label={챕터쓰기라벨}
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
              보내기라벨={보내는중 ? 챕터보내는중라벨 : 챕터보내기라벨}
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
    </ChapterStage></BookOrigin></CompassIntroduction>
  );
}

/** 서사·응답·완결이 같은 숲에 머문다. 새 모험을 권하는 출구는 만들지 않는다. */
function ChapterStage({ children, done = false, status = false, bookDisabled = false }: {
  children: ReactNode;
  done?: boolean;
  status?: boolean;
  bookDisabled?: boolean;
}) {
  /* **이름은 "/" 와 같은 방법으로 받는다** — `GET /child/me`, 실패는 삼킨다.
     **이름을 모르는 것과 못 들어온 것은 다르다**(`app/page.tsx` 같은 자리). */
  const [이름, set이름] = useAdventureState<string | null>("/chapter", "name", null);
  useEffect(() => {
    let alive = true;
    apiGet<ChildMe>("/child/me")
      .then((me) => {
        if (alive) set이름(me.nickname);
      })
      .catch(() => {
        // 삼킨다. 이름이 없어도 모험이 막히면 안 된다.
      });
    return () => {
      alive = false;
    };
  }, [set이름]);

  return (
    <div className={`game-shell chapter-shell${done ? " game-shell--ending" : ""}`}>
      <main className={`game-stage chapter-stage${done ? " chapter-stage--done" : ""}${status ? " chapter-stage--status" : ""}`}>
        {/* **"/" 와 같은 자리·같은 클래스다** (2026-09-20 사용자 지시 — 공통 요소는 두 화면이 같아야 한다).
            종전에는 이 헤더가 **「내 책」 버튼**을 들고 있어 **이름이 들어갈 자리가 없었다.**
            "/" 는 **헤더가 이름(오른쪽 위) · 툴바가 「내 책」(가운데 위)**이고, 여기만 달랐다. */}
        {이름 !== null && (
          <header className="game-stage-header">
            <p data-탐험가이름 title={이름} className="text-sm text-[var(--muted)]">
              {이름}
            </p>
          </header>
        )}
        {!done && !status && (
          <div className="game-stage__toolbar">
            <BookLink disabled={bookDisabled} />
          </div>
        )}
        {children}
      </main>
      {/* **나가기는 `<main>` 밖이다** — "/" 가 그렇게 두고 `문구.md` **2.3** 이 정한 자리다.
          **모험 한가운데서 나갈 길이 없던 것이 이 화면의 결함이었다.**
          **완결·상태 화면에서도 그대로 둔다** — "/" 가 「들어온 뒤에는 상태를 안 가린다」로
          정한 것과 같다. 오락가락하는 컨트롤이 오히려 눌러보게 만든다. */}
      <footer className="game-stage-footer">
        <LeaveButton />
      </footer>
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
function ChapterArtwork({ 참조, 새그림 }: { 참조: ArtworkRef; 새그림: boolean }) {
  const 상태 = useArtwork(참조);
  return <>
    <ArtworkFrame
      상태={상태}
      waitingContent={새그림 ? <p>중요한 순간이야! 네 글로 그림을 만들고 있어.</p> : undefined}
    />
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
