"use client";

import type { ReactNode } from "react";

import { CompassArrival, CompassGlow } from "@/components/compass-glow";
import { useCompassIntroduction } from "@/components/compass-introduction";

/** 상황을 읽고 동료의 말을 들은 뒤에만 아이가 쓰는 자리를 연다. */
export function GameConsole({ children }: { children: ReactNode }) {
  const introduction = useCompassIntroduction();
  const phase = introduction?.phase ?? "complete";
  const ready = phase === "complete";

  return (
    <div className="game-console" data-introduction-phase={phase} hidden={!ready}>
      <div
        className="game-response"
        data-response-visible={ready}
        inert={!ready}
        aria-hidden={!ready ? true : undefined}
      >
        <div className="game-response__content">{children}</div>
      </div>
    </div>
  );
}

/** 동료의 대사 곁에서 먼저 소개되고, 글쓰기 중에도 같은 물건이 빛난다. */
export function StageCompass({ length }: { length: number }) {
  const introduction = useCompassIntroduction();
  const phase = introduction?.phase ?? "complete";
  const awaitingArrival = phase === "prefix" || phase === "pause" || phase === "compass";
  return (
    <div
      className="game-compass"
      data-compass-destination
      data-compass-visible={phase !== "narrative"}
      data-compass-arrival-pending={awaitingArrival}
    >
      <CompassGlow length={length} introducing={phase === "compass"} />
      {phase === "compass" && <CompassArrival />}
    </div>
  );
}
