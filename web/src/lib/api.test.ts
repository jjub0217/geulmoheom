import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  NetworkError,
  apiGet,
  apiPost,
  apiPostNoBody,
  역할이다르다,
  인증이풀렸다,
} from "./api";

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  // **기본값이 없다.** 주소는 언제나 환경에서 온다 — 테스트도 예외가 아니다.
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://localhost:8000/api/v1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("apiPost", () => {
  it("204 는 본문이 없다 — 파싱하려 들면 성공이 실패로 둔갑한다", async () => {
    // `POST /events` 가 204 다 (`docs/api/Stage0.md` 7절). 여기서 죽으면
    // 이벤트가 조용히 실패한 것처럼 보이고, 원인은 응답이 아니라 우리 파서에 있다.
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));

    await expect(
      apiPost("/events", { events: [] }),
    ).resolves.toBeUndefined();
  });
});

describe("api 주소", () => {
  it("`NEXT_PUBLIC_API_BASE_URL` 에서 온다 — 이름이 어긋나면 조용히 localhost 로 떨어진다", async () => {
    // 개발 환경이 https `.test` 로 옮겨간 뒤에는 이 falling back 이 **mixed content** 가 되어
    // 브라우저가 요청을 막고, 화면에는 「서버에 못 닿음」으로만 보인다 — 원인이 안 드러난다.
    // 이름은 `web/README.md` 42행과 저장소 루트 `.env` 가 쓰는 것이 정본이다.
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.geulmoheom.test:8000/api/v1");

    const fetchMock = vi.fn<typeof fetch>(async () => respond(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await apiGet("/cards/next");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.geulmoheom.test:8000/api/v1/cards/next",
    );
  });

  it("값이 없으면 조용히 넘어가지 않고 그 자리에서 죽는다", async () => {
    // **기본값을 두지 않는 이유다.** 값이 박혀 있으면 `.env` 를 안 채워도 도는 것처럼 보이고,
    // 그 임시값이 사실상의 결정이 된다 (`api/app/config.py` 56행과 같은 원칙).
    // 개발 주소가 운영 번들에 실려도 `.test` 는 그럴듯해 보여 배포 뒤에나 드러난다.
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");

    const fetchMock = vi.fn<typeof fetch>(async () => respond(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("/cards/next")).rejects.toThrow(/NEXT_PUBLIC_API_BASE_URL/);
    // 요청을 **보내기 전에** 죽는다. `undefined/cards/next` 같은 곳을 부르지 않는다.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("apiGet", () => {
  it("쿠키를 실어 보낸다 — 안 붙이면 인증이 통째로 없는 것과 같다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      respond(200, { card_id: "c01" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiGet("/cards/next");

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "include",
    });
  });

  it("오류 봉투를 ApiError 로 바꾼다 — message 는 아이가 읽을 문구다", async () => {
    vi.stubGlobal("fetch", async () =>
      respond(409, {
        error: { code: "DAILY_CAP_REACHED", message: "오늘 카드를 다 썼어요" },
      }),
    );

    const e = await apiGet("/cards/next").catch((err: unknown) => err);

    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({
      code: "DAILY_CAP_REACHED",
      서버문구: "오늘 카드를 다 썼어요",
      status: 409,
    });
  });

  it("detail 을 버리지 않는다 — 소진 응답의 가이드 대사가 여기 실려 온다", async () => {
    vi.stubGlobal("fetch", async () =>
      respond(409, {
        error: {
          code: "DAILY_CAP_REACHED",
          message: "오늘 카드를 다 썼어요",
          detail: {
            guide: { expression: "session_end", line: "내일 또 보자" },
          },
        },
      }),
    );

    const e = (await apiGet("/cards/next").catch((err: unknown) => err)) as ApiError;

    expect(e.detail).toEqual({
      guide: { expression: "session_end", line: "내일 또 보자" },
    });
  });

  it("형식이 아닌 실패 응답도 삼키지 않는다", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>502</html>", { status: 502 }));

    const e = (await apiGet("/x").catch((err: unknown) => err)) as ApiError;

    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("INTERNAL_ERROR");
    expect(e.서버문구).toBe("");
  });

  it("서버에 닿지 못한 것과 서버가 거절한 것을 구분한다", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const e = await apiGet("/cards/next").catch((err: unknown) => err);

    expect(e).toBeInstanceOf(NetworkError);
    expect(e).not.toBeInstanceOf(ApiError);
  });

  it("헤더 값에 ASCII 만 넣는다 — 한글이 들어가면 요청이 나가지도 못한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => respond(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await apiGet("/cards/next");

    const headers = (fetchMock.mock.calls[0][1]?.headers ?? {}) as Record<
      string,
      string
    >;
    for (const value of Object.values(headers)) {
      // 브라우저는 ISO-8859-1 을 벗어난 헤더 값을 보면 fetch 단계에서 TypeError 를 던진다.
      // 화면에는 「서버에 못 닿음」으로만 보여서 원인을 찾기 어렵다 — 실제로 한 번 당했다.
      expect(value).toMatch(/^[\x00-\xFF]*$/);
    }
  });
});

/**
 * **401 과 403 은 다른 일이다** (`공통규약.md` `e50d8a8`).
 *
 * 쿠키 이름이 학부모·자녀로 나뉘어 **「인증은 됐는데 역할이 다른」 상태가 실재한다.**
 * 403 을 401 로 뭉뚱그리면 **로그인이 풀린 줄 알고 다시 로그인시킨다** — 역할 문제지 인증 문제가 아니다.
 */
describe("401 과 403 을 가른다", () => {
  const 오류 = (status: number, code: string) =>
    new ApiError(code, "서버가 준 문구", status);

  it("401 은 인증이 풀린 것이다", () => {
    expect(인증이풀렸다(오류(401, "UNAUTHORIZED"))).toBe(true);
    expect(역할이다르다(오류(401, "UNAUTHORIZED"))).toBe(false);
  });

  it("403 은 역할이 다른 것이다 — 다시 로그인시키지 않는다", () => {
    expect(역할이다르다(오류(403, "FORBIDDEN_ROLE"))).toBe(true);
    expect(인증이풀렸다(오류(403, "FORBIDDEN_ROLE"))).toBe(false);
  });

  it("다른 실패는 둘 다 아니다", () => {
    expect(인증이풀렸다(오류(409, "DAILY_CAP_REACHED"))).toBe(false);
    expect(역할이다르다(오류(409, "DAILY_CAP_REACHED"))).toBe(false);
    expect(인증이풀렸다(new NetworkError("/cards/next"))).toBe(false);
    expect(역할이다르다(new NetworkError("/cards/next"))).toBe(false);
  });
});

describe("apiPostNoBody", () => {
  it("본문도 Content-Type 도 안 붙인다 — 로그아웃은 보낼 것이 없다", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiPostNoBody("/parents/logout")).resolves.toBeUndefined();

    const init = fetchMock.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    // `Content-Type: application/json` 을 붙이면 **불필요한 preflight** 가 생긴다
    // (`미결11-2 프론트 조사` 「프론트가 할 일」). 보낼 본문이 없으니 붙일 이유도 없다.
    expect(JSON.stringify(init.headers)).not.toContain("Content-Type");
    // 쿠키가 유일한 인증 수단이다 — 여기서도 실려야 서버가 무엇을 지울지 안다.
    expect(init.credentials).toBe("include");
  });

  it("쿠키가 없어도 실패로 다루지 않는다 — 서버가 204 를 준다", async () => {
    // **로그아웃에 401 처리를 태우지 않는다.** 만료·손상된 쿠키를 지우려는 것이 로그아웃인데,
    // 인증을 걸면 **정작 지워야 할 상태에서만 막힌다** (`공통규약.md`).
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    await expect(apiPostNoBody("/parents/logout")).resolves.toBeUndefined();
  });
});
