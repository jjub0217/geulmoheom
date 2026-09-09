import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **정적 하네스가 돌기 전에 「이 빌드가 무엇을 향해 구워졌나」를 본다** (2026-09-09).
 *
 * **`web/out` 하나를 두 용도가 공유한다. 겉이 같고 안이 다르다.**
 * - **정적 e2e 용** — `NEXT_PUBLIC_API_BASE_URL=/api/v1` (**상대 경로**. 정적 서버와 api 를
 *   같은 오리진으로 두는 전제라 `page.route` 가 가로챌 수 있다)
 * - **실기기용** — `https://<LAN 호스트>:8000/api/v1` (**절대 주소**. `make build-out` 이 박는다)
 *
 * **시각으로는 못 가른다.** 2026-09-09 에 PM 이 `out/` 의 **구운 시각만 보고** 「최신이니
 * 다시 안 구워도 된다」고 했다가 틀렸다 — 그대로 올렸으면 **API 호출이 전부 어긋나
 * 「화면은 뜨는데 아무것도 안 되는」 상태**가 됐고, 전날 「JS 가 안 산다」와 **증상이 겹쳐
 * 또 오진했을 것**이다. **「최신인가」와 「무엇을 향해 구웠나」는 다른 물음이다.**
 *
 * **표식 파일을 두지 않고 번들을 직접 본다.** 표식은 **빌드가 지워 주지 않으면 남아서 거짓말**을 하고,
 * 무엇보다 **표식은 진단이지 방지가 아니다** — 막으려면 **쓰는 자리에서 죽어야** 한다.
 * 번들에 박힌 값이 **유일한 사실**이다 (`NEXT_PUBLIC_*` 는 빌드 때 문자열로 인라인된다).
 */

/** 절대 주소로 박힌 api. 이게 보이면 **실기기용 빌드**다. */
const 절대주소 = /https?:\/\/[^"'`\s]+\/api\/v1/;

/**
 * **Playwright 가 `globalSetup` 에 `FullConfig` 를 넘긴다.** 그래서 여기에 인자를 두면
 * 그 객체가 경로 자리로 들어온다 — **인자 없는 껍데기를 따로 둔다.**
 */
export default function 정적빌드확인() {
  빌드대상확인(join(process.cwd(), "out"));
}

/** 검사할 수 있게 뿌리를 받는다. **가드 자체를 안 재면 그것도 안 무는 가드다.** */
export function 빌드대상확인(뿌리: string) {
  const 청크방 = join(뿌리, "_next", "static", "chunks");

  let 파일들: string[];
  try {
    파일들 = readdirSync(청크방).filter((f) => f.endsWith(".js"));
  } catch {
    throw new Error(
      "out/ 이 없다. 먼저 구워라 —  NEXT_PUBLIC_API_BASE_URL=/api/v1 pnpm build",
    );
  }

  const 걸린것: string[] = [];
  let 상대경로있나 = false;

  for (const 이름 of 파일들) {
    const 내용 = readFileSync(join(청크방, 이름), "utf8");
    const 맞은것 = 절대주소.exec(내용);
    if (맞은것) 걸린것.push(`${이름}: ${맞은것[0]}`);
    if (내용.includes('"/api/v1"')) 상대경로있나 = true;
  }

  if (걸린것.length > 0) {
    throw new Error(
      [
        "이 out/ 은 **실기기용 빌드**다 (api 주소가 절대 주소로 박혀 있다).",
        ...걸린것.slice(0, 3).map((줄) => `  ${줄}`),
        "",
        "정적 하네스는 상대 경로 빌드를 전제한다 — 같은 오리진이어야 page.route 가 가로챈다.",
        "다시 구워라:  NEXT_PUBLIC_API_BASE_URL=/api/v1 pnpm build",
        "",
        "⚠ 실기기용이 필요하면 `make build-out` 으로 다시 구워야 한다. 둘은 겉이 같고 안이 다르다.",
      ].join("\n"),
    );
  }

  if (!상대경로있나) {
    // **못 찾은 것을 통과로 두지 않는다.** 번들 모양이 바뀌어 못 찾게 되면
    // 이 검사는 **아무것도 안 재면서 초록**이 된다 — 오늘 하루 종일 잡은 그 모양이다.
    throw new Error(
      [
        "out/ 에서 api 주소를 못 찾았다. **통과로 넘기지 않는다.**",
        "번들 모양이 바뀌었거나 빌드가 낡았다 — 다시 구워라:",
        "  NEXT_PUBLIC_API_BASE_URL=/api/v1 pnpm build",
      ].join("\n"),
    );
  }
}
