import type { components } from "@/api/types.gen";

type Tier = components["schemas"]["AttemptResult"]["tier"];

/**
 * 티어 배지 문구 (`docs/문구.md` **1.8** · `용어사전.md` 36행 **아이 화면** 열).
 *
 * **세 낱말은 아이 화면에 그대로 나간다.** 「티어」는 **내부 용어 열**이라 화면에 안 쓴다 —
 * **「희귀」는 되고 「희귀 티어」는 안 된다.** 사전의 열을 넘지 않는다는 규칙이 여기서 갈린다.
 *
 * **「기본」이 「부족하다」로 읽히는지는 프리테스트가 본다** (관찰 신호 6번 — 등급이 낮을 때의
 * 반응을 특히 본다). **지금 바꾸지 않는다**: 사전에 등록된 낱말이고 **바꿀 근거는 아이의
 * 반응이지 우리 짐작이 아니다.**
 */
export const 티어이름: Record<Tier, string> = {
  basic: "기본",
  rare: "희귀",
  legendary: "전설",
};

/**
 * 셋을 **같은 크기·같은 모양**으로 둔다. 색만 다르다 —
 * **「기본」을 작게 하거나 흐리게 하면 그것이 곧 「부족하다」**가 된다.
 * 금지어를 낱말로 안 쓰고 **연출로 말하는 자리**라, 폴백을 안 알리는 것과 같은 규칙이다.
 */
const 색: Record<Tier, string> = {
  basic: "bg-vest text-markings",
  rare: "bg-scarf-deep text-markings",
  legendary: "bg-brass text-scarf-deep",
};

/**
 * **그림과 함께 열린다.** 굽는 동안에는 안 그린다 — 그림 전에 등급을 알면 보상의 순간이 죽는다
 * (`문구.md` 1.5). **그림을 못 받았을 때는 그린다**: 아이는 자기 문장이 통했다는 것을
 * 알아야 하고, 그림은 「내 책」에서 다시 본다 (1.7).
 */
export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      data-티어배지
      className={`rounded-full px-6 py-2 text-xl ${색[tier]}`}
    >
      {티어이름[tier]}
    </span>
  );
}
