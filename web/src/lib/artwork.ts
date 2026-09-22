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
 * **첫 폴링을 3초 미루는 것**이 핵심이다 — 즉시 시작하면 **확실히 헛도는 요청이 3회** 나간다.
 * 서버는 60초 뒤에도 pending이면 기본 삽화로 확정한다. 기본 결과 화면은 기존 15초
 * 상한을 유지한다. 책만 서버 확정까지 기다린다. 실제 완료는 준비되는 즉시 멈춘다.
 */
export const 첫폴링 = 3_000;
export const 폴링간격 = 2_000;
/** 카드 결과와 본편의 기존 대기 상한. */
export const 폴링상한 = 15_000;
/** 책은 서버의 60초 기본 삽화 확정과 다음 확인까지 기다린다. */
export const 책폴링상한 = 65_000;

/**
 * **셋뿐이다. 「실패」가 없다.**
 *
 * `status` 에서 `failed` 가 빠진 것과 같은 이유다 — **모든 실패가 `ready` 로 수렴한다**
 * (생성 실패·출력 검사 차단·60초 초과 전부 기본 에셋). **아이가 그림을 못 받는 경우를
 * 만들지 않는다는 것이 B-3 의 결정**이고, 그 결정이 참인 한 실패 상태가 필요 없다.
 */
export type 삽화상태 =
  /** 굽는 중. **이 동안 가이드가 말을 건다**(C-1 「삽화 대기」) — 대기를 메우는 것이지 붙잡는 것이 아니다 */
  | { kind: "기다림" }
  | { kind: "떴다"; url: string; fallback?: boolean }
  /**
   * 서버의 60초 확정 뒤에도 안 왔다. **실패 화면을 띄우는 상태가 아니다** —
   * 여기 오는 것은 서버가 통째로 안 닿는 경우뿐이다. 책에서는 아이가 다시 확인할 수 있다.
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
export function useArtwork(
  ref: ArtworkRef | null,
  재확인키 = 0,
  상한 = 폴링상한,
  /**
   * **이미 `ready` 로 온 것도 한 번 물어본다** (2026-09-22).
   *
   * ## ⛔ 왜 필요한가 — 기본 그림을 개인화 그림으로 말하고 있었다
   *
   * **`ArtworkRef` 에는 `fallback` 칸이 없다.** 그런데 서버가 **그림을 못 구울 때
   * 기본 에셋으로 즉시 `ready`** 를 준다(`artwork_store.챕터삽화만들기` — `굽나=False`).
   * 그러면 화면은 **기본 그림을 받아 놓고 개인화 그림으로 읽는다.**
   *
   * **본편 결과 단계가 그것을 말로 옮긴다** — 「새 그림이 완성됐어!」. 사용자가
   * **「기본 삽화에는 완성 문구를 표시하지 말라」**로 못 박은 자리다.
   *
   * **⛔ 계약을 안 바꿨다.** 있는 엔드포인트(`GET /artworks/{id}`)를 **한 번** 더 부른다.
   * **주소는 이미 왔으니 그림은 그 자리에서 보인다** — 늦어지는 것은 **말 한 줄**뿐이다.
   *
   * **기본값이 `false` 다** — 카드 화면은 이 값을 쓰지 않으므로 **부르지 않던 요청이
   * 거기서 생기지 않는다.**
   */
  ready도확인 = false,
): 삽화상태 {
  const id = ref?.artwork_id ?? null;
  // **이미 `ready` 면 폴링을 시작하지 않는다.** 서버가 캐시에서 바로 줄 수 있다.
  const 바로온주소 = ref?.status === "ready" ? ref.url : null;
  /** `ready` 로 온 것의 **기본 그림 여부**. 한 번 물어봐서 채운다. */
  const [바로온것의기본여부, set바로온것의기본여부] = useState<{ id: string; fallback: boolean } | null>(null);

  useEffect(() => {
    if (!ready도확인 || id === null || 바로온주소 === null) return;
    let 살아있다 = true;
    apiGet<Artwork>(`/artworks/${id}`)
      .then((a) => {
        if (살아있다) set바로온것의기본여부({ id, fallback: a.fallback });
      })
      .catch(() => {
        // **못 물어봤으면 아무 말도 안 한다.** 모르는 것을 개인화로 몰지 않는다 —
        // 「완성됐어!」가 거짓일 수 있는 쪽으로 기울면 그것이 더 나쁘다.
        if (살아있다) set바로온것의기본여부({ id, fallback: true });
      });
    return () => {
      살아있다 = false;
    };
  }, [ready도확인, id, 바로온주소]);

  /**
   * **`id` 를 값에 함께 담는다.** 카드가 바뀌면 이전 삽화의 결과가 잠깐 남는데,
   * 그대로 쓰면 **앞 장면의 그림이 새 결과 화면에 뜬다.**
   *
   * **효과 안에서 동기로 `set` 하지 않는다** — 초기화가 필요하면 여기서 `id` 를 대조해
   * 떨어뜨린다. 그래서 아래 `set` 은 전부 타이머 콜백 안에서만 일어난다.
   */
  const [결과, set결과] = useState<{ id: string; 재확인키: number; 상태: 삽화상태 } | null>(null);

  useEffect(() => {
    if (id === null || 바로온주소 !== null) return;

    let 살아있다 = true;
    let 타이머: ReturnType<typeof setTimeout>;
    const 마감 = Date.now() + 상한;

    const 물어본다 = async () => {
      try {
        const a = await apiGet<Artwork>(`/artworks/${id}`);
        if (!살아있다) return;
        if (a.status === "ready" && a.url !== null) {
          set결과({ id, 재확인키, 상태: { kind: "떴다", url: a.url, fallback: a.fallback } });
          return;
        }
      } catch {
        // **네트워크 오류·5xx 면 같은 간격으로 계속한다.** 별도 재시도 카운터를 두지 않는다 —
        // 전달받은 상한이 이미 상한이다 (`Stage0.md` 5절). 여기서 멈추면 **잠깐 끊긴 것과
        // 진짜 실패를 구분 못 하는데**, 아이 화면에서는 그 차이가 「그림이 없다」로 같아진다.
        if (!살아있다) return;
      }
      // **마감을 넘겼으면 그만둔다.** 서버가 60초에 기본 에셋으로 확정하므로
      // 정상 경로에서는 그 다음 확인 안에 `ready` 가 온다.
      if (Date.now() >= 마감) {
        set결과({ id, 재확인키, 상태: { kind: "못받음" } });
        return;
      }
      타이머 = setTimeout(() => void 물어본다(), 폴링간격);
    };

    타이머 = setTimeout(() => void 물어본다(), 첫폴링);

    return () => {
      살아있다 = false;
      clearTimeout(타이머);
    };
  }, [id, 바로온주소, 재확인키, 상한]);

  if (바로온주소 !== null) {
    const 기본 = 바로온것의기본여부?.id === id ? 바로온것의기본여부.fallback : undefined;
    return { kind: "떴다", url: 바로온주소, fallback: 기본 };
  }
  // **`id` 가 다르면 버린다** — 앞 장면 그림이 새 화면에 뜨는 것을 막는 자리다.
  if (id !== null && 결과?.id === id && 결과.재확인키 === 재확인키) return 결과.상태;
  return { kind: "기다림" };
}
