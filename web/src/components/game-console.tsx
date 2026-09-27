"use client";

import type { ReactNode } from "react";

import { CompassArrival, CompassGlow } from "@/components/compass-glow";
import { useCompassIntroduction } from "@/components/compass-introduction";

/**
 * 상황을 읽고 동료의 말을 들은 뒤에만 아이가 쓰는 자리를 연다.
 *
 * **⛔ 본편도 이것을 쓴다** (2026-09-22 사용자 지시). 종전에는 본편만 **입력칸을 늘 그려서**,
 * 서사가 한 글자씩 쓰이는 동안 **이미 입력칸이 서 있었다**(실측: 서사 10자 시점에 입력칸 있음).
 * 지시는 **서사 → 래서판다 질문 → 입력칸** 순서다 — **튜토리얼이 이미 하던 일**이라
 * 새 장치를 만들지 않고 이 부품을 같이 쓴다.
 */
export function GameConsole({ children, className = "" }: { children: ReactNode; className?: string }) {
  const introduction = useCompassIntroduction();
  const phase = introduction?.phase ?? "complete";
  const ready = phase === "complete";

  return (
    <div className={`game-console${className ? ` ${className}` : ""}`} data-introduction-phase={phase} hidden={!ready}>
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
  const 연출완료 = introduction?.연출완료 ?? "건너뜀";
  const awaitingArrival = phase === "prefix" || phase === "pause" || phase === "compass";
  return (
    <div
      className="game-compass"
      data-compass-destination
      data-compass-visible={phase !== "narrative"}
      data-compass-arrival-pending={awaitingArrival}
      /* **눈에 보이는 것은 하나도 안 더한다. 사실만 남긴다** (2026-09-21 사용자 지시).
         `data-compass-introducing` 은 **움직임을 줄이면 220ms 한 번**이라 지나가고 나면
         **연출이 돌았는지를 알 방법이 없었다.** 시간을 늘리는 대신 **끝났다는 사실**을 남긴다.
         ⛔ `complete` 는 둘을 덮는다 — **보고 끝낸 것**과 **이미 본 아이라 건너뛴 것**.
         그래서 아래 둘을 같이 둔다. 문구·배지·아이콘은 더하지 않았다. */
      data-compass-phase={phase}
      data-compass-introduction-complete={
        연출완료 === "연출함" ? "true" : 연출완료 === "건너뜀" ? "skipped" : "false"
      }
    >
      <CompassGlow length={length} introducing={phase === "compass"} />
      {phase === "compass" && <CompassArrival />}
    </div>
  );
}
