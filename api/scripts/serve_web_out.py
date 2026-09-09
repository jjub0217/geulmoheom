"""정적 빌드(`web/out`)를 mkcert 인증서로 LAN 에 연다 — 사무실 실행 진단용.

**왜 필요한가.** 2026-09-08 리허설에서 **iPad(Safari 17)에서 화면은 뜨는데 JS 가
살아나지 못했다.** `next dev` 번들과 `output: "export"` 프로덕션 빌드는 **다운레벨·
미니파이가 달라서** 둘 중 한쪽에서만 죽을 수 있다. **어느 쪽인지가 이 건의 크기를
정한다** — dev 에만 있으면 프리테스트 서빙 방식만 바꾸면 되고, 양쪽에 있으면
**앱 코드 문제라 파일럿까지 막힌다.**

**그 iPad 는 6세대이고 iPadOS 17 이 마지막이다.** 「업데이트하면 되겠지」가 안 통한다 —
프리테스트를 이 기기로 하는 한 **Safari 17 에서 반드시 돌아야 한다.**

**`pnpm start`(`serve out`)를 안 쓴다.** 그건 http 이고, 우리는 `__Host-` 쿠키 때문에
개발도 https 다. 인증서를 물릴 수 있어야 해서 여기서 직접 연다.

**포트를 `next dev` 와 다르게 쓴다.** 내리지 않고 나란히 세워야 **같은 기기에서 둘을
번갈아 열어 비교**할 수 있다 — 그게 이 스크립트의 존재 이유다.
**그래서 api 의 `CORS_ORIGINS` 에 이 포트도 들어가 있어야 한다** (`Makefile` `dev-lan`).

실행:  `make serve-out`   (저장소 루트에서)
"""

import functools
import http.server
import re
import socketserver
import ssl
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "web" / "out"
SRC = REPO_ROOT / "web" / "src"
CERT = REPO_ROOT / ".certs" / "geulmoheom.test.pem"
KEY = REPO_ROOT / ".certs" / "geulmoheom.test-key.pem"
PORT = 3001


def _최근시각(폴더: Path) -> float | None:
    """그 폴더 아래에서 **가장 최근에 바뀐 파일의 시각.** 파일이 없으면 `None`."""
    시각들 = [p.stat().st_mtime for p in 폴더.rglob("*") if p.is_file()]
    return max(시각들) if 시각들 else None


def 낡았나(out: Path, src: Path) -> str | None:
    """`out` 이 `src` 보다 오래됐으면 사유, 아니면 `None`.

    **오늘 두 번 났고 둘이 거울상이다** (2026-09-09). 하나는 **시각은 최신인데 대상이
    다른 빌드**였고, 하나는 **대상은 맞는데 시각이 낡은 빌드**였다. **둘 다 `out/` 을
    열어봐서는 안 갈린다** — 그리고 **낡은 화면은 서버도 주소도 멀쩡해서 겉으로
    아무 문제가 없어 보인다.** 아이가 고치기 전 화면을 보고, 그것이 판정에 들어간다.

    **억지로 띄우는 길을 두지 않는다** (프론트 제안, 채택). 있으면 급할 때 그걸 쓰고,
    **급할 때가 정확히 오늘 같은 때**다.

    **`git checkout`·`git stash` 가 mtime 을 바꾼다** — 그때는 안 낡았는데 낡았다고
    나올 수 있다. **그 방향으로 틀리는 쪽을 택한다**: 「괜히 한 번 더 굽는다」가
    「낡은 화면이 아이에게 나간다」보다 싸다.
    """
    빌드 = _최근시각(out)
    소스 = _최근시각(src)
    # **없는 것을 근거로 안 막는다.** 여기서 죽으면 띄울 방법이 사라진다.
    if 빌드 is None or 소스 is None:
        return None
    if 소스 <= 빌드:
        return None
    from datetime import datetime

    꼴 = "%H:%M:%S"
    return (
        f"`web/out` 이 `web/src` 보다 낡았다 — "
        f"빌드 {datetime.fromtimestamp(빌드).strftime(꼴)} · "
        f"소스 {datetime.fromtimestamp(소스).strftime(꼴)}"
    )


# 번들 안의 api 주소. **번들러가 백틱 템플릿으로 인라인한다** — `` `/api/v1${경로}` `` —
# 그래서 `"/api/v1"` 큰따옴표로만 찾으면 **진짜 빌드에서 못 찾는다.** 프론트가 자기
# 가드에서 실제로 물렸고(2026-09-09), 이쪽도 PM 의 빌드를 의심할 때 같은 자리를 밟았다.
# **두 세션이 따로 밟았으면 우연이 아니라 이 저장소의 성질이다.**
_절대주소 = re.compile(r"https?://[^\s\"'`]+/api/v1")
_상대경로 = "/api/v1"


def 대상이맞나(out: Path) -> str | None:
    """번들이 **절대 주소**로 구워졌으면 `None`, 아니면 사유 (2026-09-09 프론트 지적).

    **낡음 검사와 정반대 방향이다.** e2e 하네스(`playwright.static.config.ts`)는
    **상대 경로여야** 하고 — 정적 서버와 api 를 같은 오리진으로 두고 가로챈다 —
    **여기는 절대 주소여야** 한다. 이 서버는 **프록시가 아니라 순수 정적 서버**라
    `/api/v1` 을 받아 줄 곳이 없다.

    **상대 경로 빌드를 여기에 올리면 전부 404 다.** 화면은 뜨는데 아무것도 안 되고,
    그건 **「JS 가 안 산다」와 증상이 겹친다** — 2026-09-08 리허설에서 세 시간을 쓴 자리다.

    **못 찾으면 막는다.** 조용히 통과시키면 빌드 모양이 바뀐 날부터 아무것도 안 잰다.
    """
    글자 = ""
    for 파일 in out.rglob("*.js"):
        글자 += 파일.read_text(errors="ignore")

    if _절대주소.search(글자):
        return None
    if _상대경로 in 글자:
        return (
            "`web/out` 이 **상대 경로**(`/api/v1`)로 구워졌다 — e2e 하네스용이다. "
            "이 서버에는 api 가 없어 전부 404 가 난다"
        )
    return "`web/out` 에서 api 주소를 못 찾았다. 빌드 모양이 바뀌었는지 본다"


class 핸들러(http.server.SimpleHTTPRequestHandler):
    """정적 export 를 브라우저가 기대하는 대로 돌려준다."""

    def end_headers(self) -> None:
        # **캐시를 막는다.** 리허설에서 **Safari 가 옛 번들을 들고 있어** 고친 뒤에도
        # 같은 증상이 재현됐다(2026-09-08). 진단 중에 그 변수를 없앤다.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):  # type: ignore[override]
        """`output: "export"` 는 `/child/auth` 를 `child/auth.html` 로 굽는다.

        **`.html` 파일을 디렉터리보다 먼저 본다.** export 는 같은 이름의 디렉터리도
        같이 만드는데(`child/auth/` 안에 RSC 페이로드가 들어간다), 기본 구현은
        **디렉터리를 먼저 골라 301 로 보내고 그 안에 `index.html` 이 없어 404 가 난다.**
        **그러면 앱 결함처럼 보인다** — 진단 중에 가장 나쁜 종류의 거짓 신호다.
        """
        길, _, 물음 = self.path.partition("?")
        if not 길.endswith("/") and Path(self.translate_path(길) + ".html").is_file():
            self.path = 길 + ".html" + (("?" + 물음) if 물음 else "")
        return super().send_head()

    def log_message(self, 형식: str, *인자: object) -> None:
        # 한 줄로 줄인다. **쿼리 값을 안 남긴다** — 기본 구현은 요청 라인을 통째로 찍는다.
        sys.stderr.write(f"{self.command} {self.path.split('?')[0]}\n")


def main() -> None:
    if not OUT.is_dir():
        raise SystemExit(f"{OUT} 이 없다. 먼저 빌드한다 — `make build-out`")
    if not CERT.exists():
        raise SystemExit("인증서가 없다. 먼저 `make certs-lan`")
    if 사유 := 낡았나(OUT, SRC):
        raise SystemExit(f"{사유}\n→ 먼저 `make build-out`")
    if 사유 := 대상이맞나(OUT):
        raise SystemExit(f"{사유}\n→ 먼저 `make build-out`")

    맥락 = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    맥락.load_cert_chain(CERT, KEY)

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(
        ("0.0.0.0", PORT), functools.partial(핸들러, directory=str(OUT))
    ) as 서버:
        서버.socket = 맥락.wrap_socket(서버.socket, server_side=True)
        print(f"정적 빌드 → https://<호스트>:{PORT}  ({OUT})", flush=True)
        print("**끝나면 끈다.** LAN 에 열려 있다.", flush=True)
        서버.serve_forever()


if __name__ == "__main__":
    main()
