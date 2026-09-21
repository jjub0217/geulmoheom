"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import type { components } from "@/api/types.gen";
import {
  ApiError,
  NetworkError,
  apiDelete,
  apiGet,
  apiPost,
  역할이다르다,
  인증이풀렸다,
} from "@/lib/api";
import { 아이입장으로보낼곳 } from "@/lib/parent-kicked";
import { 학부모오류문구 } from "@/app/parents/signup/copy";

import {
  나이선택,
  만들기,
  못닿음,
  별명이걸렸다,
  재발급,
  접속코드,
  지우기,
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
 * **자녀 삭제가 W5 에서 붙었다** (`web/tasks/W5.md` 2번 · COPPA). 서버는 W4 때부터
 * `DELETE /parents/children/{id}` 로 즉시 파기까지 돌고 있었고 **화면만 없었다** —
 * 보호자가 지울 경로가 화면에 없으면 **파일럿 중 삭제 요구에 손으로 DB 를 만지게 된다.**
 * 문구는 `문구.md` **3.9** 다.
 */

/** 방금 발급된 평문 코드. **서버는 해시만 저장하므로 이 값은 다시 못 받는다.** */
/** `별명` 은 **화면 문구가 쓴다** — 아이가 여럿이면 「아이에게」로는 누구인지 안 말한다. */
type 발급된코드 = { childId: string; 별명: string; code: string; expiresAt: string };

/**
 * **로그인이 풀렸는가 — 풀렸으면 로그인 화면으로 보낸다** (`문구.md` **3.11**, 401 절 포함).
 *
 * **두 갈래가 한 곳으로 간다. 화면에서 구분해 보여주지 않는다** — 부모가 보는 것은
 * **「다시 로그인하면 된다」 하나**이고, **왜 풀렸는지만 안내 줄이 다르게 말한다.**
 *
 * | 온 것 | 왜 풀렸나 | 보낼 곳 |
 * |---|---|---|
 * | **403** | 아이가 같은 기기로 들어와 **서버가 보호자 쿠키를 지웠다** (`adr/0014` 결정 3) | 표식을 **단다** — 3.10 안내를 3.11 문장으로 갈아끼운다 |
 * | **401** | **시간이 지나 풀렸다** (2시간) | 표식을 **안 단다** — **3.10 기본 안내가 이 경우를 위해 쓰인 문장**이다 |
 *
 * **⭐ 401 에 새 말을 만들지 않는 것이 핵심이다** (PM 판정). 403 은 **원인이 시간이
 * 아니라서** 갈았고, **401 은 원인이 정말 시간이다** — 여기서 새 문장을 지으면
 * **같은 사실을 두 곳에서 다르게 쓰는 것**이 된다.
 *
 * 종전에는 둘 다 3.8 의 한 줄(「이 계정으로는…」·「다시 로그인해 주세요.」)을 띄우고
 * **거기서 끝**이라, **막혔는데 나갈 길이 화면에 없었다** — ⑥⑦⑩ 과 같은 부류다.
 *
 * **어느 자리에서 풀리든 같다** — 목록·추가·재발급·삭제 넷이 이 한 갈래를 같이 쓴다.
 * **낱개로 고치면 다음 자리가 또 남는다.**
 */
function 로그인이풀렸다(e: unknown, 보낸다: (곳: string) => void): boolean {
  if (역할이다르다(e)) {
    보낸다(아이입장으로보낼곳);
    return true;
  }
  if (인증이풀렸다(e)) {
    보낸다("/parents/login");
    return true;
  }
  return false;
}

export function ChildrenPanel() {
  const router = useRouter();
  /** `null` 이면 아직 안 왔다. **빈 배열과 다르다** — 빈 배열은 「아이가 없다」다. */
  const [children, setChildren] = useState<ChildSummary[] | null>(null);
  const [목록실패, set목록실패] = useState<string | null>(null);

  const [nickname, setNickname] = useState("");
  const [ageBand, setAgeBand] = useState<CreateChildRequest["age_band"]>(11);
  const [보내는중, set보내는중] = useState(false);
  const [만들기실패, set만들기실패] = useState<string | null>(null);

  /** 되묻는 창을 띄울 대상. **`null` 이면 창이 아예 DOM 에 없다** — 아래 `DeleteChildDialog` 참고. */
  const [지울아이, set지울아이] = useState<ChildSummary | null>(null);
  const [지웠다, set지웠다] = useState<string | null>(null);

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
        // **형식 갖춘 거절은 `code` 로 고르고**(`문구.md` 3.8), **못 닿은 것만 3.5** 다.
        // **다만 401·403 은 문장이 아니라 화면 이동이다** — 로그인이 풀린 것이다 (3.11).
        if (로그인이풀렸다(e, (곳) => router.replace(곳))) return;
        if (e instanceof ApiError) {
          set목록실패(학부모오류문구(e.code));
          return;
        }
        if (e instanceof NetworkError) {
          set목록실패(못닿음.목록);
          return;
        }
        throw e;
      });

  useEffect(() => {
    // 한 번만 부른다. 이후 갱신은 만들기가 끝난 자리에서 직접 부른다.
    void 목록불러오기();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 한 번만 부른다. 아래 갱신은 만들기가 직접 부른다.
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
        별명: 만들어짐.nickname,
        code: 만들어짐.access_code,
        expiresAt: 만들어짐.access_code_expires_at,
      });
      setNickname("");
      await 목록불러오기();
    } catch (e) {
      if (로그인이풀렸다(e, (곳) => router.replace(곳))) return;
      if (e instanceof ApiError) {
        // **별명이 걸린 것만 종류를 말해 준다** (`문구.md` 3.4). 학부모는 다시 지어야 하는
        // 사람이라, 무엇이 걸렸는지 모르면 **같은 별명을 조금 바꿔 다시 넣는다.**
        const kind = (e.detail as { reason?: string; kind?: unknown } | undefined);
        const 걸림 =
          kind?.reason === "PII_DETECTED" ? 별명이걸렸다(kind.kind) : null;
        // **`detail` 을 먼저 본다** — 별명 PII 는 422 지만 **오류가 아니라 안내**다.
        // 아니면 3.8 표. **`message` 로 되돌아가지 않는다** — 되돌아가면 새 코드가 생길 때마다
        // 아이 목소리가 학부모 화면에 다시 샌다.
        set만들기실패(걸림 ?? 학부모오류문구(e.code));
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

  const 코드다시받기 = async (childId: string, 별명: string) => {
    set재발급중(childId);
    set재발급실패(null);
    try {
      const 새코드 = await apiPost<AccessCode>(
        `/parents/children/${childId}/access-code`,
        {},
      );
      set코드({
        childId,
        별명,
        code: 새코드.access_code,
        expiresAt: 새코드.access_code_expires_at,
      });
    } catch (e) {
      // **남의 자녀는 404 다**(403 이 아니다). 3.8 의 `NOT_FOUND` 가 **「찾으시는 정보가
      // 없습니다.」로 끝나는 이유**가 그것이다 — 「권한이 없습니다」로 쓰면
      // **「그 ID 는 존재한다」가 문구로 샌다.** 문구가 계약의 판단을 되돌리면 안 된다.
      if (로그인이풀렸다(e, (곳) => router.replace(곳))) return;
      if (e instanceof ApiError) {
        set재발급실패(학부모오류문구(e.code));
        return;
      }
      if (e instanceof NetworkError) {
        set재발급실패(못닿음.재발급);
        return;
      }
      throw e;
    } finally {
      set재발급중(null);
    }
  };

  /**
   * **되돌릴 수 없는 창을 열기 전에 한 번 묻는다** (2026-09-15, 결과 ⑩ · `문구.md` 3.11 ⚠).
   *
   * **2026-09-14 에 사용자가 확인창을 다 띄우고 「지우기」를 누른 뒤에야 403 을 만났다.**
   * 마음을 정하는 비용을 **다 치르고 나서** 안 된다는 말을 들은 것이고, **그 사이에
   * 「지워졌나?」를 모른다.** 열기 전에 물으면 **그 자리에서 로그인 화면으로 간다.**
   *
   * **이것만으로는 ⑩ 이 안 닫힌다** — 여기는 **삭제 자리 하나**를 막을 뿐이고,
   * 나머지 자리는 위 `아이가들어와서풀렸다` 가 받는다. **둘 다 해야 한다** (PM 판단).
   *
   * **못 닿으면 창을 연다.** 서버가 아무 말도 못 한 것을 「풀렸다」로 읽으면
   * **네트워크가 잠깐 끊긴 부모를 로그인 화면으로 쫓아내는 것**이 된다 — 그때는
   * 창 안에서 3.5 문장으로 받는 길이 이미 있다.
   */
  const 지우기전에확인 = async (아이: ChildSummary) => {
    try {
      await apiGet<ParentMe>("/parents/me");
    } catch (e) {
      if (로그인이풀렸다(e, (곳) => router.replace(곳))) return;
      // 그 밖의 거절·못닿음은 **창 안이 이미 처리한다.** 여기서 두 번 말하지 않는다.
    }
    set지울아이(아이);
  };

  /**
   * 지워진 뒤. **여기서 서버를 부르지 않는다** — 부른 것은 창 안이고 여기는 뒷정리다.
   */
  const 지워졌다 = async (지운아이: ChildSummary) => {
    set지웠다(지우기.지웠다(지운아이.nickname));
    // **방금 발급된 코드가 그 아이 것이면 같이 지운다.** 아래 「목록에 안 붙은 코드」 자리는
    // **목록에 없는 것**을 조건으로 뜨는데, 지워진 아이가 정확히 그 조건에 걸린다 —
    // 놔두면 **이미 파기된 아이의 접속 코드를 화면이 계속 띄운다.**
    set코드((지금) => (지금?.childId === 지운아이.child_id ? null : 지금));
    await 목록불러오기();
  };

  const 아이가있다 = children !== null && children.length > 0;
  const 첫아이를만든다 = children !== null && children.length === 0;
  /**
   * **목록 틀을 언제 보이나.**
   *
   * ⛔ 종전에는 「아이가 있거나 목록을 못 불렀을 때」였다. 그래서 **마지막 아이를 지우면
   * 「지웠어요」가 그 틀과 함께 통째로 사라졌다** — 지웠다는 말이 목록 안에 들어 있는데
   * 목록이 비면 목록이 안 그려지기 때문이다.
   *
   * **그게 이 검사가 막으려던 바로 그 상황이다** — 「목록에서 사라지는 것으로 대신하지 않는다」.
   * 아이가 하나뿐인 부모에게는 그 한 줄이 **성공과 실패를 가르는 유일한 신호**다.
   */
  const 목록틀을보인다 = 아이가있다 || 목록실패 !== null || 지웠다 !== null;

  return (
    <section className={`children-layout${첫아이를만든다 && !목록틀을보인다 ? " children-layout--empty" : ""}`}>
      {/* ⛔ **바깥 목록 틀을 걷었다** (2026-09-21 사용자 지시).
          종전에는 `account-card` 하나가 아이 카드들을 통째로 감쌌고, 그래서
          **상자 안에 상자**가 되어 설정표처럼 읽혔다. 이제 **아이 한 명이 카드 하나**다.
          목록 제목(「아이 목록」)도 같이 걷었다 — 위에 페이지 제목이 있고
          **카드마다 이름이 있어** 카드가 되풀이되는 모양만으로 목록인 것이 읽힌다. */}
      {목록틀을보인다 && (
        <div className="children-list-section">
        {목록실패 !== null && <p data-목록실패 role="alert" className="account-feedback">{목록실패}</p>}

        {아이가있다 && (
          <ul className="children-list">
            {children.map((아이) => (
              <li
                key={아이.child_id}
                data-자녀
                className="child-card"
              >
                {/* **이름이 카드에서 가장 먼저 보이는 정보다.** 나이는 그 아래 한 단 작게 둔다.
                    ⛔ 종전 「현이 · 만 11세」는 가운뎃점으로 둘을 같은 줄에 붙여 놔서
                    **위계가 안 보였고**, 나이가 이름과 거의 같은 무게로 읽혔다
                    (2026-09-21 사용자 지적). **아이콘·아바타는 새로 넣지 않는다** — 같은 지시다. */}
                <div className="child-summary">
                  <p className="child-name">{아이.nickname}</p>
                  <p className="child-age">
                    {나이선택.find((n) => n.값 === 아이.age_band)?.글자}
                  </p>
                </div>

                {/* **경고가 버튼 옆이다. 누른 뒤가 아니다** (`문구.md` 3.4) —
                    재발급이 `token_version` 을 올려 **아이가 쓰던 태블릿이 끊긴다.**
                    **되돌릴 수 없는 실수가 이제 둘이고 장치가 다르다**(3.9) — 이건 버튼 옆
                    한 줄이고 아래 지우기는 창이다. **끊기는 것이 기기냐 책이냐**로 갈렸다. */}
                <div className="child-access-actions">
                  {/* ⛔ **제목(「접속 코드 관리」)을 걷었다** — 별도 관리 메뉴처럼 보였고
                      아이마다 되풀이됐다. **아래 한 줄이 이미 그 몫을 한다**:
                      무엇을 하는 버튼인지와 그 대가를 같이 말한다. */}
                  <p className="account-description">{재발급.경고}</p>
                  <button
                    type="button"
                    disabled={재발급중 === 아이.child_id}
                    onClick={() => void 코드다시받기(아이.child_id, 아이.nickname)}
                    className="pressable action-secondary self-start"
                  >
                    {재발급.버튼}
                  </button>
                </div>

                {코드 !== null && 코드.childId === 아이.child_id && (
                  <AccessCodePanel 코드={코드} />
                )}

                {/* **여기는 경고를 안 적는다. 되묻는 창이 그 몫을 한다** (`문구.md` 3.9) —
                    위 재발급과 굵기가 갈리는 자리다. 재발급은 끊기는 것이 **기기**라
                    버튼 옆 한 줄로 됐고, 이것은 **책이 사라져서** 창을 띄운다.
                    **둘을 같은 굵기로 두면 무거운 쪽이 가벼워 보인다.**
                    버튼이 맨 글자인 것은 나가기(2.3)와 같은 이유다 — 자리로 조용하게 두되
                    **글자를 작게 만들지 않는다**(본문 16px 이상이 MUST). */}
                <div className="child-danger-actions">
                  <button
                    type="button"
                    data-지우기
                    onClick={() => {
                      // 지난번 「지웠어요」가 남아 있으면 지운다 — 다음 아이를 지우려는데
                      // 앞 아이의 완료 문장이 떠 있으면 **무엇이 방금 일어난 것인지 갈린다.**
                      set지웠다(null);
                      void 지우기전에확인(아이);
                    }}
                    className="pressable action-secondary child-delete"
                  >
                    {지우기.버튼}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {재발급실패 !== null && <p data-재발급실패 role="alert" className="account-feedback">{재발급실패}</p>}

        {/* **지운 뒤에 한 줄 말한다.** 목록에서 사라지는 것만으로는 성공과 실패가
            구분되지 않는다 — 못 닿아서 안 지워진 것도 화면에서는 비슷하게 보인다. */}
        {지웠다 !== null && <p data-지웠다 role="status" className="account-feedback">{지웠다}</p>}
        </div>
      )}

      <form
        className="account-card child-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (nickname.trim() !== "" && !보내는중) void 추가하기();
        }}
      >
        <div className="child-create-heading">
          <h2 className="account-section-title">{만들기.제목}</h2>
          {/* 이름을 실제 이름과 별명 중 무엇으로 할지, 입력 전에 부모가 고를 수 있게 한다. */}
          <p className="account-description">{만들기.안내}</p>
        </div>

        <label className="account-field">
          <span className="field-label">{만들기.별명}</span>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
            className="form-field"
          />
        </label>

        <label className="account-field">
          <span className="field-label">{만들기.나이}</span>
          {/* **선택지가 셋뿐인 것은 계약이 닫아 둔 것이다** (`age_band ∈ {10,11,12}`).
              자유 입력으로 두면 타깃 밖 나이가 들어오고 서버가 422 로 되돌려준다. */}
          <select
            value={ageBand}
            onChange={(e) =>
              setAgeBand(Number(e.target.value) as CreateChildRequest["age_band"])
            }
            className="form-field"
          >
            {나이선택.map(({ 값, 글자 }) => (
              <option key={값} value={값}>
                {글자}
              </option>
            ))}
          </select>
        </label>

        {만들기실패 !== null && <p data-만들기실패 role="alert" className="account-feedback">{만들기실패}</p>}

        <button
          type="submit"
          disabled={nickname.trim() === "" || 보내는중}
          className="pressable action-primary account-submit"
        >
          {만들기.버튼}
        </button>
      </form>

      {/* **창은 열릴 때 새로 만들어진다.** 상태를 바꾸고 곧바로 `showModal()` 을 부르면
          **한 프레임 동안 앞 아이의 별명이 제목에 뜬다** — 되돌릴 수 없는 것에서
          대상이 잠깐이라도 다른 아이로 보이면 안 된다. 마운트 뒤에 여는 이유다. */}
      {지울아이 !== null && (
        <DeleteChildDialog
          아이={지울아이}
          닫기={() => set지울아이(null)}
          지워졌다={지워졌다}
        />
      )}

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
    // **`role="status"` 다** (2026-09-21). 새 코드는 **버튼을 누른 뒤 화면 중간에 조용히 생긴다** —
    // 화면을 못 보는 부모에게는 **아무 일도 안 일어난 것과 같다.** 되묻는 창처럼 초점을
    // 뺏지는 않는다(코드를 읽는 중일 수 있다) — **읽어 주기만 한다.**
    <div data-접속코드 role="status" className="access-code-panel">
      <p className="access-code-title">{접속코드.제목(코드.별명)}</p>

      {/* ⛔ **여섯 자를 붙여서 그대로 보여준다** (2026-09-21 사용자 지시).
          한때 **앞뒤 세 자리씩 나눠 여백으로 벌렸는데 사용자가 요청한 적이 없어 되돌렸다.**
          불러주기 쉬우라고 넣은 것이었지만 **확인된 필요가 아니라 추측이었다.**
          ⛔ **다시 나누지 않는다** — 화면이 달라지는 것은 사용자가 정한다.

          읽어 줄 때는 **한 자씩** 불러야 해서 `aria-label` 을 따로 준다 —
          안 주면 「팔십육만 칠천삼백일」로 읽힌다. */}
      <p className="access-code-value" aria-label={[...코드.code].join(" ")}>
        {코드.code}
      </p>

      {/* **무엇을 하면 무슨 일이 일어나는지 먼저 말한다.**
          ⛔ **뒤에 붙어 있던 「같은 주소」 한 줄을 걷었다** (2026-09-21 사용자 판정,
          `문구.md` 3.4). 그 줄이 09-15 에 막으려던 것은 **「아이가 어디서 코드를 넣는지
          부모가 모른다」**였는데(`adr/0014`), **이 한 줄이 그것을 더 곧장 말한다** —
          「같은 주소」가 **어떤 주소인지 알 수 없었고**, 위에서는 아이에게 코드를 알려 주라
          하고 아래에서는 **부모가 직접 넣으라는 것처럼 읽혔다.** 자리를 없앤 것이 아니라
          **그 자리가 하던 일을 더 나은 문장이 맡은 것이다.** */}
      <p className="access-code-instruction">{접속코드.쓰는법}</p>

      {/* **본 그 순간에 말한다.** 나중에 다시 열어보려 하는 것이 실제 실패 모드다. */}
      <p className="access-code-validity">{접속코드.한번만}</p>
    </div>
  );
}

/**
 * 자녀 지우기 되묻는 창 (`문구.md` **3.9** · COPPA).
 *
 * **이름이 영문인 것은 훅 이름과 같은 제약이다** (`web/CLAUDE.md` 「이 패키지의 관례」) —
 * `react-hooks/rules-of-hooks` 가 **컴포넌트 이름을 대문자로 검사하는데 한글에는 대문자가 없어**
 * 한글 이름의 컴포넌트 안에서는 훅을 아예 못 쓴다. **규칙의 예외가 아니라 도구의 제약이다.**
 *
 * **`LeaveButton`(2.3)과 같은 네이티브 `<dialog>` 다** — 포커스 가둠·`Esc`·배경 비활성이
 * 공짜로 따라오고, **`Esc` 로 닫히는 것이 안전한 방향**이다.
 * **여기서는 그 규칙이 더 세다**: 나가기는 다시 들어오면 되고 **이것은 아무것도 안 돌아온다.**
 *
 * **열릴 때마다 새로 마운트된다.** 부모가 `지울아이 !== null` 일 때만 그리므로
 * 지난번 실패·진행 상태가 딸려오지 않고, **제목의 별명이 항상 이번 아이 것**이다.
 */
function DeleteChildDialog({
  아이,
  닫기,
  지워졌다,
}: {
  아이: ChildSummary;
  닫기: () => void;
  지워졌다: (아이: ChildSummary) => Promise<void>;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const 제목id = useId();
  const [지우는중, set지우는중] = useState(false);
  const [실패, set실패] = useState<string | null>(null);

  useEffect(() => {
    // 마운트된 뒤에 연다. **내용이 먼저 그려져 있다.**
    dialog.current?.showModal();
  }, []);

  const 지운다 = async () => {
    set지우는중(true);
    set실패(null);
    try {
      await apiDelete(`/parents/children/${아이.child_id}`);
    } catch (e) {
      // **닿지 못하면 아이 데이터가 그대로 남아 있다. 지운 척하지 않는다** —
      // 창도 안 닫는다. 닫으면 목록이 그대로인 것을 보고 **왜 안 지워졌는지 모른다.**
      // **창을 열 때는 살아 있었는데 누르는 사이에 아이가 들어왔을 수 있다** (3.11).
      // 열기 전 확인이 그 틈을 못 막는다 — **그래서 여기도 같은 갈래로 보낸다.**
      if (로그인이풀렸다(e, (곳) => router.replace(곳))) return;
      if (e instanceof ApiError) {
        // **`message` 를 쓰지 않는다** — 아이 목소리다. `code` 로 3.8 표에서 고른다.
        set실패(학부모오류문구(e.code));
        return;
      }
      if (e instanceof NetworkError) {
        set실패(못닿음.삭제);
        return;
      }
      throw e;
    } finally {
      set지우는중(false);
    }

    // **뒷정리를 먼저 하고 닫는다.** 닫으면 이 컴포넌트가 사라진다.
    await 지워졌다(아이);
    닫기();
  };

  return (
    <dialog
      ref={dialog}
      data-삭제확인
      aria-labelledby={제목id}
      // `Esc` 와 「그대로 두기」가 둘 다 여기로 온다. **닫히는 방향이 안전한 쪽**이다.
      onClose={닫기}
      className="account-dialog"
    >
      <div className="flex flex-col gap-5">
        {/* **별명을 제목에 넣는다** — 자녀가 여럿일 때 목록 위치로만 구분되면 잘못 누른다. */}
        <h2 id={제목id} className="account-section-title">{지우기.제목(아이.nickname)}</h2>

        <div className="flex flex-col gap-2">
          {/* **무엇이 사라지는지 세어서 말한다** — 서버가 글·그림·책·기록을 함께 지운다.
              **되돌릴 수 없다는 말이 같은 문장 안에 있다** (2026-09-21) — 종전에는 별도 줄이었는데
              **세어서 말한 바로 그 문장에 붙어 있어야** 무엇을 못 되돌리는지가 붙는다. */}
          <p className="font-semibold">{지우기.사라진다(아이.nickname)}</p>
          <p className="account-description">{지우기.기기도}</p>
        </div>

        {실패 !== null && <p data-삭제실패 role="alert" className="account-feedback">{실패}</p>}

        {/* **머무는 쪽이 DOM 에서 먼저다.** `<dialog>` 가 첫 포커스 가능 요소에 포커스를 주므로
            **되돌릴 수 없는 쪽에 포커스가 앉지 않는다.** */}
        <div className="account-dialog-actions">
          <form method="dialog">
            {/* `method="dialog"` 라 **서버를 부르지 않고 창만 닫는다.** */}
            <button
              type="submit"
              className="pressable action-secondary"
            >
              {지우기.그대로둔다}
            </button>
          </form>

          {/* **`type="button"` 이어야 한다.** 기본 `submit` 로 두면 나중에 폼 안으로 옮겨졌을 때
              **아무 말 없이 창만 닫는다.** */}
          <button
            type="button"
            data-지운다
            disabled={지우는중}
            onClick={() => void 지운다()}
            className="pressable action-primary"
          >
            {지우기.지운다}
          </button>
        </div>
      </div>
    </dialog>
  );
}
