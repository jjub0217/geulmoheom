"use client";

import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import { ApiError, NetworkError, apiGet, apiPost } from "@/lib/api";

import {
  나이선택,
  만들기,
  목록,
  못닿음,
  별명이걸렸다,
  재발급,
  접속코드,
  하루상한,
} from "./children-copy";

type ParentMe = components["schemas"]["ParentMe"];
type ChildSummary = components["schemas"]["ChildSummary"];
type CreateChildRequest = components["schemas"]["CreateChildRequest"];
type CreateChildResponse = components["schemas"]["CreateChildResponse"];
type AccessCode = components["schemas"]["AccessCode"];

/**
 * 학부모 자녀 관리 (백로그 E-4 프론트 짝, `web/tasks/W4.md` 3번).
 *
 * **아이에게 건넬 접속 코드가 여기서 나온다.** 이 화면이 없으면 **코드가 안 나오고,
 * 자녀 인증 화면(`/child/auth`)을 쓸 수 없다** — Stage 0 루프의 첫 칸이다.
 *
 * **문구는 `docs/문구.md` 3.4·3.5 가 SSOT** 이고 `./children-copy.ts` 가 옮겨 온 것이다.
 * **서버가 준 `error.message` 를 이 화면에 쓰지 않는다** — 그건 아이 목소리다 (4장 「열린 자리」).
 *
 * **가입 화면의 「가입됨」 안에 붙는다. 라우트를 새로 만들지 않았다** —
 * 새 화면으로 빼면 **거기로 가는 링크 글자**가 필요한데 `문구.md` 에 그 자리가 없다.
 *
 * **자녀 삭제는 여기 없다.** 서버는 `DELETE /parents/children/{id}` 로 즉시 파기까지 돌지만
 * **W4 완료 조건이 ①만들기 ②접속 코드 ③목록 셋뿐**이라 **계획이 안 시킨 것**이다
 * (`문구.md` 4장에 W5 로 기록됐다). **범위를 진척에서 늘리지 않는다.**
 */

/** 방금 발급된 평문 코드. **서버는 해시만 저장하므로 이 값은 다시 못 받는다.** */
type 발급된코드 = { childId: string; code: string; expiresAt: string };

export function ChildrenPanel() {
  /** `null` 이면 아직 안 왔다. **빈 배열과 다르다** — 빈 배열은 「아이가 없다」다. */
  const [children, setChildren] = useState<ChildSummary[] | null>(null);
  const [목록실패, set목록실패] = useState<string | null>(null);

  const [nickname, setNickname] = useState("");
  const [ageBand, setAgeBand] = useState<CreateChildRequest["age_band"]>(11);
  const [보내는중, set보내는중] = useState(false);
  const [만들기실패, set만들기실패] = useState<string | null>(null);

  const [코드, set코드] = useState<발급된코드 | null>(null);
  const [재발급중, set재발급중] = useState<string | null>(null);
  const [재발급실패, set재발급실패] = useState<string | null>(null);

  const 목록불러오기 = () =>
    apiGet<ParentMe>("/parents/me")
      .then((me) => {
        setChildren(me.children);
        set목록실패(null);
      })
      .catch((e: unknown) => {
        if (e instanceof NetworkError || e instanceof ApiError) {
          set목록실패(못닿음.목록);
          return;
        }
        throw e;
      });

  useEffect(() => {
    // 한 번만 부른다. 이후 갱신은 만들기가 끝난 자리에서 직접 부른다.
    void 목록불러오기();
  }, []);

  const 추가하기 = async () => {
    set보내는중(true);
    set만들기실패(null);
    try {
      const body: CreateChildRequest = { nickname, age_band: ageBand };
      const 만들어짐 = await apiPost<CreateChildResponse>("/parents/children", body);
      // **평문 코드는 이 응답 한 번에만 실린다.** 화면에서 놓치면 재발급뿐이다.
      set코드({
        childId: 만들어짐.child_id,
        code: 만들어짐.access_code,
        expiresAt: 만들어짐.access_code_expires_at,
      });
      setNickname("");
      await 목록불러오기();
    } catch (e) {
      if (e instanceof ApiError) {
        // **별명이 걸린 것만 종류를 말해 준다** (`문구.md` 3.4). 학부모는 다시 지어야 하는
        // 사람이라, 무엇이 걸렸는지 모르면 **같은 별명을 조금 바꿔 다시 넣는다.**
        const kind = (e.detail as { reason?: string; kind?: unknown } | undefined);
        const 걸림 =
          kind?.reason === "PII_DETECTED" ? 별명이걸렸다(kind.kind) : null;
        set만들기실패(걸림 ?? 못닿음.추가);
        return;
      }
      if (e instanceof NetworkError) {
        set만들기실패(못닿음.추가);
        return;
      }
      throw e;
    } finally {
      set보내는중(false);
    }
  };

  const 코드다시받기 = async (childId: string) => {
    set재발급중(childId);
    set재발급실패(null);
    try {
      const 새코드 = await apiPost<AccessCode>(
        `/parents/children/${childId}/access-code`,
        {},
      );
      set코드({
        childId,
        code: 새코드.access_code,
        expiresAt: 새코드.access_code_expires_at,
      });
    } catch (e) {
      // **남의 자녀는 404 다**(403 이 아니다). 없는 것과 남의 것을 화면에서 **구분해 보여주지
      // 않는다** — 구분하는 순간 「그 ID 는 존재한다」가 샌다. 그래서 한 문구로 묶는다.
      if (e instanceof ApiError || e instanceof NetworkError) {
        set재발급실패(못닿음.재발급);
        return;
      }
      throw e;
    } finally {
      set재발급중(null);
    }
  };

  return (
    <section className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold">{목록.제목}</h2>

        {목록실패 !== null && <p data-목록실패>{목록실패}</p>}

        {children !== null && children.length === 0 && <p>{목록.비었을때}</p>}

        {children !== null && children.length > 0 && (
          <ul className="flex flex-col gap-3">
            {children.map((아이) => (
              <li
                key={아이.child_id}
                data-자녀
                className="flex flex-col gap-3 rounded-2xl border-2 border-brass/40 p-5"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <strong className="text-xl">{아이.nickname}</strong>
                  <span className="opacity-80">
                    {나이선택.find((n) => n.값 === 아이.age_band)?.글자}
                  </span>
                  {/* **개수가 아니라 「했다/아직」이다** — 계약에 개수가 없고,
                      부모가 보려는 것도 오늘 아이가 이걸 했는지다. */}
                  <span data-오늘>
                    {아이.played_today ? 목록.오늘썼다 : 목록.오늘아직}
                  </span>
                  {/* **상한은 말하지 않으면 없는 것과 같다.** 학부모의 핵심 불안이 도파민이다. */}
                  <span className="opacity-70">{하루상한(아이.daily_cap)}</span>
                </div>

                {/* **경고가 버튼 옆이다. 누른 뒤가 아니다** (`문구.md` 3.4) —
                    재발급이 `token_version` 을 올려 **아이가 쓰던 태블릿이 끊긴다.**
                    이 화면이 만드는 **유일한 되돌릴 수 없는 실수**다. */}
                <div className="flex flex-col gap-2">
                  <p className="opacity-80">{재발급.경고}</p>
                  <button
                    type="button"
                    disabled={재발급중 === 아이.child_id}
                    onClick={() => void 코드다시받기(아이.child_id)}
                    className="self-start rounded-full border-2 border-brass/60 px-6 py-2
                      disabled:opacity-40"
                  >
                    {재발급.버튼}
                  </button>
                </div>

                {코드 !== null && 코드.childId === 아이.child_id && (
                  <AccessCodePanel 코드={코드} />
                )}
              </li>
            ))}
          </ul>
        )}

        {재발급실패 !== null && <p data-재발급실패>{재발급실패}</p>}
      </div>

      <form
        className="flex flex-col gap-4 rounded-2xl border-2 border-brass/40 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (nickname.trim() !== "" && !보내는중) void 추가하기();
        }}
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">{만들기.제목}</h2>
          {/* **넣기 전에 알린다.** 서버가 걸러내지만 거절당한 뒤에 아는 것보다 낫고,
              학부모의 불안은 「거절」이 아니라 **「어디에 남나」**다. */}
          <p className="opacity-80">{만들기.안내}</p>
        </div>

        <label className="flex flex-col gap-1">
          <span>{만들기.별명}</span>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
            className="rounded-xl border-2 border-brass/50 bg-markings/70 p-3
              dark:bg-glow-deep/40"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span>{만들기.나이}</span>
          {/* **선택지가 셋뿐인 것은 계약이 닫아 둔 것이다** (`age_band ∈ {10,11,12}`).
              자유 입력으로 두면 타깃 밖 나이가 들어오고 서버가 422 로 되돌려준다. */}
          <select
            value={ageBand}
            onChange={(e) =>
              setAgeBand(Number(e.target.value) as CreateChildRequest["age_band"])
            }
            className="rounded-xl border-2 border-brass/50 bg-markings/70 p-3
              dark:bg-glow-deep/40"
          >
            {나이선택.map(({ 값, 글자 }) => (
              <option key={값} value={값}>
                {글자}
              </option>
            ))}
          </select>
        </label>

        {만들기실패 !== null && <p data-만들기실패>{만들기실패}</p>}

        <button
          type="submit"
          disabled={nickname.trim() === "" || 보내는중}
          className="self-end rounded-full bg-scarf px-10 py-3 text-markings
            disabled:opacity-40"
        >
          {만들기.버튼}
        </button>
      </form>

      {/* 아직 목록에 안 붙은 코드(방금 만든 아이). 목록 갱신이 늦어도 **코드를 잃지 않는다.** */}
      {코드 !== null &&
        !(children ?? []).some((아이) => 아이.child_id === 코드.childId) && (
          <AccessCodePanel 코드={코드} />
        )}
    </section>
  );
}

/**
 * **평문 코드는 여기서 한 번만 보인다.** 서버는 해시만 저장해서 다시 못 받는다 —
 * 놓치면 재발급뿐이고, **재발급은 아이 기기를 끊는다.**
 */
function AccessCodePanel({ 코드 }: { 코드: 발급된코드 }) {
  return (
    <div data-접속코드 className="flex flex-col gap-2 rounded-2xl bg-brass/15 p-5">
      <p className="font-semibold">{접속코드.제목}</p>
      {/* 숫자는 **띄어 읽을 수 있게** 자간을 준다 — 학부모가 아이에게 불러준다. */}
      <p className="text-4xl tracking-[0.3em] tabular-nums">{코드.code}</p>
      {/* **본 그 순간에 말한다.** 나중에 다시 열어보려 하는 것이 실제 실패 모드다. */}
      <p>{접속코드.한번만}</p>
      {/* 아이 화면(3.2)이 막아주지만 **먼저 알면 아이가 그 벽을 안 만난다.** */}
      <p>{접속코드.홈화면앱}</p>
    </div>
  );
}
