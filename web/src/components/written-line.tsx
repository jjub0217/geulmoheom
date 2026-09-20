import type { components } from "@/api/types.gen";
import { 하이라이트조각 } from "@/lib/highlight";

type Highlight = components["schemas"]["Highlight"];

/**
 * 아이가 쓴 문장. **묘사어 자리에 표시가 붙는다** (`용어사전.md` 36행 「묘사어 하이라이트」).
 *
 * **문장은 아이 원문 그대로다.** 다듬지도 줄이지도 않는다 — 이건 로그가 아니라 **창작물**이고
 * 곧 책에 실릴 문장이다 (비전 2장).
 *
 * **가려진 자리(`○○○`)에 설명을 붙이지 않는다.** 대표 판정이 **「가리고 진행」**이고
 * **알리는 쪽은 채택되지 않았다** (미결 11-5, 2026-09-08). 여기에 「일부를 가렸어」류를
 * 지어 넣으면 **그 판정을 화면에서 뒤집는 것**이다.
 *
 * **설명 문구를 위에 얹지 않는다.** 어느 말이 통했는지는 **가이드가 이미 말한다**
 * (`guide.line` — 「'캄캄했지만'에 나침반이 확 돌았어!」). 여기 한 줄을 더 두면 같은 말이
 * 두 목소리로 겹친다.
 */
export function WrittenLine({
  text,
  highlights,
}: {
  text: string;
  highlights: readonly Highlight[];
}) {
  return (
    <p data-쓴문장 className="written-line">
      {하이라이트조각(text, highlights).map((조각, i) =>
        조각.강조 ? (
          // `<mark>` 가 뜻으로 맞다 — **읽어 주는 기계에도 「여기가 짚인 자리」로 전해진다.**
          // 색은 나침반 빛이다: 가이드가 말하는 「나침반이 돌았어」와 **같은 것을 가리킨다.**
          <mark
            key={i}
            data-강조
            className="rounded bg-glow/30 px-1 text-foreground"
          >
            {조각.text}
          </mark>
        ) : (
          <span key={i}>{조각.text}</span>
        ),
      )}
    </p>
  );
}
