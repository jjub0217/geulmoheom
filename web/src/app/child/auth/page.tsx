"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import { AccountEntry } from "@/components/account-entry";
import { ApiError, NetworkError, apiGet, apiPost, 역할이다르다, 인증이풀렸다 } from "@/lib/api";

import { 상태표시 } from "@/app/status-copy";

import { 끊겨서왔나 } from "@/lib/kicked";

import { 못닿음, 코드길이, 코드입력 } from "./copy";

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
 * **아이 로그아웃(셋째 몫)은 붙었다** — 다만 화면은 여기가 아니라 모험 화면 맨 아래다
 * (`src/components/leave.tsx`). **나가면 여기로 돌아온다** (`문구.md` 2.3).
 */

/**
 * **다섯 상태고 다섯 다 화면이 있다.** 빈 화면으로 두는 자리를 만들지 않는다 —
 * 아이는 왜 아무 일도 안 일어나는지 알 방법이 없다.
 */
type Screen =
  /** 인증 확인 전. **여기서 코드 입력칸을 그리지 않는다** — 보이면 누른다 (`문구.md` 3.2) */
  | { kind: "확인중" }
  /**
   * 홈 화면 앱이고 아직 안 들어왔다. `line` 은 **서버가 준 오류**이지 화면이 지은 말이 아니다.
   *
   * `끊김` 은 **쓰다가 끊겨서 왔는가**다 (`문구.md` 3.3) — 참이면 기본 안내 대신
   * **「부모님이 새 접속 코드를 받으셨어요」**를 쓴다. **판정은 `lib/kicked.ts` 에 있다.**
   */
  | { kind: "코드입력"; line: string | null; 끊김: boolean }
  /** 서버가 형식을 갖춰 거절했고 폼을 다시 줄 수 없는 경우 (역할 불일치 등) */
  | { kind: "거절"; line: string }
  | { kind: "못닿음"; hints: string[] };

export default function ChildAuth() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ kind: "확인중" });
  const [code, setCode] = useState("");
  const [보내는중, set보내는중] = useState(false);

  useEffect(() => {
    let alive = true;

    apiGet<ChildMe>("/child/me")
      .then(() => {
        // 이미 들어와 있다. **인증 화면에 머무를 이유가 없다.**
        if (alive) router.replace("/");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // **401 은 「아직 안 들어왔다」다.** 오류가 아니라 이 화면의 정상 출발점이다.
        // **401 은 「아직 안 들어왔다」이고, 여기서는 403 도 같은 뜻이다.**
        //
        // **⛔ 403 을 거절 화면으로 그리면 아이가 갇힌다** (2026-09-14, 서버까지 붙는 E2E 가 잡았다).
        // 공용 브라우저에서 **부모가 로그인한 채로 코드를 받아 아이에게 넘기는 것이 정상 흐름**인데
        // (`adr/0014` 결정 3), 그 브라우저에는 **부모 쿠키가 살아 있어 `/child/me` 가
        // `403 FORBIDDEN_ROLE`** 로 답한다. 그러면 화면이 **「여기는 지금 들어갈 수 없어요」**를
        // 띄우고 **코드 입력칸이 아예 안 뜬다** — 아이가 들어갈 길이 없다.
        //
        // **`역할이다르다` 를 401 로 뭉뚱그리는 것이 아니다.** 그 구분은 그대로 필요하다
        // (`lib/api.ts`). **다만 이 화면에서는 둘이 같은 것을 뜻한다**: 「이 브라우저는
        // 아직 들어온 아이가 아니다」. **부모 쿠키는 코드를 넣는 순간 서버가 지운다**
        // (`adr/0014` 결정 3) — 그래서 여기서 코드 입력을 여는 것이 **덜 안전하지도 않다.**
        if (인증이풀렸다(e) || 역할이다르다(e)) {
          // **효과 안에서 한 번 읽는다.** 렌더 중에 `location` 을 보면 정적 빌드의
          // 첫 HTML 과 하이드레이션이 어긋난다.
          setScreen({ kind: "코드입력", line: null, 끊김: 끊겨서왔나() });
          return;
        }
        if (e instanceof ApiError) {
          setScreen({ kind: "거절", line: e.서버문구 });
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
  }, [router]);

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
        // **`끊김` 을 유지한다.** 여기서 떨구면 **오타 한 번에 안내가 기본으로 돌아가**
        // 아이가 「부모님이 새 코드를 받으셨어요」를 읽다가 그 줄을 잃는다.
        setScreen((prev) => ({
          kind: "코드입력",
          line: e.서버문구,
          끊김: prev.kind === "코드입력" ? prev.끊김 : false,
        }));
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
    <AccountEntry kind="child" showParentAccess={screen.kind === "코드입력"}>
      {screen.kind === "확인중" && (
        <div className="child-entry-state" role="status">
          <p className="child-entry-status">{상태표시.확인중}</p>
        </div>
      )}

      {screen.kind === "코드입력" && (
        <form
          className="account-auth-form child-entry-form"
          aria-busy={보내는중}
          onSubmit={(e) => {
            e.preventDefault();
            if (보낼수있다) void 들어가기();
          }}
        >
          <div className="account-heading child-entry-heading">
            <h1>{코드입력.제목}</h1>
            {/* 무엇을 넣어야 하는지 모양을 미리 알려준다 — 오류를 나눠 말할 수 없으니
                **엉뚱한 것을 넣기 전에 막는 것**이 유일한 수단이다. */}
            {/* **끊겨서 왔으면 기본 안내 대신 이 줄이다** (`문구.md` 3.3).
                주어가 **부모**인 것이 전부다 — 「다시 한 번 들어와 주세요」는
                **아이가 뭘 잘못한 것처럼 읽히는데 실제로 끊은 쪽은 어른**이다. */}
            <p id="child-code-help" data-안내 className="account-description">
              {screen.끊김 ? 코드입력.끊겨서왔을때 : 코드입력.안내}
            </p>
          </div>

          <div className="child-entry-ticket">
            <label className="account-field child-entry-code">
              <span className="field-label child-entry-code-label">{코드입력.라벨}</span>
              <input
                // `text` + `inputMode="numeric"` — `type="number"` 는 앞자리 0 을 흘리고
                // 스피너가 붙는다. 6자리 코드는 **수가 아니라 글자**다.
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-describedby={screen.line === null ? "child-code-help" : "child-code-help child-code-error"}
                aria-invalid={screen.line !== null || undefined}
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
                readOnly={보내는중}
                spellCheck={false}
                className="form-field account-code-input child-entry-code-input"
              />
            </label>
          </div>

          {/* **서버가 준 문구다.** 화면이 지은 말이 아니고, 자리도 입력칸 곁이다 —
              무엇에 대한 말인지 아이가 찾지 않아도 되게. */}
          {screen.line !== null && (
            <p id="child-code-error" data-오류 role="alert" className="account-feedback child-entry-feedback">
              {screen.line}
            </p>
          )}

          {/* **⛔ 33초 동안 아무 말도 안 하고 있었다** (2026-09-15 백엔드 실측 —
              **식은 서버의 첫 요청이 33.3초**). 그때 아이가 보는 것은 **흐려진 버튼 하나**였고,
              **그날 첫 아이가 정확히 그 화면을 본다.**
              **문구는 이미 있었다** — `문구.md` **2.5** 의 「접속 코드를 확인하는 중」.
              **자리가 비어 있었던 것이지 없는 말이 아니다.** */}
          {보내는중 && <p data-확인중 role="status" className="child-entry-status">{상태표시.확인중}</p>}

          <button
            type="submit"
            disabled={!보낼수있다}
            className="pressable action-primary account-submit child-entry-submit"
          >
            {코드입력.버튼}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      )}

      {screen.kind === "거절" && <p role="alert" className="account-feedback child-entry-feedback child-entry-state">{screen.line}</p>}

      {screen.kind === "못닿음" && (
        <div className="child-entry-state child-entry-unreachable">
          {/* **`문구.md` 2.4 다.** 서버가 아무 말도 못 했으므로 화면이 고르지만,
              그렇다고 화면이 짓는 것은 아니다 — 문서에 자리가 있다. */}
          <p role="status">{못닿음}</p>
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
    </AccountEntry>
  );
}
