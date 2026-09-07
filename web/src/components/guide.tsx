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
    <figure className="flex items-center gap-5">
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
        className="size-28 shrink-0 rounded-2xl border-2 border-brass/30 object-cover
          tablet:size-44"
        priority
      />
      {/* 말풍선이 아니라 그냥 대사다 — 서버 문자열을 그대로 읽는다. */}
      <figcaption className="text-xl/relaxed">{guide.line}</figcaption>
    </figure>
  );
}
