"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import { BookPageFrame } from "@/components/book-page";
import { 끊겨서보낼곳 } from "@/lib/kicked";
import { BookTitle } from "@/components/book-title";
import { ApiError, NetworkError, apiGet, 인증이풀렸다 } from "@/lib/api";

import { 버튼, 못닿음 } from "../copy";
import { 상태표시 } from "../status-copy";
import { 빈책, 지은이 } from "./copy";

type Book = components["schemas"]["Book"];

/**
 * 내 책 (백로그 A0-4).
 *
 * **비전 2장이 파는 것이 이 화면이다** — 쓰기는 수단이고 **책과 독자가 목적**이다.
 * 결과 화면이 「이 장면이 네 책에 남아」라고 말한 그 책이 여기 있다.
 *
 * **책 이름은 서버가 준다** (`book.title`). **아이가 바꿀 수 있다** — 2026-09-12 에 섰다
 * (`문구.md` 1.16 · `PATCH /book`). 종전 주석은 「고치는 자리를 만들지 않는다 — 제목 바꾸기는
 * W5 이고 A0-4 완료 조건에 없다」였고 **그 W5 가 지금이다.**
 *
 * **⛔ 아이 화면에 「제목」을 쓰지 않는다** — 낱말은 **「책 이름」**이다 (`용어사전.md` 1장).
 */
type Screen =
  | { kind: "loading" }
  | { kind: "book"; book: Book }
  /** 서버가 형식을 갖춰 거절했다 (인증 만료 등). `message` 가 아이가 읽을 문구다. */
  | { kind: "refused"; line: string }
  | { kind: "unreachable"; hints: string[] };

export default function BookScreen() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;

    apiGet<Book>("/book")
      .then((book) => {
        if (alive) setScreen({ kind: "book", book });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // **모험 화면과 같은 뿌리다** (2026-09-08). 여기도 401 이면 문구만 띄우고
        // **나가는 문조차 없었다** — 이 화면에는 「나가기」가 아예 없어서 뒤로 가기 말고는 길이 없다.
        // 아이가 결과 화면의 「내 책」을 눌렀는데 그 사이 쿠키가 죽으면 정확히 여기로 온다.
        if (인증이풀렸다(e)) {
          // **끊겼다는 표식을 달아 보낸다** (`문구.md` 3.3). 내 책을 열었다는 것은
          // **들어와 있었다**는 뜻이다 — 결과 화면에서 보내는 쪽과 같은 확신이다.
          router.replace(끊겨서보낼곳);
          return;
        }
        if (e instanceof ApiError) {
          setScreen({ kind: "refused", line: e.서버문구 });
          return;
        }
        if (e instanceof NetworkError) {
          setScreen({ kind: "unreachable", hints: e.hints });
          return;
        }
        throw e;
      });

    return () => {
      alive = false;
    };
  }, [attempt, router]);

  return (
    <main className="page-frame flex flex-1 flex-col gap-8 py-10">
      {screen.kind === "loading" && (
        <p className="text-center opacity-70">{상태표시.책펼치는중}</p>
      )}

      {screen.kind === "book" && (
        <>
          {/* **서버가 준 제목 그대로다.** 프론트가 짓지도 다듬지도 않는다. */}
          <h1 className="text-center text-3xl/relaxed">{screen.book.title}</h1>

          {/* **제목 아래 한 줄** (`문구.md` 1.15 · A0-6). **아이가 자기 책을 열어도 자기 이름이
              어디에도 없었다** — 대표 판정의 근거인 「자기가 쓴 글을 뿌듯해한다」가 나오는 자리가
              정확히 여기다. **실명을 열어 준 것과 한 짝**이라, 이름을 쓸 수 있게 해 놓고
              보이는 자리가 없으면 반만 한 것이다.

              **`GET /child/me` 의 `nickname` 으로 그리지 않는다.** 지금은 같은 값이지만
              **공유가 열리는 순간 남의 책에 보는 사람 이름이 찍힌다** — `visibility` 를 미리
              넣어 둔 것과 같은 자리다. **지은이는 책에 속한 값**이라 `book.author` 를 쓴다.

              **빈 값 갈래를 만들지 않는다.** `nickname` 은 자녀 생성 때 필수라 비지 않는다.
              **만약 비면 그 줄을 통째로 안 그린다** — 「지은이 (없음)」은 없다. */}
          {screen.book.author !== "" && (
            <p data-지은이 className="-mt-6 text-center text-lg opacity-70">
              {지은이(screen.book.author)}
            </p>
          )}

          {/* **표지 아래에 둔다** (`문구.md` 1.16). 이름과 지은이가 표지이고
              바꾸는 자리는 그 다음이다 — **표지 안에 넣으면 표지가 도구처럼 보인다.**

              **`book` 상태를 갈아끼운다.** 다시 불러오지 않는 것은 응답의 `title` 이
              **서버가 실제로 저장한 값**이라 그것만으로 충분하기 때문이다. 다시 부르면
              **한 판 분량을 또 받아오고** 그 사이 화면이 「책 펼치는 중」으로 돌아간다. */}
          <BookTitle
            title={screen.book.title}
            onChanged={(title) =>
              setScreen((s) => (s.kind === "book" ? { ...s, book: { ...s.book, title } } : s))
            }
            onUnauthorized={() => router.replace(끊겨서보낼곳)}
          />

          {/* **`onMasked` 를 안 넘긴다.** `pii_masked` 이벤트는 카드 화면에서
              **묘사 입력**에 붙은 것이고(`Stage0.md` 7절), 책 이름은 그 자리가 아니다.
              **종류만 나가는 값이라도 계약에 없는 자리를 만들지 않는다** —
              필요해지면 `Stage0.md` 에 먼저 적는다 (축 ⑮). */}

          {screen.book.pages.length === 0 ? (
            // **빈 책은 오류가 아니다.** 처음 들어온 아이는 아직 안 썼을 뿐이다 —
            // 여기서 못 한 일을 세면 그 자체가 평가가 된다 (`문구.md` 1.6 과 같은 규칙).
            <div className="reading-frame flex flex-col items-center gap-6 text-center">
              <p className="text-2xl/relaxed">
                {빈책.줄1}
                <br />
                {빈책.줄2}
              </p>
              {/* **여기서 나가는 곳은 모험 화면 하나뿐이다.** 「첫 장을 만들러」가 가리키는 곳이다. */}
              <Link
                href="/"
                className="rounded-full bg-scarf px-8 py-3 text-xl text-markings"
              >
                {빈책.버튼}
              </Link>
            </div>
          ) : (
            // **한 장씩 세로로 쌓는다.** 태블릿 가로에서는 두 칸이다 —
            // 책장을 넘기는 연출을 넣지 않는다: 다시 보러 오는 자리지 머무는 자리가 아니다.
            <>
              <div className="grid gap-8 wide:grid-cols-2">
                {screen.book.pages.map((page) => (
                  <BookPageFrame key={page.page_no} page={page} />
                ))}
              </div>

              {/* **쌓였을 때도 모험으로 가는 문이 있어야 한다** (`문구.md` 1.17,
                  2026-09-12 실기기). **빈 책에만 있었다** — 한 장이라도 쌓이는 순간
                  그 문이 사라지고 **페이지 목록만 남았다.**

                  **「쓰러 가기」 그대로다** (1.13 재사용). 빈 책과 **같은 화면·같은 동작**이라
                  새 낱말을 만들지 않는다 — 방향이 **모험으로 가는 것**이라 「가기」가 맞다.
                  결과 화면이 「다음 장면 **열기**」인 것은 거기가 **이미 모험 안**이어서다.

                  **목록 아래에 둔다** — 여기 온 아이가 하려던 일은 **다시 보는 것**이고,
                  다 보고 나서 나가는 자리가 끝이다. 위에 두면 목록을 가린다. */}
              <div className="flex justify-center">
                <Link
                  href="/"
                  data-쓰러가기
                  className="rounded-full bg-scarf px-8 py-3 text-xl text-markings"
                >
                  {빈책.버튼}
                </Link>
              </div>
            </>
          )}
        </>
      )}

      {screen.kind === "refused" && (
        // 서버가 준 문구를 그대로 보여준다.
        <p className="text-center text-2xl/relaxed">{screen.line}</p>
      )}

      {screen.kind === "unreachable" && (
        <div className="flex flex-col items-center gap-6 text-center">
          {/* **앱 목소리라 캐릭터를 옆에 세우지 않는다** (`문구.md` 0장) — 모험 화면과 같다. */}
          <p className="text-2xl/relaxed">{못닿음.내책}</p>
          <button
            type="button"
            onClick={() => {
              setScreen({ kind: "loading" });
              setAttempt((n) => n + 1);
            }}
            className="rounded-full bg-scarf px-8 py-3 text-markings"
          >
            {버튼.다시열기}
          </button>
          {screen.hints.length > 0 && (
            // **개발 빌드 전용이다.** 운영에서는 `hints` 가 비어 있어 안 그려진다.
            <ul
              data-dev-hints
              className="max-w-xl list-disc space-y-1 rounded-xl border border-dashed
                border-brass/50 p-4 text-left text-sm opacity-70"
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
