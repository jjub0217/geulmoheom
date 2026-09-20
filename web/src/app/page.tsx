"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { components } from "@/api/types.gen";
import { ArtworkFrame } from "@/components/artwork";
import { BookLink } from "@/components/book-link";
import { BookOrigin, useAdventureState, useAdventureRequest, useAdventureSession } from "@/components/book-journey";
import { AttemptInput } from "@/components/attempt-input";
import { CompassIntroduction } from "@/components/compass-introduction";
import { GameConsole, StageCompass } from "@/components/game-console";
import { GuideFigure } from "@/components/guide";
import { LeaveButton } from "@/components/leave";
import { ChapterDoor } from "@/components/chapter-door";
import { SceneCard } from "@/components/scene-card";
import { SessionEnding } from "@/components/session-ending";
import { StoryOpening, StoryReading } from "@/components/story-opening";
import { TierBadge } from "@/components/tier-badge";
import { TierBadgeWritingIntroduction, 다시쓰기안내 } from "@/components/tier-badge-writing-intro";
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
  | { kind: "card"; card: Card; guide: Guide }
  /** 보내는 중. 같은 화면을 두고 버튼만 잠근다 — 쓴 것이 사라지면 아이는 날아간 줄 안다. */
  | { kind: "sending"; card: Card; guide: Guide }
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
const 다른장면라벨 = "다른 장면 써보기";

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
        setScreen({ kind: "card", card, guide: card.guide });
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
    setScreen({ kind: "sending", card, guide });
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
        setScreen({ kind: "card", card, guide: outcome.guide });
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
          setScreen({ kind: "card", card, guide });
        }
        return;
      }
      if (e instanceof NetworkError) {
        // **화면을 넘기지 않는다.** 넘기면 「다시 열기」가 **다른 카드**를 불러오고,
        // 입력칸에 남은 문장이 **앞 장면에 쓴 글인 채로 새 장면에 붙는다.**
        // 되묻기·차단이 그 자리에 머무는 것과 같은 이유다 — **공들여 쓴 글이 사라지면 그것 자체가 벌**이다.
        setSendError(못닿음.보내기);
        setScreen({ kind: "card", card, guide });
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
    setPreviousResult({ screen, text });
    set재시도원본(앞시도);
    setSendError(null);
    setScreen({ kind: "card", card, guide: card.guide });
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
      {이름 !== null && (
        <header className={gameScene ? "game-stage-header" : "page-frame adventure-header flex justify-end pt-3"}>
          <p data-탐험가이름 title={이름} className="text-sm text-[var(--muted)]">
            {이름}
          </p>
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
            guide={screen.guide}
            situation={screen.card.situation}
            cardId={screen.card.card_id}
            skipOpening={screen.card.card_id === restoredCard || previousResult !== null}
          >
          <div className="game-stage__world">
            {/* **튜토리얼 여는 말** (`문구.md` 1.22 · A-6). **T1 에서 카드보다 먼저**다 —
                **쓰는 것이 곧 깨우는 것**이라는 전제를 말한 뒤에 첫 장면이 온다.
                **⛔ 새 화면을 만들지 않는다** — A-6 이 「루프를 설정만 바꾼다」이고,
                안내 화면을 한 장 세우면 **첫 5~7분에 관문이 하나 생긴다.** */}
            {/* **모험으로 들어가는 문** (`문구.md` 1.25 · W7 18번).
                **⛔ 튜토리얼 중에는 안 그린다** — T1~T3 는 **첫 5~7분**이고
                **A-6 이 「잠금·관문 없음」으로 세운 자리**다. 여기에 다른 길을 같이 내면
                **아이가 무엇부터 할지 고르게 되고 그 5~7분이 관문이 된다.**
                **T3 를 끝낸 뒤에 열린다** — 아래 결과 화면과 여기 둘 다. */}
            <div className="game-stage__toolbar">
              {첫경험완료 === true && 튜토리얼차례(screen.card.card_id) === null && (
                text.length === 0 && previousResult === null && screen.kind === "card"
                  ? <ChapterDoor /> : <BookLink disabled={screen.kind === "sending"} />
              )}
              {튜토리얼차례(screen.card.card_id) === "t1" && (
                <p data-튜토리얼안내 className="text-lg/relaxed text-accent">
                  {튜토리얼문구.여는말}
                </p>
              )}
            </div>
            <div className="game-story">
              <SceneCard card={screen.card} />
            </div>
            {/* 표정도 대사도 **서버가 마지막에 준 것**이다. 되묻기면 여기가 그 질문 자리가 된다. */}
            <GuideFigure guide={screen.guide} stage compass={<StageCompass length={text.length} />} />
          </div>
          <GameConsole>
            <TierBadgeWritingIntroduction
              onConfirm={() => document.querySelector<HTMLTextAreaElement>(".game-console textarea")?.focus()}
            />
            {/* 입력창은 **아래 전폭**이다. 오른쪽 절반에 가두면 줄이 짧아지고,
                짧은 칸은 짧게 쓰게 만든다 — H2 합격선이 회당 150자다. */}
            <AttemptInput
              showCompass={false}
              label={screen.card.prompt_label}
              value={text}
              onChange={setText}
              onMasked={가림알림}
              disabled={screen.kind === "sending"}
              보내기라벨={screen.kind === "sending" ? "그림을 준비하는 중…" : "내 이야기를 그림으로 보기"}
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
            <div className="result-reading">
              <ArtworkFrame 상태={삽화} waitingContent={<StoryOpening />} />
              {/* 그림을 기다릴 때는 액자 안 대사만 보인다. 못 받은 경우에는
                  빈 액자 없이 아이의 원문과 서버의 반응을 그대로 보여준다. */}
              {삽화.kind !== "기다림" && (
                <div className="result-content">
                  <WrittenLine text={text} highlights={screen.result.highlights} />
                  <TierBadge tier={screen.result.tier} introduce />
                  <GuideFigure guide={screen.result.guide} stage />
                </div>
              )}
            </div>

            {/* 작은 화면에서는 읽는 영역만 스크롤된다. 다음에 할 행동은 아래에 남긴다. */}
            {삽화.kind !== "기다림" && (
              <div className="result-controls">
                {튜토리얼차례(screen.card.card_id) === "t2" &&
                  T2권유를띄울까(screen.result.tier) && (
                  <p data-튜토리얼안내 className="text-center text-lg/relaxed text-accent">
                    {다시쓰기안내}
                  </p>
                )}
                {튜토리얼차례(screen.card.card_id) === "t3" && (
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
                    {튜토리얼차례(screen.card.card_id) === "t3" ? 다른장면라벨 : "새 이야기 만나기"}
                  </button>
                  <BookLink />
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
      {인증확인됨(screen) && (
        <footer className={gameScene ? "game-stage-footer" : "page-frame adventure-footer flex justify-center pb-3"}>
          <LeaveButton />
        </footer>
      )}
    </div>
    </BookOrigin>
  );
}
