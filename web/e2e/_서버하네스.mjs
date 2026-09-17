// 브라우저가 **진짜 api 를 무는** 갈래를 위한 하네스 (`주차계획/W6.md` 프론트 6번).
//
// **운영과 같은 모양으로 세운다** — 한 오리진 프록시(`adr/0012`). `/api/*` 는 uvicorn 으로,
// 나머지는 `next dev` 로 넘긴다. **cross-origin 으로 붙이는 길은 안 골랐다**: `__Host-` 쿠키가
// `SameSite=Lax` 라 **cross-site fetch 에 안 실려 로그인 자체가 안 된다.** 운영이 프록시를
// 필수로 두는 이유가 그것이고, **검사도 같은 조건이어야 같은 것을 잰다.**
//
// **⛔ 돈이 걸린 자리다.** api 를 진짜로 태우면 묘사 평가·그림이 **유료 호출**이 될 수 있고
// **그건 초록으로 지나간다**(응답이 오니까). 그래서 백엔드가 세운 둘을 그대로 쓴다 —
// ① 주소를 **가짜 앞단**으로 돌리고 ② `GEMINI_API_KEY` 에 **못 쓰는 값**을 넣는다.
// 가짜를 안 지난 호출은 과금이 아니라 **거절로 죽는다**.
//
// **가짜를 여기서 다시 만들지 않는다.** `api/tests/fake_gemini.py` 를 **불러서 쓴다** —
// 베끼면 한쪽만 고쳐지는 날 **둘이 다른 것을 잰다**(축 ⑨). 그래서 api 의 테스트 모듈에
// 의존하는데, **그 이름이 바뀌면 여기가 깨진다. 깨지는 것이 맞다** — 조용히 진짜 구글을
// 부르는 것보다 낫다.
//
// **⚠ `next dev` 는 프로젝트 디렉터리당 하나만 뜬다.** 빠른 e2e 와 **동시에 못 돈다** —
// 나란히 돌리면 뒤엣것이 죽는다. 순서대로 돌린다.
//
// **⚠ DB 가 떠 있어야 한다** — `make db-up`. 없으면 api 가 뜨다 죽고, 아래가 그 이유를 보여준다.
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";

const 저장소 = resolve(import.meta.dirname, "../..");
const API = resolve(저장소, "api");

/**
 * **사람이 보는 모드** (2026-09-16 신설 · W7 10번).
 *
 * **검사가 아니라 대표가 눈으로 보려고 띄운다.** T1~T3 장면 카드가 **대표 미검수**라
 * 튜토리얼이 **기본 꺼짐**인데(`config.tutorial_enabled`), **검수를 하려면 켜진 화면을
 * 봐야 한다.** 그래서 이 모드에서만 `TUTORIAL_ENABLED=true` 로 띄운다.
 *
 * **⛔ 돈이 안 나가는 것이 요점이다.** 가짜 앞단과 못 쓰는 키를 **그대로** 쓴다 —
 * 검사 갈래와 **같은 설정**이고, **평가도 그림도 진짜 구글로 안 나간다.**
 * **삽화가 기본 에셋인 것은 알고 본다** — 그림을 보려는 것이 아니라 **문구와 흐름**을 본다.
 *
 * **⛔ 운영을 안 켠다.** 이건 **이 기계의 임시 서버**이고 DB 도 `geulmoheom_e2e` 다 —
 * 운영 스위치는 **검수가 끝난 뒤 `config.tutorial_enabled` 한 군데**를 켜는 것이지
 * 이 모드와 무관하다.
 *
 * **⛔ 크롬으로 본다. 사파리에서는 가입이 안 된다** (2026-09-16 실측).
 * 이 하네스는 **http** 인데 인증 쿠키가 **`__Host-`**(Secure 강제)라 **사파리가 버린다** —
 * 가입은 201 인데 쿠키가 안 앉아 다음 요청이 401 이고 **로그인 ↔ 가입이 돈다.**
 * **`config.py` 가 이미 적어 둔 자리다** — 「Secure 쿠키가 http://localhost 에 붙는지가
 * 브라우저마다 갈린다. 파일럿이 태블릿이라 Safari 를 건너뛸 수 없다」.
 * **⭐ 제품 결함이 아니다** — 운영은 https 라 사파리에서도 선다.
 * **아이패드로 봐야 하면** `make certs` 로 https 개발 설정을 세우는 길이 따로 있다.
 *
 * ```
 * cd web && pnpm 보여주기
 * ```
 */
const 보여주기 = process.env.E2E_SHOW === "1" || process.argv.includes("--보여주기");

const 프록시포트 = Number(process.env.E2E_SHOW === "1" ? 3005 : (process.env.E2E_PROXY_PORT ?? 3003));
const 웹포트 = Number(process.env.E2E_WEB_PORT ?? 3004);

const 자식들 = [];

/** 죽일 때 하나도 안 남긴다 — 남으면 다음 실행이 포트에서 막힌다. */
function 정리() {
  for (const p of 자식들) {
    try {
      p.kill("SIGTERM");
    } catch {
      /* 이미 죽었다 */
    }
  }
}
process.on("SIGTERM", () => {
  정리();
  process.exit(0);
});
process.on("SIGINT", () => {
  정리();
  process.exit(0);
});

function 띄운다(이름, 명령, 인자, 옵션 = {}) {
  const p = spawn(명령, 인자, { ...옵션, stdio: ["ignore", "pipe", "pipe"] });
  자식들.push(p);
  p.on("exit", (코드) => {
    // **뜨다 죽으면 그 자리에서 멈춘다.** 안 그러면 「포트가 안 열린다」만 남고
    // **왜 안 떴는지가 사라진다** — 백엔드가 같은 자리에서 겪은 것이다.
    if (코드 !== 0 && 코드 !== null) {
      console.error(`[하네스] ${이름} 이 죽었다 (exit ${코드})`);
      정리();
      process.exit(1);
    }
  });
  p.stderr.on("data", (d) => process.stderr.write(`[${이름}] ${d}`));
  return p;
}

/**
 * 한 번 돌고 끝나는 것. **죽으면 거기서 멈춘다** — 준비가 반만 된 채로 서버를 띄우면
 * **「인증이 깨졌다」처럼 보이는 실패**가 나고, 그 자리를 쫓느라 시간을 버린다(2026-09-16).
 */
function 한번돌린다(이름, 명령, 인자, 옵션 = {}) {
  return new Promise((res, rej) => {
    const p = spawn(명령, 인자, { ...옵션, stdio: ["ignore", "pipe", "pipe"] });
    let 말 = "";
    p.stderr.on("data", (d) => {
      말 += d;
    });
    p.on("exit", (코드) => {
      if (코드 === 0) {
        console.log(`[하네스] ${이름} ✓`);
        res();
        return;
      }
      rej(new Error(`${이름} 이 실패했다 (exit ${코드})\n${말}`));
    });
    p.on("error", rej);
  });
}

/** 포트가 열릴 때까지. **고정 대기를 쓰지 않는다** — 느린 기계에서 그 값이 곧 거짓이 된다. */
async function 열릴때까지(포트, 초 = 90) {
  const 끝 = Date.now() + 초 * 1000;
  while (Date.now() < 끝) {
    const 됐나 = await new Promise((res) => {
      const s = connect(포트, "127.0.0.1");
      s.on("connect", () => (s.destroy(), res(true)));
      s.on("error", () => res(false));
    });
    if (됐나) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`포트 ${포트} 가 ${초}초 안에 안 열렸다`);
}

/**
 * **띄우기 전에 포트가 비었는지 본다.**
 *
 * **⛔ 앞 실행이 남아 있으면 증상이 엉뚱한 데서 난다.** 2026-09-15 에 실제로 그랬다 —
 * 프록시가 죽으면서 자식들이 살아남았고, 다음 실행은 **「web 이 죽었다 (exit 1)」**,
 * 그다음은 **「address already in use」**로 죽었다. **둘 다 진짜 원인을 안 말한다.**
 *
 * **여기서 멈추고 무엇을 지우면 되는지 말한다** — 사람이 1초에 고칠 수 있는 것을
 * 두 번 재실행으로 알아내게 두지 않는다.
 */
async function 비었나확인(쌍들) {
  const 물린것 = [];
  for (const [이름, 포트] of 쌍들) {
    const 열려있나 = await new Promise((res) => {
      const s = connect(포트, "127.0.0.1");
      s.on("connect", () => (s.destroy(), res(true)));
      s.on("error", () => res(false));
    });
    if (열려있나) 물린것.push(`${이름}(${포트})`);
  }
  if (물린것.length > 0) {
    console.error(`[하네스] 포트가 이미 물려 있다 — ${물린것.join(" · ")}`);
    console.error("[하네스] 앞 실행이 남았다. 이렇게 지운다:");
    console.error(
      `[하네스]   for p in ${쌍들.map(([, 포트]) => 포트).join(" ")}; do kill $(lsof -nP -iTCP:$p -sTCP:LISTEN -t) 2>/dev/null; done`,
    );
    process.exit(1);
  }
}

await 비었나확인([
  ["프록시", 프록시포트],
  ["web", 웹포트],
]);

// ── ⓪ DB — **백엔드 pytest 와 갈라 놓는다** ────────────────────────────
//
// **⛔ 종전 기본값이 `geulmoheom_test` 였다. 그게 백엔드 `conftest.py` 의 DB 다.**
// 그쪽은 세션마다 **`pg_terminate_backend` 로 남의 커넥션을 끊고 `drop database`** 한다
// (`api/tests/conftest.py` 195~211행 — 옛 스키마 위에서 도는 것을 막으려는 정당한 이유다).
//
// **그래서 백엔드가 `pytest` 를 돌리면 이 갈래의 행이 흐름 한가운데서 사라졌다.**
// 증상이 인증 결함처럼 보인다 — 몇 요청이 200 으로 지나간 뒤 그 다음부터 **401**
// (`require_parent`/`require_child` 가 행을 못 찾는다). **2026-09-16 에 실제로 밟았고
// 「세션이 중간에 죽는다」로 한참 쫓았다.**
//
// **⛔ 종전 주석은 「백엔드 conftest 가 만들고 마이그레이션까지 해 둔 것」이라고 적어
// 두고 있었다** — 즉 **남의 세션 검사가 남긴 것에 얹혀 있었다.** 그것이 원인이다.
// **이제 우리 DB 를 우리가 세운다.**
//
// CI 는 자기 `DATABASE_URL` 을 넘기므로 이 기본값을 안 탄다 (`ci.yml` web-slow).
const 디비주소 =
  process.env.DATABASE_URL ??
  // **개발 DB 를 안 문다.** 거기엔 실제 자녀 계정이 있고, 이 갈래는 매 실행마다
  // 학부모·자녀를 새로 만든다 — 쌓이면 그 DB 가 검사 쓰레기로 찬다.
  "postgresql+asyncpg://geulmoheom:geulmoheom@localhost:5433/geulmoheom_e2e";

// **⛔ 지우고 다시 만들지 않는다.** 백엔드 conftest 가 그러는 것은 **스키마가 낡는 것**을
// 막으려는 것이고, 여기는 **마이그레이션을 매번 끝까지 돌리므로** 같은 위험이 없다.
// 그리고 **남의 것을 지우는 코드가 저장소에 하나 더 생기는 것**이 오늘 밟은 그 문제다.
//
// **⛔ `psql` 을 안 쓴다** — 기계에 깔려 있으란 법이 없다. api 의 venv 에 `asyncpg` 가
// 이미 있으니 **그것으로 만든다.** 준비물을 늘리면 **다음 사람이 여기서 막힌다.**
const 디비이름 = new URL(디비주소.replace("postgresql+asyncpg://", "postgresql://")).pathname.slice(1);

await 한번돌린다("DB 만들기", "uv", [
  "run",
  "python",
  "-c",
  // **이미 있으면 그냥 지나간다.** 매 실행에 새로 만들 이유가 없다 —
  // 마이그레이션이 뒤에서 스키마를 맞춘다.
  "import asyncio, asyncpg\n"
    + "async def m():\n"
    + "    c = await asyncpg.connect('postgresql://geulmoheom:geulmoheom@localhost:5433/postgres')\n"
    + "    try:\n"
    + `        await c.execute('create database \"${디비이름}\"')\n`
    + "    except asyncpg.DuplicateDatabaseError:\n"
    + "        pass\n"
    + "    finally:\n"
    + "        await c.close()\n"
    + "asyncio.run(m())\n",
], { cwd: API, env: { ...process.env, PYTHONPATH: API } });

await 한번돌린다("마이그레이션", "uv", ["run", "alembic", "upgrade", "head"], {
  cwd: API,
  env: { ...process.env, DATABASE_URL: 디비주소 },
});
await 한번돌린다("카드 시드", "uv", ["run", "python", "scripts/seed_cards.py"], {
  cwd: API,
  env: { ...process.env, DATABASE_URL: 디비주소, PYTHONPATH: API },
});

/**
 * **보여주기 모드에서 등급과 그림을 고른다** (2026-09-16, 백엔드가 손잡이를 알려줬다).
 *
 * **⛔ 검사 갈래는 손대지 않는다** — 무인자 그대로다. **여기서 등급을 바꾸면
 * 검사가 「가짜가 답했는지를 등급으로 묻는」 잣대를 잃는다**(`server.spec.ts` 가 `G3` 를 본다).
 *
 * ## 왜 필요한가 — 대표 검수에서 못 재는 것이 넷 나왔다
 *
 * 가짜는 **본문을 안 뜯는다**(그게 그 파일의 원칙이고, 뜯으면 **아이 문장을 읽어야** 한다).
 * 그래서 **한 서버 = 한 등급**이고, 입력이 뭐든 같은 값이 온다 —
 * **「본다」 두 글자도 전설**이 나왔고 대표가 그것을 물으셨다.
 *
 * **⭐ 그런데 「한 판을 그 등급으로 띄우는 것」은 된다.** 그러면 셋이 풀린다:
 * - `G0` — **되묻기가 진짜로 뜬다.** `app/scaffold.py` 가 **LLM 을 안 부르고 조립**하므로
 *   (PRD 4.0) **검수에서 보이는 그 문장이 제품 문장 그대로**다. 그리고 **상한 2회 뒤
 *   G1 취급으로 지나가므로**(`MAX_SCAFFOLD`) **「되묻기 → 그래도 진행」 두 갈래가 한 판에** 나온다
 * - `G1`·`G2` — **낮은 티어 판.** T2 권유가 실제로 뜨는 것을 본다(판정 ① 때문에 `G3` 에선 안 뜬다)
 * - **그림** — 진짜 PNG 를 먹이면 **액자가 단색 네모가 아니게 된다**
 *
 * **⛔ 안 풀리는 것 하나 — 「같은 판 안에서 등급이 갈리는 것」.** 등급이 고정이라
 * **오르는 순간**은 못 본다. **A-6 의 「보고 체득」이 그 순간이라** 그것만 완료 판정 회차 몫이다.
 *
 * **⚠ 그림을 보는 자리가 아니라 액자가 사는지를 보는 자리다.** 안내 줄에 그렇게 적는다.
 */
const 보여줄등급 = process.env.E2E_SHOW_GRADE ?? null;

/**
 * 액자에 먹일 그림. **⛔ 요점은 그림이 아니라 비율이다.**
 *
 * 진짜 삽화는 **784×1353 — 세로로 긴 것(1:1.73)**이고 가이드 표정은 **1024×1024 정사각**이라
 * **액자가 다르게 선다.** `globals.css` 의 **`--artwork-cap`** 이 있는 이유가 그 세로 길이고,
 * 그 주석이 **「360×640 에서 여유가 1px」**이라고 적어 뒀다.
 * **정사각을 보고 액자를 다듬으면 그 1px 이 어디로 갔는지 아무도 모른다** (2026-09-17 PM).
 *
 * **셋으로 고른다 — 환경변수 → 이 기계의 삽화 캐시 → 가이드 표정.**
 * **`.artworks/` 는 로컬 캐시라 기계마다 있는 파일이 다르고 파일명에 해시가 붙는다.**
 * 그래서 **경로를 박지 않고 찾고, 없으면 조용히 떨어진다** — CI 와 다른 기계에서 안 깨진다.
 */
function 보여줄그림고르기() {
  const 지정 = process.env.E2E_SHOW_ARTWORK;
  if (지정) {
    if (existsSync(지정)) return { 경로: 지정, 출처: "E2E_SHOW_ARTWORK" };
    console.log(`[하네스] ⚠ E2E_SHOW_ARTWORK 가 가리키는 파일이 없다 — 캐시에서 찾는다: ${지정}`);
  }
  const 캐시 = resolve(저장소, ".artworks/artworks");
  if (existsSync(캐시)) {
    const 후보 = readdirSync(캐시)
      .filter((이름) => 이름.endsWith(".jpg"))
      .sort();
    // 카드 삽화(`c01_…`)를 먼저 고른다 — 안내 줄에 어느 카드인지가 드러난다.
    const 고른것 = 후보.find((이름) => /^c\d+_/.test(이름)) ?? 후보[0];
    if (고른것) return { 경로: resolve(캐시, 고른것), 출처: `삽화 캐시 — ${고른것}` };
  }
  return {
    경로: resolve(저장소, "docs/캐릭터/표정/default.png"),
    출처: "가이드 표정 — ⚠ 1024×1024 정사각이라 진짜 삽화와 비율이 다르다",
  };
}

const 보여줄그림 = 보여주기 ? 보여줄그림고르기() : null;

const 가짜파이썬 = 보여주기
  ? [
      "import time",
      "from tests.fake_gemini import 가짜앞단, 글응답, 그림응답, 기본글",
      // **`기본글` 을 펼쳐 쓴다.** 통째로 새로 쓰면 GM 키(`narrative`·`choices`·
      // `trial_path`)가 빠져 **`POST /chapters` 가 500** 이 된다 — 2026-09-16 에
      // 프론트 브라우저 e2e 가 잡았던 그 자리로 되돌아간다.
      보여줄등급
        ? `글 = 글응답({**기본글, "grade": ${JSON.stringify(보여줄등급)}})`
        : "글 = None",
      `그림 = 그림응답(open(${JSON.stringify(보여줄그림.경로)}, "rb").read())`,
      "with 가짜앞단(글=글, 그림=그림) as f:",
      "    print(f.base_url, flush=True)",
      "    while True:",
      "        time.sleep(3600)",
    ].join("\n")
  : // **검사 갈래는 무인자 그대로다.**
    "import time\nfrom tests.fake_gemini import 가짜앞단\nwith 가짜앞단() as f:\n    print(f.base_url, flush=True)\n    while True:\n        time.sleep(3600)\n";

// ── ① 가짜 앞단 — api 의 것을 불러서 쓴다 ────────────────────────────────
const 가짜 = 띄운다(
  "가짜앞단",
  "uv",
  [
    "run",
    "python",
    "-c",
    // `base_url` 을 찍고 죽지 않고 서 있는다. **여기서 주소를 만들지 않는다** —
    // 포트를 고르는 것도 그쪽 몫이라 **우리가 아는 것은 찍힌 한 줄뿐**이다.
    가짜파이썬,
  ],
  { cwd: API, env: { ...process.env, PYTHONPATH: API } },
);

const 가짜주소 = await new Promise((res, rej) => {
  const 시한 = setTimeout(() => rej(new Error("가짜 앞단이 주소를 안 찍었다")), 60_000);
  가짜.stdout.on("data", (d) => {
    const 줄 = String(d).trim().split("\n")[0];
    if (줄.startsWith("http")) {
      clearTimeout(시한);
      res(줄);
    }
  });
});
console.log(`[하네스] 가짜 앞단 ${가짜주소}`);

// ── ② 진짜 api ────────────────────────────────────────────────────────
const api포트 = Number(process.env.E2E_API_PORT ?? 8010);

// **api 포트도 같은 이유로 먼저 본다** — 여기 상수가 위 확인보다 아래에 있어 따로 부른다.
await 비었나확인([["api", api포트]]);
띄운다(
  "api",
  "uv",
  ["run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(api포트)],
  {
    cwd: API,
    env: {
      ...process.env,
      APP_ENV: "dev",
      // **여기 둘이 이 하네스의 핵심이다.** 없으면 진짜 구글로 나간다.
      GEMINI_BASE_URL: 가짜주소,
      GEMINI_API_KEY: "fake-key-not-valid-anywhere",
      // **사람이 보는 모드에서만 켠다** — 검사 갈래는 **꺼진 채로** 돈다.
      // 켜고 검사하면 **「기본 꺼짐」이 깨져도 아무도 모른다.**
      ...(보여주기 ? { TUTORIAL_ENABLED: "true" } : {}),
      EVALUATOR_MODEL: "gemini-3.1-flash-lite",
      // 가짜는 **모델 이름에 `image` 가 드는가**로 갈래를 나눈다 (`adr/0006`).
      IMAGE_MODEL: "gemini-3.1-flash-lite-image",
      DATABASE_URL: 디비주소,
      JWT_SECRET: process.env.JWT_SECRET ?? "e2e-secret-not-used-outside-tests",
      PYTHONPATH: API,
    },
  },
);
await 열릴때까지(api포트);
console.log(`[하네스] api 127.0.0.1:${api포트}`);

// ── ③ 화면 ────────────────────────────────────────────────────────────
// **`out/` 을 안 쓴다.** 그 폴더는 정적 하네스와 실기기가 같이 쓰는 하나의 상태라
// (`web/CLAUDE.md`) 여기서 또 물면 **누가 마지막이냐**가 검사 결과를 정한다.
// **배포 형태를 재는 것은 정적 하네스의 몫**이고, 여기가 재는 것은 **서버까지 닿는가**다.
띄운다("web", "pnpm", ["exec", "next", "dev", "--port", String(웹포트)], {
  cwd: resolve(저장소, "web"),
  env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: "/api/v1" },
});
await 열릴때까지(웹포트);
console.log(`[하네스] web 127.0.0.1:${웹포트}`);

// ── ④ 한 오리진 프록시 — 운영의 `vercel.json` rewrites 와 같은 모양 ──────
//
// **생소켓으로 쓰지 않는다.** 직접 HTTP 를 써 보내면 청크 인코딩·연결 재사용을 우리가 떠안고,
// **틀리면 제품이 아니라 하네스가 만든 실패**가 난다. `http.request` 가 그것을 안다.
/**
 * **보여주기 모드는 https 로 선다** (2026-09-16).
 *
 * **⛔ 사파리는 `http` 로 온 `Secure` 쿠키를 버린다.** 인증 쿠키가 `__Host-` 라
 * **Secure 가 강제**되므로, http 로 띄우면 **가입은 201 인데 쿠키가 안 앉아**
 * 다음 요청이 401 이고 **로그인 ↔ 가입이 돈다** (대표가 실제로 밟았다).
 *
 * **`dev-certs.sh` 가 이미 그 이유로 존재한다** — 「파일럿이 태블릿이라 Safari 를
 * 건너뛸 수 없어 **개발 환경 자체를 https 로 옮긴다**」. **그 길을 여기서도 쓴다.**
 *
 * **⛔ 쿠키를 약하게 만들지 않는다.** 보는 편의 때문에 `__Host-`·`Secure` 를 내리면
 * **그게 남는다.** 고칠 것은 **띄우는 쪽**이다.
 *
 * **⛔ 검사 갈래는 http 그대로다** — Chromium 은 `http://127.0.0.1` 의 Secure 쿠키를
 * 받으므로 바꿀 이유가 없고, **바꾸면 인증서가 없는 기계(CI)에서 검사가 죽는다.**
 *
 * **인증서가 없으면 http 로 내려앉고 그 사실을 말한다** — 조용히 http 로 서면
 * **대표가 또 같은 고리를 밟는다.**
 */
const 인증서 = `${API}/../.certs/geulmoheom.test.pem`;
const 열쇠 = `${API}/../.certs/geulmoheom.test-key.pem`;
const https로 = 보여주기 && existsSync(인증서) && existsSync(열쇠);
const 볼주소 = https로
  ? `https://app.geulmoheom.test:${프록시포트}`
  : `http://127.0.0.1:${프록시포트}`;

const 프록시핸들러 = (요청, 응답) => {
  // **`/healthz` 도 api 로 넘긴다** — 운영 `vercel.json` 과 같은 모양이다 (2026-09-15).
  // **로컬과 운영이 같은 길을 써야** 「깨우기가 안 간다」를 여기서 잡을 수 있다.
  const api로 = 요청.url.startsWith("/api/") || 요청.url === "/healthz";
  const 뒤 = httpRequest(
    {
      host: "127.0.0.1",
      port: api로 ? api포트 : 웹포트,
      method: 요청.method,
      path: 요청.url,
      // **헤더를 그대로 넘긴다.** `Host` 를 바꾸지 않는 것이 요점이다 — 서버가 삽화 주소를
      // 만들 때 그 값을 보고, **바꾸면 `<img>` 가 딴 곳을 가리킨다**(`adr/0012` 따라오는 작업 ①).
      headers: 요청.headers,
    },
    (뒤응답) => {
      // **`Set-Cookie` 를 포함해 그대로 돌려준다.** 여기서 하나라도 떨구면
      // **로그인이 안 되는 것을 하네스가 만든 것**이 된다.
      응답.writeHead(뒤응답.statusCode ?? 502, 뒤응답.headers);
      뒤응답.pipe(응답);
    },
  );
  뒤.on("error", (e) => {
    console.error(`[프록시] ${요청.method} ${요청.url} → ${e.message}`);
    if (!응답.headersSent) 응답.writeHead(502);
    응답.end();
  });
  // **⛔ 양쪽 끝에 오류 처리를 단다** (2026-09-15). 없으면 **브라우저가 요청을 중간에
  // 끊을 때**(화면 이동·프리페치 취소) `ECONNRESET` 이 **처리되지 않은 'error' 이벤트**가 되어
  // **프록시 프로세스가 통째로 죽는다.** 그러면 그 뒤 모든 단계가 실패하고,
  // **증상은 「아이가 코드를 넣어도 안 넘어간다」로 보인다** — 제품이 아니라 하네스다.
  요청.on("error", () => 응답.destroy());
  응답.on("error", () => 요청.destroy());
  요청.pipe(뒤);
};

const 프록시 = https로
  ? createTlsServer({ cert: readFileSync(인증서), key: readFileSync(열쇠) }, 프록시핸들러)
  : createServer(프록시핸들러);

// **연결 자체가 깨진 경우**(TLS 아님·중간 끊김). 기본 동작은 400 을 쓰려다 죽는 것이다.
프록시.on("clientError", (_e, 소켓) => 소켓.destroy());
// **업그레이드(웹소켓)를 따로 넘긴다.** `next dev` 의 HMR 이 그걸로 붙는데,
// 일반 요청처럼 다루면 `Parse Error: Expected HTTP/` 가 나고 **화면이 통째로 안 산다** —
// 2026-09-14 에 실제로 그랬다. **제품이 아니라 하네스가 만든 실패**라 여기서 막는다.
프록시.on("upgrade", (요청, 소켓, 머리) => {
  const 뒤 = httpRequest({
    host: "127.0.0.1",
    port: 웹포트,
    method: 요청.method,
    path: 요청.url,
    headers: 요청.headers,
  });
  뒤.on("upgrade", (뒤응답, 뒤소켓, 뒤머리) => {
    소켓.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(뒤응답.headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`)
          .join("") +
        "\r\n",
    );
    뒤소켓.write(뒤머리);
    // **뒤쪽 소켓도 마찬가지다** — 업그레이드가 선 뒤에 끊기는 쪽은 둘 다일 수 있다.
    뒤소켓.on("error", () => 뒤소켓.destroy());
    소켓.pipe(뒤소켓).pipe(소켓);
  });
  // **HMR 이 못 붙어도 검사는 돈다.** 여기서 죽이지 않는다 — 재려는 것이 HMR 이 아니다.
  뒤.on("error", () => 소켓.destroy());
  // **⛔ 두 소켓에 오류 처리를 단다.** HMR 소켓은 **화면이 넘어갈 때마다 끊긴다** —
  // `pipe` 는 오류를 안 옮기므로 처리 없는 `ECONNRESET` 하나가 **프록시를 죽인다.**
  // **2026-09-15 에 그것으로 서버 갈래가 빨갰고**, 백엔드가 「`Invalid WebSocket frame` 은
  // HMR 이라 별개일 것」이라고 한 그 소켓이 맞다 — **별개가 아니라 그것이 원인이었다.**
  소켓.on("error", () => 소켓.destroy());
  뒤.end(머리);
});

프록시.listen(프록시포트, "127.0.0.1", () => {
  console.log(`[하네스] 프록시 http://127.0.0.1:${프록시포트} — /api/* → api, 나머지 → web`);

  if (!보여주기) return;

  // **사람이 읽는 줄이다.** 위 줄들은 기계가 뜬 것을 적은 것이고 이건 **볼 사람을 위한 것**이다.
  // **끄지 않는다** — Playwright 가 없으니 이 프로세스가 살아 있는 동안 서버도 산다.
  console.log(`
────────────────────────────────────────────────────────────
  튜토리얼 「나침반 깨우기」를 눈으로 봅니다

  1. 브라우저에서 열기   ${볼주소}/parents/signup
  2. 학부모로 가입 → 아이 추가 → 접속 코드(6자리)를 받는다
  3. ${볼주소}/child/auth 에 그 코드를 넣는다
  4. T1 → T2 → T3 가 순서대로 나옵니다

${https로
    ? `  ✅ 사파리로 보셔도 됩니다 — https 로 섰습니다 (.certs 의 mkcert 인증서).
     운영과 같은 조건입니다: __Host- 쿠키가 Secure 를 강제하는데 https 라 앉습니다.`
    : `  ⛔ 크롬으로 열어 주세요 — 인증서가 없어 http 로 섰습니다.
     사파리는 http 로 온 Secure 쿠키를 버려서 가입이 로그인 ↔ 가입으로 돕니다.
     사파리로 보려면 별도 터미널에서: make certs`}

  ⛔ 돈이 안 나갑니다 — 가짜 앞단 + 못 쓰는 키입니다.

  이번 판의 등급: ${보여줄등급 ?? "G3 (전설) — 가짜 기본값"}
  ⚠ 한 판은 한 등급입니다. 무엇을 쓰든 같은 등급이 나옵니다.
     (가짜가 아이 문장을 안 읽습니다 — 그게 그 장치의 원칙입니다)

     다른 등급으로 보시려면 서버를 그 등급으로 다시 띄웁니다:
       pnpm 보여주기:되묻기   G0 — 되묻기가 뜨고, 2회 뒤 그냥 진행합니다
       pnpm 보여주기:낮게     G1 — 낮은 티어. T2 권유가 실제로 뜹니다
       pnpm 보여주기          G3 — 전설. T2 권유는 안 뜹니다(대표 판정 ①)

  액자에 뜨는 그림: ${보여줄그림.출처}
  ⚠ 그림을 보는 자리가 아니라 액자가 제대로 사는지를 보는 자리입니다.
     ⛔ 다만 비율은 진짜여야 합니다 — 삽화는 784×1353 으로 세로가 깁니다.
        다른 그림으로 보시려면: E2E_SHOW_ARTWORK=/경로/그림.jpg pnpm 보여주기
  ⛔ 이건 이 기계의 임시 서버입니다. 운영이 켜진 것이 아닙니다.

  끄기: Ctrl+C
────────────────────────────────────────────────────────────
`);
});
