"""가이드 대사가 **`docs/문구.md` 에서 온다** (C-1 배선 · W4 4번).

**문구를 코드에 복사하지 않는다.** 복사해 두면 문서와 갈라지고, **갈라진 쪽이 실제로
아이에게 말을 건다.** 그래서 여기서 보는 것은 **문장 내용이 아니라 「어디서 오는가」**다.

**문자열을 박아 놓고 비교하지 않는다.** W3 에서 두 번 났다 — 테스트에 박힌 문구가
①맞는 문구를 못 바꾸게 하고 ②틀린 문구를 정답으로 굳혔다. **문서를 읽어서 대조한다.**
"""

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import _fixtures as fx
from app.api.v1 import attempts
from app.evaluator import 평가결과
from app.guide_lines import 결과대사, 결과한줄, 종료대사, 차단대사
from app.moderation import 검사결과


def test_세_묶음이_다_읽힌다():
    """비어 있으면 아이 화면에 **빈 말풍선**이 뜬다.

    **1.5(삽화 대기)는 서버 몫이 아니다** — 폴링 응답에 `guide` 가 없어 프론트가 갖는다.
    """
    assert len(종료대사()) == 5  # 1.10
    assert len(차단대사()) == 5  # 1.11


@pytest.mark.parametrize("tier", ["basic", "rare", "legendary"])
def test_티어마다_다섯이다(tier):
    """`문구.md` 1.6 — 티어별 5개."""
    assert len(결과대사()[tier]) == 5


def test_마크다운_강조가_안_섞인다():
    """문서는 `**문장**` 으로 적혀 있다. **별표가 아이 화면에 갈 이유가 없다.**"""
    모든대사 = [
        *종료대사(),
        *차단대사(),
        *(줄 for 묶음 in 결과대사().values() for 줄 in 묶음),
    ]

    assert 모든대사
    for 줄 in 모든대사:
        assert "*" not in 줄
        assert 줄 == 줄.strip()


def test_종료_인사는_다섯_다_내일을_말한다():
    """**하드 피니시를 벌로 만들지 않는다** (`문구.md` 1.10 지킬 것). 끝이 아니라
    다음이 있는 것이다 — 「그만해」로 읽히면 가드레일이 아니라 차단이 된다."""
    assert all("내일" in 줄 or "다음" in 줄 for 줄 in 종료대사())


def test_결과_대사에_금지어가_없다():
    """PRD 4.4 금지어. **기본에도 「부족하다」가 없어야 한다** (`문구.md` 1.6)."""
    금지 = ["부족", "다시 써", "틀렸", "더 길게", "점수"]

    for 티어, 묶음 in 결과대사().items():
        for 줄 in 묶음:
            assert not [말 for 말 in 금지 if 말 in 줄], f"{티어}: {줄}"


def test_차단_문구가_종류를_말하지_않는다():
    """계약이 **종류를 응답에 안 싣는다** (`Stage0.md` 4절). 「나쁜 말」 피드백 금지다."""
    새면안됨 = ["폭력", "욕", "선정", "나쁜", "위험한 말"]

    for 줄 in 차단대사():
        assert not [말 for 말 in 새면안됨 if 말 in 줄], 줄


def test_자해_대사는_이_묶음에_없다():
    """**1.2 는 대표 판정 문장이고 1.11 과 겹치면 그쪽이 이긴다.** 무작위로 고르는
    이 묶음에 섞이면 **자해 신호에 엉뚱한 대사가 나갈 수 있다.**"""
    from app.api.v1.attempts import _자해대사

    assert _자해대사 not in 차단대사()


# ── `{말}` 은 첫 하이라이트로 채운다 (1.6) ─────────────────


def test_말자리가_하이라이트로_채워진다():
    """**어느 말이 통했는지를 말하는 자리가 여기뿐이다** (PRD A0-3 MUST).
    하이라이트 옆에 설명을 안 두는 근거가 이 줄이라(1.9), 빠지면 그 근거가 거짓이 된다.
    """
    나온것 = {결과한줄("rare", 씨앗, "살금살금") for 씨앗 in range(60)}

    assert 나온것
    assert not [줄 for 줄 in 나온것 if "{말}" in 줄]
    assert [줄 for 줄 in 나온것 if "살금살금" in 줄], "채워지는 문장이 하나도 안 나왔다"


def test_하이라이트가_없으면_말자리를_안_고른다():
    """**없는 말을 지어내지 않는다.** 티어마다 셋이 그 폴백이다."""
    for tier in ("basic", "rare", "legendary"):
        나온것 = {결과한줄(tier, 씨앗, None) for 씨앗 in range(60)}

        assert 나온것
        assert not [줄 for 줄 in 나온것 if "{말}" in 줄]


def test_같은_시도는_같은_문장이다():
    """**새로고침해도 나침반이 다른 말을 하지 않는다** (`문구.md` 1.6 지킬 것)."""
    셋 = {결과한줄("legendary", "같은-시도-id", "은빛") for _ in range(20)}

    assert len(셋) == 1


def test_중괄호가_든_말도_안_터진다():
    """`str.format` 을 쓰면 여기서 터진다. 아이가 쓴 말에 무엇이 있을지 모른다."""
    줄 = 결과한줄("rare", "씨앗", "{이상한}")

    assert "{이상한}" in 줄


# ── 라우트까지 — 「값이 왔다」와 「맞는 값이 왔다」는 다르다 ──────────────
#
# 2026-09-09 PM 이 프론트 스샷을 보고 물었다: 결과 화면 대사가 **카드 화면 대사와
# 글자 하나까지 같다.** 위 테스트들은 `결과한줄()` 만 보므로 **라우트가 그 함수를
# 실제로 부르는지는 아무도 안 봤다.** `guide.line` 은 문자열이라 계약 검사도 통과한다.


async def test_결과_응답의_대사가_1_6_에서_오고_말자리가_채워진다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """`POST /attempts` 가 `outcome=result` 로 답할 때. **카드 대사가 아니어야 한다.**"""

    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade="G2", signals=["adv:살금살금"])

    async def _통과(text: str) -> 검사결과:
        return 검사결과(blocked=False)

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _통과)

    몸 = client.post(
        "/api/v1/attempts",
        json={"card_id": "c01", "text": "그림자 뒤로 살금살금 돌아간다"},
    ).json()

    assert 몸["outcome"] == "result"
    assert 몸["tier"] == "rare"
    # **문서를 읽어서 대조한다** — 이 파일 머리말 그대로. 문자열을 박지 않는다.
    후보 = [줄.replace("{말}", "살금살금") for 줄 in 결과대사()["rare"]]
    assert 몸["guide"]["line"] in 후보
    # 하이라이트가 있으면 **`{말}` 자리가 든 문장 중에서 골라야** 어느 말이 통했는지
    # 말해 준다 (PRD A0-3 MUST). 씨앗이 시도 id 라 어느 문장인지는 고정 못 한다.
    assert "살금살금" in 몸["guide"]["line"] or 몸["guide"]["line"] in 결과대사()["rare"]


async def test_결과_대사는_카드_대사가_아니다(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """**프론트 스샷에서 나온 그 자리다** (2026-09-09). 카드 대사가 결과 화면에 그대로
    떴는데, 서버가 그것을 내려줄 수 있는 경로가 있는지 여기서 못 박는다."""

    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade="G2", signals=["adv:살금살금"])

    async def _통과(text: str) -> 검사결과:
        return 검사결과(blocked=False)

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _통과)

    몸 = client.post(
        "/api/v1/attempts",
        json={"card_id": "c01", "text": "그림자 뒤로 살금살금 돌아간다"},
    ).json()

    assert 몸["guide"]["line"] != fx.CARD_GUIDE["line"]


async def test_목_강제_결과_대사도_1_6_에서_온다(client: TestClient):
    """**목도 이 문서를 읽는다** (`문구.md` 0장, 2026-09-09 PM 판정).

    박아 두면 **목으로 화면을 만드는 사람이 진짜 문구를 한 번도 못 본다** — 그리고
    안 맞는 문장에 자리를 맞추면 진짜 문장이 올 때 또 옮긴다.
    """
    몸 = client.post(
        "/api/v1/attempts",
        json={"card_id": "c01", "text": "그림자 뒤로 살금살금 돌아간다"},
        headers={"X-Mock-Outcome": "result"},
    ).json()

    말 = 몸["highlights"][0]["text"]
    후보 = [줄.replace("{말}", 말) for 줄 in 결과대사()[몸["tier"]]]
    assert 몸["guide"]["line"] in 후보


async def test_목_결과_대사는_두_번_불러도_같다(client: TestClient):
    """**픽스처가 흔들리면 프론트가 못 쓴다.** 목의 시도 id 가 고정이라 대사도 고정이다 —
    안 고정이면 목이 「새로고침하면 다른 말」을 재현하고 있다는 뜻이라 더 나쁘다."""
    보냄 = {
        "json": {"card_id": "c01", "text": "그림자 뒤로 살금살금 돌아간다"},
        "headers": {"X-Mock-Outcome": "result"},
    }

    첫번 = client.post("/api/v1/attempts", **보냄).json()
    두번 = client.post("/api/v1/attempts", **보냄).json()

    assert 첫번["guide"]["line"] == 두번["guide"]["line"]
