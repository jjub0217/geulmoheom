"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import { BookReader } from "@/components/book-reader";
import { BookPrintButton, BookReturnLink } from "@/components/book-actions";
import { 끊겨서보낼곳 } from "@/lib/kicked";
import { BookTitle } from "@/components/book-title";
import { useAdventureRequest } from "@/components/book-journey";
import { useChapterInProgress } from "@/components/book-progress";
import { ApiError, NetworkError, apiGet, 역할이다르다, 인증이풀렸다 } from "@/lib/api";

import { 버튼, 못닿음 } from "../copy";
import { 상태표시 } from "../status-copy";
import { 빈책, 쓰는중안내, 지은이 } from "./copy";

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
  /**
   * **지금 쓰는 본편이 있나** (2026-09-22 사용자 지시).
   * **본편은 완결해야 책 한 장이 된다** — 그래서 본편을 쓰는 중에 책을 열면
   * **방금 쓴 것이 없다.** 그 사실을 말해 주는 안내를 고르는 데만 쓴다.
   * **⛔ 책을 그리는 것을 막지 않는다** — 이 값을 기다리느라 책이 늦게 뜨면 안 된다.
   */
  const 본편이도나 = useChapterInProgress();
  const 한번만 = useAdventureRequest();

  /**
   * **같은 책을 두 번 받지 않는다** (2026-09-22 실측으로 잡았다).
   *
   * 화면이 한 번 서는 동안 **똑같은 `GET /book` 이 두 번** 나갔다 — 주소도 응답도 같다.
   * `book-progress.ts` · `chapter-door.tsx` 와 같은 자리이고 같은 장치를 쓴다.
   *
   * **⛔ 열쇠에 `attempt` 를 넣는다.** 「다시 시도」는 **일부러 다시 받는 것**이라
   * 여기서 막으면 그 버튼이 아무 일도 안 하게 된다.
   *
   * **⭐ 삽화 갱신은 이 요청과 무관하다** — 준비 중인 그림은 `book-page.tsx` 가
   * `GET /artworks/{id}` 로 따로 확인한다. 이 요청을 줄여도 그림은 그대로 갱신된다.
   */
  useEffect(() => {
    let alive = true;

    한번만(`book-content:${attempt}`, () => apiGet<Book>("/book"))
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
        // **403 은 같은 곳으로 보내되 표식을 안 단다** (2026-09-15, 결과 ⑪).
        // 부모 쿠키가 있는 브라우저라 **아이는 아직 한 번도 안 들어왔다** — 「부모님이 새
        // 접속 코드를 받으셨어요」는 **받은 적 없는 코드를 찾게 만든다**(`lib/kicked.ts`
        // 「확신이 있는 자리에만 단다」). **틀리는 방향이 대칭이 아니라서 그렇다.**
        if (역할이다르다(e)) {
          router.replace("/child/auth");
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
  }, [attempt, router, 한번만]);

  return (
    <div className="book-shell">
      <main className="page-frame book-library">
        {screen.kind === "loading" && (
          <p role="status" className="book-loading text-center opacity-70">{상태표시.책펼치는중}</p>
        )}

        {screen.kind === "book" && (
          <>
            <header className="book-heading book-cover">
              {/* 책 이름·지은이는 서버 원문 그대로. 보는 사람의 별명으로 바꾸지 않는다. */}
              <BookTitle
                title={screen.book.title}
                onChanged={(title) =>
                  setScreen((s) => (s.kind === "book" ? { ...s, book: { ...s.book, title } } : s))
                }
                onUnauthorized={() => router.replace(끊겨서보낼곳)}
              />
              {screen.book.author !== "" && (
                <p data-지은이 className="book-cover-author">
                  {지은이(screen.book.author)}
                </p>
              )}
            </header>

            {screen.book.pages.length === 0 ? (
              <div className="book-empty">
                {/* ⛔ **본편이 진행 중이면 다른 말을 한다** (2026-09-22 사용자 확정,
                    `문구.md` **1.13**). **카드는 한 장 쓸 때마다 쪽이 생기는데 본편은
                    완결해야 한 장이 생긴다** — 본편 아이에게 「하나씩 쌓여」는 사실이 아니고
                    **자기가 방금 쓴 것이 어디 갔는지 못 찾게 만든다.**
                    **카드만 쓴 아이에게는 종전 두 줄이 여전히 참이라 그대로 쓴다.** */}
                {본편이도나 === "있음" ? (
                  <p className="book-empty-line">{빈책.본편진행중}</p>
                ) : (
                  <p className="book-empty-line">
                    {빈책.줄1}
                    <br />
                    {빈책.줄2}
                  </p>
                )}
              </div>
            ) : (
              <>
                <BookReader pages={screen.book.pages} />
                {/* ⛔ **책 아래다** (`문구.md` **1.13b**). **책은 아이 창작물을 보는 곳**이고
                    이 안내는 곁말이라 **글과 삽화를 가리거나 읽기를 끊지 않는 자리**에 둔다.
                    쪽이 있고 본편이 진행 중일 때만 나온다. */}
                {본편이도나 === "있음" && (
                  <p data-쓰는중안내 className="book-in-progress-note">{쓰는중안내}</p>
                )}
              </>
            )}

            <footer className="book-actions print:hidden">
              <BookReturnLink />
              {screen.book.pages.length > 0 && <BookPrintButton />}
            </footer>
          </>
        )}

        {screen.kind === "refused" && (
          <div className="book-library-status">
            <p>{screen.line}</p>
            <BookReturnLink />
          </div>
        )}

        {screen.kind === "unreachable" && (
          <div className="book-library-status">
            <p>{못닿음.내책}</p>
            <button
              type="button"
              onClick={() => {
                setScreen({ kind: "loading" });
                setAttempt((n) => n + 1);
              }}
              className="pressable action-primary"
            >
              {버튼.다시열기}
            </button>
            <BookReturnLink />
            {screen.hints.length > 0 && (
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
    </div>
  );
}
