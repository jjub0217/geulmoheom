import Image from "next/image";

import type { components } from "@/api/types.gen";

type Guide = components["schemas"]["Guide"];

/**
 * 가이드 캐릭터. **서버가 준 `guide` 객체를 그대로 쓴다.**
 *
 * 프론트가 하는 일은 `expression` → PNG 매핑 하나뿐이다. 표정을 고르지도, 대사를 지어내지도 않는다
 * (`docs/api/Stage0.md` 3절). 특히 `compass_bright`·`compass_dim` 은 **평가 결과**를 뜻하므로
 * 제출 전에는 어떤 이유로도 켜지 않는다 — 입력 중 화면은 `default` 를 넘긴다.
 */
export function GuideFigure({ guide }: { guide: Guide }) {
  return (
    <figure className="flex items-center gap-3 sm:gap-5">
      <Image
        // 파일명이 곧 `expression` 값이다 (`docs/캐릭터/표정/` 에서 복사).
        src={`/guide/${guide.expression}.png`}
        alt=""
        width={256}
        height={256}
        // **원형으로 자르지 않는다.** 자르면 고글·크로스백·파란 스카프가 잘려 나가는데,
        // 아동 4명이 2판을 고른 이유가 정확히 그 셋이다 — 잘라내면 확인받은 것이 제품에 없는 셈이다.
        // 배경이 옅은 회색 단색(알파 없음)이라 액자처럼 둥근 사각형 안에 그대로 둔다.
        // 알파본은 W3 에서 뽑는다 (`compass_bright` 는 빛이 배경으로 번져 있어 재생성이 필요할 수 있다).
        // **작은 화면에서 줄인다** (2026-09-15 PM 판정 · 결과 ⑭ 옆). 화면의 우선순위는
        // **삽화 → 아이 문장 → 나가는 길 셋 → 가이드**이고 **가이드가 가장 뒤**다 —
        // 삽화는 보상 그 자체이고, **나가는 길은 안 보이면 없는 것**이다(③ 이 증명했다).
        //
        // **표정 4종을 64px 로 줄여 눈으로 봤다** (2026-09-15). 고글·스카프·나침반 빛은 살아 있고
        // **`compass_bright` 와 `session_end` 는 또렷하다.**
        // **⚠ 다만 `default` 와 `compass_dim` 은 자세 차이뿐이라 이 크기에서 약하다.**
        // 대사가 늘 같이 서므로(되묻기는 질문 문장이 온다) **뜻이 사라지지는 않지만**,
        // **여기가 하한이다 — 더 줄이면 표정이 아니라 장식이 된다.** PM 에게 알렸다.
        className="size-16 shrink-0 rounded-2xl border-2 border-brass/30 object-cover
          sm:size-28 wide:size-44"
        priority
      />
      {/* 말풍선이 아니라 그냥 대사다 — 서버 문자열을 그대로 읽는다. */}
      {/* **작은 화면에서 본문 크기로 내린다** — `text-lg` 는 18px 라 **16px MUST 위**다
          (`globals.css` 「글자」). 대사가 두 줄이면 그 두 줄이 통째로 이 블록의 높이다. */}
      <figcaption className="text-lg/relaxed sm:text-xl/relaxed">{guide.line}</figcaption>
    </figure>
  );
}
