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

/** 빛이 가득 차는 글자 수. PRD A0-2. */
const 가득 = 30;

export function CompassGlow({ length }: { length: number }) {
  // 0 → 1. 넘겨도 1 에서 멈춘다.
  const 밝기 = Math.min(length / 가득, 1);

  return (
    <svg
      // 64 좌표계에 나침반은 반지름 12 다. 나머지가 빛이 퍼질 여백이다 —
      // 좁게 잡으면 가득 찼을 때 빛이 네모나게 잘려 「원이 아니라 사각형」으로 보인다.
      viewBox="0 0 64 64"
      // **점이 아니라 물건으로 보여야 한다.** 56px 일 때 실기기에서 「무엇인지 안 읽혔다」 —
      // 「보내기」(높이 약 60px) 옆에 서면서 **둘이 한 줄의 짝**으로 읽히는 크기다.
      className="size-16 shrink-0"
      // 장식이다. 스크린리더에 읽히면 그게 곧 숫자 없는 진행 표시가 되어버린다.
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="compass-glow">
          <stop offset="0%" stopColor="var(--color-glow)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--color-glow)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 퍼지는 빛. 밝기에 따라 커지고 진해진다 — 이것 하나가 연속 변화를 만든다. */}
      <circle
        cx="32"
        cy="32"
        r={12 + 20 * 밝기}
        fill="url(#compass-glow)"
        style={{ opacity: 밝기 }}
        className="transition-all duration-500 motion-reduce:transition-none"
      />

      {/* 나침반 자체는 항상 같은 밝기다. 꺼져 있는 것이 아니라 조용한 것이다. */}
      <circle
        cx="32"
        cy="32"
        r="12"
        fill="none"
        stroke="var(--color-brass)"
        strokeWidth="2.5"
      />
      <circle
        cx="32"
        cy="32"
        r="5"
        fill="var(--color-glow)"
        style={{ opacity: 0.35 + 0.65 * 밝기 }}
        className="transition-opacity duration-500 motion-reduce:transition-none"
      />
      <path
        d="M32 23 L35.5 32 L32 41 L28.5 32 Z"
        fill="var(--color-scarf-deep)"
        style={{ opacity: 0.55 }}
      />
    </svg>
  );
}
