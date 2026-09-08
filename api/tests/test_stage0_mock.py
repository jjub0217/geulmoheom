"""목 서버가 `docs/api/Stage0.md` 대로 응답하는지 본다.

프론트는 이 응답 모양에 화면을 맞춘다. 모양이 틀리면 프론트가 두 번 짠다.
"""

import logging
import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import attempts
from app.auth import CHILD_COOKIE, MAX_AGE_SECONDS, PARENT_COOKIE
from app.config import REPO_ROOT
from app.docs_md import 민, 읽기
from app.evaluator import 평가결과
from app.models import Parent
from app.moderation import SELF_HARM, 검사결과, 슬러그

SIGNUP = (
    "POST",
    "/api/v1/parents/signup",
    {"email": "a@b.c", "password": "x", "consent": True},
    201,
)
EVENTS = (
    "POST",
    "/api/v1/events",
    {"events": [{"event": "session_start", "ts": "2026-09-01T00:00:00Z"}]},
    204,
)


@pytest.fixture(autouse=True)
def 판정_고정(monkeypatch: pytest.MonkeyPatch) -> None:
    """`X-Mock-Outcome` 없는 호출은 **실제 Evaluator·입력 검사로 간다** (W2 2번 · E-1).

    이 파일은 응답 **모양**이 `Stage0.md` 와 맞는지만 본다. 네트워크를 타면 안 되고,
    타서도 판정이 흔들리면 계약 테스트가 아니라 모델 테스트가 된다.

    **둘 다 갈아끼운다.** 검사를 안 끼우면 모델 미설정 경로로 빠지는데, 그건 이 파일이
    확인하려는 것이 아니다 — 검사 자체의 동작은 `tests/test_moderation.py` 몫이다.
    """

    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade="G2", signals=["adj:은빛", "adv:살금살금"])

    async def _통과(text: str) -> 검사결과:
        return 검사결과(blocked=False)

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _통과)


# ── 인증 ─────────────────────────────────────────────────

인증_필요 = [
    ("GET", "/api/v1/parents/me"),
    ("GET", "/api/v1/child/me"),
    ("GET", "/api/v1/cards/next"),
    ("GET", "/api/v1/book"),
    ("GET", "/api/v1/artworks/a1"),
]


@pytest.mark.parametrize(("method", "path"), 인증_필요)
def test_토큰이_없으면_401(익명: TestClient, method: str, path: str):
    response = 익명.request(method, path)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_401_메시지는_아이가_읽는_문장이다(익명: TestClient):
    body = 익명.get("/api/v1/cards/next").json()["error"]

    assert body["message"] == "다시 한 번 들어와 주세요"
    assert "UNAUTHORIZED" not in body["message"]


def test_authorization_헤더로는_들어가지_못한다(익명: TestClient):
    """미결 11-2 는 HttpOnly 쿠키로 확정됐다. **`Bearer` 경로를 되살리지 않는다.**

    남겨두면 프론트가 토큰을 JS 로 보관하는 길이 다시 열리고, 그 순간 XSS 한 번에
    30일짜리 자녀 토큰이 나간다.
    """
    response = 익명.get("/api/v1/cards/next", headers={"Authorization": "Bearer mock"})

    assert response.status_code == 401


def test_자녀_쿠키로_학부모_API_를_부르면_403(익명: TestClient):
    """401 이 아니다 — 로그인이 풀린 게 아니라 역할이 다르다 (`FORBIDDEN_ROLE`)."""
    익명.cookies.set(CHILD_COOKIE, "mock")

    response = 익명.get("/api/v1/parents/me")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN_ROLE"


def test_학부모_쿠키로_자녀_API_를_부르면_403(익명: TestClient):
    익명.cookies.set(PARENT_COOKIE, "mock")

    response = 익명.get("/api/v1/child/me")

    assert response.status_code == 403


# ── 토큰은 body 에 없다 ──────────────────────────────────

# **실제 계정이 있어야 도는 흐름이 됐다** (E-3). 목이던 때는 아무 값이나 통과했다.
# 페이로드를 여기 못 박지 못하는 이유가 그것이라, 이름만 두고 `굽는요청` 이 채운다.
토큰을_굽는_곳 = [
    ("/api/v1/parents/signup", "signup", PARENT_COOKIE),
    ("/api/v1/parents/login", "login", PARENT_COOKIE),
    ("/api/v1/child/auth", "auth", CHILD_COOKIE),
]


@pytest.fixture
def 굽는요청(학부모행: Parent, 접속코드: str, 비밀번호: str) -> dict[str, dict]:
    """세 경로의 실제 요청 body. **가입만 매번 새 이메일**이다 — 같은 값을 두 번
    보내면 두 번째가 중복으로 422 다."""
    return {
        "signup": {
            "email": f"{uuid.uuid4().hex}@example.test",
            "password": "test-password",
            "consent": True,
        },
        "login": {"email": 학부모행.email, "password": 비밀번호},
        "auth": {"access_code": 접속코드},
    }


@pytest.mark.parametrize(("path", "이름", "쿠키이름"), 토큰을_굽는_곳)
def test_토큰이_응답_body_에_없다(
    익명: TestClient, 굽는요청: dict, path: str, 이름: str, 쿠키이름: str
):
    """`공통규약.md` 「인증 쿠키」 — JS 는 토큰을 읽을 수도 보관할 수도 없다."""
    body = 익명.post(path, json=굽는요청[이름]).json()

    assert "token" not in str(body)


@pytest.mark.parametrize(("path", "이름", "쿠키이름"), 토큰을_굽는_곳)
def test_인증_쿠키_속성이_확정본_그대로다(
    익명: TestClient, 굽는요청: dict, path: str, 이름: str, 쿠키이름: str
):
    """**속성이 하나라도 다르면 로그아웃의 삭제 쿠키가 발급분을 못 지운다.**

    `Domain` 은 **붙어 있으면 안 된다** — `__Host-` 가 host-only 를 요구한다.
    """
    구운것 = 익명.post(path, json=굽는요청[이름]).headers["set-cookie"]

    assert 구운것.startswith(f"{쿠키이름}=")
    assert "HttpOnly" in 구운것
    assert "Secure" in 구운것
    assert "Path=/" in 구운것
    assert "SameSite=Lax" in 구운것
    assert "Domain=" not in 구운것
    assert f"Max-Age={MAX_AGE_SECONDS}" in 구운것


@pytest.mark.parametrize(("path", "이름", "쿠키이름"), 토큰을_굽는_곳)
def test_토큰을_실은_응답은_캐시되지_않는다(
    익명: TestClient, 굽는요청: dict, path: str, 이름: str, 쿠키이름: str
):
    """앞단이 Cloudflare 다. 공용 캐시에 앉으면 다른 사람에게 나간다."""
    response = 익명.post(path, json=굽는요청[이름])

    assert response.headers["cache-control"] == "no-store"


def test_구운_쿠키로_바로_다음_요청이_통과한다(익명: TestClient, 접속코드: str):
    """계약 전체가 실제로 도는지 — body 에 토큰이 없어도 브라우저는 붙일 수 있다."""
    익명.post("/api/v1/child/auth", json={"access_code": 접속코드})

    assert 익명.get("/api/v1/child/me").status_code == 200


# ── 로그아웃 2종 ─────────────────────────────────────────

로그아웃 = [
    ("/api/v1/parents/logout", PARENT_COOKIE, CHILD_COOKIE),
    ("/api/v1/child/logout", CHILD_COOKIE, PARENT_COOKIE),
]


@pytest.mark.parametrize(("path", "지울것", "남길것"), 로그아웃)
def test_로그아웃은_204_다(client: TestClient, path: str, 지울것: str, 남길것: str):
    assert client.post(path).status_code == 204


@pytest.mark.parametrize(("path", "지울것", "남길것"), 로그아웃)
def test_삭제_쿠키의_속성이_발급_때와_같다(client: TestClient, path: str, 지울것: str, 남길것: str):
    """**하나라도 다르면 브라우저가 다른 쿠키로 보고 아무것도 안 지운다** (`Stage0.md` 1·2절).

    그래서 속성은 `app/auth.py` 한곳에서만 나온다 — 여기서 갈라지면 로그아웃이
    204 를 돌려주면서 세션은 살아 있는 상태가 된다.
    """
    지우는것 = client.post(path).headers["set-cookie"]

    assert 지우는것.startswith(f"{지울것}=")
    assert "HttpOnly" in 지우는것
    assert "Secure" in 지우는것
    assert "Path=/" in 지우는것
    assert "SameSite=Lax" in 지우는것
    assert "Domain=" not in 지우는것
    assert "Max-Age=0" in 지우는것


def _가족태블릿(client: TestClient, 이메일: str, 비밀번호: str, 코드: str) -> None:
    """학부모가 가입하고 같은 기기를 아이가 쓴다 — 쿠키 둘이 함께 앉은 실제 상태.

    **`cookies.set()` 으로 심지 않고 서버에게 굽게 한다.** 손으로 심은 쿠키는
    도메인이 비어 있어 서버가 보낸 삭제 `Set-Cookie` 와 짝이 안 맞는다 — 그러면
    로그아웃이 제대로 지우는지를 이 테스트가 영영 못 본다.
    """
    client.post("/api/v1/parents/login", json={"email": 이메일, "password": 비밀번호})
    client.post("/api/v1/child/auth", json={"access_code": 코드})


@pytest.mark.parametrize(("path", "지울것", "남길것"), 로그아웃)
def test_로그아웃은_한쪽_역할만_끊는다(
    익명: TestClient,
    학부모행: Parent,
    접속코드: str,
    비밀번호: str,
    path: str,
    지울것: str,
    남길것: str,
):
    """가족 태블릿이다 — 아이가 내려온다고 학부모까지 로그아웃되면 안 된다.

    204 만 보고 넘기지 않는다. 브라우저(테스트 클라이언트)의 쿠키통을 직접 본다.
    """
    _가족태블릿(익명, 학부모행.email, 비밀번호, 접속코드)

    익명.post(path)

    assert 지울것 not in 익명.cookies
    assert 남길것 in 익명.cookies


@pytest.mark.parametrize(("path", "지울것", "남길것"), 로그아웃)
def test_쿠키가_없어도_로그아웃은_204_다(익명: TestClient, path: str, 지울것: str, 남길것: str):
    """**401 로 막지 않는다.** 만료·손상된 쿠키를 지우려는 것이 로그아웃인데,
    인증을 요구하면 정작 지워야 할 상태에서만 안 지워진다. 지우는 것 말고 하는 일이
    없어 인증 없이 열어도 잃을 것이 없다 (`SameSite=Lax` 가 cross-site POST 를 막는다).
    """
    response = 익명.post(path)

    assert response.status_code == 204
    assert response.headers["set-cookie"].startswith(f"{지울것}=")


@pytest.mark.parametrize(("path", "지울것", "남길것"), 로그아웃)
def test_로그아웃_응답도_캐시되지_않는다(client: TestClient, path: str, 지울것: str, 남길것: str):
    """앞단이 Cloudflare 다. 삭제 `Set-Cookie` 가 캐시에 앉으면 남의 세션을 끊는다."""
    assert client.post(path).headers["cache-control"] == "no-store"


def test_학부모_로그아웃_뒤에는_학부모_API_가_401_이다(
    익명: TestClient, 학부모행: Parent, 비밀번호: str
):
    """계약 전체가 도는지 — 구운 쿠키가 실제로 무효가 된다."""
    익명.post("/api/v1/parents/login", json={"email": 학부모행.email, "password": 비밀번호})
    assert 익명.get("/api/v1/parents/me").status_code == 200

    익명.post("/api/v1/parents/logout")

    assert 익명.get("/api/v1/parents/me").status_code == 401


def test_자녀_로그아웃_뒤에는_자녀_API_가_401_이다(익명: TestClient, 접속코드: str):
    익명.post("/api/v1/child/auth", json={"access_code": 접속코드})
    assert 익명.get("/api/v1/child/me").status_code == 200

    익명.post("/api/v1/child/logout")

    assert 익명.get("/api/v1/child/me").status_code == 401


# ── outcome 3분기 ────────────────────────────────────────


def _attempt(client: TestClient, **headers) -> dict:
    return client.post(
        "/api/v1/attempts",
        headers=headers,
        json={"card_id": "c01", "text": "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"},
    ).json()


def test_헤더가_없으면_판정_결과가_나온다(client: TestClient):
    """고정값이 아니라 Evaluator 판정에서 나온 티어다 (G2 → rare)."""
    body = _attempt(client)

    assert body["tier"] == "rare"
    assert [h["text"] for h in body["highlights"]] == ["은빛", "살금살금"]
    assert body["outcome"] == "result"
    assert body["artwork"]["status"] == "pending"
    assert body["artwork"]["placeholder_url"]


def test_scaffold_를_헤더로_강제한다(client: TestClient):
    body = _attempt(client, **{"X-Mock-Outcome": "scaffold"})

    assert body["outcome"] == "scaffold"
    assert body["guide"]["expression"] == "compass_dim"
    assert body["scaffold_count"] == 1


def test_blocked_를_헤더로_강제한다(client: TestClient):
    body = _attempt(client, **{"X-Mock-Outcome": "blocked"})

    assert body["outcome"] == "blocked"
    assert body["reason"] in {"moderation", "pii"}


def test_어떤_분기도_등급을_노출하지_않는다(client: TestClient):
    """G0~G3 은 로그 전용이다 (용어사전 3장). **판정 경로도 포함해서 본다.**"""
    본문들 = [str(_attempt(client))]  # 헤더 없음 = 실제 판정 경로
    for o in ("result", "scaffold", "blocked"):
        본문들.append(str(_attempt(client, **{"X-Mock-Outcome": o})))

    for 전문 in 본문들:
        assert not any(g in 전문 for g in ("G0", "G1", "G2", "G3"))
        assert "grade" not in 전문


# ── 입력 검사 (E-1 · adr/0009) ───────────────────────────


def _차단(monkeypatch: pytest.MonkeyPatch, 카테고리: str) -> list[str]:
    """검사가 차단하게 두고, **평가가 실제로 불렸는지**를 기록해 돌려준다.

    카테고리는 `안전_어휘_기준.md` 3장 이름으로 받아 슬러그로 옮긴다 — `검사결과.category`
    에 실리는 것은 로그용 슬러그다. 문서 이름을 그대로 넣으면 자해 분기가 조용히 안 탄다.
    """
    불림: list[str] = []

    async def _검사(text: str) -> 검사결과:
        슬 = 슬러그[카테고리]
        # **`category` 와 `self_harm` 은 이제 갈린다** (대표 판정). 단독으로 온 경우를
        # 흉내내므로 둘이 함께 선다 — 합쳐진 경우는 `test_moderation.py` 가 본다.
        return 검사결과(blocked=True, category=슬, self_harm=슬 == SELF_HARM, label=슬)

    async def _판정(text: str, **_) -> 평가결과:
        불림.append(text)
        return 평가결과(grade="G3", signals=["adj:은빛"])

    monkeypatch.setattr(attempts, "검사하기", _검사)
    monkeypatch.setattr(attempts, "evaluate", _판정)
    return 불림


def test_검사가_막으면_blocked_다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    _차단(monkeypatch, "고문·잔혹")

    body = _attempt(client)

    assert body["outcome"] == "blocked"
    assert body["reason"] == "moderation"


def test_차단이면_평가_결과를_버린다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """`adr/0009` 결정 3. 평가는 **동시에 던져서 이미 돌았지만** 결과는 안 쓴다 —
    G3 로 판정됐어도 티어가 응답에 실리면 안 된다.
    """
    불림 = _차단(monkeypatch, "유혈·신체 훼손")

    body = _attempt(client)

    assert 불림, "병렬이므로 평가는 던져진다 (차단 건의 평가 비용은 수용한다)"
    assert "tier" not in body
    assert "legendary" not in str(body)


def test_차단이면_eval_result_를_남기지_않는다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    """버린 판정이 로그에 남으면 **화면에 보여주지도 않은 평가가 등급 분포를 오염시킨다**
    (`adr/0009` 결정 3의 근거).
    """
    _차단(monkeypatch, "선정")

    with caplog.at_level(logging.INFO, logger="app"):
        _attempt(client)

    assert not [r for r in caplog.records if r.message == "eval_result"]


def test_통과하면_eval_result_가_남는다(client: TestClient, caplog: pytest.LogCaptureFixture):
    """차단이 아닐 때는 그대로 남아야 한다 — 폴백 비율이 경보다."""
    with caplog.at_level(logging.INFO, logger="app"):
        _attempt(client)

    assert [r for r in caplog.records if r.message == "eval_result"]


def test_자해는_대사만_다르고_겉모양이_같다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """**아이가 자기 신호가 특별히 취급됐다는 것을 알아채면 안 된다** (`문구.md` 1.2).

    표정도 `reason` 도 일반 차단과 같다. 달라지는 것은 대사 한 줄뿐이다.
    """
    _차단(monkeypatch, "고문·잔혹")
    일반 = _attempt(client)

    _차단(monkeypatch, "자해·자살")
    자해 = _attempt(client)

    assert 자해["guide"]["expression"] == 일반["guide"]["expression"]
    assert 자해["reason"] == 일반["reason"]
    assert set(자해) == set(일반)
    assert 자해["guide"]["line"] != 일반["guide"]["line"]


def test_자해_문구는_확정본_그대로다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """대표 판정 문장이다. **바꾸는 것은 「대표 몫」**이라 여기서 고정한다."""
    _차단(monkeypatch, "자해·자살")

    body = _attempt(client)

    assert body["guide"]["line"] == "지금 마음이 많이 힘들면, 옆에 있는 어른한테 꼭 말해줘."


def test_내장_필터가_막은_것도_blocked_다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """**우리 검사는 통과시켰는데 내장 필터가 막은 경우다.**

    전에는 `evaluate()` 가 그걸 삼켜 G1 폴백으로 넘겨서 **차단이 「그냥 평범한 문장」으로
    기록됐다.** 등급 분포에도 섞이고 F-1 로깅에서도 안 보인다.
    """

    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade="G1", fallback="builtin_block")

    monkeypatch.setattr(attempts, "evaluate", _판정)

    body = _attempt(client)

    assert body["outcome"] == "blocked"


def test_평범한_폴백은_차단이_아니다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """타임아웃 폴백까지 차단으로 읽으면 **프로바이더가 느린 날 아이가 전부 막힌다.**"""

    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade="G1", fallback="timeout")

    monkeypatch.setattr(attempts, "evaluate", _판정)

    assert _attempt(client)["outcome"] == "result"


def test_자해_문구가_문서와_어긋나면_깨진다():
    """**SSOT 는 `docs/문구.md` 1.2 다.** 코드에 문장이 박혀 있는 것은 로그·응답 경로가
    문서 읽기에 매달리지 않게 하려는 것뿐이고, **원본은 문서다.**

    바꾸는 것이 「대표 몫」인 문장이라 조용히 갈라지면 안 된다 — 여기서 깨뜨려 사람이 본다.
    """
    본문 = 읽기(REPO_ROOT / "docs" / "문구.md")
    절 = 본문.split("### 1.2")[1].split("###")[0]
    인용 = [민(줄.lstrip("> ").strip()) for 줄 in 절.splitlines() if 줄.startswith(">")]

    assert attempts._자해대사 in 인용


def test_차단은_카테고리를_아이에게_말하지_않는다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """「나쁜 말」 피드백을 주지 않는다. 슬러그도 카테고리 이름도 응답에 없다."""
    _차단(monkeypatch, "비속어·혐오")

    전문 = str(_attempt(client))

    for 새면안되는것 in ("slur", "비속어", "혐오", "self_harm", "category"):
        assert 새면안되는것 not in 전문


# ── 되묻기 (W2 3번) ──────────────────────────────────────


def _G0(monkeypatch: pytest.MonkeyPatch, 횟수: int | None) -> None:
    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade="G0")

    async def _횟수(아이: str, card_id: str) -> int | None:
        return 횟수

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "되묻기횟수", _횟수)


def test_G0_이면_되묻는다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    _G0(monkeypatch, 1)

    body = _attempt(client)

    assert body["outcome"] == "scaffold"
    assert body["scaffold_count"] == 1
    assert body["guide"]["expression"] == "compass_dim"
    assert "그림자" in body["guide"]["line"]  # c01 의 명사 태그


def test_되묻기는_카드를_소모하지_않는다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """프론트는 입력창과 쓰던 글을 그대로 둔다."""
    _G0(monkeypatch, 2)
    결과 = _attempt(client, **{"X-Mock-Outcome": "result"})

    되물음 = _attempt(client)

    assert 되물음["today"]["cards_done"] < 결과["today"]["cards_done"]


def test_두_번_되묻고_나면_결과로_간다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """`scaffold_count` 2 이후 같은 카드 재제출은 G1 취급이다 (`Stage0.md` 4절)."""
    _G0(monkeypatch, 3)

    body = _attempt(client)

    assert body["outcome"] == "result"
    assert body["tier"] == "basic"


def test_횟수를_못_세면_되묻지_않는다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """같은 카드에서 무한히 되물어 아이를 가두는 쪽이 더 나쁘다."""
    _G0(monkeypatch, None)

    assert _attempt(client)["outcome"] == "result"


def test_되묻기에도_등급이_안_나간다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    _G0(monkeypatch, 1)

    전문 = str(_attempt(client))

    assert not any(g in 전문 for g in ("G0", "G1", "G2", "G3"))
    assert "grade" not in 전문


def test_blocked_는_차단_카테고리를_말하지_않는다(client: TestClient):
    """아이에게 "나쁜 말" 피드백을 주지 않는다."""
    body = _attempt(client, **{"X-Mock-Outcome": "blocked"})

    assert set(body) == {"outcome", "reason", "guide", "today"}


# ── 오류 3종 ─────────────────────────────────────────────


def test_daily_cap_reached_409(client: TestClient):
    response = client.get("/api/v1/cards/next", headers={"X-Mock-Error": "DAILY_CAP_REACHED"})

    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "DAILY_CAP_REACHED"
    assert body["message"] == "오늘 카드를 다 썼어요"
    # 아이가 빈 화면을 보지 않게 대사를 함께 준다
    assert body["detail"]["guide"]["line"]


def test_validation_error_422(client: TestClient):
    """`text` 는 1~500자."""
    response = client.post("/api/v1/attempts", json={"card_id": "c01", "text": ""})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_재시도는_상한에_걸리지_않는다(client: TestClient):
    """재시도(`retry_of`)는 일일 카운트를 쓰지 않는다.

    **`retry_of` 에 아무 문자열이나 넣지 않는다** (2026-09-08). 소모 이력이 들어오면서
    이 값이 **실제 시도를 가리켜야** 한다 — 가짜 id 는 이제 422 다. 인증이 진짜가 됐을 때
    `c1` 을 걷어낸 것과 같은 자리다.
    """
    첫번째 = client.post("/api/v1/attempts", json={"card_id": "c01", "text": "처음 써본다"})

    response = client.post(
        "/api/v1/attempts",
        headers={"X-Mock-Error": "DAILY_CAP_REACHED"},
        json={
            "card_id": "c01",
            "text": "다시 써본다",
            "retry_of": 첫번째.json()["attempt_id"],
        },
    )

    assert response.status_code == 200


# ── 나머지 엔드포인트 ────────────────────────────────────


def test_전_엔드포인트가_응답한다(
    client: TestClient, 학부모행: Parent, 비밀번호: str, 접속코드: str
):
    """계약에 적힌 경로가 전부 살아 있는지 한 번에 훑는다.

    **`c1` 같은 가짜 ID 를 쓰지 않는다** (E-3). 자녀 관련 경로는 이 테스트가 방금
    만든 아이를 쓴다 — 목이던 때는 아무 문자열이나 200 이었지만, 지금 남의 ID 는
    404 다. 그게 맞는 동작이라 **테스트가 진짜 ID 를 들고 와야 한다.**
    """
    만든아이 = client.post(
        "/api/v1/parents/children", json={"nickname": "샛별탐험가", "age_band": 12}
    )
    assert 만든아이.status_code == 201
    자녀 = 만든아이.json()["child_id"]

    호출 = [
        (
            "POST",
            "/api/v1/parents/signup",
            {"email": f"{uuid.uuid4().hex}@example.test", "password": 비밀번호, "consent": True},
            201,
        ),
        ("POST", "/api/v1/parents/login", {"email": 학부모행.email, "password": 비밀번호}, 200),
        ("GET", "/api/v1/parents/me", None, 200),
        ("POST", f"/api/v1/parents/children/{자녀}/access-code", None, 200),
        ("PATCH", f"/api/v1/parents/children/{자녀}", {"daily_cap": 12}, 200),
        ("POST", "/api/v1/child/auth", {"access_code": 접속코드}, 200),
        ("GET", "/api/v1/child/me", None, 200),
        ("PATCH", "/api/v1/child/guide", {"guide_name": "나침이"}, 200),
        ("GET", "/api/v1/cards/next", None, 200),
        ("GET", "/api/v1/cards/c01", None, 200),
        ("GET", "/api/v1/attempts/a1", None, 200),
        ("GET", "/api/v1/artworks/w1", None, 200),
        ("GET", "/api/v1/book", None, 200),
        ("GET", "/api/v1/book/today", None, 200),
        ("PATCH", "/api/v1/book", {"title": "나의 모험"}, 200),
        (
            "POST",
            "/api/v1/events",
            {"events": [{"event": "session_start", "ts": "2026-09-01T00:00:00Z"}]},
            204,
        ),
        # **삭제는 로그아웃 바로 앞이다.** 지운 뒤에 그 아이로 뭘 부르면 401 이라,
        # 중간에 두면 뒤가 전부 무너진다. 지우는 것은 방금 만든 아이이지
        # 이 클라이언트가 로그인해 있는 아이가 아니다.
        ("DELETE", f"/api/v1/parents/children/{자녀}", None, 204),
        # **로그아웃 둘은 맨 뒤다.** 같은 클라이언트로 순서대로 도는 목록이라
        # 중간에 넣으면 쿠키를 지워 놓고 그 뒤를 전부 401 로 만든다.
        ("POST", "/api/v1/parents/logout", None, 204),
        ("POST", "/api/v1/child/logout", None, 204),
    ]

    실패 = [
        (method, path, response.status_code)
        for method, path, body, expected in 호출
        if (response := client.request(method, path, json=body)).status_code != expected
    ]

    assert 실패 == []


def test_책은_아이_원문을_그대로_돌려준다(client: TestClient):
    """마스킹은 로그 경로에만 건다. 책에는 아이 문장이 그대로 있어야 한다 (PRD 1.1b)."""
    page = client.get("/api/v1/book").json()["pages"][0]

    assert page["text"] == "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


def test_daily_cap_이_child_me_에_반영된다(client: TestClient):
    body = client.get("/api/v1/child/me", headers={"X-Mock-Error": "DAILY_CAP_REACHED"}).json()

    assert body["today"]["locked"] is True
    assert body["today"]["cards_done"] == body["today"]["cap"]


# ── 계약 문서 ────────────────────────────────────────────


def test_attempts_응답이_outcome_으로_갈리는_합타입이다(client: TestClient):
    """프론트가 `outcome` 하나로 화면을 가를 수 있어야 한다."""
    schema = client.get("/openapi.json").json()
    응답 = schema["paths"]["/api/v1/attempts"]["post"]["responses"]["200"]
    본문 = 응답["content"]["application/json"]["schema"]

    assert 본문["discriminator"]["propertyName"] == "outcome"
    assert len(본문["oneOf"]) == 3
