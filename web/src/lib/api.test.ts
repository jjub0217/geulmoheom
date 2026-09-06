import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, NetworkError, apiGet } from "./api";

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
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
      childMessage: "오늘 카드를 다 썼어요",
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
    expect(e.childMessage).toBe("");
  });

  it("서버에 닿지 못한 것과 서버가 거절한 것을 구분한다", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const e = await apiGet("/cards/next").catch((err: unknown) => err);

    expect(e).toBeInstanceOf(NetworkError);
    expect(e).not.toBeInstanceOf(ApiError);
  });
});
