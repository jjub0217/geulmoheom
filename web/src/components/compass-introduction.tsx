"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { components } from "@/api/types.gen";

// 서버 문장을 바꾸지 않고, 사용자가 지정한 지점에서 나침반을 가리킨다.
const 가리키는말 = "여기 이 나침반,";
const 상황글자간격 = 38;
const 대사글자간격 = 45;
const 상황읽을시간 = 600;
const 대사읽을시간 = 800;
/** 가리키는 말을 다 읽은 뒤, 물건이 나타나기 전의 짧은 숨. */
const 나침반멈춤시간 = 200;
/** 등장·이동·도착 반짝임을 모두 담는 시간. */
const 나침반연출시간 = 1_200;
/**
 * ⛔ **움직임을 줄이면 이 위의 시간들을 하나도 안 쓴다** (2026-09-23 사용자 지시).
 * 종전에는 움직임을 줄여도 **단계마다 기다렸다** — 서사 뒤 600ms, 나침반 앞뒤로 600+200+220ms,
 * 말풍선 뒤 800ms. 첫 튜토리얼에서 **2,420ms**, 본편에서 **1,400ms** 였다(계산·실측 일치).
 * **글자 효과만 끄고 기다림은 그대로 둔 것**이라, 움직임에 예민한 아이가 얻는 것이 없었다.
 * ⭐ **순서는 그대로 지킨다** — 서사 → 래서판다·말풍선 → 입력칸. 다만 각 단계는
 * **다음 렌더로만** 넘어간다. 읽어 주는 기계가 순서대로 읽을 수 있고, 아이는 안 기다린다.
 */
const 움직임줄인대기 = 0;

type Phase = "narrative" | "prefix" | "pause" | "compass" | "rest" | "complete";
type Introduction = {
  line: string;
  visible: string;
  situation: string;
  visibleSituation: string;
  phase: Phase;
  /** 현재 차례를 완성하고 다음 차례로 간다. 이후 차례까지 건너뛰지는 않는다. */
  advance: () => void;
  /** 입력 이벤트 등에서 전체 연출을 끝내는 호환 경로. */
  finish: () => void;
  /**
   * **연출이 어떻게 끝났나.** `phase` 만으로는 **「보고 끝낸 것」과 「건너뛴 것」이 구분되지 않는다** —
   * 둘 다 `complete` 다.
   *
   * **⛔ 이 값이 필요한 이유는 검사가 아니라 사실이다.** 나침반 단계는 **지나가고 나면
   * 돌았는지 아닌지를 아무도 알 수 없다** — 움직임을 줄이면 그 단계 자체를 건너뛴다.
   * 눈에 보이는 것은 하나도 더하지 않고 **사실만 남긴다** (2026-09-21 사용자 지시).
   */
  연출완료: 완료종류;
};
type 완료종류 = "아직" | "연출함" | "건너뜀";
type Playback = {
  encounter: string; identity: string; phase: Phase;
  narrativeCount: number; count: number; 연출완료: 완료종류;
};

const IntroductionContext = createContext<Introduction | null>(null);

export function useCompassIntroduction() {
  return useContext(IntroductionContext);
}

/** 상황 → 동료의 말 → 나침반 → 나머지 말 → 글쓰기. 새로 들어오면 처음부터 보여준다. */
export function CompassIntroduction({
  guide,
  situation,
  cardId,
  skipOpening = false,
  children,
}: {
  guide: components["schemas"]["Guide"];
  situation: string;
  cardId: string;
  /** 책 왕복과 결과에서의 다시 쓰기는 이미 읽은 장면으로 곧바로 돌아간다. */
  skipOpening?: boolean;
  children: ReactNode;
}) {
  const line = guide.line;
  const eligible = guide.expression === "default" && line.startsWith(가리키는말);
  const encounter = JSON.stringify([cardId, situation]);
  const identity = JSON.stringify([cardId, situation, line]);
  const [state, setState] = useState<Playback>({ encounter, identity,
    phase: skipOpening ? "complete" : "narrative",
    narrativeCount: skipOpening ? Array.from(situation).length : 0,
    count: skipOpening ? Array.from(line).length : 0,
    // **건너뛰고 시작한 것을 「연출했다」로 적지 않는다.** 이미 본 아이와 처음 보는 아이가 섞인다.
    연출완료: skipOpening ? "건너뜀" : "아직" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skip = useRef<() => void>(() => {});
  // 현재 마운트에서 끝낸 카드만 기억한다. 새로고침·재진입 때는 새 소개가 시작된다.
  const completedEncounter = useRef<string | null>(null);

  const finish = useCallback((건너뜀 = false) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    skip.current = () => {};
    completedEncounter.current = encounter;
    setState({ encounter, identity, phase: "complete",
      narrativeCount: Array.from(situation).length, count: Array.from(line).length,
      연출완료: 건너뜀 ? "건너뜀" : "연출함" });
  }, [encounter, identity, line, situation]);
  const advance = useCallback(() => skip.current(), []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const narrative = Array.from(situation);
    const letters = Array.from(line);
    const pauseAt = Array.from(가리키는말).length;
    let alive = true;
    let count = 0;
    let narrativeCount = 0;
    let phase: Phase = "narrative";

    const cancelTimer = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const schedule = (callback: () => void, delay: number) => {
      cancelTimer();
      timer.current = setTimeout(() => { if (alive) callback(); }, delay);
    };
    /** 읽을 틈을 주는 대기. **움직임을 줄이면 0 이다** — 단계는 남고 기다림만 없어진다. */
    const 대기 = (ms: number) => (motion.matches ? 움직임줄인대기 : ms);
    const show = (next: Phase) => {
      phase = next;
      setState({ encounter, identity, phase, narrativeCount, count, 연출완료: "아직" });
    };
    const complete = () => {
      phase = "complete";
      finish();
    };
    const beginRest = () => {
      if (motion.matches) count = letters.length;
      show("rest");
      if (count >= letters.length) schedule(complete, 대기(대사읽을시간));
      else schedule(advanceGuide, 대사글자간격);
    };
    const beginCompass = () => {
      count = pauseAt;
      show("compass");
      // **여기는 움직임을 줄이지 않은 길에서만 온다** — 줄이면 `beginGuide` 와
      // `motionChanged` 가 둘 다 `beginRest` 로 바로 간다.
      schedule(beginRest, 나침반연출시간);
    };
    const pointCompass = () => {
      count = pauseAt;
      show("pause");
      schedule(beginCompass, 나침반멈춤시간);
    };
    const advanceGuide = () => {
      count += 1;
      if (eligible && phase === "prefix" && count >= pauseAt) pointCompass();
      else if (count >= letters.length) {
        show("rest");
        schedule(complete, 대사읽을시간);
      } else {
        show(phase);
        schedule(advanceGuide, 대사글자간격);
      }
    };
    const beginGuide = () => {
      narrativeCount = narrative.length;
      if (!eligible) {
        beginRest();
        return;
      }
      // ⛔ **움직임을 줄이면 `prefix` 를 안 거친다.** 그 단계는 **말풍선의 앞부분만**
      // 보여 주는 자리인데, 사용자가 정한 순서는 **「완성된 말풍선」**이다.
      // 나침반은 `phase !== "narrative"` 면 보이므로(`game-console.tsx`) 여기서 잃지 않는다.
      if (motion.matches) {
        beginRest();
        return;
      }
      count = 0;
      show("prefix");
      schedule(advanceGuide, 대사글자간격);
    };
    const advanceNarrative = () => {
      narrativeCount += 1;
      show("narrative");
      if (narrativeCount >= narrative.length) schedule(beginGuide, 상황읽을시간);
      else schedule(advanceNarrative, 상황글자간격);
    };

    skip.current = () => {
      cancelTimer();
      if (phase === "narrative") beginGuide();
      else if (phase === "prefix") pointCompass();
      // 소개 효과를 건너뛰어도 남은 대사는 읽는다. 나침반만 곧바로 도착 상태가 된다.
      else if (phase === "pause" || phase === "compass") beginRest();
      else if (phase === "rest") complete();
    };
    schedule(() => {
      // 같은 카드의 제출 응답·되묻기는 새 장면이 아니다. 초점과 입력을 유지한다.
      // **이미 본 아이다.** `complete()` 가 아니라 **건너뜀으로** 끝낸다 —
      // 이번 진입에서 연출이 돈 것처럼 기록하면 두 아이가 구분되지 않는다.
      if (skipOpening || completedEncounter.current === encounter) { phase = "complete"; finish(true); }
      else {
        completedEncounter.current = null;
        narrativeCount = motion.matches ? narrative.length : 0;
        show("narrative");
        if (motion.matches || narrative.length === 0) schedule(beginGuide, 대기(상황읽을시간));
        else schedule(advanceNarrative, 상황글자간격);
      }
    }, 0);

    const motionChanged = () => {
      if (!motion.matches) return;
      // 글자 애니메이션만 멈춘다. 화면의 다음 요소가 등장하는 순서는 지킨다.
      if (phase === "narrative") {
        narrativeCount = narrative.length;
        show("narrative");
        schedule(beginGuide, 움직임줄인대기);
      } else if (phase === "prefix" || phase === "pause" || phase === "compass") {
        beginRest();
      } else if (phase === "rest") {
        count = letters.length;
        show("rest");
        schedule(complete, 움직임줄인대기);
      }
    };
    motion.addEventListener("change", motionChanged);
    return () => {
      alive = false;
      cancelTimer();
      skip.current = () => {};
      motion.removeEventListener("change", motionChanged);
    };
  }, [eligible, encounter, finish, identity, line, situation, skipOpening]);

  const current = state.identity === identity ? state
    : state.encounter === encounter && state.phase === "complete"
      // 같은 카드의 다른 대사다. **앞서 어떻게 끝냈는지를 그대로 이어받는다.**
      ? { phase: "complete" as const, narrativeCount: Array.from(situation).length,
          count: Array.from(line).length, 연출완료: state.연출완료 }
      : { phase: "narrative" as const, narrativeCount: 0, count: 0, 연출완료: "아직" as const };
  return (
    // 단계가 바뀌어도 Provider와 입력창 자체를 리마운트하지 않는다.
    <IntroductionContext value={{
      line,
      visible: Array.from(line).slice(0, current.count).join(""),
      situation,
      visibleSituation: Array.from(situation).slice(0, current.narrativeCount).join(""),
      phase: current.phase,
      advance,
      finish,
      연출완료: current.연출완료,
    }}>
      {children}
    </IntroductionContext>
  );
}

/**
 * ## ⛔ 글자가 찍히는 동안에는 무대 어디를 눌러도 건너뛴다 (2026-09-23 사용자 확정 · ⑥ㄴ)
 *
 * **건너뛰는 기능은 이미 있었다** — 장면 글(`scene-card.tsx`)과 말풍선(`guide.tsx`)이
 * `role="button"` 으로 서 있고 `prefers-reduced-motion` 에서는 연출이 통째로 사라진다
 * (실측 6.36초 → 0.81초). **없던 것은 「누르면 된다」를 아이가 아는 길**이다.
 *
 * **⛔ 문장을 더하지 않고 푼다** (사용자 확정 — 갈래 ㄴ). 방법 셋을 겹친다.
 * ① **누를 수 있는 자리를 무대 전체로 넓힌다** — 여기가 그 하나다. 만 10세는
 *    글자를 정확히 겨누기보다 **아무 데나 누른다**
 * ② 손 모양 커서 — `pressable` 이 이미 준다(마우스 기기에만 먹는다)
 * ③ 찍히는 동안 **장면 판의 테두리가 보인다** — `game-stage.css`. **터치 기기에서
 *    유일하게 먹는 단서**다
 *
 * **⚠ 이것으로 충분한지는 아직 모른다.** 커서는 태블릿에 없고 테두리는 「살아 있다」까지만
 * 말한다. **아동 3명 회차에서 아이가 실제로 누르는지 보고**, 안 누르면 그때 말(갈래 ㄱ)로 간다.
 *
 * **⛔ 연출 길이(3.90초)는 안 건드렸다** — 그건 따로 판단할 것이다.
 *
 * **⛔ 읽어 주는 기계에는 새 버튼을 만들지 않는다** — 장면 글과 말풍선이 이미 그 이름으로
 * 서 있고, 여기에 또 버튼을 두면 **같은 일을 하는 것이 셋**이 된다. 그래서 `role` 도
 * `tabIndex` 도 안 준다. **마우스·손가락 전용 지름길**이다.
 *
 * **⛔ 이름만 영문이다** — `react-hooks/rules-of-hooks` 가 **컴포넌트를 첫 글자 대문자로**
 * 검사하는데 **한글에는 대문자가 없다.** 한글 이름을 쓰면 이 안에서 훅을 아예 못 쓴다
 * (`web/CLAUDE.md` 「이 패키지의 관례」 — 규칙의 예외가 아니라 도구의 제약이다).
 */
export function SkippableStage({ className, children, ...rest }: {
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  const introduction = useCompassIntroduction();
  const 찍는중 = introduction != null && introduction.phase !== "complete";
  /**
   * ## ⛔ 안쪽이 이미 받은 누름은 여기서 또 세지 않는다 (2026-09-23 검사가 잡았다)
   *
   * 장면 글과 말풍선은 **이미 `role="button"` 으로 자기 누름을 받는다.** 그 위에 무대가
   * 같은 일을 얹으니 **한 번 누른 것이 위로 타고 올라와 두 번** 세어졌고,
   * **차례를 하나 건너뛰던 것이 둘을 건너뛰었다.**
   * (`compass-intro.spec.ts` 「현재 차례를 마쳐도 다음 차례를 건너뛰지 않는다」)
   *
   * ⭐ **누른 자리가 이미 버튼이면 무대는 가만히 있는다.** 무대가 받는 것은
   * **글자도 말풍선도 아닌 빈자리**를 눌렀을 때뿐이다 — 그게 이 지름길의 목적이다.
   */
  const 무대가받나 = (event: { target: unknown }) =>
    !(event.target instanceof Element) || event.target.closest('[role="button"]') === null;
  return (
    <div
      className={className}
      data-건너뛸수있나={찍는중 ? "" : undefined}
      onClick={찍는중 ? (event) => { if (무대가받나(event)) introduction.advance(); } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
