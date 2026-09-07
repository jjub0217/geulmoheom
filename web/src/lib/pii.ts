/**
 * 아이 입력에서 개인정보를 **정규식으로만** 찾아 그 자리에서 가린다 (백로그 E-2 프론트 몫).
 *
 * **가리되 막지 않는다** (대표 판정 2026-09-07, PRD E-2). 전송은 그대로 되고,
 * 서버가 **마스킹된 텍스트를 책 콘텐츠로 저장**한다 (`docs/api/Stage0.md` 4절).
 *
 * **여기서 잡는 것이 전부가 아니다.** 최종 판정은 언제나 서버 2차(NER)이고,
 * 프론트는 아이에게 주는 **즉시 피드백**일 뿐이다 (`docs/api/공통규약.md` 「클라이언트 PII 패턴」).
 * 그래서 이 파일은 **확실한 것만 잡는다** — 애매하면 통과시켜 서버로 보낸다.
 *
 * **실명·학교명은 여기서 잡지 않는다** (PRD E-2). 한글 실명을 정규식으로 잡으려 들면
 * 아이가 지은 가이드 이름(`PATCH /child/guide`)·괴물 이름이 입력창에서 실시간으로 걸린다.
 *
 * **미탐과 오탐은 무게가 다르다.** 미탐은 서버가 받아준다. 오탐은 아무도 못 받는다 —
 * 아이는 멀쩡한 문장을 쓰고도 이유를 모른 채 자기 글이 가려지는 것을 본다.
 * 경계를 넓히고 싶을 때 이 순서를 뒤집지 않는다.
 *
 * 패턴은 **빌드 타임 상수**다 (미결 11-3 확정, 2026-09-07). 바뀌면 재배포한다.
 *
 * **이 파일은 받은 문자열을 어디로도 내보내지 않는다** — 부른 쪽에 돌려줄 뿐이다 (PRD 1.1b).
 */

/** `pii_masked` 이벤트의 `kind` 로 그대로 나간다 (`Stage0.md` 7절). */
export type PiiKind = "phone" | "email" | "address" | "school";

/**
 * 가린 자리에 남는 글자. **확정본은 `docs/문구.md` 1.1** 이다.
 *
 * **길이와 무관하게 고정 3자다** — 가린 길이를 드러내지 않는다.
 *
 * **평범한 글자다.** 지워지지 않는 덩어리로 만들지 않는다 — 그러면 아이가 자기 문장을 못 고친다.
 * 그래서 **아이가 읽고 지울지 말지 판단하는 대상**이기도 하고, **책에 그대로 인쇄된다**
 * (마스킹된 텍스트가 책 콘텐츠로 저장된다 — `api/Stage0.md` 4절). 「보안 필터」 같은
 * 시스템 용어를 쓰지 않는 이유가 그 셋이다.
 */
export const PII_MASK = "○○○";

/**
 * 규칙. **순서가 곧 `detectPii` 가 돌려주는 순서다.**
 *
 * 각 패턴은 **그룹 1 이 앞 경계, 그룹 2 가 가릴 부분**이다. 앞 경계를 그룹으로 떼어두지 않으면
 * `(?:^|\D)` 가 먹은 앞 글자까지 함께 가려져 **아이 문장이 한 글자씩 사라진다.**
 * lookbehind 로 대신하지 않는 이유는 iPad Safari 구버전에서 지원이 갈리기 때문이다.
 */
const RULES: ReadonlyArray<{ kind: PiiKind; pattern: RegExp }> = [
  {
    kind: "phone",
    // 휴대폰(구분자 없어도 잡는다) · 유선(구분자가 있을 때만).
    // **3-4-4 자릿수 구조로 묶어** 「3-4번 문」·「100-200마리」가 안 걸리게 한다.
    pattern:
      /((?:^|\D))((?:01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}))(?!\d)/g,
  },
  {
    kind: "email",
    pattern: /()([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g,
  },
  {
    kind: "address",
    // **번지·호수까지 붙었을 때만 잡는다.** 「은하시 별빛동」 같은 아이가 지어낸 지명은
    // 실제 주소와 정규식으로 못 가른다 — 숫자가 붙지 않으면 통과시켜 서버로 넘긴다.
    // 단독 「동」·「구」·「로」는 절대 조건으로 쓰지 않는다. 「동굴」·「구름」·「길」이 전부 걸린다.
    pattern:
      /()(\d+\s*동\s*\d+\s*호|\d+\s*번지|[가-힣]{2,}(?:시|군|구)\s*[가-힣]{2,}(?:동|읍|면|리|로|길)\s*\d)/g,
  },
  {
    kind: "school",
    // **학교명 전체 꼴일 때만.** 「우리 학교는 ○○」 패턴을 글자 그대로 넣으면
    // 「우리 학교는 마법학교야」가 걸린다 — 판타지에서 아이가 충분히 쓸 말이다.
    // 줄임꼴(○○초)도 넣지 않는다. 「마법약초」·「기초」가 함께 걸린다.
    pattern: /()([가-힣]{2,}(?:초등학교|중학교|고등학교))/g,
  },
];

type Span = { kind: PiiKind; start: number; end: number };

/** 가릴 자리들을 앞에서부터 찾는다. 겹치면 앞선 것만 남긴다. */
function scan(text: string): Span[] {
  const found: Span[] = [];

  for (const { kind, pattern } of RULES) {
    // `matchAll` 은 원본 정규식의 `lastIndex` 를 건드리지 않는다.
    // `.test()` 를 g 플래그 정규식에 쓰면 호출마다 위치가 밀려 **두 번째 호출이 조용히 틀린다.**
    for (const m of text.matchAll(pattern)) {
      const start = (m.index ?? 0) + m[1].length;
      found.push({ kind, start, end: start + m[2].length });
    }
  }

  found.sort((a, b) => a.start - b.start);

  const spans: Span[] = [];
  for (const s of found) {
    const 앞 = spans[spans.length - 1];
    if (!앞 || s.start >= 앞.end) spans.push(s);
  }
  return spans;
}

/** 찾은 개인정보의 **종류**를 돌려준다. 못 찾으면 빈 배열. 값 자체는 돌려주지 않는다. */
export function detectPii(text: string): PiiKind[] {
  const 있는 = new Set(scan(text).map((s) => s.kind));
  return RULES.filter((r) => 있는.has(r.kind)).map((r) => r.kind);
}

/**
 * 찾은 자리를 `PII_MASK` 로 갈아끼운 문장과, **따라 움직인 커서 위치**를 돌려준다.
 *
 * 커서를 안 옮기면 치환한 만큼 글자가 밀려 **아이가 쓰던 자리를 잃는다.**
 * 가려진 구간 안에 있던 커서는 **가린 자리 바로 뒤**에 둔다 — 문장 맨 끝으로 보내지 않는다.
 */
export function maskPii(
  text: string,
  caret: number,
): { text: string; kinds: PiiKind[]; caret: number } {
  const spans = scan(text);
  if (spans.length === 0) return { text, kinds: [], caret };

  let masked = "";
  let 읽은데까지 = 0;
  let 새커서 = caret;

  for (const s of spans) {
    masked += text.slice(읽은데까지, s.start) + PII_MASK;

    if (caret >= s.end) {
      // 가린 자리보다 뒤에 있었다 — 줄어들거나 늘어난 만큼 따라 움직인다.
      새커서 += PII_MASK.length - (s.end - s.start);
    } else if (caret > s.start) {
      // 가려진 구간 한가운데 있었다 — 갈 곳이 없어졌으니 가린 자리 바로 뒤에 세운다.
      새커서 = masked.length;
    }

    읽은데까지 = s.end;
  }
  masked += text.slice(읽은데까지);

  const 있는 = new Set(spans.map((s) => s.kind));
  return {
    text: masked,
    kinds: RULES.filter((r) => 있는.has(r.kind)).map((r) => r.kind),
    caret: Math.max(0, Math.min(새커서, masked.length)),
  };
}
