/** 카드의 문장 전송 표시. 문구 출처: docs/문구.md 2.5 (2026-09-18). */
export function StoryReading() {
  return <p data-읽는중 role="status" className="text-xl/relaxed opacity-80">네 이야기를 읽고 있어.</p>;
}

/** 결과 삽화 대기 표시. 문구 출처: docs/문구.md 1.5 (2026-09-18). */
export function StoryOpening() {
  return (
    <div className="story-opening">
      <svg className="story-opening__book" viewBox="0 0 96 80" fill="none" aria-hidden="true">
        <path d="M48 67C36 60 23 60 9 64V18C23 14 36 16 48 23C60 16 73 14 87 18V64C73 60 60 60 48 67Z" fill="#a77a40" />
        <path d="M48 61C36 54 25 54 14 57V12C26 9 37 12 48 19C59 12 70 9 82 12V57C71 54 60 54 48 61Z" fill="#fff6df" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M48 20V60M23 24C29 24 34 25 39 28M23 34C29 34 34 35 39 38M57 28C62 25 67 24 73 24M57 38C62 35 67 34 73 34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".5" />
        <path className="story-opening__page" d="M48 19C59 12 70 9 82 12V57C71 54 60 54 48 61V19Z" fill="#f5e4bd" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <p>네 이야기를 그림으로 펼치고 있어.</p>
    </div>
  );
}
