#!/usr/bin/env bash
#
# 로컬 개발 인증서 — mkcert 로 `.test` 두 호스트를 굽는다.
# 근거: `docs/api/공통규약.md` 「인증 쿠키 · 개발 환경도 https다」 (미결 11-2 확정).
#
# `__Host-` 쿠키는 `Secure` 를 강제하는데, `Secure` 쿠키가 `http://localhost` 에 붙는지가
# 브라우저마다 갈린다 (Chromium 허용, Safari 불확실 — WebKit #281149 REOPENED).
# 파일럿이 태블릿이라 Safari 를 건너뛸 수 없어 개발 환경 자체를 https 로 옮긴다.
#
#   make certs        # 저장소 루트에서. api/ 안이면 `make -C .. certs`
#
# **별도 터미널에서 돌린다. Claude 세션 안에서는 sudo 프롬프트에 입력이 안 들어간다** —
# 그러면 인증서 발급(sudo 불필요)만 되고 키체인 등록과 `/etc/hosts` 가 통째로
# 건너뛰어져 **조용히 절반만 된 상태**로 끝난다. 2026-09-07 실제 발생.
#
# **sudo 를 두 번 묻는다** — 루트 CA 를 시스템 키체인에 넣을 때, `/etc/hosts` 에 줄을 넣을 때.
# `/etc/hosts` 를 손대지 않으려면 `--no-hosts`.
#
# 변수 이름을 영문으로 둔다. macOS 기본 bash 는 3.2 라 한글 식별자에서 구문 오류가 난다
# (파이썬 쪽 한글 식별자와 다르다).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CERT_DIR="$REPO_ROOT/.certs"
API_HOST="api.geulmoheom.test"
WEB_HOST="app.geulmoheom.test"
CERT="$CERT_DIR/geulmoheom.test.pem"
KEY="$CERT_DIR/geulmoheom.test-key.pem"

EDIT_HOSTS=1
[ "${1:-}" = "--no-hosts" ] && EDIT_HOSTS=0

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert 가 없다:  brew install mkcert nss" >&2
  exit 1
fi

# 1. 루트 CA — 시스템 키체인 + (nss 가 깔려 있으면) Firefox
echo "→ mkcert -install  (시스템 키체인. sudo 를 물을 수 있다)"
mkcert -install

# 2. 인증서 — 두 호스트를 한 장에 담는다. 나누면 갱신 때 한쪽만 만료된다
mkdir -p "$CERT_DIR"
echo "→ 인증서: $API_HOST · $WEB_HOST → $CERT_DIR"
mkcert -cert-file "$CERT" -key-file "$KEY" "$API_HOST" "$WEB_HOST"
chmod 600 "$KEY"

# 3. 이름 풀이 — macOS 는 `.test` 를 자동으로 풀지 않는다
if [ "$EDIT_HOSTS" -eq 1 ]; then
  MISSING=""
  for HOST in "$API_HOST" "$WEB_HOST"; do
    if ! grep -qE "^[^#]*[[:space:]]${HOST}([[:space:]]|\$)" /etc/hosts; then
      MISSING="$MISSING $HOST"
    fi
  done

  if [ -n "$MISSING" ]; then
    echo "→ /etc/hosts 에 추가 (sudo):  127.0.0.1$MISSING"
    for HOST in $MISSING; do
      printf '127.0.0.1\t%s\n' "$HOST" | sudo tee -a /etc/hosts >/dev/null
    done
  else
    echo "→ /etc/hosts 는 이미 되어 있다"
  fi
fi

# 4. 실제로 됐는지 확인한다 — **「됐다」를 출력하기 전에**
#
# `mkcert -install` 은 sudo 프롬프트를 못 받아도 0 을 반환한다. `set -e` 가 안 잡는다.
# 그래서 종료 코드가 아니라 **결과 상태**를 본다.
FAILED=""

[ -s "$CERT" ] && [ -s "$KEY" ] || FAILED="$FAILED\n  - 인증서가 없다: $CERT"

if ! security find-certificate -a -c mkcert /Library/Keychains/System.keychain >/dev/null 2>&1; then
  FAILED="$FAILED\n  - 루트 CA 가 시스템 키체인에 없다 (mkcert -install 이 sudo 를 못 받았다)"
fi

if [ "$EDIT_HOSTS" -eq 1 ]; then
  for HOST in "$API_HOST" "$WEB_HOST"; do
    grep -qE "^[^#]*[[:space:]]${HOST}([[:space:]]|\$)" /etc/hosts \
      || FAILED="$FAILED\n  - /etc/hosts 에 $HOST 가 없다"
  done
fi

if [ -n "$FAILED" ]; then
  echo >&2
  # shellcheck disable=SC2059
  printf "절반만 됐다:$FAILED\n" >&2
  echo >&2
  echo "**별도 터미널에서 다시 돌린다.** Claude 세션 안에서는 sudo 프롬프트에 입력이 안 들어간다." >&2
  exit 1
fi

echo
echo "됐다. 확인:"
echo "  make dev-api"
echo "  curl -sf https://$API_HOST:8000/healthz   # 정상이면 200"
