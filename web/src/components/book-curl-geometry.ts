import type { BookCurlDirection } from "@/components/book-curl-model";

export const BOOK_CURL_STRIP_COUNT = 16;
export const BOOK_CURL_DURATION_MS = 980;

export type BookCurlStripPose = {
  angle: number;
  x: number;
  z: number;
};

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - ((-2 * value + 2) ** 3) / 2;
}

/**
 * 한 장을 책등부터 바깥쪽까지 연결된 짧은 선분으로 본다. 각 선분의 회전각을
 * 적분해 x/z 좌표를 만들기 때문에 모든 스트립이 같은 축에서 도는 카드가 아니라
 * 앞선 스트립 끝에 다음 스트립이 이어지는 하나의 곡면이 된다.
 */
export function bookCurlStripPoses(
  direction: BookCurlDirection,
  rawProgress: number,
  pageWidth: number,
  count = BOOK_CURL_STRIP_COUNT,
): BookCurlStripPose[] {
  const progress = easeInOutCubic(Math.min(1, Math.max(0, rawProgress)));
  const stripWidth = pageWidth / count;
  const sign = direction === "next" ? -1 : 1;
  const turn = Math.PI * progress;
  // 중간 구간에만 곡률을 만들고 시작과 끝에서는 다시 평평한 종이가 된다.
  const bend = Math.PI * 0.42 * Math.sin(Math.PI * progress);
  const poses = Array.from({ length: count }) as BookCurlStripPose[];
  let curveX = 0;
  let curveZ = 0;

  for (let distanceIndex = 0; distanceIndex < count; distanceIndex += 1) {
    const distanceRatio = (distanceIndex + 0.5) / count;
    // 바깥쪽이 먼저 들리고 책등 쪽이 뒤따른다.
    const angle = sign * (turn + bend * (distanceRatio - 0.5));
    const centerX = curveX + Math.cos(angle) * stripWidth / 2;
    const centerZ = curveZ + sign * Math.sin(angle) * stripWidth / 2;
    const physicalIndex = direction === "next"
      ? distanceIndex
      : count - distanceIndex - 1;
    const baseX = direction === "next"
      ? pageWidth + (physicalIndex + 0.5) * stripWidth
      : (physicalIndex + 0.5) * stripWidth;
    const curvedX = direction === "next"
      ? pageWidth + centerX
      : pageWidth - centerX;

    poses[physicalIndex] = {
      angle: angle * 180 / Math.PI,
      x: curvedX - baseX,
      z: centerZ,
    };
    curveX += Math.cos(angle) * stripWidth;
    curveZ += sign * Math.sin(angle) * stripWidth;
  }

  return poses;
}
