import { create } from "zustand";

/** 서비스워커 등록 상태. 화면 문자열이 아니라 내부 식별자다. */
export type ServiceWorkerStatus =
  | "idle"
  | "unsupported"
  | "registering"
  | "ready"
  | "failed";

type PwaState = {
  serviceWorkerStatus: ServiceWorkerStatus;
  setServiceWorkerStatus: (status: ServiceWorkerStatus) => void;
};

const initialState = {
  serviceWorkerStatus: "idle",
} satisfies Pick<PwaState, "serviceWorkerStatus">;

export const usePwaStore = create<PwaState>()((set) => ({
  ...initialState,
  setServiceWorkerStatus: (status) => set({ serviceWorkerStatus: status }),
}));

/** 테스트용. 스토어는 모듈 전역이라 케이스 사이에 되돌려 준다. */
export function resetPwaStore() {
  usePwaStore.setState(initialState);
}
