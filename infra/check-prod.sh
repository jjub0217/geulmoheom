#!/usr/bin/env bash
#
# 운영 두 곳이 「지금 무엇을 내보내고 있는지」를 잰다 (`주차계획/W6.md` 11번).
#
# ⛔ 왜 있나 — 2026-09-14 하루에 「연결은 있어 보이는데 조용히 안 돈다」를 셋 밟았다
# (Vercel · Render · Actions). **Vercel 은 반나절 안 돌았고 빨간불이 하나도 없었다.**
# 「Ready」와 「내용이 갔다」를 사람이 네 번 손으로 갈랐다.
#
# ⛔ 새로 정하는 기준이 없다. W6 완료 판정 1·2·3 을 그대로 명령으로 옮긴 것이다.
# 기준이 바뀌면 그 문서가 먼저 바뀌고 여기가 따라온다.
#
# ⛔ CI 에 얹지 않는다 — 운영을 재는 것이라 push 때가 아니라 **배포 뒤에 사람이 부른다.**
# 얹으면 운영이 잠깐 잠든 새벽에 빨개지고, 그러면 아무도 안 본다.
#
# ⚠ api 는 무료 티어라 잠든다. 첫 요청이 30~50초 걸린다 — 그래서 넉넉히 기다리고,
#   **「못 닿았다」와 「어긋났다」를 따로 찍는다.** 둘을 섞으면 이 명령이 있으나 마나다.

# ⚠ 변수 이름만 영문이다. **셸이 한글 변수를 못 받는다** — POSIX 가 변수 이름을
#   `[A-Za-z_][A-Za-z0-9_]*` 로 못 박아 두었고, `mismatch=0` 은 **대입이 아니라 「명령을 찾는다」**로
#   읽혀 `command not found` 가 난다 (2026-09-15 실측). **함수 이름은 통과한다** — 그래서
#   `잰다`·`받기`·`상태` 는 한글이다. `web/CLAUDE.md` 의 훅·컴포넌트 이름과 같은 부류 —
#   **규칙의 예외가 아니라 도구의 제약**이다.

set -uo pipefail

WEB="${WEB_URL:-https://geulmoheom-web-six.vercel.app}"
API="${API_URL:-https://geulmoheom-api.onrender.com}"
# 옛 주소. **접근 불가한 팀 프로젝트가 쥐고 있어 지울 수 없다** (`adr/0012`).
OLD_WEB="${OLD_WEB_URL:-https://geulmoheom-web.vercel.app}"

mismatch=0
unreachable=0

# 본문을 받는다. 못 닿으면 빈 문자열이고 종료 코드로 갈린다.
받기() { curl -fsS --max-time 90 "$1" 2>/dev/null; }
# 상태 코드만 본다. 못 닿으면 000 이다 — **404 와 구분돼야 한다.**
상태() { curl -s -o /dev/null -w "%{http_code}" --max-time 90 "$1" 2>/dev/null; }

잰다() { # 잰다 <이름> <기대> <잰값>
	if [ "$2" = "$3" ]; then
		printf '  ✓ %-38s %s\n' "$1" "$3"
	elif [ "$3" = "000" ]; then
		printf '  ⚠ %-38s %s (기대 %s) — 닿지 못했다\n' "$1" "$3" "$2"
		unreachable=$((unreachable + 1))
	else
		printf '  ✘ %-38s %s (기대 %s)\n' "$1" "$3" "$2"
		mismatch=$((mismatch + 1))
	fi
}

echo "api  $API"
body=$(받기 "$API/openapi.json")
if [ -z "$body" ]; then
	잰다 "/openapi.json" "200" "000"
else
	# 웹 전환이 갔는지 (`adr/0014`). **계약에 `standalone` 이 남아 있으면 옛 빌드다.**
	잰다 "/openapi.json 의 standalone" "0건" "$(printf '%s' "$body" | grep -c standalone)건"
fi

echo
echo "web  $WEB"
home=$(받기 "$WEB/")
if [ -z "$home" ]; then
	잰다 "/" "200" "000"
else
	# 홈 화면 앱을 버렸다 (`adr/0014`). 셋 중 `appleWebApp` 이 핵심이다 —
	# **홈 화면 추가 자체는 못 막고, 막을 수 있는 것은 격리된 컨텍스트로 열리는 것**이다.
	잰다 "manifest 링크" "0개" "$(printf '%s' "$home" | grep -oci 'rel="manifest"')개"
	잰다 "apple-mobile-web-app-capable" "0개" "$(printf '%s' "$home" | grep -oci 'apple-mobile-web-app-capable')개"
fi
잰다 "/sw.js" "404" "$(상태 "$WEB/sw.js")"
# **학부모가 다시 들어올 길** (`adr/0014` 결정 4 — 세션이 2시간이다).
# 09-14 에 **서버는 2시간으로 배포됐는데 이 화면이 운영에 없어** 구멍이 열려 있었다.
잰다 "/parents/login" "200" "$(상태 "$WEB/parents/login")"

echo
echo "옛 web  $OLD_WEB"
old_sw=$(상태 "$OLD_WEB/sw.js")
if [ "$old_sw" = "200" ]; then
	# **여기서 어긋남으로 세지 않는다.** 지우는 것은 대표 몫이고(접근 불가한 팀 계정),
	# 우리가 고칠 수 없는 것으로 명령을 빨갛게 두면 **빨간불이 배경음이 되어 아무도 안 본다.**
	# 대신 **지워질 때까지 계속 말한다.**
	printf '  ⚠ %-38s %s — 서비스워커를 아직 뿌린다. 지우는 것은 대표 몫 (adr/0012)\n' "/sw.js" "$old_sw"
else
	printf '  ✓ %-38s %s\n' "/sw.js" "$old_sw"
fi

echo
if [ "$mismatch" -gt 0 ]; then
	echo "어긋난 것 ${mismatch}개. 위의 ✘ 가 무엇이 다른지 말한다."
	echo "→ 배포가 갔는지 먼저 본다. 「Ready」는 「내용이 갔다」가 아니다 (adr/0012)."
	exit 1
fi
if [ "$unreachable" -gt 0 ]; then
	echo "닿지 못한 것 ${unreachable}개. **어긋난 것과 다르다** — 잠들었거나 내려갔다."
	echo "→ api 무료 티어는 첫 요청이 30~50초다. 한 번 더 부른다."
	exit 2
fi
echo "운영 둘 다 기대대로다."
