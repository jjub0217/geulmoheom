/**
 * 책 한 장이 움직일 때의 면 관계다. 저장된 장면은 건드리지 않고, 화면에서만
 * `현재 글 → 다음 삽화`를 한 장의 앞·뒷면으로 엮는다.
 */
export type BookCurlDirection = "next" | "previous";

export type BookCurlFaces<T> = {
  fixedLeft?: T;
  fixedRight?: T;
  underLeft?: T;
  underRight?: T;
  turningFront: T;
  turningBack: T;
};

export function bookCurlFaces<T>(
  direction: BookCurlDirection,
  current: T,
  adjacent: T,
): BookCurlFaces<T> {
  if (direction === "next") {
    return {
      fixedLeft: current,
      turningFront: current,
      turningBack: adjacent,
      underRight: adjacent,
    };
  }

  return {
    underLeft: adjacent,
    fixedRight: current,
    turningFront: current,
    turningBack: adjacent,
  };
}
