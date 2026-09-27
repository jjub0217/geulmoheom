"use client";

import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import { useAdventureRequest } from "@/components/book-journey";
import { apiGet } from "@/lib/api";

/**
 * 「책에 쌓인 것이 있나」와 「지금 쓰는 본편이 있나」.
 *
 * ## ⛔ 왜 있나 — 화면이 아이에게 거짓을 보였다
 *
 * **본편은 완결해야 책 한 장이 된다** (A-7 · `api/app/api/v1/stage1.py` `_책한장`).
 * 카드는 한 장 쓸 때마다 한 쪽이 되는데 **본편은 열 턴을 다 써야** 생긴다.
 * 그런데 본편 화면이 **첫 턴을 쓰고 삽화까지 받은 자리에서 「내 책 펼치기」를 띄웠고**,
 * 아이가 누르면 **빈 책**이었다. 2026-09-22 에 사용자가 실기기에서 겪었다.
 *
 * **⛔ 저장 규칙이 틀린 것이 아니다.** 규칙은 그대로 두고 **화면이 그 규칙을 말하게** 한다.
 *
 * ## 「모름」을 따로 둔다
 *
 * **못 닿았을 때와 정말로 비었을 때를 같이 다루면 안 된다.** 통신이 한 번 실패했다고
 * **카드로 쌓아 둔 책을 못 보게 막으면** 잃는 것이 더 크다. 그래서 `모름` 은
 * **버튼을 그대로 두는 쪽**으로 읽는다.
 *
 * **`로딩` 과 `없음` 도 다르다.** 로딩 중에 버튼을 그렸다가 지우면 **눈앞에서 사라지고**,
 * 아이는 자기가 뭘 잘못 눌렀는지 모른다. **없던 것이 뒤늦게 생기는 쪽**이 낫다.
 */
export type 책상태 = "로딩" | "없음" | "있음" | "모름";

/** 책에 쌓인 쪽이 있나. 카드로 쌓은 것과 완결한 본편이 모두 여기 들어간다. */
export function useBookPageCount(): 책상태 {
  const [상태, set상태] = useState<책상태>("로딩");
  /**
   * **같은 읽기를 두 번 보내지 않는다** (2026-09-22 실측으로 잡았다).
   *
   * 효과가 **한 번 붙을 때 두 번 도는 경우**가 있다(개발 서버의 엄격 모드, 그리고 화면이
   * 「불러오는 중」에서 내용으로 바뀌며 다시 붙을 때). 그러면 **같은 `GET /book` 이
   * 1초 안에 두 번** 나간다 — 아이가 보는 것은 똑같은데 요청만 는다.
   *
   * **⭐ 새 장치를 만들지 않았다.** 본편 입장이 이미 쓰는 `loadOnce` 를 그대로 쓴다 —
   * **같은 열쇠의 요청이 이미 날아가 있으면 그것을 기다린다.**
   */
  const 한번만 = useAdventureRequest();

  useEffect(() => {
    let 살아있나 = true;
    한번만("book-page-count", () => apiGet<components["schemas"]["Book"]>("/book"))
      .then((책) => {
        if (살아있나) set상태(책.pages.length > 0 ? "있음" : "없음");
      })
      .catch(() => {
        if (살아있나) set상태("모름");
      });
    return () => {
      살아있나 = false;
    };
  }, [한번만]);

  return 상태;
}

/**
 * 지금 쓰는 본편이 있나.
 *
 * **`GET /chapters/current` 가 200 이면 하던 이야기, 404 면 없다** — `ChapterDoor` 가
 * 쓰는 것과 같은 신호다. **못 닿으면 `모름`** 이고, 그때는 **원래 하던 말을 그대로** 한다.
 */
export function useChapterInProgress(): 책상태 {
  const [상태, set상태] = useState<책상태>("로딩");
  /** 위와 같은 이유로 같은 읽기를 두 번 보내지 않는다. */
  const 한번만 = useAdventureRequest();

  useEffect(() => {
    let 살아있나 = true;
    한번만("chapter-in-progress", () => apiGet("/chapters/current"))
      .then(() => {
        if (살아있나) set상태("있음");
      })
      .catch(() => {
        // **404 와 통신 실패를 안 가른다.** 둘 다 「본편이 있다고 말할 근거가 없다」이고,
        // 이 값이 하는 일은 **안내 문장을 고르는 것뿐**이라 틀려도 잃는 것이 문장 하나다.
        if (살아있나) set상태("없음");
      });
    return () => {
      살아있나 = false;
    };
  }, [한번만]);

  return 상태;
}
