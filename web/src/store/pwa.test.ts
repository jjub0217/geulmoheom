import { beforeEach, describe, expect, it } from "vitest";
import { resetPwaStore, usePwaStore } from "./pwa";

describe("usePwaStore", () => {
  beforeEach(() => {
    resetPwaStore();
  });

  it("서비스워커 상태는 idle 로 시작한다", () => {
    expect(usePwaStore.getState().serviceWorkerStatus).toBe("idle");
  });

  it("등록 결과를 상태로 반영한다", () => {
    usePwaStore.getState().setServiceWorkerStatus("registering");
    expect(usePwaStore.getState().serviceWorkerStatus).toBe("registering");

    usePwaStore.getState().setServiceWorkerStatus("ready");
    expect(usePwaStore.getState().serviceWorkerStatus).toBe("ready");
  });

  it("resetPwaStore 는 초기 상태로 되돌린다", () => {
    usePwaStore.getState().setServiceWorkerStatus("failed");
    resetPwaStore();
    expect(usePwaStore.getState().serviceWorkerStatus).toBe("idle");
  });
});
