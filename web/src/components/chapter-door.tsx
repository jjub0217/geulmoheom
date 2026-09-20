"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

import { 모험문 } from "@/app/chapter-door-copy";

// 2026-09-20 사용자 요청 · docs/문구.md 1.25. 책의 복귀 버튼과 같은 '모험'을 쓴다.
const 하던모험안내 = "쓰던 모험이 기다리고 있어.";
const 하던모험버튼 = "모험 계속하기";

/**
 * 모험으로 들어가는 문 (`문구.md` **1.25** · W7 **18번**).
 *
 * ## ⛔ 갈래를 프론트가 정하지 않는다 — 서버가 이미 가른다
 *
 * **`GET /chapters/current`** 가 **200 이면 하던 이야기**, **404(`NO_ACTIVE_CHAPTER`)면
 * 아직 안 연 날**이다 (`api/Stage1.md` 1절). **계약에 다 있어서 백엔드 몫이 0 이다.**
 *
 * ## ⛔ 몰라서 아무것도 안 그리는 자리를 만들지 않는다
 *
 * **못 물어봤으면 「아직 안 연 날」로 그린다.** 문이 아예 없는 것보다 낫다 —
 * **눌러 보면 `/chapter` 가 다시 묻고 거기서 이어하기가 잡힌다**(그 화면이 `current` 를
 * 먼저 부르고 404 일 때만 새로 연다). **여기서 틀려도 아이가 잃는 것이 없다.**
 *
 * **⚠ 반대로 「모르는 동안 아무것도 안 그리기」로 두면** 느린 연결에서 **문이 없는 화면**이
 * 되고, **아이는 오늘 할 게 없다고 읽는다.**
 *
 * ## ⛔ 「이어서」를 안 쓴다
 *
 * **1.20 이 「이어서 더 하기를 만들지 않는다 — 문구도 버튼도 없다」**로 못 박았다.
 * **저건 완결한 아이에게 더 시키는 것**(D-1 금지)이고 **이건 중도에 끊긴 아이가 돌아오는 길**
 * (D-1 이 「같은 날 1챕터 완결까지는 허용」으로 연 자리)이다. **낱말이 겹치면 둘이 같은
 * 것으로 읽혀 한쪽이 지워진다.**
 */
export function ChapterDoor() {
  /** `null` 은 **아직 모른다**. 모르는 동안에도 문은 그린다 — 위 주석. */
  const [하던게있나, set하던게있나] = useState<boolean | null>(null);
  const [툴팁을보이나, set툴팁을보이나] = useState(false);

  useEffect(() => {
    let 살아있나 = true;
    apiGet("/chapters/current")
      .then(() => {
        if (살아있나) set하던게있나(true);
      })
      .catch((e: unknown) => {
        if (!살아있나) return;
        // **404 만 「없다」로 읽는다.** 401·403·못 닿음은 **모르는 것**이고,
        // 그때도 문은 그린다 — 눌러 보면 `/chapter` 가 제 갈래로 보낸다.
        set하던게있나(e instanceof ApiError && e.status === 404 ? false : false);
      });
    return () => {
      살아있나 = false;
    };
  }, []);

  const 이어간다 = 하던게있나 === true;

  return (
    /* **⛔ 좁은 화면에서는 한 줄로 눕힌다** (2026-09-17 실측).
       세로로 쌓았더니 **360×640 에서 「보내기」가 27px 밖**으로 밀렸다 —
       **문을 얹어서 쓸 자리를 밀어내면 문이 해를 끼친 것**이다(W6 14번 판정).
       **안내와 버튼이 나란히 서면 한 줄이 덜 든다.** 넓으면 원래대로 쌓는다.

       **⛔ 문구를 줄이지 않았다** — 자리가 모자라다고 `문구.md` 1.25 의 문장을
       깎는 것은 **문서를 코드가 무르는 것**이다. **줄인 것은 배치뿐이다.** */
    <div
      data-모험문
      className="chapter-door"
    >
      <p>
        {이어간다 ? 하던모험안내 : 모험문.기다린다}
      </p>
      <span className="chapter-door__action">
        <Link
          href="/chapter"
          data-모험문버튼
          aria-describedby={툴팁을보이나 ? "chapter-door-writing-tooltip" : undefined}
          onPointerEnter={(event) => {
            if (event.pointerType !== "touch") set툴팁을보이나(true);
          }}
          onPointerLeave={() => set툴팁을보이나(false)}
          onFocus={() => set툴팁을보이나(true)}
          onBlur={() => set툴팁을보이나(false)}
          className="pressable action-primary shrink-0"
        >
          {이어간다 ? 하던모험버튼 : 모험문.떠나기}
        </Link>
        {툴팁을보이나 && (
          <span id="chapter-door-writing-tooltip" data-모험문툴팁 role="tooltip" className="chapter-door__tooltip">
            다음에 무슨 일이 일어날지 직접 쓰면, 네 글대로 이야기가 이어져.
          </span>
        )}
      </span>
    </div>
  );
}
