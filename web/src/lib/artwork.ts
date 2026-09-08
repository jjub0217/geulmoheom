"use client";

import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import { apiGet } from "@/lib/api";

type ArtworkRef = components["schemas"]["ArtworkRef"];
type Artwork = components["schemas"]["Artwork"];

/**
 * 삽화 폴링 (백로그 B-3 프론트 몫, `docs/api/Stage0.md` 5절).
 *
 * **SSE 가 아니라 폴링이다** — 미결 11-1 확정. 이벤트 1회를 위해 연결 유지·프록시 타임아웃·
 * 재연결·모바일 백그라운드 전환을 다 얹을 값이 없다.
 *
 * **숫자 셋은 실측에서 나왔다** (`api/benchmarks/W1-image-bench.md`, 평균 6.2초·최대 8.1초).
 * **첫 폴링을 3초 미루는 것**이 핵심이다 — 즉시 시작하면 **확실히 헛도는 요청이 3회** 나간다.
 */
export const 첫폴링 = 3_000;
export const 폴링간격 = 2_000;
export const 폴링상한 = 15_000;

/**
 * **셋뿐이다. 「실패」가 없다.**
 *
 * `status` 에서 `failed` 가 빠진 것과 같은 이유다 — **모든 실패가 `ready` 로 수렴한다**
 * (15초 초과·생성 실패·출력 검사 차단 전부 기본 에셋). **아이가 그림을 못 받는 경우를
 * 만들지 않는다는 것이 B-3 의 결정**이고, 그 결정이 참인 한 실패 상태가 필요 없다.
 */
export type 삽화상태 =
  /** 굽는 중. **이 동안 가이드가 말을 건다**(C-1 「삽화 대기」) — 대기를 메우는 것이지 붙잡는 것이 아니다 */
  | { kind: "기다림" }
  | { kind: "떴다"; url: string }
  /**
   * 15초를 넘겼는데도 안 왔다. **실패 화면을 띄우는 상태가 아니다** —
   * 서버가 15초에 기본 에셋으로 확정하므로 **여기 오는 것은 서버가 통째로 안 닿는 경우**뿐이다.
   * 화면은 **그림 자리만 비우고 나머지(등급·가이드 대사)는 그대로 그린다.**
   */
  | { kind: "못받음" };

/**
 * `POST /attempts` 가 준 `artwork` 를 받아 **뜰 때까지 물어본다.**
 *
 * **훅 이름만 영문이다** — `react-hooks/rules-of-hooks` 가 `use` + 대문자를 검사하는데
 * 한글에는 대문자가 없다 (`web/CLAUDE.md` 「이 패키지의 관례」).
 *
 * **`url` 을 앞에 뭘 붙이지 않는다.** 서버가 **절대 주소**로 준다 — web 은 `app.`,
 * api 는 `api.` 라 **상대 경로면 `<img src>` 가 web 오리진에 붙어 그림이 통째로 안 뜬다.**
 */
export function useArtwork(ref: ArtworkRef | null): 삽화상태 {
  const id = ref?.artwork_id ?? null;
  // **이미 `ready` 면 폴링을 시작하지 않는다.** 서버가 캐시에서 바로 줄 수 있다.
  const 바로온주소 = ref?.status === "ready" ? ref.url : null;

  /**
   * **`id` 를 값에 함께 담는다.** 카드가 바뀌면 이전 삽화의 결과가 잠깐 남는데,
   * 그대로 쓰면 **앞 장면의 그림이 새 결과 화면에 뜬다.**
   *
   * **효과 안에서 동기로 `set` 하지 않는다** — 초기화가 필요하면 여기서 `id` 를 대조해
   * 떨어뜨린다. 그래서 아래 `set` 은 전부 타이머 콜백 안에서만 일어난다.
   */
  const [결과, set결과] = useState<{ id: string; 상태: 삽화상태 } | null>(null);

  useEffect(() => {
    if (id === null || 바로온주소 !== null) return;

    let 살아있다 = true;
    let 타이머: ReturnType<typeof setTimeout>;
    const 마감 = Date.now() + 폴링상한;

    const 물어본다 = async () => {
      try {
        const a = await apiGet<Artwork>(`/artworks/${id}`);
        if (!살아있다) return;
        if (a.status === "ready" && a.url !== null) {
          set결과({ id, 상태: { kind: "떴다", url: a.url } });
          return;
        }
      } catch {
        // **네트워크 오류·5xx 면 같은 간격으로 계속한다.** 별도 재시도 카운터를 두지 않는다 —
        // **15초 상한이 이미 상한이다** (`Stage0.md` 5절). 여기서 멈추면 **잠깐 끊긴 것과
        // 진짜 실패를 구분 못 하는데**, 아이 화면에서는 그 차이가 「그림이 없다」로 같아진다.
        if (!살아있다) return;
      }
      // **마감을 넘겼으면 그만둔다.** 서버가 15초에 기본 에셋으로 확정하므로
      // 정상 경로에서는 그 전에 `ready` 가 온다.
      if (Date.now() >= 마감) {
        set결과({ id, 상태: { kind: "못받음" } });
        return;
      }
      타이머 = setTimeout(() => void 물어본다(), 폴링간격);
    };

    타이머 = setTimeout(() => void 물어본다(), 첫폴링);

    return () => {
      살아있다 = false;
      clearTimeout(타이머);
    };
  }, [id, 바로온주소]);

  if (바로온주소 !== null) return { kind: "떴다", url: 바로온주소 };
  // **`id` 가 다르면 버린다** — 앞 장면 그림이 새 화면에 뜨는 것을 막는 자리다.
  if (id !== null && 결과?.id === id) return 결과.상태;
  return { kind: "기다림" };
}
