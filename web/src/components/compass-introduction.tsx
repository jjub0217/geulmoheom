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
const 움직임줄인나침반시간 = 220;

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
};
type Playback = { encounter: string; identity: string; phase: Phase; narrativeCount: number; count: number };

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
    count: skipOpening ? Array.from(line).length : 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skip = useRef<() => void>(() => {});
  // 현재 마운트에서 끝낸 카드만 기억한다. 새로고침·재진입 때는 새 소개가 시작된다.
  const completedEncounter = useRef<string | null>(null);

  const finish = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    skip.current = () => {};
    completedEncounter.current = encounter;
    setState({ encounter, identity, phase: "complete", narrativeCount: Array.from(situation).length, count: Array.from(line).length });
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
    const show = (next: Phase) => {
      phase = next;
      setState({ encounter, identity, phase, narrativeCount, count });
    };
    const complete = () => {
      phase = "complete";
      finish();
    };
    const beginRest = () => {
      if (motion.matches) count = letters.length;
      show("rest");
      if (count >= letters.length) schedule(complete, 대사읽을시간);
      else schedule(advanceGuide, 대사글자간격);
    };
    const beginCompass = () => {
      count = pauseAt;
      show("compass");
      schedule(beginRest, motion.matches ? 움직임줄인나침반시간 : 나침반연출시간);
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
      count = motion.matches ? pauseAt : 0;
      show("prefix");
      if (motion.matches) schedule(pointCompass, 상황읽을시간);
      else schedule(advanceGuide, 대사글자간격);
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
      if (skipOpening || completedEncounter.current === encounter) complete();
      else {
        completedEncounter.current = null;
        narrativeCount = motion.matches ? narrative.length : 0;
        show("narrative");
        if (motion.matches || narrative.length === 0) schedule(beginGuide, 상황읽을시간);
        else schedule(advanceNarrative, 상황글자간격);
      }
    }, 0);

    const motionChanged = () => {
      if (!motion.matches) return;
      // 글자 애니메이션만 멈춘다. 화면의 다음 요소가 등장하는 순서는 지킨다.
      if (phase === "narrative") {
        narrativeCount = narrative.length;
        show("narrative");
        schedule(beginGuide, 상황읽을시간);
      } else if (phase === "prefix") {
        count = pauseAt;
        show("prefix");
        schedule(pointCompass, 나침반멈춤시간);
      } else if (phase === "pause" || phase === "compass") {
        beginRest();
      } else if (phase === "rest") {
        count = letters.length;
        show("rest");
        schedule(complete, 대사읽을시간);
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
      ? { phase: "complete" as const, narrativeCount: Array.from(situation).length, count: Array.from(line).length }
      : { phase: "narrative" as const, narrativeCount: 0, count: 0 };
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
    }}>
      {children}
    </IntroductionContext>
  );
}
