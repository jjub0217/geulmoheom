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

  // **개발 서버에 다른 오리진에서 들어오는 것을 허용한다** (2026-09-14).
  //
  // **Next 16 은 개발 전용 자산·엔드포인트에 오는 cross-origin 요청을 기본으로 막는다**
  // (`node_modules/next/dist/docs/.../allowedDevOrigins.md`). 그런데 **서버까지 붙는 E2E 하네스**가
  // `next dev` 앞에 **한 오리진 프록시**를 세운다 — 운영의 `vercel.json` rewrites 와 같은 모양이다
  // (`e2e/_서버하네스.mjs` · `adr/0012`). 브라우저가 보는 오리진은 프록시고 dev 서버는 그 뒤라,
  // 막히면 **화면이 뜨긴 하는데 하이드레이션이 안 끝나 요청을 한 건도 안 보낸다.**
  // **증상이 「확인하는 중…」에서 멈추는 것**이라 화면 코드를 한참 뒤졌다.
  //
  // **개발에만 걸린다** — `output: "export"` 라 운영에는 dev 서버 자체가 없다.
  allowedDevOrigins: ["127.0.0.1"],

  // 삽화·스케치가 R2 에서 오고 배포는 정적 빌드다 — Stage 0 은 최적화를 쓰지 않는다
  // (`docs/adr/0007` 결정 4). 끄면 원격 호스트를 `remotePatterns` 에 등록할 필요도 없어져
  // R2 도메인이 정해지기 전에도 그림이 뜬다. W3 B-3 에서 다시 보지 않는다.
  images: { unoptimized: true },
};

export default nextConfig;
