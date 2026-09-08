import { describe, expect, it } from "vitest";

import { 학부모오류문구 } from "./copy";

/**
 * `docs/문구.md` 3.8. **이 검사가 지키는 것은 「문구가 맞다」가 아니라
 * 「아이 목소리로 되돌아가지 않는다」**다.
 *
 * 되돌아가는 것은 **한 줄만 고치면 언제든 일어나고**(`?? e.서버문구`),
 * **그때 화면은 멀쩡해 보인다** — 문장이 뜨긴 뜨니까. 그래서 여기서 잡는다.
 */

/** `api/app/errors.py` 의 `CHILD_MESSAGE` — **아이 목소리다. 하나도 새면 안 된다.** */
const 아이문구 = [
  "다시 한 번 들어와 주세요",
  "여기는 지금 들어갈 수 없어요",
  "찾는 것이 여기 없어요",
  "잠깐 문제가 생겼어요. 다시 한 번 해볼까요",
  "오늘 카드를 다 썼어요",
  "이 장면은 오늘 이미 다녀왔어요",
  "부모님 확인이 먼저 필요해요",
  "조금만 천천히 가볼까요",
  "나침반이 잠깐 느려요. 조금 뒤에 다시 해볼까요",
  "잠깐 문제가 생겼어요. 조금 뒤에 다시 해볼까요",
];

describe("학부모오류문구 — 3.8", () => {
  it("표에 있는 코드를 학부모 말로 바꾼다", () => {
    // **이 절이 생긴 이유다** — 아이 문구는 「부모님 확인이 먼저 필요해요」인데
    // **읽는 사람이 그 부모님**이다.
    expect(학부모오류문구("CONSENT_REQUIRED")).toBe("아직 동의하지 않은 항목이 있습니다.");
    expect(학부모오류문구("UNAUTHORIZED")).toBe("다시 로그인해 주세요.");
  });

  it("`NOT_FOUND` 는 「없습니다」로 끝난다 — 권한을 말하지 않는다", () => {
    // 남의 자녀 ID 도 404 다. 「권한이 없습니다」로 쓰면 **「그 ID 는 존재한다」가 샌다** —
    // **문구가 계약의 판단을 되돌리면 안 된다.**
    const 문구 = 학부모오류문구("NOT_FOUND");
    expect(문구).toBe("찾으시는 정보가 없습니다.");
    for (const 새는말 of ["권한", "다른 사람", "없는 아이"]) {
      expect(문구).not.toContain(새는말);
    }
  });

  it("모르는 코드도 문장을 준다 — 빈칸이 되지 않는다", () => {
    // 서버가 코드를 늘렸는데 여기가 안 따라온 경우다.
    expect(학부모오류문구("SOMETHING_NEW")).toBe(
      "잠시 문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요.",
    );
    expect(학부모오류문구("")).not.toBe("");
  });

  it("어떤 코드에도 아이 목소리가 새지 않는다", () => {
    // **가드의 핵심.** 표에 없는 코드를 `message` 로 떨어뜨리는 한 줄이 들어오면 여기서 문다.
    const 볼것 = [
      "UNAUTHORIZED", "FORBIDDEN_ROLE", "NOT_FOUND", "VALIDATION_ERROR",
      "CONSENT_REQUIRED", "RATE_LIMITED", "INTERNAL_ERROR",
      "DAILY_CAP_REACHED", "CARD_ALREADY_DONE_TODAY", "UPSTREAM_TIMEOUT",
      "SOMETHING_NEW", "",
    ];
    for (const code of 볼것) {
      expect(아이문구).not.toContain(학부모오류문구(code));
    }
  });

  it("학부모 말투다 — 「해볼까요」로 끝나지 않는다", () => {
    for (const code of ["UNAUTHORIZED", "VALIDATION_ERROR", "INTERNAL_ERROR", "모르는것"]) {
      expect(학부모오류문구(code)).not.toMatch(/까요$/);
      expect(학부모오류문구(code)).toMatch(/(습니다|주세요)\.$/);
    }
  });
});
