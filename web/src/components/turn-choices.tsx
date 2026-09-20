import type { components } from "@/api/types.gen";

import { 턴문구 } from "@/components/turn-copy";

type Choice = components["schemas"]["Choice"];

/**
 * 선택지 목록 (`문구.md` 1.18 · `api/Stage1.md` 2절).
 *
 * ## ⛔ 이 컴포넌트가 지키는 것 — 전부 「안 하는 것」이다
 *
 * **선택지를 고르는 것을 화면이 나무라지 않는다.** 흐리게·작게·아래로 밀지 않는다 —
 * **선택지는 막힌 아이의 길**이고 1.12 되묻기와 같은 자리다. 그래서 글자 크기(`text-xl`)와
 * 테두리가 **입력창과 같다.** 둘이 같은 무게라는 것을 **자리와 크기로** 말한다.
 *
 * **⛔ 부추기는 일은 이 화면이 하지 않는다.** 「고르기만 하면 재미없어」를 안 쓰는 정도가
 * 아니라, **약하게 보이게 하는 것도 같은 말**이다. 부추기는 일은 **계약이 한다** —
 * **`choice_id` 로 온 턴도 등급이 매겨진다**(`Stage1.md` 2절). **구조가 하는 일을 UI 가
 * 대신하지 않는다.**
 *
 * **⛔ 4칸 고정 그리드로 짜지 않는다.** 세로 목록이고 **개수가 몇이든 받는다.**
 * 네 칸으로 두면 **GM 이 그 모양을 강요받고**, 「① 싸운다 ② 말을 건다 ③ 살펴본다 ④ 달랜다」로
 * 경로를 나열하게 된다 — **경로를 나열하면 쓰기가 고르기로 바뀐다**(챕터 뼈대 「하면 안 되는 것」 ②).
 * 목이 일부러 **경로가 섞인 선택지**를 주는 이유가 그것이다.
 *
 * **⛔ 번호를 UI 가 붙이지 않는다.** 「①②③④」를 그리면 **개수가 의미를 갖게** 되고,
 * 위와 같은 자리로 되돌아간다. 라벨은 GM 이 준 것 그대로 쓴다.
 *
 * **⛔ 경로별로 다른 색·아이콘을 쓰지 않는다** (`문구.md` 1.19). 네 경로가 **동등**한데
 * 화면이 갈라 그리면 **문구 규칙을 화면이 깨는 자리**가 된다. 애초에 `Choice` 에
 * **경로 필드가 없다** — 계약이 그렇게 안 준다.
 */
export function TurnChoices({
  choices,
  onChoose,
  disabled = false,
}: {
  choices: Choice[];
  /** 고른 것의 `id` 를 그대로 넘긴다. **라벨을 넘기지 않는다** — 계약이 `choice_id` 를 받는다. */
  onChoose: (choiceId: string) => void;
  disabled?: boolean;
}) {
  // **비어 있으면 아무것도 그리지 않는다.** 빈 상자를 남기면 아이가 「여기 뭔가 오는데
  // 안 왔다」로 읽는다. `choices` 는 계약에서 선택 필드라 **안 올 수 있다.**
  if (choices.length === 0) return null;

  return (
    <div className="turn-choices">
      <ul>
        {choices.map((choice) => (
          <li key={choice.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChoose(choice.id)}
              // 테두리·글자 크기가 **입력창과 같다.** 둘이 같은 무게라는 것을 자리로 말한다.
              // `text-left` 인 것은 **라벨이 한 줄을 넘칠 수 있기** 때문이다 — GM 이 쓴 문장이라
              // 길이를 우리가 모른다. 가운데 정렬은 두 줄이 되는 순간 읽기가 나빠진다.
              className="pressable turn-choice"
            >
              {choice.label}
            </button>
          </li>
        ))}
      </ul>

      {/* **선택지 「아래」다** — 1.18 이 「선택지를 먼저 보여준 뒤에 오는 말」로 못 박았다.
          위에 두면 「아니면」이 가리킬 것이 아직 없다. */}
      <p className="choice-invitation">{턴문구.직접쓰기유도}</p>
    </div>
  );
}
