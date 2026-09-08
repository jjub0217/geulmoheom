"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ApiError, NetworkError, apiPostNoBody } from "@/lib/api";

import { 나가기문구 } from "./leave-copy";

/**
 * 나가기 — 아이 로그아웃 (백로그 E-3 프론트 짝, `web/tasks/W4.md` 2번).
 *
 * **W3 이 여기로 넘긴 것이고, 자녀 인증 화면과 같이 서야 했다** — `api/Stage0.md` 2절이
 * **「나갈 문만 먼저 만들면 아이가 스스로를 가둔다. 둘을 같이 세운다」**로 못 박아 둔 그 자리다.
 * 들어오는 문(`/child/auth`)이 W4 에 섰으므로 이제 나가는 문을 연다.
 *
 * **문구는 `docs/문구.md` 2.3 이 SSOT** 이고 `./leave-copy.ts` 가 옮겨 온 것이다.
 *
 * **되묻는 이유는 되돌릴 수 없기 때문이다.** 접속 코드는 1회용이고 **이미 소진됐다** —
 * 잘못 눌러 나가면 **학부모가 재발급하기 전까지 아무것도 못 한다.**
 * 「한 달에 한 번은 가드레일, 매일이면 마찰」이 갈리는 자리다.
 */

/**
 * **자리는 화면 맨 아래다.** 「아이 눈에 띄는 자리에 두지 않는다」(`주차계획/W4.md`)를
 * **자리로 지킨다 — 글자를 작게 해서가 아니다.** 본문 16px 이상이 MUST 라
 * (`globals.css` 「글자」·PRD 7장 접근성) 읽을 수 없게 만드는 것은 답이 아니다.
 *
 * 그래서 셋만 한다 — ① `<main>` 밖 맨 아래 ② 채운 버튼이 아니라 **맨 글자**
 * (「보내기」가 스카프 블루로 채워져 있어 그 옆에서 저절로 조용해진다) ③ 색을 안 준다.
 */
export function LeaveButton() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [나가는중, set나가는중] = useState(false);
  /** 서버가 준 문구이거나 못닿음 문구. **성공 경로에는 이 자리가 없다** — 화면이 바뀐다. */
  const [실패, set실패] = useState<string | null>(null);

  const 열기 = () => {
    // 지난번 실패가 남아 있으면 지운다. 다시 열었을 때 **없는 실패**를 보여주지 않는다.
    set실패(null);
    dialog.current?.showModal();
  };

  /**
   * **서버를 부른다.** 클라이언트에서 쿠키를 지우는 것으로 대신하지 않는다 —
   * `__Host-` 쿠키는 **JS 가 못 읽고 못 지운다.** 로컬 상태만 비우면 쿠키는 살아 있다.
   * (학부모 로그아웃이 같은 이유로 같은 모양이다 — `parents/signup/page.tsx`.)
   */
  const 나간다 = async () => {
    set나가는중(true);
    try {
      // **401 처리를 태우지 않는다.** 쿠키가 없어도 서버가 204 를 준다 —
      // 만료·손상된 쿠키를 지우려는 것이 로그아웃인데 인증을 걸면
      // **정작 지워야 할 상태에서만 막힌다** (`api/공통규약.md` 148).
      await apiPostNoBody("/child/logout");
    } catch (e) {
      // **닿지 못하면 쿠키가 그대로 살아 있다. 나간 척하지 않는다.**
      // 확인 창을 닫지도 않는다 — 닫으면 아이는 나간 줄 알고, 실제로는 그대로 들어와 있다.
      if (e instanceof NetworkError) {
        set실패(나가기문구.못닿음);
        return;
      }
      if (e instanceof ApiError) {
        // 서버가 준 문구를 그대로 쓴다. 화면이 다듬거나 덧붙이지 않는다.
        set실패(e.childMessage);
        return;
      }
      throw e;
    } finally {
      set나가는중(false);
    }

    // **나간 뒤에는 접속 코드 입력으로 돌아간다. 화면을 새로 만들지 않는다** (`문구.md` 2.3).
    // 3.3 의 안내 한 줄(「부모님이 알려주신 6자리 숫자예요」)이 그대로 다음 행동을 가리킨다.
    // `replace` 다 — 뒤로 가기로 방금 나온 모험 화면에 돌아가지 못하게 한다.
    router.replace("/child/auth");
  };

  return (
    <>
      <button type="button" onClick={열기} className="underline underline-offset-4 opacity-70">
        {나가기문구.버튼}
      </button>

      {/* **네이티브 `<dialog>` 다.** 포커스 가둠·`Esc`·배경 비활성이 공짜로 따라온다.
          `Esc` 로 닫히는 것이 **안전한 방향**이라는 점이 중요하다 — 닫히면 머무는 것이고,
          되돌릴 수 없는 쪽은 반드시 눌러야만 일어난다. 배경 클릭으로는 닫히지 않는다(기본값). */}
      <dialog
        ref={dialog}
        className="m-auto max-w-md rounded-2xl border-2 border-brass/40 bg-background
          p-7 text-foreground backdrop:bg-scarf-deep/50"
      >
        <div className="flex flex-col gap-5">
          <h2 className="text-2xl font-semibold">{나가기문구.확인.제목}</h2>

          {/* **경고를 버튼 옆에 박지 않는다.** 3.4(학부모 재발급)가 그렇게 정한 것은
              거기에 확인 단계가 없기 때문이다. 여기는 이 창이 그 몫을 한다 —
              버튼 옆에 박으면 **버튼이 눈에 띄어** 위 「자리」와 정면으로 부딪힌다. */}
          <p>{나가기문구.확인.한줄}</p>

          {실패 !== null && <p data-나가기실패>{실패}</p>}

          {/* **머무는 쪽이 DOM 에서 먼저다.** `<dialog>` 는 첫 포커스 가능 요소에 포커스를 주므로
              **되돌릴 수 없는 쪽에 포커스가 앉지 않는다.** 보이는 순서도 같아 왼쪽이 안전한 쪽이다. */}
          <div className="flex justify-end gap-3">
            <form method="dialog">
              {/* `method="dialog"` 라 이 버튼은 **서버를 부르지 않고 창만 닫는다.**
                  머무는 것이 곧 아무 일도 안 일어나는 것이다. */}
              <button type="submit" className="rounded-full px-6 py-3 underline underline-offset-4">
                {나가기문구.확인.머문다}
              </button>
            </form>

            {/* **`type="button"` 이어야 한다.** 위 `<form method="dialog">` 밖이지만,
                기본 `submit` 로 두면 나중에 폼 안으로 옮겨졌을 때 **아무 말 없이 창만 닫는다.** */}
            <button
              type="button"
              disabled={나가는중}
              onClick={() => void 나간다()}
              className="rounded-full bg-scarf px-6 py-3 text-markings disabled:opacity-40"
            >
              {나가기문구.확인.나간다}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
