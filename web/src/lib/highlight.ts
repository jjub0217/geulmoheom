import type { components } from "@/api/types.gen";

type Highlight = components["schemas"]["Highlight"];

/** 화면에 그릴 한 도막. `강조` 가 참이면 묘사어로 표시된 자리다. */
export type 조각 = { text: string; 강조: boolean };

/**
 * 아이 문장 위에 묘사어 자리를 표시한다 (`docs/api/Stage0.md` 4절 · `용어사전.md` 36행).
 *
 * **오프셋이 안 온다.** 한글 조합·이모지에서 인덱스가 어긋나기 때문이고, 그래서 **문자열로
 * 다시 찾는다.** 서버가 **「아이 입력문에 그대로 있는 것만」** 내려보내기로 계약에 넣어 뒀지만
 * (4절), **프론트는 그 보장 위에 서되 못 찾으면 조용히 건너뛴다** — 하이라이트는 **보상이지
 * 필수 정보가 아니라서**, 없다고 화면이 죽으면 안 된다.
 *
 * **`kind`(adj·adv·clause)는 화면에 안 나간다.** 그건 내부 용어이고, 셋을 다르게 그리면
 * **아이가 품사를 배우는 화면**이 된다 — 여기서 말하려는 것은 「이 말이 통했다」 하나뿐이다.
 */
export function 하이라이트조각(
  text: string,
  highlights: readonly Highlight[],
): 조각[] {
  /**
   * **긴 것부터 잡는다.** 「살금살금」과 「살금」이 같이 오면 짧은 쪽이 먼저 자리를 차지해
   * **긴 쪽이 통째로 떨어진다** — 아이가 실제로 쓴 말이 더 짧게 표시되는 셈이다.
   */
  const 후보 = [...highlights]
    .map((h) => h.text)
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);

  const 자리: { start: number; end: number }[] = [];

  for (const 말 of 후보) {
    // **모든 등장 자리를 잡는다.** 같은 말을 두 번 썼는데 한 번만 표시되면
    // 아이 눈에는 **왜 저기는 안 되나**로 보인다.
    for (let i = text.indexOf(말); i !== -1; i = text.indexOf(말, i + 1)) {
      const [s, e] = [i, i + 말.length];
      // 겹치면 버린다 — 먼저 잡은 쪽(더 긴 쪽)이 이긴다.
      if (자리.some((r) => s < r.end && r.start < e)) continue;
      자리.push({ start: s, end: e });
    }
  }

  자리.sort((a, b) => a.start - b.start);

  const 조각들: 조각[] = [];
  let 읽은데까지 = 0;
  for (const r of 자리) {
    if (r.start > 읽은데까지)
      조각들.push({ text: text.slice(읽은데까지, r.start), 강조: false });
    조각들.push({ text: text.slice(r.start, r.end), 강조: true });
    읽은데까지 = r.end;
  }
  if (읽은데까지 < text.length)
    조각들.push({ text: text.slice(읽은데까지), 강조: false });

  return 조각들;
}
