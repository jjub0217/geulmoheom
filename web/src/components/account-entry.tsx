import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/** 입장 화면의 브랜드 문구: docs/문구.md 3.12. 인증·동의 문구는 각 화면에서 유지한다. */
const 입장문구 = {
  이름: "글모험",
  아이제목: ["너의 이야기가", "시작되는 곳"],
  부모제목: ["아이의 한 문장이", "한 권의 책으로"],
  부모설명: "아이가 직접 쓴 글과 그림이 자기만의 책에 모입니다.",
  코드없음: "접속 코드가 없으신가요?",
  부모안내: "부모님이 먼저 가입하시면 코드를 받으실 수 있어요.",
  부모가입: "부모님 가입하기",
} as const;

export function AccountEntry({ kind, children, showParentAccess = false }: {
  kind: "child" | "login" | "signup";
  children: ReactNode;
  showParentAccess?: boolean;
}) {
  const child = kind === "child";
  const title = child ? 입장문구.아이제목 : 입장문구.부모제목;

  return (
    <main className={`account-entry account-entry--${kind}`}>
      <div className="entry-grid">
        <aside className="entry-introduction">
          <div className="entry-brand">
            <svg aria-hidden="true" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 10C13 6 7 6 3 7v22c5-1 10 0 15 3 5-3 10-4 15-3V7c-4-1-10-1-15 3Z" />
              <path d="M18 10v22M7 12c3 0 5 1 7 2M7 17c3 0 5 1 7 2M25 2v6M22 5h6" />
            </svg>
            <span>{입장문구.이름}</span>
          </div>
          <div className="entry-intro-copy">
            <p className="entry-intro-title">{title.map(line => <span key={line}>{line}</span>)}</p>
            {!child && <p className="entry-intro-description">{입장문구.부모설명}</p>}
          </div>
          <div className="entry-illustration" aria-hidden="true">
            <div className="entry-forest">
              <Image src="/adventure/forest-stage.png" alt="" fill sizes="(max-width: 760px) 1px, 380px" className="entry-forest-image" priority />
            </div>
            <Image src="/guide/default-stage.png" alt="" width={256} height={256} className="entry-mascot" priority />
          </div>
        </aside>

        <div className="entry-content">
          {children}
          {showParentAccess && (
            <div className="entry-parent-access">
              <p>{입장문구.코드없음}</p>
              <p className="entry-parent-access-note">{입장문구.부모안내}</p>
              <Link href="/parents/signup" className="entry-text-link">
                {입장문구.부모가입}
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
