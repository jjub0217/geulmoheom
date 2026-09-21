import { describe, expect, it } from "vitest";

import { BOOK_CURL_STRIP_COUNT, bookCurlStripPoses } from "./book-curl-geometry";

describe("bookCurlStripPoses", () => {
  it("시작과 끝에서는 한 장의 평면이며 다음 방향은 오른쪽에서 왼쪽으로 간다", () => {
    const start = bookCurlStripPoses("next", 0, 480);
    const end = bookCurlStripPoses("next", 1, 480);

    expect(start).toHaveLength(BOOK_CURL_STRIP_COUNT);
    expect(start.every(({ angle, x, z }) => Math.abs(angle) < 0.001 && Math.abs(x) < 0.001 && Math.abs(z) < 0.001)).toBe(true);
    expect(end.every(({ angle, z }) => Math.abs(angle + 180) < 0.001 && Math.abs(z) < 0.001)).toBe(true);
    expect(end[0].x).toBeLessThan(0);
    expect(end.at(-1)!.x).toBeLessThan(end[0].x);
  });

  it("중간에는 스트립마다 각도와 깊이가 달라져 활 모양 곡면을 만든다", () => {
    const middle = bookCurlStripPoses("next", 0.5, 480);
    const angles = middle.map(({ angle }) => Math.round(angle));
    const depths = middle.map(({ z }) => Math.round(z));

    expect(new Set(angles).size).toBeGreaterThan(10);
    expect(new Set(depths).size).toBeGreaterThan(10);
    expect(Math.max(...depths)).toBeGreaterThan(200);
  });

  it("이전 방향은 같은 곡률로 왼쪽에서 오른쪽으로 되돌아온다", () => {
    const next = bookCurlStripPoses("next", 0.5, 480);
    const previous = bookCurlStripPoses("previous", 0.5, 480);

    for (let index = 0; index < BOOK_CURL_STRIP_COUNT; index += 1) {
      const mirrored = BOOK_CURL_STRIP_COUNT - index - 1;
      expect(previous[index].angle).toBeCloseTo(-next[mirrored].angle, 5);
      expect(previous[index].z).toBeCloseTo(next[mirrored].z, 5);
      expect(previous[index].x).toBeCloseTo(-next[mirrored].x, 5);
    }
  });
});
