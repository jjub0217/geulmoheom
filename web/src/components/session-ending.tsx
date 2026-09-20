import type { components } from "@/api/types.gen";
import { BookLink } from "@/components/book-link";
import { GuideFigure } from "@/components/guide";

/** 하루의 쓰기가 끝나도, 이미 만든 책은 계속 펼쳐 볼 수 있다. */
export function SessionEnding({ guide, line }: {
  guide: components["schemas"]["Guide"] | null;
  line: string;
}) {
  return (
    <div className="session-ending" data-session-ending>
      {guide ? (
        <GuideFigure guide={guide} stage />
      ) : (
        <p className="session-ending__message">{line}</p>
      )}
      <BookLink prominent className="session-ending__book" />
    </div>
  );
}
