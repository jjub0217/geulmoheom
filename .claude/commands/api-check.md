---
description: api-requests 현황 확인 — 상대가 처리했는지, 지금 착수해도 되는지
allowed-tools: Bash(git:*), Bash(ls:*), Bash(cat:*), Bash(curl:*), Bash(make:*), Read, Glob, Grep
---

`api-requests/` 현황을 확인하고, 사용자가 지금 무엇을 할 수 있는지 알려줘.

## 현재 상태

> 경로는 저장소 루트 기준이다. 이 명령은 `api/`·`web/` 안에서도 돌기 때문에
> 상대 경로로 두면 조용히 「없음」이 된다.
> **「미결」·「완료」의 출력이 비어 있으면 그 폴더에 항목이 없다는 뜻**이다(`.gitkeep` 은 안 보인다).

- 미결: !`ls -1 "$(git rev-parse --show-toplevel)/api-requests/open/" 2>/dev/null || echo "(디렉터리 없음)"`
- 완료: !`ls -1 "$(git rev-parse --show-toplevel)/api-requests/done/" 2>/dev/null || echo "(디렉터리 없음)"`
- 최근 변경: !`git log --oneline -8 -- :/api-requests/ 2>/dev/null || true`
- 원격 대비: !`git fetch -q origin 2>/dev/null; git log --oneline HEAD..origin/main -- :/api-requests/ 2>/dev/null || true`

## 할 일

**1. 원격에 새 커밋이 있으면 먼저 알린다.** `git pull`을 제안하고, 사용자가 동의하면 받은 뒤 다시 확인한다.

**2. `open/` 항목을 하나씩 읽고 표로 정리한다.**
번호 · 제목 · 종류(요청/합의/작업) · 담당 · **막힘 여부** · **`접수` 날짜**.

`접수`가 비어 있는 항목은 **상대가 아직 읽지 않았다는 뜻**이다. 이걸 명확히 짚어라.
알림 장치가 없으므로, 사용자가 올린 항목의 `접수`가 비어 있으면 **상대에게 직접 말하라고 알려준다.**

**3. `done/`으로 최근 옮겨진 항목을 찾는다.**
`git log --diff-filter=R -- api-requests/` 로 이동 커밋을 확인하고, 각 파일의 「완료 기록」에서
결정·커밋·메모를 읽어 **요청한 대로 됐는지, 다르게 구현됐는지**를 보고한다.
완료 기록이 비어 있으면 그 사실을 지적한다 — 옮기기만 하고 안 채운 것이다.

**4. 착수 가능 여부를 기계로 검증한다. 이것이 이 명령어의 핵심이다.**

`done/`에 있다는 것만으로 착수 가능이라고 말하지 마라. 파일은 사람이 옮긴 주장일 뿐이다.

- 목 서버/api가 떠 있는지: `curl -sf -o /dev/null http://localhost:8000/openapi.json`
- 떠 있으면 `make contracts` 를 돌려 `web/src/api/types.gen.ts` 가 갱신되는지, 해당 타입이 실제로 생기는지 확인
- 안 떠 있으면 `make dev-api` 로 먼저 띄우라고 안내하고, **검증하지 않은 채로 "착수 가능"이라고 말하지 않는다**

파일 상태와 기계 신호가 **어긋나면 코드가 맞다.** 어긋난 사실을 그대로 보고한다.

**5. 마지막에 다음 행동 하나를 제안한다.**

- 착수 가능한 항목이 있으면 → 그 작업을 이어서 할지 묻는다
- 막힘("예")인데 아직 `open/`에 있으면 → 그게 지금 최우선임을 알린다
- 사용자가 올린 항목의 `접수`가 비어 있으면 → 상대에게 말할 것을 알린다
- 아무것도 없으면 → 그렇게만 말한다. 없는 일을 만들지 않는다

$ARGUMENTS
