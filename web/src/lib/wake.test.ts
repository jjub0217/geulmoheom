import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { 깨우는간격, 깨우기시작 } from "./wake";

/**
 * `주차계획/W6.md` 15번. **이 검사가 지키는 것은 「깨운다」가 아니라 「필요 없을 때 안 친다」**다.
 *
 * 무료 사용 시간(750h)이 걸려 있어 **열어 두고 잊은 탭이 계속 치면** 그게 곧 요금이다.
 */
function 세운다(보임: boolean) {
    const 친횟수 = { 값: 0 };
  let 바뀜: ((보이나: boolean) => void) | null = null;
  const 끊겼나 = { 값: false };
  const 멈춤 = 깨우기시작(() => (친횟수.값 += 1), {
    보이나: () => 보임,
    구독: (f) => {
      바뀜 = f;
      return () => (끊겼나.값 = true);
    },
  });
  return { 친횟수, 바꾼다: (v: boolean) => 바뀜!(v), 끊겼나, 멈춤 };
}

describe("깨우기 — W6 15번", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("화면이 뜨면 그 자리에서 한 번 친다", () => {
    // **가장 중요한 한 번**이다 — 사람이 첫 요청을 보내기까지 수십 초가 남아 있고,
    // **서버가 깨는 시간이 정확히 그만큼**이다.
    const { 친횟수 } = 세운다(true);
    expect(친횟수.값).toBe(1);
  });

  it("열려 있는 동안 10분마다 친다", () => {
    const { 친횟수 } = 세운다(true);
    vi.advanceTimersByTime(깨우는간격 * 2);
    expect(친횟수.값).toBe(3);
  });

  it("⛔ 탭이 숨으면 멈춘다 — 열어 두고 잊은 탭이 계속 치면 그게 요금이다", () => {
    const { 친횟수, 바꾼다 } = 세운다(true);
    바꾼다(false);
    vi.advanceTimersByTime(깨우는간격 * 5);
    expect(친횟수.값).toBe(1);
  });

  it("다시 보이면 그 자리에서 한 번 친다 — 돌아온 순간이 다음 요청 직전이다", () => {
    const { 친횟수, 바꾼다 } = 세운다(true);
    바꾼다(false);
    vi.advanceTimersByTime(깨우는간격 * 3);
    바꾼다(true);
    expect(친횟수.값).toBe(2);
    vi.advanceTimersByTime(깨우는간격);
    expect(친횟수.값).toBe(3);
  });

  it("숨은 채로 시작하면 아무것도 안 친다", () => {
    const { 친횟수 } = 세운다(false);
    vi.advanceTimersByTime(깨우는간격 * 3);
    expect(친횟수.값).toBe(0);
  });

  it("보임이 여러 번 와도 타이머가 겹치지 않는다", () => {
    // **`setInterval` 이 쌓이면 10분마다 두 번·세 번 친다.** 무료 시간이 그만큼 준다.
    const { 친횟수, 바꾼다 } = 세운다(true);
    바꾼다(true);
    바꾼다(true);
    const 친것 = 친횟수.값;
    vi.advanceTimersByTime(깨우는간격);
    expect(친횟수.값).toBe(친것 + 1);
  });

  it("멈추면 더 안 치고 구독도 끊는다", () => {
    const { 친횟수, 끊겼나, 멈춤 } = 세운다(true);
    멈춤();
    vi.advanceTimersByTime(깨우는간격 * 3);
    expect(친횟수.값).toBe(1);
    expect(끊겼나.값).toBe(true);
  });
});
