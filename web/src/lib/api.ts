/**
 * api 호출의 유일한 입구.
 *
 * 계약은 `docs/api/공통규약.md`. 여기서 지키는 것 셋 —
 * ① **쿠키 인증**이므로 모든 요청에 `credentials: "include"` 를 붙인다.
 *    붙이지 않으면 cross-origin 요청에 쿠키가 아예 안 실린다 (web ↔ api 는 same-site 지만 오리진이 다르다).
 * ② 오류는 `{ error: { code, message, detail } }` 한 형식이다. `message` 는 **아이가 읽는 문구**라
 *    화면이 그대로 쓴다 — 프론트가 문구를 지어내지 않는다.
 * ③ **요청·응답 body 를 로그에 남기지 않는다.** 입력 body 에 아이 원문이 실린다 (PRD 1.1b).
 *    실패해도 `console.error(res)` 같은 것을 하지 않는다.
 */

const BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api/v1";

/**
 * **목 서버 전용, 곧 사라진다.**
 *
 * 계약은 이미 HttpOnly 쿠키로 확정됐지만(미결 11-2), 목 서버는 아직 `Authorization: Bearer` 를 본다
 * (`api/app/api/v1/deps.py` — 존재 여부만 확인한다). W3 E-3/E-4 에서 서버가 쿠키로 바뀌면
 * **이 함수만 지운다.** `credentials: "include"` 는 그때도 그대로 남는다.
 */
function mockAuthHeader(): Record<string, string> {
  if (process.env.NODE_ENV === "production") return {};
  // **ASCII 만 쓴다.** 헤더 값은 ISO-8859-1 이라 한글이 들어가면 fetch 가 요청도 보내지 못하고
  // 그 자리에서 TypeError 를 던진다 — 화면은 「서버에 못 닿음」으로 떨어지고 원인은 안 보인다.
  const token = process.env.NEXT_PUBLIC_MOCK_TOKEN ?? "mock-token-dev";
  return { Authorization: `Bearer ${token}` };
}

/** 서버가 형식을 갖춰 돌려준 실패. `message` 는 아이에게 그대로 보여도 되는 문구다. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    /** 아이가 읽는 문구. 서버가 준 것이다 — 화면에서 바꾸지 않는다. */
    readonly childMessage: string,
    readonly status: number,
    readonly detail?: Record<string, unknown>,
  ) {
    // Error.message 는 개발자용이다. 아이 화면에는 childMessage 를 쓴다.
    super(`${code} (${status})`);
    this.name = "ApiError";
  }
}

/** 서버에 닿지도 못한 경우. 아이에게 보여줄 문구가 **서버에서 오지 않으므로** 화면이 정한다. */
export class NetworkError extends Error {
  readonly name = "NetworkError";
}

type ErrorEnvelope = {
  error?: { code?: string; message?: string; detail?: Record<string, unknown> };
};

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

/**
 * **본문에 아이 원문이 실린다.** 그래서 이 함수는 요청 body 를 어디에도 남기지 않는다 —
 * 실패해도 응답만 읽고 버린다 (PRD 1.1b).
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: { Accept: "application/json", ...mockAuthHeader(), ...init.headers },
    });
  } catch {
    // 원인 객체를 싣지 않는다 — 요청 정보가 오류 리포터로 흘러가는 경로를 만들지 않는다.
    throw new NetworkError(path);
  }

  if (!res.ok) {
    let envelope: ErrorEnvelope = {};
    try {
      envelope = (await res.json()) as ErrorEnvelope;
    } catch {
      // 형식이 아닌 응답(프록시 오류 페이지 등). 코드만 남기고 넘어간다.
    }
    throw new ApiError(
      envelope.error?.code ?? "INTERNAL_ERROR",
      envelope.error?.message ?? "",
      res.status,
      envelope.error?.detail,
    );
  }

  return (await res.json()) as T;
}
