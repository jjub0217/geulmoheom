"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

import { ApiError, NetworkError, apiPostNoBody } from "@/lib/api";

import { 나가기문구 } from "./leave-copy";

/**
 * **⛔ 2026-09-23 에 자리를 옮겼다** (사용자 지시 · `문구.md` 2.3).
 * 종전에는 **확인 창 안에 따로 선 문단**이었는데, 그 자리가
 * **안내 문장 아래에 밝은 상자를 하나 더** 만들었다. 지금은 **누른 버튼의 글자**다.
 * **값은 `나가기문구.확인.나가는중` 하나**이고 여기는 예전 이름을 잇는 별칭이다.
 */
export const 나가기대기문구 = 나가기문구.확인.나가는중;

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
 * **자리는 화면 위, 아이 이름 옆이다** (2026-09-22 사용자 지시).
 *
 * **⛔ 종전에는 화면 맨 아래였다. 근거를 지우지 않고 남긴다** —
 * 「아이 눈에 띄는 자리에 두지 않는다」(`주차계획/W4.md`)를 **자리로 지킨다**는 것이었고,
 * **글자를 작게 하는 것은 답이 아니다**(본문 16px 이상이 MUST · PRD 7장 접근성).
 *
 * **뒤집은 근거는 「이름과 나가는 행동을 같은 상단 영역에 둔다」**이다. 아래에 있으면
 * **모바일에서 진행 버튼과 같은 구역을 다투고**, 실제로 결과 화면에서 잘려 보였다.
 *
 * **그래서 눈에 덜 띄게 하는 일은 생김새가 맡는다** — ① 채운 버튼이 아니라 **맨 글자**
 * (`action-quiet`, 진행 버튼은 스카프 블루로 채워져 있다) ② 색을 안 준다
 * ③ **누르면 바로 안 나가고 한 번 되묻는다.**
 */
export function LeaveButton({ 쓰던글있나 = false, 잠금 = false }: {
  /**
   * **입력칸에 아직 안 보낸 글이 있나** (2026-09-22 사용자 지시 — 「작성 중인 글이 있을 때
   * 실수로 나가지 않도록 처리」).
   *
   * **확인 창은 원래 늘 뜬다.** 이 값이 더하는 것은 **한 줄**이다 — 그때만 잃는 것이
   * 하나 더 있어서다. **버튼을 잠그거나 단계를 늘리지 않는다**: 되돌릴 수 없는 것은
   * 이미 한 번 되묻고 있고, 관문을 더 세우면 **나가는 길 자체가 어려워진다.**
   */
  쓰던글있나?: boolean;
  /**
   * **보내는 중인가** (2026-09-24 사용자 지시).
   *
   * ## ⛔ 왜 이 하나만 잠그나
   *
   * **되돌릴 수 없는 쪽이 더 헐겁게 열려 있었다.** 같은 순간 **「내 책 펼치기」는
   * 잠기는데**(`BookLink disabled` · 본편 `bookDisabled`) **나가기는 안 잠겼다.**
   * 책으로 가는 것은 앱 안에서 되돌아올 수 있고, **나가는 것은 접속 코드를 다시
   * 받아야** 한다. 두 이동 중 **무거운 쪽이 더 열려 있던 것**이다.
   *
   * ⛔ **타자기가 도는 동안은 잠그지 않는다** — 그건 읽는 시간이지 보내는 중이 아니다.
   * ⛔ **결과·새 장면 화면도 잠그지 않는다** — 보낸 요청이 이미 끝난 자리다.
   * ⛔ **숨기지 않는다** — 사라졌다 나타나면 **상단이 흔들리고**, 아이는 나가는 길이
   *    없어진 줄 안다. **자리는 그대로 두고 못 누르게만** 한다.
   * ⭐ **`disabled` 를 쓴다** — 클릭·Enter·Space·초점 이동을 브라우저가 한 번에 막는다.
   *    `aria-disabled` 만 붙이면 **키보드로는 그대로 열린다.**
   */
  잠금?: boolean;
} = {}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const 머무는버튼 = useRef<HTMLButtonElement>(null);
  const 나가기요청중 = useRef(false);
  const [나가는중, set나가는중] = useState(false);
  /** 서버가 준 문구이거나 못닿음 문구. **성공 경로에는 이 자리가 없다** — 화면이 바뀐다. */
  const [실패, set실패] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (실패 !== null && !나가는중) 머무는버튼.current?.focus();
  }, [실패, 나가는중]);

  const 열기 = () => {
    if (잠금 || 나가기요청중.current) return;
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
    // 렌더가 반영되기 전 연달아 눌러도 서버 요청은 하나만 보낸다.
    if (나가기요청중.current) return;
    나가기요청중.current = true;
    set실패(null);
    set나가는중(true);
    try {
      // **401 처리를 태우지 않는다.** 쿠키가 없어도 서버가 204 를 준다 —
      // 만료·손상된 쿠키를 지우려는 것이 로그아웃인데 인증을 걸면
      // **정작 지워야 할 상태에서만 막힌다** (`api/공통규약.md` 148).
      await apiPostNoBody("/child/logout");
    } catch (e) {
      나가기요청중.current = false;
      set나가는중(false);
      // **닿지 못하면 쿠키가 그대로 살아 있다. 나간 척하지 않는다.**
      // 확인 창을 닫지도 않는다 — 닫으면 아이는 나간 줄 알고, 실제로는 그대로 들어와 있다.
      if (e instanceof NetworkError) {
        set실패(나가기문구.못닿음);
        return;
      }
      if (e instanceof ApiError) {
        // 서버가 준 문구를 그대로 쓴다. 화면이 다듬거나 덧붙이지 않는다.
        set실패(e.서버문구);
        return;
      }
      throw e;
    }

    // **나간 뒤에는 접속 코드 입력으로 돌아간다. 화면을 새로 만들지 않는다** (`문구.md` 2.3).
    // 3.3 의 안내 한 줄(「부모님이 알려주신 6자리 숫자예요」)이 그대로 다음 행동을 가리킨다.
    // `replace` 다 — 뒤로 가기로 방금 나온 모험 화면에 돌아가지 못하게 한다.
    // 성공 후에는 화면 이동이 끝날 때까지 잠근다. 이미 처리된 나가기를 취소할 수는 없다.
    router.replace("/child/auth");
  };

  return (
    <>
      <button
        type="button"
        disabled={잠금}
        onClick={열기}
        className="pressable action-quiet"
      >
        {나가기문구.버튼}
      </button>

      {/* 전송 전이나 실패 뒤에는 Esc로 머문다. 전송 중 닫아도 서버 요청은 취소되지 않으므로
          그때는 창을 유지한다. 배경 클릭으로는 닫히지 않는다(네이티브 dialog 기본값). */}
      <dialog
        ref={dialog}
        className="app-dialog child-dialog"
        aria-busy={나가는중}
        onCancel={(event) => {
          if (나가기요청중.current) event.preventDefault();
        }}
      >
        {/* **제목 → 설명 → 버튼의 위계를 간격이 만든다** (2026-09-23 사용자 지시). */}
        <div className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold">{나가기문구.확인.제목}</h2>

          {/* **경고를 버튼 옆에 박지 않는다.** 3.4(학부모 재발급)가 그렇게 정한 것은
              거기에 확인 단계가 없기 때문이다. 여기는 이 창이 그 몫을 한다 —
              버튼 옆에 박으면 **버튼이 눈에 띄어** 위 「자리」와 정면으로 부딪힌다. */}
          <p>{나가기문구.확인.한줄}</p>
          {/* **쓰던 글이 있을 때만 나온다.** 없는 손실을 말하지 않는다. */}
          {쓰던글있나 && <p data-쓰던글경고>{나가기문구.확인.쓰던글}</p>}

          {실패 !== null && <p data-나가기실패 role="status">{실패}</p>}

          {/* **읽어 주는 기계에는 처리 중임을 그대로 전한다** (2026-09-23 사용자 지시).
              화면에서는 버튼 글자 하나로 말하지만, **눈으로 버튼을 볼 수 없는 아이**에게는
              그 변화가 안 닿는다. **보이지 않는 알림 줄**이 그 몫을 한다.
              ⛔ **자리를 차지하지 않는다** — `sr-only` 라 창 높이가 안 바뀐다. */}
          <p className="sr-only" role="status" aria-live="polite">
            {나가는중 ? 나가기대기문구 : ""}
          </p>

          {/* **머무는 쪽이 DOM 에서 먼저다.** `<dialog>` 는 첫 포커스 가능 요소에 포커스를 주므로
              **되돌릴 수 없는 쪽에 포커스가 앉지 않는다.** 보이는 순서도 같아 왼쪽이 안전한 쪽이다. */}
          <div className="app-dialog-actions">
            <form
              method="dialog"
              onSubmit={(event) => {
                if (나가기요청중.current) event.preventDefault();
              }}
            >
              {/* `method="dialog"` 라 이 버튼은 **서버를 부르지 않고 창만 닫는다.**
                  머무는 것이 곧 아무 일도 안 일어나는 것이다. */}
              <button
                ref={머무는버튼}
                type="submit"
                disabled={나가는중}
                className="pressable action-primary"
              >
                {나가기문구.확인.머문다}
              </button>
            </form>

            {/* **`type="button"` 이어야 한다.** 위 `<form method="dialog">` 밖이지만,
                기본 `submit` 로 두면 나중에 폼 안으로 옮겨졌을 때 **아무 말 없이 창만 닫는다.** */}
            {/* ⛔ **되돌릴 수 없는 쪽이 보조 행동이다** (2026-09-23 사용자 지시).
                종전에는 **나가는 쪽이 채운 버튼**이었다 — 잘못 눌렀을 때 잃는 것이 큰 쪽을
                기본으로 두고 있었다. **읽기 어렵게 만들지는 않는다**: `action-secondary` 는
                테두리와 글자를 그대로 두고 **채운 색만** 걷는다.
                ⛔ **처리 중에도 글자 수가 비슷한 말로 바꾼다** — 「모험 나가기」(6자) →
                「나가는 중…」(6자). **버튼 폭이 안 튀어서 창 높이도 안 변한다.** */}
            <button
              type="button"
              disabled={나가는중}
              aria-busy={나가는중}
              onClick={() => void 나간다()}
              className="pressable action-secondary"
            >
              {나가는중 && <span className="leave-spinner" aria-hidden="true" />}
              {나가는중 ? 나가기대기문구 : 나가기문구.확인.나간다}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
