"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import type { components } from "@/api/types.gen";
import { AccountEntry } from "@/components/account-entry";
import { ApiError, NetworkError, apiPost } from "@/lib/api";

import { 아이가들어와서왔나 } from "@/lib/parent-kicked";

import { 못닿음, 학부모오류문구 } from "../signup/copy";
import { 로그인 } from "./copy";

/** `useSyncExternalStore` 의 구독 자리. **모듈 밖에 두어야 매 렌더 새로 만들어지지 않는다.** */
const 안바뀐다 = () => () => {};

type LoginRequest = components["schemas"]["LoginRequest"];
type LoginResponse = components["schemas"]["LoginResponse"];

/**
 * 학부모 로그인 화면 (`문구.md` **3.10** · `adr/0014` 결정 5).
 *
 * **⛔ 이 화면이 없어서 구멍이 열려 있었다.** 부모 세션이 **30일 → 2시간**으로 짧아졌는데
 * **다시 들어갈 화면이 없었다** — 화면이 `/parents/signup` 하나뿐이라 **같은 이메일로는
 * 못 들어가고**, 그러면 **접속 코드 재발급도 자녀 삭제도 못 한다.**
 * **짧게 만드는 결정은 다시 들어올 길이 있어야 성립한다.**
 *
 * **여기는 아이 화면이 아니다** — `용어사전.md` 「아이 화면」 열의 말을 쓰지 않는다.
 * 그리고 **아이 화면으로 가는 길도 두지 않는다**: 아이는 접속 코드로 들어온다.
 *
 * **입력 열의 폭을 제한한다** (가입 화면과 같은 이유) — 1280 을 다 쓰면 한 줄이 너무 길고,
 * **이메일 칸이 화면을 가로지르면 「길게 쓰라」는 신호**가 된다.
 *
 * **`apiPost` 를 쓴다. `fetch` 를 직접 부르지 않는다** — 그 함수가
 * **`credentials: "include"`** 를 넣는다. 빠지면 **서버는 쿠키를 굽는데 브라우저가 안 받아**
 * **200 인데 로그인이 안 된 상태**가 되고, 부모 눈에는 「로그인했는데 또 로그인하라고 한다」로 보인다.
 */
export default function ParentLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [오류, set오류] = useState<string | null>(null);
  /**
   * **아이가 들어와서 풀린 것인가** (`문구.md` **3.11**). 참이면 안내 한 줄이 갈린다 —
   * 기본 문장은 **시간을 원인으로 말하는데 이 경우 원인은 시간이 아니다.**
   *
   * **`useSyncExternalStore` 다. 효과에서 `setState` 하지 않는다** — 그렇게 쓰면
   * `react-hooks/set-state-in-effect` 가 문다(2026-09-15 실측). 그리고 이 훅이
   * **서버 스냅샷을 따로 받으므로**(세 번째 인자 `false`) **정적 빌드의 첫 HTML 과
   * 하이드레이션이 안 어긋난다** — `lib/parent-kicked.ts` 가 걱정한 그 자리를 훅이 맡는다.
   *
   * **구독은 빈 함수다.** 주소는 이 화면이 사는 동안 안 바뀐다 — 바뀌면 화면이 새로 선다.
   */
  const 아이가들어왔다 = useSyncExternalStore(
    안바뀐다,
    아이가들어와서왔나,
    () => false,
  );
  const [보내는중, set보내는중] = useState(false);

  const 보낼수있다 = email.trim() !== "" && password !== "" && !보내는중;

  const 들어가기 = async () => {
    set보내는중(true);
    set오류(null);
    try {
      const body: LoginRequest = { email, password };
      await apiPost<LoginResponse>("/parents/login", body);
      // **성공하면 화면을 하나 더 만들지 않는다.** 부모가 하러 온 일은 자녀 관리다.
      //
      // **⚠ 「/parents」가 아니다 — 그 주소는 404 다** (2026-09-14 실측).
      // **학부모 홈이 `/parents/signup` 에 있다**: 그 화면이 `/parents/me` 를 물어보고
      // **로그아웃이면 가입 폼, 로그인이면 자녀 관리(`ChildrenPanel`)**를 그린다.
      // **주소 이름이 하는 일과 어긋나 있다** — 고치려면 링크·문구가 같이 움직여서
      // **이번 범위 밖으로 두고 PM 에게 말했다.**
      router.replace("/parents/signup");
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        // **`code` 로 고른다.** `error.message` 는 아이 목소리라 학부모 화면에 그대로 쓰지 않는다
        // (`문구.md` 3.8). **없는 이메일과 틀린 비밀번호가 같은 401 이라 화면도 안 나눈다** —
        // 나누면 **남의 이메일을 넣어 계정 유무를 확인**할 수 있다.
        //
        // **⛔ 다만 `UNAUTHORIZED` 만 이 화면에서 갈라 받는다** (`문구.md` 3.10, 2026-09-14).
        // 3.8 표는 그것을 **「다시 로그인해 주세요.」**로 옮기는데, **로그인 화면에서 그 문장은
        // 아무 말도 아니다** — 부모는 방금 로그인을 시도했다. 사용자가 실물로 밟았고,
        // **비밀번호가 틀렸다는 것을 알 방법이 화면에 없었다.**
        // **`오류문구` 표는 안 고친다** — 다른 학부모 화면에서는 그 문장이 맞다.
        set오류(e.code === "UNAUTHORIZED" ? 로그인.실패 : 학부모오류문구(e.code));
        return;
      }
      if (e instanceof NetworkError) {
        // **서버가 아무 말도 못 한 경우다.** 401 문구와 섞으면 **부모가 비밀번호를 의심하며
        // 계속 고쳐 넣는다** — 실제로는 네트워크가 끊긴 것인데도.
        set오류(못닿음.로그인);
        return;
      }
      throw e;
    } finally {
      set보내는중(false);
    }
  };

  return (
    <AccountEntry kind="login">
      <div className="parent-entry parent-entry--login">
      <form
        className="account-auth-form parent-entry-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (보낼수있다) void 들어가기();
        }}
      >
        <div className="account-heading">
          {/* **「다시 로그인해 주세요」가 아니다** — 만료돼서 온 사람과 **처음 오는 사람이
              같은 화면에 온다.** 「다시」는 후자에게 거짓이다 (`문구.md` 3.10). */}
          <h1>{로그인.제목}</h1>
          {/* **왜 로그아웃되는지를 먼저 말한다.** 「세션이 만료되었습니다」는 전문 용어라 안 쓴다.
              **아이가 들어와서 풀렸으면 그 사실을 말한다** (`문구.md` 3.11) — 기본 문장은
              **시간을 원인으로 말하는데 그때는 원인이 시간이 아니라서 거짓이 된다.** */}
          <p data-안내 className="account-description">
            {아이가들어왔다 ? 로그인.아이가들어왔다 : 로그인.안내}
          </p>
        </div>

        <label className="account-field">
          <span className="field-label">{로그인.이메일}</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="form-field"
          />
        </label>

        <label className="account-field">
          <span className="field-label">{로그인.비밀번호}</span>
          <input
            type="password"
            name="password"
            // **`current-password` 다.** 가입 화면이 `new-password` 라 값이 갈린다 —
            // 여기서 `new-password` 를 쓰면 **비밀번호 관리자가 저장된 것을 안 채운다.**
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="form-field"
          />
        </label>

        {/* **자리가 입력칸 곁이다** — 무엇에 대한 말인지 부모가 찾지 않아도 되게.
            아이 화면 오류를 둔 자리와 같은 규칙이다. */}
        {오류 !== null && (
          <p data-오류 role="alert" className="account-feedback">
            {오류}
          </p>
        )}

        <button
          type="submit"
          disabled={!보낼수있다}
          className="pressable action-primary account-submit"
        >
          {로그인.버튼}
        </button>
      </form>

      {/* **나가는 길은 가입 하나뿐이다.** 아이 화면으로 가는 길을 여기 두지 않는다. */}
      <Link
        href="/parents/signup"
        className="pressable action-quiet account-alternate parent-entry-switch"
      >
        {로그인.가입으로}
      </Link>
      </div>
    </AccountEntry>
  );
}
