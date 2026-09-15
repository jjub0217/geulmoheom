"use client";

import { useEffect } from "react";

import { apiWake } from "@/lib/api";
import { 깨우기시작 } from "@/lib/wake";

/**
 * 식은 서버를 깨운다 (`src/lib/wake.ts` 에 이유와 규칙이 있다 · `주차계획/W6.md` 15번).
 *
 * **모든 화면에 붙는다** — 아이 화면이든 학부모 화면이든 **다음 요청이 502 로 죽는 것은
 * 같기 때문**이다. 그래서 `layout.tsx` 에 한 번 둔다.
 *
 * **아무것도 안 그린다.** 화면에 흔적을 남기면 **그 자체가 아이에게 설명할 것이 하나 느는 것**이다.
 */
export function Waker() {
  useEffect(
    () =>
      깨우기시작(apiWake, {
        보이나: () => document.visibilityState === "visible",
        구독: (바뀜) => {
          const 듣는다 = () => 바뀜(document.visibilityState === "visible");
          document.addEventListener("visibilitychange", 듣는다);
          return () => document.removeEventListener("visibilitychange", 듣는다);
        },
      }),
    [],
  );
  return null;
}
