import type { ReactNode } from "react";

import type { components } from "@/api/types.gen";

type Card = components["schemas"]["Card"];

/**
 * 장면 카드 — 상황문.
 *
 * **그림이 없다** (2026-09-09, `adr` 대신 PM 판정 · 계약에서 `sketch_url` 이 빠졌다).
 * 카드 스케치와 결과 삽화가 **같은 장면 프롬프트에서 나오기 때문**이다 — 쓰기 전에 그 장면을
 * 보여주면 **결과가 카드와 같은 그림이 되어 보상이 0** 이고, 한 겹 더 나쁜 것은
 * **아이가 묘사할 것을 그림이 대신 말해 준다**는 것이다. Stage 0 이 재는 것이 H2(묘사 노력)라
 * **보고 베끼면 그 값이 오염된다.**
 *
 * **두 칸으로 나누던 것도 같이 접었다.** 왼쪽이 스케치였고 오른쪽이 상황문·가이드였는데,
 * 왼쪽이 없어지면 **빈 칸 절반**이 남는다 — 실기기에서 사용자가 「왼쪽이 비어 있다」고 본 것이
 * 정확히 그 자리다. **화면 구성을 다시 보는 것은 별도 항목**이고 여기서는 **빈 칸만 없앤다.**
 *
 * 상황문은 **서버가 준 것을 그대로** 쓴다 (대표 검수 반영본). 프론트에서 다듬지 않는다.
 * 카드 종류(`type`)는 **내부 용어**라 화면에 내보내지 않는다 — 위기/발견/만남은 아이가 볼 말이 아니다.
 */
export function SceneCard({
  card,
  children,
}: {
  card: Card;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-8">
      <p className="text-2xl/relaxed tablet:text-3xl/relaxed">{card.situation}</p>
      {children}
    </section>
  );
}
