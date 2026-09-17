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
# **✅ 운영 기본값은 켜짐이다** (2026-09-16 대표 판정 · `pii_ner_enabled`).
# **되살린 날이 왔고, 아래 넷이 재 두던 것이 값을 했다** — Stage 1 가족 공유(A-7)가
# 열리며 켜는 데 든 것이 **기본값 한 줄**이었다.
#
# **양쪽을 계속 잰다.** 아래 넷은 **켠 갈래**, 그 아래 둘은 **끈 갈래**다.
# **한쪽만 재면 다른 쪽이 영영 안 재진다** — 그리고 **둘 다 픽스처로 명시한다.**
# 09-09~09-16 에는 끈 갈래가 **기본값에 기대** 있었고, 켜는 날 **둘 다 조용히 반대를
# 재게 됐다.** 기본값 자체는 **바로 아래 검사 하나**가 따로 잰다.


def test_기본값이_켜짐이다():
    """**⛔ 이 검사가 2026-09-16 대표 판정 그 자체다.**

    실명 마스킹이 꺼진 채로 도는 것과 켜진 채로 도는 것은 **아이 책에 실명이
    인쇄되느냐**로 갈린다. 그리고 **밖에서 보면 똑같다** — 꺼져 있어도 화면은
    멀쩡하고 검사도 초록이다. 그래서 **기본값을 값으로 못 박는다.**

    **다시 끄는 것은 대표 판정 자리다.** 이 검사가 빨개지면 판정 없이 뒤집힌 것이다.
    """
    from app.config import get_settings

    get_settings.cache_clear()
    assert get_settings().pii_ner_enabled is True, (
        "실명(NER)이 꺼졌다 — A-7 로 아이 책이 기기 밖에 나가는데 실명이 안 가려진다"
    )


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
async def test_같은_사람을_성_없이_부른_것도_가린다(monkeypatch):
    """**⛔ 완료 판정 회차에서 실물로 난 그 문장이다** (2026-09-17 · 안전).

    아이가 쓴 것 — 「김민준이랑 같이 들어갔다. **민준이가** 먼저 손을 뻗었다」
    그때 책에 남은 것 — 「○○○이랑 같이 들어갔다. **민준이가** 먼저 손을 뻗었다」

    **그리고 GM 이 그 이름을 받아 서사에 썼다** — 입력에서 한 번 샌 것이 출력으로
    번졌고, **그 문장이 책에 실렸다. A-7 은 인쇄해서 가족에게 보낸다.**

    **⭐ 판정을 좁힌 게 아니라 판정대로 안 돈 것이다.** 대표 판정문은 **「실명을
    가린다」**이지 「성+이름 **형태**만 가린다」가 아니다 — 「성+이름」은 `_NER_지시` 의
    **구현 선택**이었고, **같은 사람을 두 번 부른 글에서 하나만 가리면 반만 집행된다.**
    """
    from app import pii

    async def _판정(text: str) -> list[str]:
        return ["김민준"]  # 모델은 성+이름만 돌려준다

    monkeypatch.setattr(pii, "_실명물어보기", _판정)

    가려진, 종류 = await pii.실명까지가리기(
        "김민준이랑 같이 들어갔다. 민준이가 먼저 손을 뻗었다", 제외=()
    )

    assert "김민준" not in 가려진
    assert "민준" not in 가려진, "성 없는 호칭이 그대로 나갔다 — 회차에서 난 그 결함이다"
    assert 종류 == ["name"]


@pytest.mark.usefixtures("_NER_켠다")
async def test_전체_이름을_먼저_지운다_성이_남지_않는다(monkeypatch):
    """**⛔ 순서가 틀리면 성이 남는다.**

    `민준` 을 먼저 지우면 `김민준` 이 **`김○○○`** 이 된다 — **가렸는데 성이 남는
    것**이고, 성은 그 자체로 사람을 좁힌다. 전체 이름이 **항상 먼저**여야 한다.
    """
    from app import pii

    async def _판정(text: str) -> list[str]:
        return ["김민준"]

    monkeypatch.setattr(pii, "_실명물어보기", _판정)

    가려진, _ = await pii.실명까지가리기("김민준이 웃었다", 제외=())

    assert 가려진 == f"{PII_MASK}이 웃었다"
    assert "김" not in 가려진


@pytest.mark.usefixtures("_NER_켠다")
async def test_한_글자_이름은_안_만든다(monkeypatch):
    """**⛔ `김철` → `철` 이면 「철」이 든 모든 낱말이 가려진다** — 철사·지하철·철수.

    **두 글자가 이름으로 읽히는 최소 길이**다. 한 글자는 **덜 가리는 쪽으로 진다.**
    """
    from app import pii

    async def _판정(text: str) -> list[str]:
        return ["김철"]

    monkeypatch.setattr(pii, "_실명물어보기", _판정)

    가려진, _ = await pii.실명까지가리기("김철이랑 지하철을 탔다", 제외=())

    assert "김철" not in 가려진
    assert "지하철" in 가려진, "한 글자 호칭을 만들어 엉뚱한 낱말을 가렸다"


@pytest.mark.usefixtures("_NER_켠다")
async def test_아이가_지은_이름은_호칭도_안_가린다(monkeypatch):
    """**화이트리스트가 호칭 갈래에도 걸린다** (PRD E-2).

    안 걸면 **「나침반」 같은 가이드 이름의 뒷부분**이 가려질 수 있다 —
    **서버가 아는 값인데 가리는 것**이라 그냥 손해다.
    """
    from app import pii

    async def _판정(text: str) -> list[str]:
        return ["김나침"]

    monkeypatch.setattr(pii, "_실명물어보기", _판정)

    가려진, 종류 = await pii.실명까지가리기("김나침이 달려갔다", 제외=("김나침", "나침"))

    assert 가려진 == "김나침이 달려갔다"
    assert 종류 == []


@pytest.mark.usefixtures("_NER_켠다")
async def test_이름이_흔한_낱말과_같으면_그_낱말도_가려진다(monkeypatch):
    """**⚠ 이것은 결함이 아니라 고른 값이다.** 남겨서 다음 사람이 알게 한다.

    「김하늘이랑 놀았다. 하늘이 파랗다」 → **뒤의 `하늘` 도 가려진다.**

    **덜 나쁜 쪽을 골랐다** — 가려진 낱말은 **아이 눈에 보여서 말할 수 있고**,
    안 가려진 실명은 **책에 인쇄돼 나간 뒤에야 안다.** 되돌릴 수 있는 쪽과 없는 쪽이다.

    **⛔ 이 검사가 빨개지면 「고쳤다」가 아니라 「값이 바뀌었다」**이니,
    바꾸기 전에 위 판단을 다시 읽어라.
    """
    from app import pii

    async def _판정(text: str) -> list[str]:
        return ["김하늘"]

    monkeypatch.setattr(pii, "_실명물어보기", _판정)

    가려진, _ = await pii.실명까지가리기("김하늘이랑 놀았다. 하늘이 파랗다", 제외=())

    assert "김하늘" not in 가려진
    assert 가려진.count(PII_MASK) == 2, "고른 값이 바뀌었다 — docstring 을 읽어라"


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


@pytest.mark.usefixtures("_NER_끈다")
async def test_꺼져_있으면_실명을_안_가리고_호출도_안_나간다(monkeypatch):
    """**끈 갈래는 살아 있다** — 다시 끄는 것은 대표 판정 자리이고, 그때 이 코드가 돈다.

    **끈 것을 「안 가린다」로만 재면 절반이다.** 호출이 여전히 나가면 **돈이 나가고
    아이 문장이 프로바이더로 간다** — 화면만 보면 똑같아서 안 보인다. 그래서
    **불렸는지를 따로 센다.**

    **⛔ 기본값에 기대지 않는다** (2026-09-16). 종전에는 `cache_clear()` 만 하고
    **기본값이 꺼짐인 것에 기대** 있었다 — 켜는 날 **이 검사가 반대를 재게 됐다.**
    """
    from app import pii

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


@pytest.mark.usefixtures("_NER_끈다")
async def test_꺼져도_전화_이메일_주소_학교명은_그대로_가린다(monkeypatch):
    """**⛔ 껐다 켰다 하는 것은 실명 갈래 하나다.** 정규식 넷은 판정 대상이 아니었다.

    **이 검사가 그 경계다** — 없으면 다음 사람이 「PII 마스킹을 껐다」로 읽고
    정규식까지 들어낸다. 그러면 **아이 전화번호가 책에 인쇄된다.**
    """
    from app import pii

    # **여기서도 호출을 막는다.** 픽스처가 껐어도 막아 둔다 — 이 검사가 재려는 것은
    # **정규식 넷**이고, 호출 갈래가 새면 재려던 것과 상관없이 돈이 나간다.
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
