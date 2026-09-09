"""서버측 PII 2차 감지 (E-2). **오탐이 미탐보다 비싸지 않다 — 여기서는 반대다.**

프론트(`web/src/lib/pii.ts`)는 「애매하면 통과시킨다」로 서 있다. 미탐을 서버가
받아주기 때문이다. **여기가 그 서버다.** 받아줄 다음 층이 없으므로 경계가 다르다.

그렇다고 넓히면 아이가 지은 이름이 걸린다. 그래서 **이 파일의 절반이 「걸리면 안 되는
것」**이다 — 판타지 문장·아이가 지어낸 지명·숫자가 붙은 평범한 말.

**같은 규칙을 TS 와 파이썬 두 곳에 짰다.** 둘이 갈리는 것은 사고가 아니다 —
서버가 더 넓게 잡는 것은 설계대로다(프론트를 믿지 않는다). **좁게 잡는 쪽이 사고다.**
"""

from typing import get_args

import pytest

from app.pii import PII_MASK, 가리기, 찾기


def _종류(text: str) -> list[str]:
    return [감지.kind for 감지 in 찾기(text)]


# ── 잡아야 하는 것 ────────────────────────────────────────


def test_휴대폰_번호는_구분자가_없어도_잡는다():
    assert _종류("내 번호 01012345678 이야") == ["phone"]
    assert _종류("010-1234-5678 로 연락해") == ["phone"]


def test_메일_주소를_잡는다():
    assert _종류("minjun@example.com 으로 보내줘") == ["email"]


def test_번지_호수가_붙은_주소를_잡는다():
    assert _종류("우리집은 101동 502호야") == ["address"]


def test_학교명_전체_꼴을_잡는다():
    assert _종류("나는 별빛초등학교 다녀") == ["school"]


# ── 걸리면 안 되는 것 ─────────────────────────────────────


def test_숫자가_붙은_평범한_말은_안_걸린다():
    """「3-4번 문」이 전화번호로 걸리면 아이는 이유도 모르고 문장이 가려진다."""
    for 문장 in ("3-4번 문을 열었다", "100-200마리쯤 있었다", "1234 걸음을 걸었다"):
        assert _종류(문장) == [], 문장


def test_아이가_지어낸_지명은_안_걸린다():
    """「은하시 별빛동」을 실제 주소와 정규식으로 가를 수 없다. **숫자가 없으면 통과다.**"""
    assert _종류("은하시 별빛동으로 갔다") == []


def test_동굴과_구름은_주소가_아니다():
    """단독 「동」·「구」를 조건으로 쓰면 이 둘이 전부 걸린다."""
    for 문장 in ("어두운 동굴로 들어갔다", "구름 위를 걸었다", "긴 길을 따라갔다"):
        assert _종류(문장) == [], 문장


def test_판타지_학교는_안_걸린다():
    """「우리 학교는 ○○」 패턴을 넣으면 이게 걸린다 — 아이가 충분히 쓸 말이다."""
    assert _종류("우리 학교는 마법학교야") == []


def test_학교명_줄임꼴은_안_잡는다():
    """`○○초` 를 넣으면 「마법약초」·「기초」가 함께 걸린다."""
    for 문장 in ("마법약초를 캤다", "기초부터 다시 했다"):
        assert _종류(문장) == [], 문장


def test_아이가_지은_이름은_정규식이_안_건드린다():
    """실명·학교명은 **NER 몫**이다 (PRD E-2). 정규식을 실명으로 넓히면
    가이드 이름·괴물 이름이 먼저 걸린다 — 프론트가 뺀 것과 같은 이유다.
    """
    assert _종류("나침이가 은빛 검을 들고 달려갔다") == []


# ── 가린다 ───────────────────────────────────────────────


def test_가린_자리는_길이와_무관하게_세_글자다():
    """가린 길이가 새면 **몇 자리 번호였는지가 드러난다** (`문구.md` 1.1)."""
    가려진, 종류 = 가리기("내 번호 010-1234-5678 이야")
    assert 가려진 == f"내 번호 {PII_MASK} 이야"
    assert 종류 == ["phone"]


def test_여러_개를_한_번에_가린다():
    가려진, 종류 = 가리기("01012345678 이고 minjun@example.com 이야")
    assert 가려진 == f"{PII_MASK} 이고 {PII_MASK} 이야"
    assert 종류 == ["phone", "email"]


def test_같은_종류가_두_번이면_한_번만_센다():
    """`pii_masked` 이벤트는 **종류별로 한 건**이다. 개수를 세면 그게 곧 원문의 모양이다."""
    _, 종류 = 가리기("01012345678 이랑 01087654321")
    assert 종류 == ["phone"]


def test_아무것도_없으면_문장을_안_건드린다():
    문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"
    가려진, 종류 = 가리기(문장)
    assert 가려진 == 문장
    assert 종류 == []


# ── 흐름에 붙어 있다 (E-2 서버 2차) ───────────────────────

전화번호가섞인문장 = "은빛 검을 들고 01012345678 로 달려갔다"


@pytest.fixture
def 판정_고정(monkeypatch):
    """모델을 갈아끼우고 **무엇이 모델에 갔는지**를 붙잡는다."""
    from app.api.v1 import attempts
    from app.evaluator import 평가결과
    from app.moderation import 검사결과

    본것: dict[str, str] = {}

    async def _판정(text: str, **_) -> 평가결과:
        본것["평가"] = text
        return 평가결과(grade="G2", signals=["adj:은빛"], latency_ms=12.0)

    async def _통과(text: str) -> 검사결과:
        본것["검사"] = text
        return 검사결과(blocked=False)

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _통과)
    return 본것


async def test_가린_뒤_진행한다_막지_않는다(client, 판정_고정):
    """**대표 판정 2026-09-08** (미결 11-5). 막으면 아이에게 이유를 말해줄 수 없다."""
    응답 = client.post("/api/v1/attempts", json={"card_id": "c01", "text": 전화번호가섞인문장})

    assert 응답.status_code == 200
    assert 응답.json()["outcome"] == "result"


async def test_원문이_프로바이더로_안_나간다(client, 판정_고정):
    """**이 테스트가 E-2 서버 몫의 존재 이유다.**

    가리는 것이 저장 직전이면 늦다 — 그 사이에 검사·평가가 **원문을 밖으로 보낸다.**
    """
    client.post("/api/v1/attempts", json={"card_id": "c01", "text": 전화번호가섞인문장})

    for 어디, 간것 in 판정_고정.items():
        assert "01012345678" not in 간것, 어디
        assert PII_MASK in 간것, 어디


async def test_pii_masked_가_layer_server_로_남는다(client, 자녀행, 판정_고정):
    from sqlalchemy import select

    from app import db
    from app.models import Event

    client.post("/api/v1/attempts", json={"card_id": "c01", "text": 전화번호가섞인문장})

    async with db.SessionLocal() as session:
        행들 = list((await session.execute(select(Event))).scalars())
    (마스킹,) = [행 for 행 in 행들 if 행.event == "pii_masked"]
    assert 마스킹.payload == {"layer": "server", "kind": "phone"}


async def test_char_len_은_가린_뒤_길이다(client, 자녀행, 판정_고정):
    """PRD 5장 — 「원문」은 **PII 마스킹 뒤 텍스트**다. 화면·로그·책이 같은 문자열을 센다."""
    from sqlalchemy import select

    from app import db
    from app.models import Event

    client.post("/api/v1/attempts", json={"card_id": "c01", "text": 전화번호가섞인문장})

    async with db.SessionLocal() as session:
        행들 = list((await session.execute(select(Event))).scalars())
    (입력,) = [행 for 행 in 행들 if 행.event == "turn_input"]
    가려진, _ = 가리기(전화번호가섞인문장)
    assert 입력.payload["char_len"] == len(가려진)
    assert 입력.payload["char_len"] != len(전화번호가섞인문장)


def test_차단_사유에_pii_가_없다():
    """**PII 로는 차단 응답이 안 나간다** (`Stage0.md` 4절 (c), 2026-09-08 정정).

    값이 살아 있으면 **영영 안 쓰이는 분기**가 계약에 남는다.
    """
    from app.schemas.stage0 import BlockedReason

    assert get_args(BlockedReason) == ("moderation",)


# ── 눕혀 놓고 본다 ────────────────────────────────────────


def _전각(글: str) -> str:
    """ASCII 를 전각으로 바꾼다. **리터럴로 적지 않는 이유**는 ruff 가 소스 안의
    전각 문자를 「반각을 잘못 친 것」으로 보고 막기 때문이다 — 여기서는 의도한 값이다.
    """
    return "".join(chr(ord(글자) - 0x20 + 0xFF00) if " " < 글자 <= "~" else 글자 for 글자 in 글)


def test_전각_숫자로_쓴_번호도_잡는다():
    """**정규식을 그냥 지나간다.** `app/accounts.py` 는 닉네임 검사에서 이미 알고
    NFKC 로 눕혀 두고 있었는데, 이쪽에는 그 방어가 없었다 (2026-09-08 발견).
    """
    assert _종류(f"내 번호 {_전각('01012345678')} 이야") == ["phone"]
    assert _종류(f"{_전각('101')}동 {_전각('502')}호") == ["address"]


def test_눕히는_것은_찾을_때뿐이고_아이_문장은_안_바꾼다():
    """**NFKC 를 문장에 적용해 저장하면 아이가 쓴 글자가 바뀐다.**

    전각으로 쓴 것도 아이가 고른 모양이고, 그대로 책에 인쇄된다.
    """
    문장 = f"{_전각('Hello')} 라고 적힌 문을 열었다"
    가려진, 종류 = 가리기(문장)
    assert 가려진 == 문장
    assert 종류 == []


def test_전각_번호를_가려도_나머지_글자는_그대로다():
    가려진, 종류 = 가리기(f"내 번호 {_전각('01012345678')} 이야")
    assert 가려진 == f"내 번호 {PII_MASK} 이야"
    assert 종류 == ["phone"]


# ── 실명 (NER) ────────────────────────────────────────────
#
# **⛔ 운영 기본값은 꺼짐이다** (2026-09-09 대표 판정 · `pii_ner_enabled`).
# 아래 넷은 **켠 갈래**를 잰다 — Stage 1 가족 공유(A-7) 전에 되살릴 때 **그 코드가
# 여전히 도는지**를 여기서 보장한다. 안 재고 두면 되살리는 날 처음부터 다시 짓는다.
# **끈 갈래는 그 아래 둘**이 잰다. **한쪽만 재면 다른 쪽이 영영 안 재진다** — 오늘만
# 세 번 나온 함정이다(축 ⑰ · 프론트 픽스처 `pending` 한쪽).


@pytest.mark.usefixtures("_NER_켠다")
async def test_모델이_짚은_실명을_가린다(monkeypatch):
    """**대표 판정 2026-09-08** (미결 11-6) — NER 이 맡는 것은 실명뿐이다."""
    from app import pii

    async def _판정(text: str) -> list[str]:
        return ["김민준"]

    monkeypatch.setattr(pii, "_실명물어보기", _판정)

    가려진, 종류 = await pii.실명까지가리기("김민준이랑 같이 동굴로 들어갔다", 제외=())
    assert 가려진 == f"{PII_MASK}이랑 같이 동굴로 들어갔다"
    assert 종류 == ["name"]


@pytest.mark.usefixtures("_NER_켠다")
async def test_문장에_없는_이름을_돌려주면_버린다(monkeypatch):
    """모델이 지어낸 문자열은 **어디를 가릴지 알 수 없다.**

    억지로 맞추려 들면 엉뚱한 자리를 가린다 — 아이 문장이 이유 없이 망가진다.
    """
    from app import pii

    async def _판정(text: str) -> list[str]:
        return ["박서연"]  # 문장에 없다

    monkeypatch.setattr(pii, "_실명물어보기", _판정)

    가려진, 종류 = await pii.실명까지가리기("김민준이랑 같이 동굴로 들어갔다", 제외=())
    assert 가려진 == "김민준이랑 같이 동굴로 들어갔다"
    assert 종류 == []


@pytest.mark.usefixtures("_NER_켠다")
async def test_아이가_지은_이름은_화이트리스트로_뺀다(monkeypatch):
    """**서버가 이미 아는 값이라 호출 없이 오탐을 줄인다** (PRD E-2).

    모델이 가이드 이름을 실명이라고 해도 **우리가 지어준 이름인 걸 안다.**
    """
    from app import pii

    async def _판정(text: str) -> list[str]:
        return ["나침이"]

    monkeypatch.setattr(pii, "_실명물어보기", _판정)

    가려진, 종류 = await pii.실명까지가리기("나침이가 달려갔다", 제외=("나침이", "불꽃탐험가"))
    assert 가려진 == "나침이가 달려갔다"
    assert 종류 == []


@pytest.mark.usefixtures("_NER_켠다")
async def test_NER_이_죽어도_정규식_결과는_살아_있다(monkeypatch):
    """**아이를 막지 않는다.** 실명을 못 잡는 것과 아이가 못 쓰는 것 중 후자가 나쁘다 —
    E-1 검사와 방향이 반대인 이유는 `app/moderation.py` 머리말에 있다.
    """
    from app import pii

    async def _터짐(text: str) -> list[str]:
        raise TimeoutError("모델 없음")

    monkeypatch.setattr(pii, "_실명물어보기", _터짐)

    가려진, 종류 = await pii.실명까지가리기("내 번호 01012345678 이야", 제외=())
    assert 가려진 == f"내 번호 {PII_MASK} 이야"
    assert 종류 == ["phone"]


@pytest.mark.usefixtures("_NER_켠다")
async def test_실명도_흐름에서_가려지고_이벤트로_남는다(client, 자녀행, 판정_고정, monkeypatch):
    """**셋을 동시에 던진다** — 검사·평가·실명 NER. 순차로 두면 지연 예산이 깨진다
    (`adr/0009` 결정 2 와 같은 이유).
    """
    from sqlalchemy import select

    from app import db, pii
    from app.models import Event

    async def _판정(text: str) -> list[str]:
        return ["김민준"]

    monkeypatch.setattr(pii, "_실명물어보기", _판정)

    client.post("/api/v1/attempts", json={"card_id": "c01", "text": "김민준이랑 동굴로 갔다"})

    async with db.SessionLocal() as session:
        행들 = list((await session.execute(select(Event))).scalars())
    (마스킹,) = [행 for 행 in 행들 if 행.event == "pii_masked"]
    assert 마스킹.payload == {"layer": "server", "kind": "name"}


async def test_꺼져_있으면_실명을_안_가리고_호출도_안_나간다(monkeypatch):
    """**2026-09-09 대표 판정 — 「실명 검사 제거. 이름 노출해도 괜찮음」.**

    **끈 것을 「안 가린다」로만 재면 절반이다.** 호출이 여전히 나가면 **돈이 나가고
    아이 문장이 프로바이더로 간다** — 화면만 보면 똑같아서 안 보인다. 그래서
    **불렸는지를 따로 센다.**
    """
    from app import pii
    from app.config import get_settings

    get_settings.cache_clear()  # 기본값이 꺼짐인지를 본다 — 여기서 켜지 않는다

    # **예외로 세우면 안 된다.** `실명까지가리기()` 의 `except Exception` 이
    # `AssertionError` 까지 삼켜서 **불려도 초록**이 된다 (2026-09-09 실측 — 뒤집다가
    # 잡았다). 삼킬 수 없는 것으로 센다.
    불린횟수 = []

    async def _세기(text: str) -> list[str]:
        불린횟수.append(text)
        return []

    monkeypatch.setattr(pii, "_실명물어보기", _세기)

    가려진, 종류 = await pii.실명까지가리기("김민준이랑 같이 동굴로 들어갔다", 제외=())
    assert not 불린횟수, "꺼져 있는데 NER 호출이 나갔다 — 돈이 나가고 원문이 밖으로 간다"
    assert 가려진 == "김민준이랑 같이 동굴로 들어갔다"
    assert 종류 == []


async def test_꺼져도_전화_이메일_주소_학교명은_그대로_가린다(monkeypatch):
    """**⛔ 꺼진 것은 실명 갈래 하나다.** 정규식 넷은 판정 대상이 아니었다.

    **이 검사가 그 경계다** — 없으면 다음 사람이 「PII 마스킹을 껐다」로 읽고
    정규식까지 들어낸다. 그러면 **아이 전화번호가 책에 인쇄된다.**
    """
    from app import pii
    from app.config import get_settings

    get_settings.cache_clear()

    # **여기서도 호출을 막는다.** 안 막으면 기본값이 켜지는 날 이 검사가 조용히
    # 진짜 Gemini 로 나간다 — 재려던 것과 상관없이 돈이 나가는 자리다.
    불린횟수 = []

    async def _세기(text: str) -> list[str]:
        불린횟수.append(text)
        return []

    monkeypatch.setattr(pii, "_실명물어보기", _세기)

    문장 = "김민준한테 01012345678 로 연락해. me@example.com 이고 은하초등학교 3동 201호야"
    가려진, 종류 = await pii.실명까지가리기(문장, 제외=())

    assert set(종류) == {"phone", "email", "school", "address"}, 종류
    assert "01012345678" not in 가려진
    assert "me@example.com" not in 가려진
    assert "은하초등학교" not in 가려진
    assert "201호" not in 가려진
    # **실명만 남는다.** 이것이 판정된 내용이다
    assert "김민준" in 가려진
    assert not 불린횟수, "꺼져 있는데 NER 호출이 나갔다"
