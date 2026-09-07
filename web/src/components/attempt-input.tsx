"use client";

import { CompassGlow } from "@/components/compass-glow";

/**
 * 자유 입력창. **선택지는 없다** — Stage 0 이 검증하는 것이 「직접 쓴다」이기 때문이다.
 *
 * 라벨은 서버가 준 `prompt_label` 을 그대로 쓴다 (「탐험가는 어떻게 할까?」).
 * 프론트에 문구를 박아두면 서버가 카드마다 다른 물음을 줄 때 화면만 옛말을 하게 된다.
 *
 * **여기 담기는 값은 아이의 창작물이다.** 로깅·오류 리포터에 절대 흘리지 않는다 (PRD 1.1b) —
 * `onChange` 에서 값을 어디로도 보내지 않고, 부모도 화면에 그리는 것 외에 쓰지 않는다.
 */
export function AttemptInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <label htmlFor="attempt" className="text-xl">
          {label}
        </label>
        {/* 쓸수록 밝아진다. 라벨 옆에 두어 쓰는 눈이 닿는 자리에 있게 한다. */}
        <CompassGlow length={value.length} />
      </div>
      <textarea
        id="attempt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        // 아이가 쓰는 칸이다. 맞춤법 빨간 줄로 「틀렸다」는 인상을 주지 않는다.
        spellCheck={false}
        autoComplete="off"
        className="w-full resize-none rounded-2xl bg-markings/60 p-5 text-xl/relaxed
          text-foreground outline-2 outline-offset-2 outline-transparent
          focus-visible:outline-glow dark:bg-glow-deep/40"
      />
    </div>
  );
}
