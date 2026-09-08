import Image from "next/image";

import type { components } from "@/api/types.gen";
import { TierBadge } from "@/components/tier-badge";

type BookPage = components["schemas"]["BookPage"];

/**
 * 책 페이지 한 장 (백로그 A0-4).
 *
 * **틀은 계약이 정해 뒀다** — **삽화 위 · 문장 아래 · 페이지 번호** (`docs/api/Stage0.md` 6절).
 * 화면에서 순서를 바꾸지 않는다.
 *
 * **문장은 아이 원문 그대로다** (마스킹 뒤 텍스트). 요약도 교정도 하지 않는다 — 이건 로그가
 * 아니라 **창작물**이다 (비전 2장 · `용어사전.md` 54행). 여기 손대면 **책이 아이 것이 아니게 된다.**
 *
 * **하이라이트를 칠하지 않는다.** 결과 화면의 표시는 **그 순간 무엇이 통했는지**를 말하는 것이고,
 * 책은 **문장 자체를 두는 자리**다. 계약도 `highlights` 를 여기 안 준다.
 */
export function BookPageFrame({ page }: { page: BookPage }) {
  return (
    <article className="flex flex-col gap-5 rounded-3xl border-2 border-brass/30 p-5">
      {/* **`artwork_url` 은 `ready` 인 것만 온다** — 굽는 중에 책을 열면 `null` 이다.
          그때는 **자리를 비운다**: 깨진 그림을 세우면 아이는 자기 그림이 사라진 줄 안다.
          결과 화면에서 못 받았을 때 액자를 통째로 빼는 것과 같은 판단이다 (`문구.md` 1.7). */}
      {page.artwork_url !== null && (
        <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl bg-vest/10">
          <Image
            // 서버가 준 절대 주소 그대로다. **`crossOrigin` 을 붙이지 않는다**
            // (`Stage0.md` 5절 ⚠) — 붙는 순간 쿠키가 안 실려 그림이 통째로 안 뜬다.
            src={page.artwork_url}
            // 그림의 내용은 **바로 아래 아이 문장이 말한다.**
            alt=""
            fill
            className="object-cover"
            sizes="(min-width: 64rem) 33vw, 100vw"
          />
        </div>
      )}

      {/* **아이가 쓴 그 문장이다.** 여기가 이 화면의 주인공이라 가장 크다. */}
      <p data-책문장 className="text-2xl/relaxed">
        {page.text}
      </p>

      <footer className="flex items-center justify-between">
        <TierBadge tier={page.tier} />
        {/* **번호는 교체돼도 안 바뀐다** (백엔드 확인) — 자리가 밀리면 아이가 기억하는
            순서가 흐트러진다. 그래서 목록의 몇 번째가 아니라 **서버가 준 `page_no`** 를 쓴다. */}
        <span data-쪽번호 className="text-lg opacity-70">
          {page.page_no}
        </span>
      </footer>
    </article>
  );
}
