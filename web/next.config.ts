import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev 가 web/CLAUDE.md 에 자기 안내 블록을 덧붙이는 것을 끈다.
  // 이 파일은 손으로 관리한다 — 대신 「항상 하는 것」에 같은 취지를 한 줄로 적어 두었다.
  agentRules: false,
};

export default nextConfig;
