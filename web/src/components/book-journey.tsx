"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import type { components } from "@/api/types.gen";
import { apiGet, 역할이다르다, 인증이풀렸다 } from "@/lib/api";
import { 끊겨서보낼곳 } from "@/lib/kicked";

// docs/문구.md 2.5 — 책에서 돌아오는 동안 계정의 범위를 확인한다.
const 복귀확인중 = "모험으로 돌아가는 중…";
const 복귀확인실패 = "모험을 열 수 없어요. 다시 눌러 주세요.";
const 다시확인 = "다시 열기";

type AdventurePath = "/" | "/chapter";
type Fields = Partial<Record<AdventurePath, Record<string, unknown>>>;
type Memory = { origin: AdventurePath | null; childId: string | null; fields: Fields; generation: number };
type LoadOnce = <T>(key: string, load: () => Promise<T>) => Promise<T>;
type Journey = Memory & {
  setField: (path: AdventurePath, key: string, update: (previous: unknown) => unknown) => void;
  remember: (path: AdventurePath) => void;
  identify: (childId: string, requireKnownOwner: boolean) => void;
  loadOnce: LoadOnce;
  isCurrent: () => boolean;
};
const JourneyContext = createContext<Journey | null>(null);
const OriginContext = createContext<AdventurePath | null>(null);

/** 책 왕복 동안만 기억한다. 원문을 URL·기기 저장소·로그에 기록하지 않는다. */
export function BookJourneyProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // 카드 API의 오늘 기준은 UTC다. 인증/부모 화면으로 나가도 이전 탭 메모리를 버린다.
  const scope = pathname === "/" || pathname === "/chapter" || pathname === "/book"
    ? `adventure:${new Date().toISOString().slice(0, 10)}` : pathname;
  return <JourneyScope key={scope} pathname={pathname}>{children}</JourneyScope>;
}

function JourneyScope({ children, pathname }: { children: ReactNode; pathname: string }) {
  const [memory, setMemory] = useState<Memory>({ origin: null, childId: null, fields: {}, generation: 0 });
  const generation = memory.generation;
  const activeGeneration = useRef(generation);
  useLayoutEffect(() => {
    activeGeneration.current = generation;
    return () => { activeGeneration.current = -1; };
  }, [generation]);
  const isCurrent = useCallback(() => activeGeneration.current === generation, [generation]);
  const requests = useRef(new Map<string, Promise<unknown>>());
  const loadOnce: LoadOnce = useCallback(<T,>(key: string, load: () => Promise<T>) => {
    const requestKey = `${generation}:${key}`;
    const existing = requests.current.get(requestKey);
    if (existing) return existing as Promise<T>;
    const pending = load().finally(() => requests.current.delete(requestKey));
    requests.current.set(requestKey, pending);
    return pending;
  }, [generation]);
  const setField = useCallback((path: AdventurePath, key: string, update: (previous: unknown) => unknown) => {
    // 다른 아이로 전환된 뒤 도착한 이전 아이의 응답은 새 메모리를 건드리지 않는다.
    setMemory((previous) => previous.generation !== generation ? previous : ({ ...previous, fields: { ...previous.fields,
      [path]: { ...previous.fields[path], [key]: update(previous.fields[path]?.[key]) },
    } }));
  }, [generation]);
  const remember = useCallback((path: AdventurePath) => setMemory((previous) => ({ ...previous, origin: path })), []);
  const identify = useCallback((childId: string, requireKnownOwner: boolean) => {
    setMemory((previous) => {
      if (previous.childId === childId) return previous;
      const changed = previous.childId !== null || requireKnownOwner;
      return { ...previous, childId, fields: changed ? {} : previous.fields,
        generation: previous.generation + (changed ? 1 : 0) };
    });
  }, []);
  const value = useMemo(() => ({ ...memory, setField, remember, identify, loadOnce, isCurrent }), [memory, setField, remember, identify, loadOnce, isCurrent]);
  return <JourneyContext value={value}>
    <IdentityGate key={`${pathname}:${memory.generation}`} pathname={pathname}>{children}</IdentityGate>
  </JourneyContext>;
}

/** 복귀 전에 현재 아이를 대조한다. 다른 탭에서 바뀐 쿠키로 이전 아이의 글을 복원하지 않는다. */
function IdentityGate({ children, pathname }: { children: ReactNode; pathname: string }) {
  const journey = useContext(JourneyContext)!;
  const router = useRouter();
  const [mustCheck] = useState(Boolean(journey.fields[pathname as AdventurePath]));
  const [ready, setReady] = useState(!mustCheck);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const identify = journey.identify;
  useEffect(() => {
    if (pathname !== "/" && pathname !== "/chapter") return;
    let alive = true;
    apiGet<components["schemas"]["ChildMe"]>("/child/me").then((me) => {
      if (!alive) return;
      if (typeof me.child_id !== "string" || !me.child_id) throw new Error("Missing child identity");
      identify(me.child_id, mustCheck);
      setReady(true);
    }).catch((error: unknown) => {
      if (!alive || !mustCheck) return;
      if (인증이풀렸다(error) || 역할이다르다(error)) {
        router.replace(역할이다르다(error) ? "/child/auth" : 끊겨서보낼곳);
      } else setFailed(true);
    });
    return () => { alive = false; };
  }, [pathname, identify, mustCheck, attempt, router]);
  if (ready) return children;
  return <main className="page-frame adventure-main flex flex-1 flex-col items-center justify-center gap-5 py-6">
    <p role="status">{failed ? 복귀확인실패 : 복귀확인중}</p>
    {failed && <button type="button" className="pressable action-primary" onClick={() => {
      setFailed(false); setAttempt((n) => n + 1);
    }}>{다시확인}</button>}
  </main>;
}

/** 상태는 화면보다 오래 산다. 책을 보는 중 도착한 응답도 같은 장면의 메모리를 갱신한다. */
export function useAdventureState<T>(path: AdventurePath, key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const journey = useContext(JourneyContext)!;
  const [fallback] = useState(() => initial);
  const stored = journey.fields[path]?.[key];
  const setField = journey.setField;
  const setValue: Dispatch<SetStateAction<T>> = useCallback((next) => {
    setField(path, key, (previous) => typeof next === "function"
      ? (next as (value: T) => T)(previous === undefined ? fallback : previous as T) : next);
  }, [setField, path, key, fallback]);
  return [stored === undefined ? fallback : stored as T, setValue];
}

export function BookOrigin({ path, children }: { path: AdventurePath; children: ReactNode }) {
  return <OriginContext value={path}>{children}</OriginContext>;
}

export function useBookDeparture() {
  const origin = useContext(OriginContext);
  const remember = useContext(JourneyContext)?.remember;
  return () => { if (origin) remember?.(origin); };
}

export function useAdventureRequest() {
  return useContext(JourneyContext)!.loadOnce;
}

export function useAdventureSession() {
  return useContext(JourneyContext)!.isCurrent;
}

export function useBookReturnPath(): AdventurePath {
  return useContext(JourneyContext)?.origin ?? "/";
}
