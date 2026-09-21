import { describe, expect, it } from "vitest";

import { bookCurlFaces } from "./book-curl-model";

describe("bookCurlFaces", () => {
  it("다음: A 삽화는 고정하고 A 글 앞면·B 삽화 뒷면·B 글 아래 면을 만든다", () => {
    const a = { scene: "A" };
    const b = { scene: "B" };

    expect(bookCurlFaces("next", a, b)).toEqual({
      fixedLeft: a,
      turningFront: a,
      turningBack: b,
      underRight: b,
    });
  });

  it("이전: B 글을 고정하고 B 삽화가 A 글로 돌아오며 A 삽화가 아래에 남는다", () => {
    const b = { scene: "B" };
    const a = { scene: "A" };

    expect(bookCurlFaces("previous", b, a)).toEqual({
      fixedRight: b,
      turningFront: b,
      turningBack: a,
      underLeft: a,
    });
  });
});
