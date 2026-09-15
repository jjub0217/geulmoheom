"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

import { ChildrenPanel } from "@/components/children";

import { 날짜시각 } from "@/lib/format";

import { 아이입장으로보낼곳 } from "@/lib/parent-kicked";

import { 상태표시 } from "@/app/status-copy";

import { 고지, 못닿음, 학부모오류문구, 폼 } from "./copy";

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
 *
 * **`page-frame` 이 아니라 `reading-frame` 이다** (W3 에서 넘긴 ③, 2026-09-08).
 * 1280 을 다 쓰면 한 줄이 너무 길어 눈이 되돌아오고, **별명처럼 대여섯 글자를 넣는 칸이
 * 화면을 가로지른다** — **칸의 크기는 「얼마나 넣는가」를 말하는 신호**라, 넓은 칸은
 * 길게 쓰라는 뜻이 된다. 모험 화면은 반대라 `page-frame` 그대로다.
 */


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
  /**
   * 서버에 닿지 못했다. **`동작` 을 함께 싣는다** — `문구.md` 3.5 가 **무엇이 안 됐는지**를
   * 말하라고 해서, 화면이 「어느 동작이 실패했나」를 알아야 문장을 고를 수 있다.
   */
  | { kind: "못닿음"; hints: string[]; 동작: keyof typeof 못닿음 };

export default function ParentSignup() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ kind: "확인중" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [labelingConsent, setLabelingConsent] = useState(false);
  const [보내는중, set보내는중] = useState(false);

  /**
   * **제출이 거절됐을 때** (`문구.md` **3.6**, 2026-09-14 신설).
   *
   * **⛔ `거절` 화면으로 넘기지 않는다.** 그 상태는 폼을 통째로 치우는데, 그러면
   * **「입력을 다시 확인해 주세요」가 거짓**이 된다 — 확인할 입력이 화면에 없다.
   * **2026-09-14 저녁 사용자가 갇힌 자리가 정확히 여기다.** 여기 남는 오류는
   * **폼 곁의 한 줄**이고, `거절` 화면은 **`/parents/me` 가 403 일 때**(자녀 쿠키)로 남는다.
   */
  const [제출오류, set제출오류] = useState<string | null>(null);

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
        //
        // **⛔ 거절 문장으로 끝내지 않는다** (2026-09-15, `문구.md` **3.11** 신설 · 결과 ⑩).
        // 종전에는 3.8 의 **「이 계정으로는 볼 수 없는 화면입니다.」**를 띄우고 **거기서 끝났다** —
        // **왜 안 되는지도, 아이 때문이라는 것도 말하지 않고** 다시 들어갈 길도 없었다.
        // **로그인 화면으로 보내면서 표식을 단다**: 그 화면이 3.11 문장으로 안내를 갈아끼운다.
        if (역할이다르다(e)) {
          router.replace(아이입장으로보낼곳);
          return;
        }
        if (e instanceof ApiError) {
          // **`code` 로 고른다. `message` 를 쓰지 않는다** (`문구.md` 3.8) —
          // 그건 아이 목소리라 학부모 화면에서 틀린다.
          setScreen({ kind: "거절", line: 학부모오류문구(e.code) });
          return;
        }
        if (e instanceof NetworkError) {
          setScreen({ kind: "못닿음", hints: e.hints, 동작: "가입" });
          return;
        }
        throw e;
      });

    return () => {
      alive = false;
    };
  }, [router]);

  const 보내기 = async () => {
    set보내는중(true);
    set제출오류(null);
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
        // **⛔ `code` 를 안 가린다. 모든 가입 실패에 같은 문장이다** (`문구.md` 3.6).
        // **갈라 쓰면 그 갈림이 곧 정보**다 — 이미 가입된 이메일을 서버가 **일부러**
        // 422 로만 답하는데(`parents.py:93`), 화면이 코드별로 문장을 나누면
        // **아무나 이메일 존재 여부를 확인**할 수 있다. 그래서 `학부모오류문구` 를 안 쓴다.
        //
        // **화면을 안 넘긴다.** 폼이 남아야 「입력을 다시 확인해 주세요」가 참이 되고,
        // **로그인으로 가는 길도 같이 남는다.**
        set제출오류(폼.제출거절);
        return;
      }
      if (e instanceof NetworkError) {
        setScreen({ kind: "못닿음", hints: e.hints, 동작: "가입" });
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
        setScreen({ kind: "못닿음", hints: e.hints, 동작: "로그아웃" });
        return;
      }
      if (e instanceof ApiError) {
        setScreen({ kind: "거절", line: 학부모오류문구(e.code) });
        return;
      }
      throw e;
    }
    setEmail("");
    setPassword("");
    setConsent(false);
    setLabelingConsent(false);
    // 앞사람의 오류 한 줄도 같이 지운다 — **가족 태블릿이고 다음 사람이 그것을 자기 것으로 읽는다.**
    set제출오류(null);
    setScreen({ kind: "가입전" });
  };

  // **필수 동의가 없으면 보낼 수 없다.** 서버도 `consent: false` 면 422 지만,
  // 여기서 막는 이유는 검증이 아니라 **「체크하지 않았다는 사실을 화면이 알고 있다」**를 보이기 위해서다.
  const 보낼수있다 =
    email.trim() !== "" && password !== "" && consent && !보내는중;

  return (
    <main className="reading-frame flex flex-1 flex-col justify-center gap-8 py-12">
      {screen.kind === "확인중" && <p className="opacity-70">{상태표시.확인중}</p>}

      {screen.kind === "가입전" && (
        <>
        <form
          className="flex flex-col gap-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (보낼수있다) void 보내기();
          }}
        >
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold">{폼.제목}</h1>
            <p className="opacity-80">{폼.안내}</p>
            {/* **⛔ 제목 바로 아래다. 폼 뒤가 아니다** (2026-09-15, W6 14번 PM 판정).
                **돌아온 부모는 고지를 다시 읽을 이유가 없다** — 그런데 이 길이 **동의 폼
                전체 뒤**라 360×640 에서 **1308px**, 태블릿 가로에서도 **1077px** 로
                **첫 화면 밖**이었다. 어제 ⑥ 을 고치며 낸 길인데 **보이지 않으면 없는 것**이다.
                **「가입하기」는 안 올린다** — **동의는 읽고 나서 누르는 것**이고,
                버튼이 고지 앞에 오면 **읽기 전에 동의**하게 된다 (3.1·7.3).
                **오류와 무관하게 늘 보인다**: 오류 때만 띄우면 그것 자체가
                **이메일 존재 확인 창구**가 된다(`parents.py:93`). */}
            <Link
              href="/parents/login"
              className="pressable self-start rounded-full py-2 underline underline-offset-4"
            >
              {폼.로그인으로}
            </Link>
          </div>

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span>{폼.이메일}</span>
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
              <span>{폼.비밀번호}</span>
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
            <h2 className="font-semibold">{폼.고지제목}</h2>
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
                <strong>{폼.필수표시}</strong> {폼.필수동의}
              </span>
            </label>
          </section>

          <section className="flex flex-col gap-2 rounded-2xl border-2 border-brass/40 p-5">
            {/* 위 상자가 「무슨 일이 일어나는지」이고 여기가 「당신이 정하는 것」이다.
                **제목이 그 경계를 선언한다** — 「선택」이라는 사실을 라벨 앞의 `[선택]` 글자
                하나에만 기대지 않게 된다. 빠르게 훑는 사람도 읽는 모드가 바뀐 것을 여기서 안다. */}
            <h2 className="font-semibold">{폼.선택시작}</h2>
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
                <strong>{폼.선택표시}</strong> {폼.선택동의}
              </span>
            </label>
            {/* 이 한 줄이 없으면 「체크 안 하면 기능이 줄어드나」 하고 그냥 누른다 —
                그러면 동의를 **받은 것이 아니라 통과시킨 것**이 된다. */}
<p className="pl-8 opacity-80">{폼.선택거부해도}</p>
          </section>

          {/* **자리가 버튼 곁이다** — 방금 누른 것에 대한 대답이라, 폼 위로 올리면
              부모가 무엇 때문에 나온 말인지 찾아야 한다. 로그인 화면과 같은 규칙이다. */}
          {제출오류 !== null && (
            <p data-오류 role="status" className="text-xl/relaxed">
              {제출오류}
            </p>
          )}

          <button
            type="submit"
            disabled={!보낼수있다}
            className="pressable self-end rounded-full bg-scarf px-10 py-3 text-markings
              disabled:opacity-40"
          >
            {폼.가입하기}
          </button>
        </form>

        </>
      )}

      {screen.kind === "가입됨" && (
        // **백엔드 6번(E-4)이 왔고 아이 계정 만들기가 바로 이 자리에 붙었다** (2026-09-08).
        // 앞 세션이 「곧 열립니다」를 안 지어두고 비워 둔 자리다 — 지어뒀으면 이틀 뒤 거짓말이 됐다.
        // **라우트를 새로 만들지 않았다**: 새 화면으로 빼면 **거기로 가는 링크 글자**가 필요한데
        // `문구.md` 에 그 자리가 없다.
        <div className="flex w-full flex-col items-start gap-2">
          <h1 className="text-3xl font-semibold">{폼.가입됨}</h1>

          {/* **⛔ 자녀 관리가 위다** (2026-09-15, W6 14번 PM 판정 — 「그 화면에 온 사람이
              해야 할 일은 첫 화면에 있어야 한다」). **부모가 여기 오는 이유는 접속 코드**이고,
              **동의 기록과 로그아웃은 확인·마무리**다. 종전에는 그 둘이 위에 있어
              360×640 에서 **「아이 추가로 가는 길」이 29px 밖**이었다.
              **폼 전체를 올리는 것이 아니다** — 첫 화면에 **목록과 길**이 있으면 된다. */}
          <div className="w-full">
            <ChildrenPanel />
          </div>

          <div className="mt-8 w-full border-t-2 border-brass/30 pt-8">
            {/* **기계가 준 값을 그대로 내지 않는다** (`문구.md` 6장). 한때 여기에
                `2026-09-08T01:00:00Z` 가 그대로 나갔다 — **문장은 3.6 에 등록돼 있었는데
                값의 형식이 어디에도 없었다.** 못 읽는 값이면 **줄을 통째로 안 그린다**:
                「NaN년」을 내보내느니 없는 편이 낫다. **학부모는 자기가 무엇에 동의했는지
                확인하러 온다** — 그래서 **없애지 않고 자리만 내린다.** */}
            {날짜시각(screen.consentAt) !== null && (
              <p className="opacity-80">
                {폼.동의기록}{" "}
                <time dateTime={screen.consentAt}>{날짜시각(screen.consentAt)}</time>
              </p>
            )}
            {/* **「모든 기기에서 로그아웃됩니다」 같은 말을 쓰지 않는다** — 지금은 거짓말이다.
                `token_version` 은 컬럼만 있고 올리는 코드가 없다(E-3/E-4).
                **「전부 로그아웃」처럼 보이게 만들지도 않는다** — 이 호출은 자녀 쿠키를 안 건드리고,
                가족 태블릿에서 **아이 세션은 살아 있어야 한다.** 그래서 주장 없이 이름만 둔다. */}
            <button
              type="button"
              onClick={() => void 로그아웃()}
              className="pressable mt-4 rounded-full border-2 border-brass/60 px-8 py-2"
            >
              {폼.로그아웃}
            </button>
          </div>
        </div>
      )}

      {screen.kind === "거절" && <p className="text-xl/relaxed">{screen.line}</p>}

      {screen.kind === "못닿음" && (
        <div className="flex flex-col gap-6">
          {/* **`문구.md` 3.5 다. 자리마다 다르다** — 무엇이 안 됐는지를 말한다.
              「인터넷 연결을 확인해 주세요」를 안 붙인다: **우리 쪽이 내려간 것일 수도 있는데
              원인을 모르면서 상대 탓으로 읽히는 안내를 하지 않는다.** */}
          <p className="text-xl/relaxed">{못닿음[screen.동작]}</p>
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
