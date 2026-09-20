"use client";

import type { ReactNode } from "react";

import type { components } from "@/api/types.gen";
import { useCompassIntroduction } from "@/components/compass-introduction";

type Card = components["schemas"]["Card"];

/** 서버 상황문을 그대로 읽는다. 장면 연출의 전체 높이와 접근 가능한 문장은 처음부터 유지한다. */
export function SceneCard({
  card,
  children,
}: {
  card: Card;
  children?: ReactNode;
}) {
  const introduction = useCompassIntroduction();
  const scene = introduction?.situation === card.situation ? introduction : null;
  const narrating = scene?.phase === "narrative";
  const partial = scene !== null && scene.visibleSituation !== card.situation;
  return (
    <section className="scene-card" data-scene-phase={scene?.phase}>
      <p
        className={`scene-narrative${scene ? " scene-dialogue" : ""}${narrating ? " pressable" : ""}`}
        role={narrating ? "button" : undefined}
        tabIndex={narrating ? 0 : undefined}
        aria-label={narrating ? card.situation : undefined}
        onClick={narrating ? scene.advance : undefined}
        onKeyDown={narrating ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            scene.advance();
          }
        } : undefined}
      >
        {scene ? <>
          <span className="scene-dialogue-space" data-text={card.situation} aria-hidden="true" />
          <span className="scene-dialogue-typed" data-scene-typed aria-hidden={partial ? true : undefined}>{scene.visibleSituation}</span>
          {partial && <span className="sr-only">{card.situation}</span>}
        </> : card.situation}
      </p>
      {children}
    </section>
  );
}
