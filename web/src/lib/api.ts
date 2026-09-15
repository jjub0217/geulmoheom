import { 못닿음원인 } from "@/lib/unreachable";

/**
 * api 호출의 유일한 입구.
 *
 * 계약은 `docs/api/공통규약.md`. 여기서 지키는 것 셋 —
 * ① **쿠키 인증**이므로 모든 요청에 `credentials: "include"` 를 붙인다.
 *    붙이지 않으면 cross-origin 요청에 쿠키가 아예 안 실린다 (web ↔ api 는 same-site 지만 오리진이 다르다).
 *    **이제 이것이 유일한 인증 수단이다** — 서버는 `Authorization` 을 아예 안 본다
 *    (`types.gen.ts` 의 인증 엔드포인트가 전부 `header?: never`).
 * ② 오류는 `{ error: { code, message, detail } }` 한 형식이다. `message` 는 **아이가 읽는 문구**라
 *    화면이 그대로 쓴다 — 프론트가 문구를 지어내지 않는다.
 * ③ **요청·응답 body 를 로그에 남기지 않는다.** 입력 body 에 아이 원문이 실린다 (PRD 1.1b).
 *    실패해도 `console.error(res)` 같은 것을 하지 않는다.
 */

/**
 * api 주소. **기본값을 두지 않는다.**
 *
 * 값이 박혀 있으면 `.env` 를 안 채워도 도는 것처럼 보이고, **그 임시값이 사실상의 결정이 된다**
 * (`api/app/config.py` 56행과 같은 원칙). 실제로 이름이 `NEXT_PUBLIC_API_BASE` 로 어긋나 있었는데도
 * 기본값이 받아주는 바람에 **아무도 몰랐다** — 개발이 https `.test` 로 옮겨갔다면 그 순간
 * **mixed content** 가 되어 화면에는 「서버에 못 닿음」으로만 보였을 것이다.
 *
 * 개발 주소를 기본값으로 박는 것도 답이 아니다. `.test` 주소는 **그럴듯해 보여서**
 * 운영 번들에 실려도 배포된 뒤에나 드러난다 — `localhost` 보다 나쁘다.
 *
 * **이름은 `web/README.md` 42행과 저장소 루트 `.env` 가 정본이다.** `web/` 에 두 번째 `.env` 를
 * 만들지 않는다 — 값이 갈린다. 개발은 `make dev-web` 이 루트 `.env` 에서 이 한 줄만 넘겨준다.
 */
function baseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL 이 비어 있다. `make dev-web` 이 저장소 루트 .env 에서 넘겨준다.",
    );
  }
  return base;
}

/** 서버가 형식을 갖춰 돌려준 실패. `message` 는 아이에게 그대로 보여도 되는 문구다. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    /**
     * **서버가 준 문구.** 이름이 「누가 읽는가」가 아니라 **「어디서 왔는가」**다 —
     * 한때 `childMessage` 였는데 **그 이름이 학부모 화면에서 틀렸다**: 같은 값이
     * 두 화면에 나가는데 이름이 한쪽만 가리켜, **학부모 화면이 그대로 쓰는 것을
     * 아무도 이상하게 안 봤다** (`문구.md` 3.8, 2026-09-08).
     *
     * **아이 화면은 이 값을 그대로 쓴다** (2.1 의 `CHILD_MESSAGE` 가 아이 목소리다).
     * **학부모 화면은 이 값을 쓰지 않는다** — `code` 로 3.8 표에서 고른다.
     */
    readonly 서버문구: string,
    readonly status: number,
    readonly detail?: Record<string, unknown>,
  ) {
    // Error.message 는 개발자용이다. 화면에는 위 `서버문구` 를 쓴다 (학부모 화면은 `code`).
    super(`${code} (${status})`);
    this.name = "ApiError";
  }
}

/** 서버에 닿지도 못한 경우. 아이에게 보여줄 문구가 **서버에서 오지 않으므로** 화면이 정한다. */
export class NetworkError extends Error {
  readonly name = "NetworkError";

  /**
   * **의심 순서. 개발 빌드에서만 채워진다** — 운영 번들에서는 빈 배열이라 아이 화면에 아무것도 안 나온다.
   * 실패한 `fetch` 의 예외는 어느 원인이든 사실상 같은 문자열이라 **예외로는 구분할 수 없다.**
   */
  constructor(
    path: string,
    readonly hints: string[] = [],
  ) {
    super(path);
  }
}

/** 개발 빌드에서만 원인을 좁힌다. 운영에서는 이 함수가 통째로 빈 배열이다. */
function 못닿은이유(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  if (typeof location === "undefined") return [];
  return 못닿음원인(baseUrl(), location.origin);
}

/**
 * **인증이 풀렸다 (401).** 쿠키가 없거나 만료됐다 — 다시 들어와야 한다.
 *
 * 아래 `역할이다르다` 와 **반드시 갈라서 다룬다.**
 */
export function 인증이풀렸다(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

/**
 * **인증은 됐는데 역할이 다르다 (403 `FORBIDDEN_ROLE`).**
 *
 * 쿠키 이름이 `__Host-gm_parent` · `__Host-gm_child` 로 나뉘어 있어, **자녀 쿠키로 학부모 API 를
 * 부르면 여기로 온다**(반대도 같다). **401 로 뭉뚱그리면 로그인이 풀린 줄 알고 다시 로그인시킨다** —
 * 역할 문제지 인증 문제가 아니다 (`docs/api/공통규약.md`).
 */
export function 역할이다르다(e: unknown): boolean {
  return e instanceof ApiError && e.status === 403;
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

/**
 * **본문에 아이 원문이 실린다** — `apiPost` 와 같은 이유로 body 를 어디에도 남기지 않는다.
 * **책 이름도 아이가 쓰는 문장이다** (`PATCH /book`): 서버가 본문과 **같은 자리에서 PII 를
 * 가리고**(`3dc4bd5`) 그 결과가 **표지에 인쇄된다.**
 *
 * **`apiPost` 를 재사용하지 않는다.** 메서드만 다른 게 아니라 **뜻이 다르다** —
 * `PATCH` 는 부분 갱신이라 **보낸 필드만 바뀐다**는 약속이 붙는다. 한 함수에 메서드를
 * 인자로 받게 만들면 부르는 쪽에서 그 약속이 안 보인다.
 */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * 본문 없이 부르는 POST. **로그아웃 두 개가 이 형태다** (`/parents/logout` · `/child/logout`).
 *
 * `Content-Type` 을 안 붙인다 — 보낼 본문이 없고, 붙이면 **불필요한 preflight** 가 생긴다.
 * **쿠키는 실린다**(`credentials: "include"`). 서버는 그 쿠키를 보고 무엇을 지울지 안다.
 *
 * **여기에 401 처리를 태우지 않는다.** 쿠키가 없어도 서버가 204 를 준다 —
 * 만료·손상된 쿠키를 지우려는 것이 로그아웃인데 인증을 걸면 **정작 지워야 할 상태에서만 막힌다.**
 */
export async function apiPostNoBody(path: string): Promise<void> {
  await request<void>(path, { method: "POST" });
}

/**
 * 본문 없이 부르는 DELETE. **지금은 자녀 파기 하나뿐이다** (`DELETE /parents/children/{id}`).
 *
 * **204 라 본문이 없다** — `request` 가 그 자리를 이미 안다. 파싱하려 들면
 * **성공이 실패로 둔갑한다.**
 *
 * **`apiPostNoBody` 와 달리 401 을 삼키지 않는다.** 로그아웃은 「쿠키가 없어도 성공」이지만
 * 파기는 아니다 — **인증이 풀린 채로 지운 척하면 아이 데이터가 남는다.**
 */
export async function apiDelete(path: string): Promise<void> {
  await request<void>(path, { method: "DELETE" });
}

/**
 * **식은 서버를 깨운다** (`src/lib/wake.ts` 에 이유가 있다 · `주차계획/W6.md` 15번).
 *
 * **⛔ 위 `api*` 들과 다른 함수인 것이 요점이다.** 그것들은 **응답을 읽고 오류를 던진다** —
 * 그러면 화면이 그 오류를 그린다. **이건 깨우기라 응답을 안 보고 예외도 삼킨다.**
 * **502 로 죽는 것이 정상 경로**다 (앞단이 기다려 주는 시간보다 기동이 길다).
 *
 * **⛔ 주소가 `/api/v1` 밖이다.** 이 하나만 **api 루트의 `/healthz`** 이고,
 * 운영에서는 `vercel.json` 의 rewrite 가, 로컬에서는 `e2e/_서버하네스.mjs` 가 같은 모양으로 넘긴다.
 * **`/api/v1/healthz` 는 없다** — 그쪽으로 쳐도 서버는 깨지만 **없는 주소를 부르는 코드는
 * 다음 사람이 오타로 읽는다.**
 *
 * **아무것도 돌려주지 않는다** — 부르는 쪽이 기다릴 이유가 없다.
 */
export function apiWake(): void {
  // **`credentials` 를 안 싣는다.** 깨우기에 쿠키가 갈 이유가 없다.
  void fetch("/healthz", { method: "GET", cache: "no-store" }).catch(() => {
    // **삼킨다.** 실패가 정상 경로이고, 여기서 남기면 **아이 화면에 오류가 생긴다.**
  });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  // **try 밖에서 만든다.** 안에서 던지면 아래 catch 가 NetworkError 로 덮어써서
  // 「설정이 없다」가 「서버에 못 닿음」으로 둔갑한다 — 원인을 삼키는 그 모양 그대로다.
  const url = `${baseUrl()}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "include",
      headers: { Accept: "application/json", ...init.headers },
    });
  } catch {
    // 원인 객체를 싣지 않는다 — 요청 정보가 오류 리포터로 흘러가는 경로를 만들지 않는다.
    throw new NetworkError(path, 못닿은이유());
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

  // **204 는 본문이 없다** (`POST /events`). 파싱하려 들면 던져서, 성공이 실패로 둔갑한다.
  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
}
