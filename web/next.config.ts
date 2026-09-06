import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev 가 web/CLAUDE.md 에 자기 안내 블록을 덧붙이는 것을 끈다.
  // 이 파일은 손으로 관리한다 — 대신 「항상 하는 것」에 같은 취지를 한 줄로 적어 두었다.
  agentRules: false,

  // 삽화·스케치가 R2 에서 오고 배포는 정적 빌드다 — Stage 0 은 최적화를 쓰지 않는다
  // (`docs/adr/0007` 결정 4). 끄면 원격 호스트를 `remotePatterns` 에 등록할 필요도 없어져
  // R2 도메인이 정해지기 전에도 그림이 뜬다. W3 B-3 에서 다시 보지 않는다.
  images: { unoptimized: true },
};

export default nextConfig;
