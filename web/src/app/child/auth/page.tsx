"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import { ApiError, NetworkError, apiGet, apiPost, 인증이풀렸다 } from "@/lib/api";
import { useDisplayMode } from "@/lib/standalone";

import { 설치안내, 코드길이, 코드입력 } from "./copy";

type ChildAuthRequest = components["schemas"]["ChildAuthRequest"];
type ChildAuthResponse = components["schemas"]["ChildAuthResponse"];
type ChildMe = components["schemas"]["ChildMe"];

/**
 * 자녀 인증 화면 (백로그 E-3 프론트 짝). **아이가 들어오는 첫 문이다.**
 *
 * **이 화면이 존재하는 이유는 편의가 아니라 막힘을 막는 것이다.** 접속 코드는
 * **6자리·24시간·1회용**이고, iOS 홈 화면 앱은 Safari 와 쿠키를 공유하지 않는다.
 * 브라우저 탭에서 코드를 써버리면 그 코드는 죽고 **아이는 재발급 없이 홈 화면 앱으로
 * 못 들어간다** (`api/공통규약.md` 181). 그래서 **판정이 입력보다 먼저**다.
 *
 * **문구는 `docs/문구.md` 3.2·3.3 이 SSOT** 이고 `./copy.ts` 가 그것을 옮겨 온 것이다.
 * 여기서 문장을 짓지 않는다. **오류도 서버가 준 것을 그대로 쓴다.**
 *
 * **아이 로그아웃은 이 화면의 셋째 몫이고 다음 세션이다** (`web/tasks/W4.md` 2번).
 */

/**
 * **다섯 상태고 다섯 다 화면이 있다.** 빈 화면으로 두는 자리를 만들지 않는다 —
 * 아이는 왜 아무 일도 안 일어나는지 알 방법이 없다.
 */
type Screen =
  /** 인증 확인 전. **여기서 코드 입력칸을 그리지 않는다** — 보이면 누른다 (`문구.md` 3.2) */
  | { kind: "확인중" }
  /** 홈 화면 앱이고 아직 안 들어왔다. `line` 은 **서버가 준 오류**이지 화면이 지은 말이 아니다 */
  | { kind: "코드입력"; line: string | null }
  /** 서버가 형식을 갖춰 거절했고 폼을 다시 줄 수 없는 경우 (역할 불일치 등) */
  | { kind: "거절"; line: string }
  | { kind: "못닿음"; hints: string[] };

export default function ChildAuth() {
  const router = useRouter();
  /**
   * **갈래는 상태가 아니라 형태가 정한다.** 브라우저 탭이라는 사실은 서버 응답과 무관하고,
   * 실행 중에 바뀔 수도 있다(아이가 안내를 읽고 홈 화면에 추가한 뒤 돌아오는 경우).
   */
  const 형태 = useDisplayMode();
  const [screen, setScreen] = useState<Screen>({ kind: "확인중" });
  const [code, setCode] = useState("");
  const [보내는중, set보내는중] = useState(false);

  useEffect(() => {
    let alive = true;

    // **판정이 먼저다.** 홈 화면 앱이 아니면 서버를 아예 부르지 않는다 —
    // 이미 들어와 있든 아니든 **이 창에서는 코드를 열지 않는 것**이 계약이다.
    if (형태 !== "홈화면앱") return;

    apiGet<ChildMe>("/child/me")
      .then(() => {
        // 이미 들어와 있다. **인증 화면에 머무를 이유가 없다.**
        if (alive) router.replace("/");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // **401 은 「아직 안 들어왔다」다.** 오류가 아니라 이 화면의 정상 출발점이다.
        if (인증이풀렸다(e)) {
          setScreen({ kind: "코드입력", line: null });
          return;
        }
        if (e instanceof ApiError) {
          setScreen({ kind: "거절", line: e.childMessage });
          return;
        }
        if (e instanceof NetworkError) {
          setScreen({ kind: "못닿음", hints: e.hints });
          return;
        }
        throw e;
      });

    return () => {
      alive = false;
    };
  }, [router, 형태]);

  /**
   * **실패해도 화면을 갈아치우지 않는다.** 입력칸을 그대로 두고 그 자리에 서버 문구만 얹는다 —
   * 오타 하나로 6자리를 처음부터 다시 치게 만들지 않는다.
   */
  const 들어가기 = async () => {
    set보내는중(true);
    try {
      const body: ChildAuthRequest = { access_code: code };
      await apiPost<ChildAuthResponse>("/child/auth", body);
      // **성공하면 화면을 하나 더 만들지 않는다** (`문구.md` 3.3).
      // 「환영합니다」류를 두면 **아이가 처음 만나는 것이 가이드가 아니라 앱**이 된다.
      // 환영은 가이드 몫이고 그것은 모험 화면에서 일어난다.
      router.replace("/");
    } catch (e) {
      if (e instanceof ApiError) {
        // **서버가 준 문구를 그대로 쓴다.** 없는 코드·만료된 코드·이미 쓴 코드가 전부
        // 같은 401 이라 **화면이 나눠 말할 수 없다** — 나눠 말하면 코드를 찍어보는 쪽에
        // 신호가 샌다. 아이 탓으로 읽히는 말도 짓지 않는다.
        setScreen({ kind: "코드입력", line: e.childMessage });
        return;
      }
      if (e instanceof NetworkError) {
        setScreen({ kind: "못닿음", hints: e.hints });
        return;
      }
      throw e;
    } finally {
      set보내는중(false);
    }
  };

  const 보낼수있다 = code.length === 코드길이 && !보내는중;

  return (
    <main className="page-frame flex flex-1 flex-col justify-center gap-8 py-12">
      {(형태 === "확인중" || (형태 === "홈화면앱" && screen.kind === "확인중")) && (
        <p className="opacity-70">확인하는 중…</p>
      )}

      {형태 === "브라우저탭" && (
        // **코드 입력칸을 흐리게라도 두지 않는다** (`문구.md` 3.2) — 보이면 누른다.
        // 그래서 이 갈래에는 `<input>` 도 `<form>` 도 아예 없다.
        <section data-설치안내 className="flex flex-col gap-6">
          <h1 className="text-3xl/relaxed font-semibold">{설치안내.제목}</h1>
          {/* **왜 안 되는지가 먼저다.** 이 줄이 빠지면 막는 화면으로만 읽힌다. */}
          <p className="text-xl/relaxed">{설치안내.이유}</p>
          <ul className="flex flex-col gap-3 rounded-2xl border-2 border-brass/40 p-5">
            {설치안내.방법.map(({ 기기, 순서 }) => (
              <li key={기기}>
                <strong>{기기}</strong> — {순서}
              </li>
            ))}
          </ul>
        </section>
      )}

      {형태 === "홈화면앱" && screen.kind === "코드입력" && (
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (보낼수있다) void 들어가기();
          }}
        >
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold">{코드입력.제목}</h1>
            {/* 무엇을 넣어야 하는지 모양을 미리 알려준다 — 오류를 나눠 말할 수 없으니
                **엉뚱한 것을 넣기 전에 막는 것**이 유일한 수단이다. */}
            <p className="opacity-80">{코드입력.안내}</p>
          </div>

          <label className="flex flex-col gap-1">
            <span>{코드입력.라벨}</span>
            <input
              // `text` + `inputMode="numeric"` — `type="number"` 는 앞자리 0 을 흘리고
              // 스피너가 붙는다. 6자리 코드는 **수가 아니라 글자**다.
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              // **`maxLength` 를 두지 않는다.** 두면 브라우저가 아래 필터보다 **먼저**
              // 원문을 6자로 자른다 — `12ab34cd56` 이 `12ab34` 이 된 뒤 숫자만 남아
              // **`1234`** 가 된다. 아이가 코드를 붙여넣을 때 **숫자가 조용히 사라진다.**
              // 길이는 아래 `slice` 가 이미 지킨다 (2026-09-07, E2E 가 잡았다).
              value={code}
              // 숫자만 남긴다. 서버는 어차피 같은 401 을 주지만, **아이가 무엇을 잘못
              // 넣었는지 듣지 못하므로** 애초에 넣을 수 없게 하는 편이 낫다.
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 코드길이))
              }
              required
              className="rounded-xl border-2 border-brass/50 bg-markings/70 p-3
                text-2xl tracking-[0.4em] dark:bg-glow-deep/40"
            />
          </label>

          {/* **서버가 준 문구다.** 화면이 지은 말이 아니고, 자리도 입력칸 곁이다 —
              무엇에 대한 말인지 아이가 찾지 않아도 되게. */}
          {screen.line !== null && (
            <p data-오류 className="text-xl/relaxed">
              {screen.line}
            </p>
          )}

          <button
            type="submit"
            disabled={!보낼수있다}
            className="self-end rounded-full bg-scarf px-10 py-3 text-markings
              disabled:opacity-40"
          >
            {코드입력.버튼}
          </button>
        </form>
      )}

      {형태 === "홈화면앱" && screen.kind === "거절" && <p className="text-xl/relaxed">{screen.line}</p>}

      {형태 === "홈화면앱" && screen.kind === "못닿음" && (
        <div className="flex flex-col gap-6">
          <p className="text-xl/relaxed">
            지금 서버에 닿지 못했습니다. 잠시 뒤에 다시 시도해 주세요.
          </p>
          {screen.hints.length > 0 && (
            // 개발 빌드 전용이다. 운영 번들에서는 `hints` 가 비어 이 블록이 안 그려진다.
            <ul
              data-dev-hints
              className="max-w-xl list-disc space-y-1 rounded-xl border border-dashed
                border-brass/50 p-4 text-sm opacity-70"
            >
              {screen.hints.map((원인) => (
                <li key={원인}>{원인}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
