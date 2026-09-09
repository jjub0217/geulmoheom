"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { components } from "@/api/types.gen";
import { BookPageFrame } from "@/components/book-page";
import { ApiError, NetworkError, apiGet, 인증이풀렸다 } from "@/lib/api";

import { 버튼, 못닿음 } from "../copy";
import { 상태표시 } from "../status-copy";
import { 빈책 } from "./copy";

type Book = components["schemas"]["Book"];

/**
 * 내 책 (백로그 A0-4).
 *
 * **비전 2장이 파는 것이 이 화면이다** — 쓰기는 수단이고 **책과 독자가 목적**이다.
 * 결과 화면이 「이 장면이 네 책에 남아」라고 말한 그 책이 여기 있다.
 *
 * **제목은 서버가 준다** (`book.title`). **고치는 자리를 만들지 않는다** — 제목 바꾸기는 W5 이고
 * A0-4 완료 조건에 없다. 프리테스트가 보는 것은 **「자기 것을 다시 여는가」**다.
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
            <div className="grid gap-8 tablet:grid-cols-2">
              {screen.book.pages.map((page) => (
                <BookPageFrame key={page.page_no} page={page} />
              ))}
            </div>
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
