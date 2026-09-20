"use client";

import { useLayoutEffect, useId, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/**
 * 글자 수 격려 — **나침반이 밝아진다.**
 *
 * PRD A0-2 의 MUST 는 「숫자 목표를 표시하지 않는다」이고, 밝아지는 것은 **나침반**이다.
 * 캐릭터 표정은 입력 중 `default` 로 고정이며 여기서 바뀌지 않는다 —
 * `compass_bright` 는 **평가 결과(좋은 묘사)** 를 뜻해서, 제출 전에 켜면 30자를 채워 밝아진 나침반이
 * 되묻기로 꺼지며 **격려가 배신이 된다** (`docs/api/Stage0.md` 3절, 2026-09-07 정정).
 *
 * 그래서 지키는 것 셋 —
 * ① **연속 변화**다. 30자에서 가득 찬다. 계단처럼 튀지 않는다
 * ② **바·퍼센트·눈금·숫자를 쓰지 않는다.** 숫자를 지운 자리에 진행바를 넣으면 같은 것이 된다
 * ③ **표정 PNG 위에 좌표로 얹지 않는다.** 캐릭터 그림은 C-2 로 다시 그려지고, 그때 나침반이
 *    몇 픽셀 움직이면 빛만 엉뚱한 데 남는다. 이 나침반은 **그림과 독립된 자기 요소**다
 */

/**
 * **PRD A0-2 의 MUST 는 「30자 넘으면 밝아짐」이다** (119행). **「30에서 멈춘다」는 PRD 가 아니라
 * 2026-09-09 까지의 우리 구현**이었고, 그것이 **두 구간을 다 죽였다** (실기기에서 사용자가 찾았다).
 *
 * **① 처음 몇 글자에서 안 움직였다.** 6자면 밝기 0.2 — 빛 반지름이 12→16, 불투명도 0.2 라
 * **빈 상태와 눈으로 구분이 안 된다.** 그런데 **아이가 「글자가 늘면 밝아진다」를 배우는 자리가
 * 정확히 거기**다. 못 배우면 그 표시는 **영영 정체불명의 점**이다.
 *
 * **② 30자 뒤로 아무 일도 없었다.** **H2 합격선이 회당 150자**인데 **우리가 실제로 원하는
 * 구간(30~150)에서 신호가 0** 이었다 — **더 써도 반응이 없으면 더 쓸 이유가 없다.**
 *
 * 그래서 구간을 둘로 나눈다. **PRD 는 그대로 지킨다** — 30자에서 확실히 밝다.
 */
const 밝아지는곳 = 30;
/** H2 합격선. **여기까지 계속 변한다.** */
const 끝 = 150;
/** 30자에서의 밝기. **「밝아졌다」로 읽히면서 위로 더 갈 자리를 남긴다.** */
const 밝아진값 = 0.65;

/**
 * **초반이 가파르고 뒤가 완만하다.** 선형이면 초반 변화가 아이 눈에 안 잡힌다 —
 * 세제곱근이 **3자에서 이미 0.30** 을 준다(선형은 0.065). **배우는 구간을 먼저 산다.**
 */
export function 나침반밝기(length: number): number {
  if (length <= 0) return 0;
  if (length < 밝아지는곳) {
    return 밝아진값 * Math.cbrt(length / 밝아지는곳);
  }
  const 남은길 = (length - 밝아지는곳) / (끝 - 밝아지는곳);
  return 밝아진값 + (1 - 밝아진값) * Math.min(남은길, 1);
}

export function CompassGlow({
  length,
  introducing = false,
  arrival = false,
}: {
  length: number;
  /** 가이드가 나침반을 가리키는 짧은 순간. 입력에 따른 빛과는 따로 움직인다. */
  introducing?: boolean;
  /** 소개 중에만 앞발 근처에서 날아오는 복제본. 최종 나침반의 상태와 섞지 않는다. */
  arrival?: boolean;
}) {
  const 밝기 = 나침반밝기(length);
  const 빛그라디언트 = useId();
  const 유리그라디언트 = useId();
  const 문양마스크 = useId();
  const 문양빛 = useId();

  return (
    <svg
      viewBox="-36 -36 315 314"
      className="compass-instrument"
      data-compass-introducing={arrival ? undefined : introducing}
      data-compass-awake={arrival ? undefined : length > 0}
      data-compass-arrival-instrument={arrival || undefined}
      // 빛은 격려를 위한 장식이다. 글자 수나 달성률로 읽히지 않는다.
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={빛그라디언트}>
          <stop offset="0%" stopColor="#e9fcff" stopOpacity="0.95" />
          <stop offset="35%" stopColor="var(--color-glow)" stopOpacity="0.8" />
          <stop offset="65%" stopColor="var(--color-glow)" stopOpacity="0.38" />
          <stop offset="100%" stopColor="var(--color-glow)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={유리그라디언트} cx="42%" cy="36%" r="70%">
          <stop offset="0%" stopColor="#244c61" />
          <stop offset="100%" stopColor="#0d202d" />
        </radialGradient>
        <linearGradient id={문양빛} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff7da" />
          <stop offset="48%" stopColor="#b9f8ff" />
          <stop offset="100%" stopColor="#fff7da" />
        </linearGradient>
        {/* 제공받은 문양의 투명 영역을 그대로 쓴다. 원본 모양은 다시 그리지 않는다. */}
        <mask id={문양마스크} x="0" y="0" width="243" height="242" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }}>
          <image href="/guide/compass-rose.svg" width="243" height="242" />
        </mask>
      </defs>

      {/* 입력에 반응하는 넓은 후광. 처음 몇 글자부터 보이고 이후에도 서서히 커진다. */}
      <circle
        data-compass-glow
        cx="121" cy="121"
        r={110 + 42 * 밝기}
        fill={`url(#${빛그라디언트})`}
        style={{ opacity: 밝기 }}
        className="compass-writing-glow"
      />
      <circle cx="121" cy="121" r="94" fill={`url(#${유리그라디언트})`} stroke="#bd995b" strokeWidth="2" />
      <circle cx="121" cy="121" r="87" fill="none" stroke="#f2d49b" strokeOpacity="0.18" />
      <circle
        cx="121" cy="121" r={34 + 48 * 밝기}
        fill={`url(#${빛그라디언트})`}
        style={{ opacity: 0.08 + 0.68 * 밝기 }}
        className="compass-writing-glow"
      />

      <g className="compass-needle">
        <image href="/guide/compass-rose.svg" width="243" height="242" />
        <rect
          width="243" height="242"
          fill={`url(#${문양빛})`}
          mask={`url(#${문양마스크})`}
          style={{ opacity: 0.85 * 밝기 }}
          className="compass-etching-light compass-writing-glow"
        />
      </g>

      {/* 소개는 입력의 빛과 독립적으로 두 번 반짝인다. 대사 순서는 그대로다. */}
      <g className="compass-intro-light">
        <circle cx="121" cy="121" r="149" fill={`url(#${빛그라디언트})`} />
        <rect width="243" height="242" fill="#efffff" mask={`url(#${문양마스크})`} />
        <path d="M211 22 215 33 226 37 215 41 211 52 207 41 196 37 207 33Z" fill="#fff8db" />
        <path d="M26 174 29 182 37 185 29 188 26 196 23 188 15 185 23 182Z" fill="#e8fcff" />
      </g>

      {/* 흰 중심점과 작은 별빛은 밝은 숲 배경에서도 빛의 위치를 또렷하게 한다. */}
      <circle cx="121" cy="121" r={6 + 9 * 밝기} fill="var(--color-glow)" style={{ opacity: 0.2 + 0.65 * 밝기 }} className="compass-writing-glow compass-core-light" />
      <path
        d="M121 103 125 117 139 121 125 125 121 139 117 125 103 121 117 117Z"
        fill="#f0feff"
        style={{ opacity: 0.2 + 0.8 * 밝기 }}
        className="compass-writing-glow"
      />
      <g className="compass-writing-sparkles compass-writing-glow" style={{ opacity: 밝기 }}>
        <path className="compass-sparkle" d="M32 32 35 41 44 44 35 47 32 56 29 47 20 44 29 41Z" />
        <path className="compass-sparkle" d="M214 28 217 36 225 39 217 42 214 50 211 42 203 39 211 36Z" />
        <path className="compass-sparkle" d="M228 183 231 191 239 194 231 197 228 205 225 197 217 194 225 191Z" />
        <path className="compass-sparkle" d="M39 201 41 207 47 209 41 211 39 217 37 211 31 209 37 207Z" />
      </g>
    </svg>
  );
}

type ArrivalPosition = {
  sourceX: number;
  sourceY: number;
  travelX: number;
  travelY: number;
  arcX: number;
  arcY: number;
  size: number;
};

/**
 * 최종 나침반을 움직이지 않고, 앞발 근처에서 출발한 작은 복제본만 화면 위로 이동시킨다.
 * 두 지점의 실제 화면 좌표를 한 번만 읽어 CSS 변수로 넘기므로 반응형 레이아웃도 밀리지 않는다.
 */
export function CompassArrival() {
  const [position, setPosition] = useState<ArrivalPosition | null>(null);

  useLayoutEffect(() => {
    let frame = requestAnimationFrame(() => {
      const source = document.querySelector<HTMLElement>("[data-compass-source]");
      const destination = document.querySelector<HTMLElement>("[data-compass-destination]");
      if (!source || !destination) return;

      const from = source.getBoundingClientRect();
      const to = destination.getBoundingClientRect();
      const sourceX = from.left + from.width / 2;
      const sourceY = from.top + from.height / 2;
      const targetX = to.left + to.width / 2;
      const targetY = to.top + to.height / 2;
      const travelX = targetX - sourceX;
      const travelY = targetY - sourceY;

      setPosition({
        sourceX,
        sourceY,
        travelX,
        travelY,
        // 이동의 중간 지점만 살짝 위로 들어 올려 짧은 곡선을 만든다.
        arcX: travelX * 0.72,
        arcY: travelY * 0.62 - Math.min(26, Math.max(12, to.width * 0.18)),
        size: to.width,
      });
    });

    return () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
  }, []);

  if (position === null || typeof document === "undefined") return null;

  const style = {
    "--compass-source-x": `${position.sourceX}px`,
    "--compass-source-y": `${position.sourceY}px`,
    "--compass-travel-x": `${position.travelX}px`,
    "--compass-travel-y": `${position.travelY}px`,
    "--compass-arc-x": `${position.arcX}px`,
    "--compass-arc-y": `${position.arcY}px`,
    "--compass-arrival-size": `${position.size}px`,
  } as CSSProperties;

  return createPortal(
    <>
      <span className="compass-arrival-source-light" style={style} aria-hidden="true" />
      <div className="compass-arrival" style={style} aria-hidden="true" data-compass-arrival>
        <CompassGlow length={0} arrival />
        <span className="compass-arrival-sparkle compass-arrival-sparkle--one" />
        <span className="compass-arrival-sparkle compass-arrival-sparkle--two" />
        <span className="compass-arrival-sparkle compass-arrival-sparkle--three" />
        <span className="compass-arrival-sparkle compass-arrival-sparkle--four" />
      </div>
    </>,
    document.body,
  );
}
