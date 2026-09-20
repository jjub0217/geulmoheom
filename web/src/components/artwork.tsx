"use client";

import Image from "next/image";

import { 빈자리비율, 액자자리 } from "@/lib/artwork-frame";
import { useState, type CSSProperties, type ReactNode } from "react";

import { 대기대사하나 } from "@/components/artwork-copy";
import type { 삽화상태 } from "@/lib/artwork";

/**
 * 결과 화면의 삽화 자리 (백로그 B-3 프론트 몫).
 *
 * **훅이 준 상태를 그리기만 한다.** 폴링·상한·주소 판단은 전부 `@/lib/artwork` 에 있다 —
 * 여기서 다시 판단하면 두 곳이 갈린다.
 *
 * **`crossOrigin` 을 붙이지 않는다** (`docs/api/Stage0.md` 5절 ⚠). 붙는 순간 쿠키가 안 실려
 * **그림이 통째로 안 뜨는데**, 네트워크 탭을 안 열면 원인이 안 보인다. `next/image` 는
 * 이 속성을 스스로 붙이지 않으므로 **손으로 안 붙이는 것이 곧 지키는 것**이다.
 *
 * **`url` 앞에 아무것도 붙이지 않는다.** 서버가 절대 주소로 준다 — web 은 `app.`, api 는
 * `api.` 라 상대 경로로 바꾸면 web 오리진에 붙어 안 뜬다 (`adr/0007`).
 *
 * **기다리는 동안 이 액자가 화면의 유일한 말이다** (`문구.md` 1.5). 결과 대사는 **그림이 뜬 뒤**에
 * 온다 — 순서가 뒤집히면 아이가 반응을 먼저 읽고 그림을 나중에 본다.
 */
export function ArtworkFrame({ 상태, waitingContent }: {
  상태: 삽화상태;
  waitingContent?: ReactNode;
}) {
  /**
   * **한 번 고르고 안 바꾼다.** 폴링이 2초마다 리렌더를 부르는데 그때마다 새로 고르면
   * **대사가 6~8초 동안 서너 번 갈아치워진다** — 읽던 아이가 문장을 잃는다.
   *
   * 결과 화면을 벗어나면 이 컴포넌트가 통째로 사라지므로 **다음 카드에서는 다시 고른다.**
   */
  const [대기대사] = useState(대기대사하나);

  /**
   * **온 그림이 자기 비율을 말한다** (`Stage0.md` 5절, 2026-09-15 개정 · `adr/0015`).
   *
   * **두 모양이 공존한다** — 갓 구운 것은 `1024×1024`, **못 구웠을 때 조합 파일은 0.58** 이고
   * **폴백은 버그가 아니라 설계된 경로**다. 그래서 **상수 하나로는 못 맞춘다** —
   * 2026-09-15 운영 실측에서 **정사각형 그림이 세로 상자에 갇혀 위아래 빈 띠**가 생겼다.
   *
   * **잰 주소를 같이 들고 있는다** — 다음 그림이 오면 **앞 그림의 비율이 잠깐 남는 일**이
   * 없어야 한다. 주소가 다르면 다시 `빈자리비율` 이다.
   */
  const [잰것, set잰것] = useState<{ url: string; 비율: number } | null>(null);

  /**
   * **못 받았으면 자리를 통째로 뺀다.** 빈 액자를 남기면 아이가 「여기 그림이 있어야 하는데
   * 없다」로 읽는데, 그건 **실패 화면을 안 만든다는 결정을 연출로 뒤집는 것**이다.
   *
   * 서버가 60초에 기본 에셋으로 확정하므로 **여기 오는 것은 서버가 통째로 안 닿는 경우**뿐이다.
   * 그때도 등급·가이드 대사는 그대로 그린다 — 그림만 없다.
   */
  if (상태.kind === "못받음") return null;

  const 지금주소 = 상태.kind === "떴다" ? 상태.url : null;
  const 비율 = 잰것 !== null && 잰것.url === 지금주소 ? 잰것.비율 : 빈자리비율;

  return (
    // 원본 비율을 알기 전에는 정사각형 자리에서 기다린다.
    // 그림이 오면 긴 변의 상한을 지키면서 원본 비율에 맞게 액자를 줄인다.
    <div
      // **자리가 있는지 없는지가 곧 상태다.** 「못받음」이면 이 요소가 통째로 사라진다 —
      // E2E 가 그 사라짐을 기다려 **상한을 실제로 넘겨보고 확인한다.**
      data-삽화자리
      // 원본 비율로 액자 자체를 맞춘다. 결과와 챕터는 각 무대의 높이 상한을 따른다.
      style={{
        ...액자자리(비율, "var(--result-frame-size, var(--artwork-cap))"),
        "--artwork-ratio": 비율,
      } as CSSProperties}
      // **`mx-auto` 가 필요하다** — 폭 상한이 걸리면 flex 열에서 왼쪽으로 붙는다.
      className="artwork-frame"
    >
      {상태.kind === "기다림" && (
        // **액자 안이다** (`문구.md` 1.5). 그림이 뜨면 그 자리를 그림이 그대로 덮는다 —
        // 대사가 다른 자리에 있으면 그림이 온 뒤에도 남아 **결과 대사와 나란히 선다.**
        <div
          data-대기대사
          role="status"
          className="absolute inset-0 flex items-center justify-center p-6
            text-center text-xl/relaxed wide:text-2xl/relaxed"
        >
          {waitingContent ?? <p>{대기대사}</p>}
        </div>
      )}
      {상태.kind === "떴다" && (
        <Image
          // **훅이 준 주소를 그대로 넣는다.** 성공이든 기본 에셋이든 같은 주소로 온다 —
          // 주소가 갈리면 「`fallback` 을 아이에게 알리지 않는다」가 네트워크 탭에서 무너진다.
          src={상태.url}
          // 그림의 내용은 바로 곁의 가이드 대사와 아이 자기 문장이 말한다.
          // 여기에 설명을 지어 넣으면 **프론트가 그림을 해석하는 것**이 된다.
          alt=""
          fill
          // 액자도 원본 비율을 따르므로 전체 그림이 가장자리까지 보인다.
          className="object-contain"
          sizes="(min-width: 64rem) 50vw, 100vw"
          // **그림이 자기 모양을 말하는 자리다.** 여기서 재지 않으면 상자가 계약 상수에
          // 갇히고, **모양이 바뀌는 날 아이 그림이 빈 띠 사이에 작게 앉는다.**
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              set잰것({ url: 상태.url, 비율: img.naturalWidth / img.naturalHeight });
            }
          }}
          priority
        />
      )}
    </div>
  );
}
