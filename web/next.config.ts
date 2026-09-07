import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev 가 web/CLAUDE.md 에 자기 안내 블록을 덧붙이는 것을 끈다.
  // 이 파일은 손으로 관리한다 — 대신 「항상 하는 것」에 같은 취지를 한 줄로 적어 두었다.
  agentRules: false,

  // 정적 빌드. 프로덕션에 Node 서버를 두지 않는다 (`docs/adr/0007` 결정 1·2, Cloudflare Pages).
  //
  // **`headers()`·`redirects()`·`rewrites()`·미들웨어를 못 쓴다.** 서비스워커를
  // `public/sw.js` 로 옮긴 것이 그 첫 대가다 — 전에는 Next 가 붙여주던
  // `Service-Worker-Allowed: /` 로 scope 를 넓히고 있었다. **둘은 같은 커밋에 들어간다**:
  // 따로 들어가면 둘 중 하나만 남는 순간이 생기고 그때 배포가 깨진다.
  // 헤더가 필요해지면 Next 가 아니라 Pages 의 `_headers` 로 내려간다 (ADR 0007 「감수하는 것」).
  output: "export",

  // 삽화·스케치가 R2 에서 오고 배포는 정적 빌드다 — Stage 0 은 최적화를 쓰지 않는다
  // (`docs/adr/0007` 결정 4). 끄면 원격 호스트를 `remotePatterns` 에 등록할 필요도 없어져
  // R2 도메인이 정해지기 전에도 그림이 뜬다. W3 B-3 에서 다시 보지 않는다.
  images: { unoptimized: true },
};

export default nextConfig;
