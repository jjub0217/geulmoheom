"use client";

import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import {
  ApiError,
  NetworkError,
  apiGet,
  apiPost,
  apiPostNoBody,
  역할이다르다,
  인증이풀렸다,
} from "@/lib/api";

type SignupRequest = components["schemas"]["SignupRequest"];
type SignupResponse = components["schemas"]["SignupResponse"];
type ParentMe = components["schemas"]["ParentMe"];

/**
 * 학부모 가입 · 보호자 동의 화면 (백로그 E-4 프론트 몫).
 *
 * **여기는 아이 화면이 아니다.** `docs/용어사전.md` 「아이 화면」 열의 말을 쓰지 않는다 —
 * 「탐험가」 같은 말이 나오면, **검증하러 온 학부모**에게 진지함이 깎인다.
 *
 * **동의를 받는 화면이지 통과시키는 화면이 아니다.** 그래서 지키는 것 셋 —
 * ① **어느 체크박스도 미리 체크하지 않는다**
 * ② **필수 동의와 라벨링 동의를 하나로 묶지 않는다** (PRD 1.1b) — 앞은 거부하면 이용할 수 없고,
 *    뒤는 **거부해도 그대로 쓸 수 있다.** 묶으면 거부할 수 없는 것을 거부할 수 있는 척하게 된다
 * ③ **고지를 링크 뒤에 숨기지 않는다.** 「어디로 가고 얼마나 남는가」는 화면에 문장으로 있다
 */

/**
 * 화면에 그대로 나가는 고지. **근거는 `MVP_PRD.md` E-4 MUST 와 `페인_가이드라인정책.md` 2.3** 이고
 * 여기서 지어낸 문장이 아니다. **확정본이다** (2026-09-07 대표 지적 → PM 확정).
 *
 * **전문 용어를 쓰지 않는다.** 정책 문서는 「숨기지 않고 고지한다」고 했지 「전문 용어로 고지한다」고
 * 하지 않았다 — **읽어도 모르면 고지가 아니라 알리바이다.** 「API」는 학부모에게 아무 정보도 주지 않아
 * 뺐고, 대신 **「구글」을 앞에 뒀다.** 학부모가 알아야 할 사실은 **「우리 밖으로, 구글이라는 회사로 간다」**다.
 * 정확한 이름(Gemini)은 괄호로 남긴다 — **제3자 위탁 고지라 수탁자명이 있어야 한다.**
 *
 * **「AI 학습」이라는 명사구를 쓰지 않는다.** 학부모의 핵심 불안이 「AI 가 대신 써준다」라서,
 * **부정문 안에 넣어도 그 단어만 기억에 남는다.** 그래서 「학습시키지는 않습니다」로 동사형을 쓴다.
 * 「남용 탐지」도 업계 말이라 **누가 무엇을 왜 하는지**로 풀었다.
 */
const 고지 = [
  "아이가 쓴 문장은 구글의 AI(Gemini)로 보내져 평가됩니다.",
  "구글이 이 문장으로 AI를 학습시키지는 않습니다. 다만 나쁘게 쓰이는지 확인하려고 일정 기간 보관합니다.",
  "실명·학교 이름·연락처는 보내기 전에 걸러냅니다.",
];

/** **3상태다.** 2상태로 만들면 첫 페인트에 가입 화면이 깜빡인다 (미결 11-2 조사 노트). */
type Screen =
  /** 확인 중 — `GET /parents/me` 가 아직 안 왔다. **여기서 폼을 그리지 않는다** */
  | { kind: "확인중" }
  /** 로그아웃됨 — 가입 폼을 보여준다 */
  | { kind: "가입전" }
  /** 로그인됨 */
  | { kind: "가입됨"; consentAt: string }
  /** 서버가 형식을 갖춰 거절했다. 문구는 서버가 준 것을 그대로 쓴다 */
  | { kind: "거절"; line: string }
  | { kind: "못닿음"; hints: string[] };

export default function ParentSignup() {
  const [screen, setScreen] = useState<Screen>({ kind: "확인중" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [labelingConsent, setLabelingConsent] = useState(false);
  const [보내는중, set보내는중] = useState(false);

  useEffect(() => {
    let alive = true;

    apiGet<ParentMe>("/parents/me")
      .then((me) => {
        if (alive) setScreen({ kind: "가입됨", consentAt: me.consent_at });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // **401 은 「아직 안 들어왔다」다.** 오류가 아니라 이 화면의 정상 출발점이다.
        if (인증이풀렸다(e)) {
          setScreen({ kind: "가입전" });
          return;
        }
        // **403 을 401 과 같이 다루지 않는다.** 자녀 쿠키로 들어온 경우가 여기다 —
        // 로그인이 풀린 게 아니라 **역할이 다른 것**이라, 가입 폼을 다시 보여주면 안 된다.
        if (역할이다르다(e)) {
          setScreen({ kind: "거절", line: (e as ApiError).childMessage });
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
  }, []);

  const 보내기 = async () => {
    set보내는중(true);
    try {
      const body: SignupRequest = {
        email,
        password,
        consent,
        // **별개 필드로 보낸다.** 위 동의에 딸려 보내지 않는다.
        labeling_consent: labelingConsent,
      };
      const res = await apiPost<SignupResponse>("/parents/signup", body);
      setScreen({ kind: "가입됨", consentAt: res.consent_at });
    } catch (e) {
      if (e instanceof ApiError) {
        setScreen({ kind: "거절", line: e.childMessage });
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

  /**
   * **서버를 부른다.** 클라이언트에서 쿠키를 지우는 것으로 대신하지 않는다 —
   * `__Host-` 쿠키는 **JS 가 못 읽고 못 지운다.** 로컬 상태만 비우면 쿠키는 살아 있다.
   *
   * 끝나면 **3상태가 「로그아웃됨」으로 간다.** 「확인 중」에 걸어두지 않는다.
   * 폼 값도 비운다 — 가족 태블릿이라 **다음 사람이 앞사람 이메일을 보면 안 된다.**
   */
  const 로그아웃 = async () => {
    try {
      await apiPostNoBody("/parents/logout");
    } catch (e) {
      // 서버에 닿지 못하면 **쿠키가 그대로 살아 있다.** 나간 척하지 않는다.
      if (e instanceof NetworkError) {
        setScreen({ kind: "못닿음", hints: e.hints });
        return;
      }
      if (e instanceof ApiError) {
        setScreen({ kind: "거절", line: e.childMessage });
        return;
      }
      throw e;
    }
    setEmail("");
    setPassword("");
    setConsent(false);
    setLabelingConsent(false);
    setScreen({ kind: "가입전" });
  };

  // **필수 동의가 없으면 보낼 수 없다.** 서버도 `consent: false` 면 422 지만,
  // 여기서 막는 이유는 검증이 아니라 **「체크하지 않았다는 사실을 화면이 알고 있다」**를 보이기 위해서다.
  const 보낼수있다 =
    email.trim() !== "" && password !== "" && consent && !보내는중;

  return (
    <main className="page-frame flex flex-1 flex-col justify-center gap-8 py-12">
      {screen.kind === "확인중" && <p className="opacity-70">확인하는 중…</p>}

      {screen.kind === "가입전" && (
        <form
          className="flex flex-col gap-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (보낼수있다) void 보내기();
          }}
        >
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold">보호자 가입</h1>
            <p className="opacity-80">
              아이 계정은 보호자 동의를 받은 뒤에 만들 수 있습니다.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span>이메일</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="rounded-xl border-2 border-brass/50 bg-markings/70 p-3
                  dark:bg-glow-deep/40"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>비밀번호</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="rounded-xl border-2 border-brass/50 bg-markings/70 p-3
                  dark:bg-glow-deep/40"
              />
            </label>
          </div>

          <section className="flex flex-col gap-3 rounded-2xl border-2 border-brass/40 p-5">
            <h2 className="font-semibold">아이가 쓴 문장이 어디로 가는지</h2>
            {/* **링크 뒤에 숨기지 않는다.** 「약관 보기」만 두면 아무도 읽지 않는다. */}
            <ul className="list-disc space-y-1 pl-5">
              {고지.map((줄) => (
                <li key={줄}>{줄}</li>
              ))}
            </ul>

            {/* 필수 — 거부하면 서비스를 이용할 수 없다. 서버도 false 면 422 다. */}
            <label className="mt-2 flex items-start gap-3">
              <input
                type="checkbox"
                name="consent"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 size-5"
              />
              <span>
                <strong>[필수]</strong> 저는 이 아이의 보호자이고, 위 내용에
                동의합니다.
              </span>
            </label>
          </section>

          <section className="flex flex-col gap-2 rounded-2xl border-2 border-brass/40 p-5">
            {/* 위 상자가 「무슨 일이 일어나는지」이고 여기가 「당신이 정하는 것」이다.
                **제목이 그 경계를 선언한다** — 「선택」이라는 사실을 라벨 앞의 `[선택]` 글자
                하나에만 기대지 않게 된다. 빠르게 훑는 사람도 읽는 모드가 바뀐 것을 여기서 안다. */}
            <h2 className="font-semibold">여기서부터는 선택입니다</h2>
            {/* **별개 항목이다.** 위와 한 덩어리로 만들지 않는다 (PRD 1.1b). */}
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="labeling_consent"
                checked={labelingConsent}
                onChange={(e) => setLabelingConsent(e.target.checked)}
                className="mt-1 size-5"
              />
              {/* **「사람이 직접 읽는다」를 숨기지 않는다.** 그게 이 동의의 실체다 —
                  나중에 알게 되면 **동의를 받은 것이 아니라 속인 것**이 된다
                  (`페인_가이드라인정책.md` 「숨기지 않고 고지한다」). */}
              <span>
                <strong>[선택]</strong> 아이가 쓴 문장을 사람이 직접 읽고 평가
                기준을 다듬는 데 쓰는 것에 동의합니다.
              </span>
            </label>
            {/* 이 한 줄이 없으면 「체크 안 하면 기능이 줄어드나」 하고 그냥 누른다 —
                그러면 동의를 **받은 것이 아니라 통과시킨 것**이 된다. */}
            <p className="pl-8 opacity-80">
              거부해도 모든 기능을 그대로 쓸 수 있습니다.
            </p>
          </section>

          <button
            type="submit"
            disabled={!보낼수있다}
            className="self-end rounded-full bg-scarf px-10 py-3 text-markings
              disabled:opacity-40"
          >
            가입하기
          </button>
        </form>
      )}

      {screen.kind === "가입됨" && (
        // **여기서 멈춘다** (PM 확정 2026-09-07). 다음 단계(아이 계정 만들기)는 백엔드 6번이
        // 오면 **바로 이 자리**에 붙는다. 「곧 열립니다」 같은 문장을 지어두면 이틀 뒤에 거짓말이 된다.
        <div className="flex flex-col items-start gap-2">
          <h1 className="text-3xl font-semibold">가입됐습니다</h1>
          <p className="opacity-80">
            동의 시각: <time dateTime={screen.consentAt}>{screen.consentAt}</time>
          </p>
          {/* **「모든 기기에서 로그아웃됩니다」 같은 말을 쓰지 않는다** — 지금은 거짓말이다.
              `token_version` 은 컬럼만 있고 올리는 코드가 없다(E-3/E-4).
              **「전부 로그아웃」처럼 보이게 만들지도 않는다** — 이 호출은 자녀 쿠키를 안 건드리고,
              가족 태블릿에서 **아이 세션은 살아 있어야 한다.** 그래서 주장 없이 이름만 둔다. */}
          <button
            type="button"
            onClick={() => void 로그아웃()}
            className="mt-4 rounded-full border-2 border-brass/60 px-8 py-2"
          >
            로그아웃
          </button>
        </div>
      )}

      {screen.kind === "거절" && <p className="text-xl/relaxed">{screen.line}</p>}

      {screen.kind === "못닿음" && (
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
