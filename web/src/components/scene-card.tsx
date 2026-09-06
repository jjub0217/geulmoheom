"use client";

import Image from "next/image";
import { useState } from "react";

import type { components } from "@/api/types.gen";

type Card = components["schemas"]["Card"];

/**
 * 장면 카드 — 스케치 + 상황문.
 *
 * 상황문은 **서버가 준 것을 그대로** 쓴다 (대표 검수 반영본). 프론트에서 다듬지 않는다.
 * 카드 종류(`type`)는 **내부 용어**라 화면에 내보내지 않는다 — 위기/발견/만남은 아이가 볼 말이 아니다.
 */
export function SceneCard({ card }: { card: Card }) {
  return (
    <section className="flex flex-col gap-6 tablet:flex-row tablet:items-center tablet:gap-10">
      <Sketch url={card.sketch_url} />
      <p className="flex-1 text-2xl/relaxed tablet:text-3xl/relaxed">
        {card.situation}
      </p>
    </section>
  );
}

/**
 * 스케치. **못 불러와도 화면이 무너지지 않아야 한다** —
 * 지금 목 서버가 주는 주소는 `https://r2.example/...` 라 실제로 안 열리고,
 * 실서버에서도 R2 가 잠깐 안 될 수 있다. 그때는 빈 액자를 그대로 둔다.
 *
 * `alt` 는 비운다. 그림의 내용은 바로 옆 상황문이 글로 말하고 있어서,
 * 여기에 설명을 지어 넣으면 스크린리더가 같은 장면을 두 번 읽는다.
 */
function Sketch({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative aspect-4/3 w-full overflow-hidden rounded-3xl bg-vest/10 tablet:w-1/2">
      {!failed && (
        <Image
          src={url}
          alt=""
          fill
          className="object-cover"
          sizes="(min-width: 64rem) 50vw, 100vw"
          onError={() => setFailed(true)}
          priority
        />
      )}
    </div>
  );
}
