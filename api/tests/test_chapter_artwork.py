"""챕터 핵심 씬 삽화 (B-3 재사용 · W7 14번).

**⛔ 상한이 이 파일의 요점이다 — 한 챕터에 둘.** 뼈대가 **1턴·9턴**으로 묶은 근거가
**돈**이다: **매 턴 굽으면 한 챕터에 10회이고 하루 상한($0.50)을 한 아이가 혼자
넘는다.** **그 둘을 서버가 쥔다 — 모델에게 안 맡긴다**(1번에서 `is_key_scene` 을
되찾은 것과 같은 자리).

**⭐ 부품을 새로 만들지 않는다.** 화풍·티어 접미어·구도·**가이드 주입**·글자금지가
카드와 **같은 것**이고, 생성 순서(**프롬프트 → 레퍼런스 → 출력 검사 → 생성**)도
**같은 함수**를 쓴다. **다른 것은 장면 하나** — 카드는 문서의 스케치 프롬프트,
챕터는 **GM 의 `scene_prompt_hint`** 다.

**⛔ 유료 호출이 이 파일에서 안 나간다.** 굽는 함수를 갈아끼운다.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import chapter_skeleton as 뼈대
from app import db
from app.api.v1 import stage1
from app.artwork import 챕터프롬프트
from app.evaluator import 평가결과
from app.gm import GM출력, 서사결과, 선택지
from app.models import Artwork, BookPage
from app.moderation import 검사결과

pytestmark = pytest.mark.anyio

챕터 = "/api/v1/chapters"
턴 = "/api/v1/turns"
문장 = "이끼 낀 돌계단을 한 칸씩 올라가며 톱니 소리를 들어본다"
힌트 = "clock tower gears grinding, a feather caught between the teeth"


@pytest.fixture(autouse=True)
def _유료호출을_끊는다(monkeypatch: pytest.MonkeyPatch) -> dict:
    센것: dict = {"구운것": [], "검사막나": False}

    async def _통과(text: str):
        return 검사결과(blocked=False)

    async def _평가(text: str, *, 기록: bool = True):
        return 평가결과(grade="G2", signals=[], descriptors=[])

    async def _서사(지시: str, 프롬프트: str, *, 턴: int, 허용재시도: int = 1):
        return 서사결과(
            출력=GM출력(
                narrative=f"{턴}턴의 서사.",
                choices=[선택지(id="c1", label="깃털을 줍는다")],
                is_key_scene=뼈대.핵심씬인가(턴),
                scene_prompt_hint=힌트,
                trial_path="care" if 턴 >= 9 else None,
            )
        )

    async def _굽기(artwork_id, 장면힌트: str, tier: str, 아이문장=None):
        센것["구운것"].append((str(artwork_id), 장면힌트, tier))

    async def _내보내도되나(프롬프트문: str):
        return 검사결과(blocked=센것["검사막나"])

    async def _요약(재료):
        return "요약이다."

    async def _추출(서사: str, 지금: dict):
        return 지금

    async def _되묻기횟수(자녀id: str, 키: str, **_):
        return 1

    monkeypatch.setattr(stage1, "검사하기", _통과)
    monkeypatch.setattr(stage1, "evaluate", _평가)
    monkeypatch.setattr(stage1, "서사", _서사)
    monkeypatch.setattr(stage1, "챕터굽기", _굽기)
    monkeypatch.setattr(stage1, "내보내도되나", _내보내도되나)
    monkeypatch.setattr(stage1, "요약하기", _요약)
    monkeypatch.setattr(stage1, "상태추출", _추출)
    monkeypatch.setattr(stage1, "되묻기횟수", _되묻기횟수)
    return 센것


def _턴(client: TestClient, 판: dict) -> dict:
    return client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장}).json()


# ── 프롬프트는 부품을 그대로 쓴다 ─────────────────────────


def test_챕터_프롬프트가_카드와_같은_부품을_쓴다():
    """**⛔ 특히 가이드 주입을 안 뺀다** — PRD B-5 가 **「삽화에서 가이드를 빼지
    않는다 — 안전 사유」**로 못 박았다(가이드 없이 구운 위기 장면이 만 10~12세에게
    경계에 가까웠다). **글자금지는 늘 마지막**이다."""
    from app.artwork import GUIDE, STYLE, 구도, 글자금지, 접미어

    글 = 챕터프롬프트(힌트, "rare", 문장)

    assert 글.startswith(STYLE)
    assert f"Scene: {힌트}" in 글
    assert 접미어["rare"] in 글 and 구도 in 글 and GUIDE in 글
    assert 글.rstrip().endswith(글자금지)


def test_장면_힌트가_비면_기본_에셋으로_간다():
    """`None` 은 실패가 아니라 **기본 에셋 신호**다 (PRD B-3 「플레이 중단 없음」)."""
    assert 챕터프롬프트("", "rare") is None
    assert 챕터프롬프트("   ", "legendary", 문장) is None


# ── ⛔ 상한 둘 ──────────────────────────────────────────


async def test_핵심씬_턴에서만_굽는다(client: TestClient, _유료호출을_끊는다: dict):
    """**1턴·9턴 둘뿐이다** (뼈대). 2·3턴에는 **새 그림이 없다** — 화면은 **직전
    핵심 씬 그림을 그대로 둔다**(프론트 8번 규칙)."""
    판 = client.post(챕터).json()

    첫턴 = _턴(client, 판)
    둘째 = _턴(client, 판)

    assert 첫턴["artwork"] is not None, "1턴은 챕터의 얼굴이다"
    assert 둘째["artwork"] is None
    assert len(_유료호출을_끊는다["구운것"]) == 1


async def test_한_판에_두_장을_넘지_않는다(client: TestClient, _유료호출을_끊는다: dict):
    """**⛔ 이 검사가 돈을 지킨다.** 뼈대가 핵심 씬을 둘로 묶은 근거가
    **「매 턴 굽으면 한 챕터에 10회이고 하루 상한($0.50)을 한 아이가 혼자 넘는다」**다.
    """
    판 = client.post(챕터).json()
    for _ in range(10):
        _턴(client, 판)

    async with db.SessionLocal() as session:
        행들 = list((await session.execute(select(Artwork))).scalars())

    assert len(_유료호출을_끊는다["구운것"]) == 2
    assert len(행들) == 2
    assert all(것.chapter_id is not None for 것 in 행들)


async def test_이미_두_장이면_더_안_굽는다(
    client: TestClient, _유료호출을_끊는다: dict, monkeypatch: pytest.MonkeyPatch
):
    """**모델이 핵심 씬이라고 해도 서버가 막는다.** 1번에서 `is_key_scene` 을
    되찾은 것과 같은 자리 — **돈이 걸린 판단을 프롬프트 준수율에 맡기지 않는다.**

    **핵심 씬을 셋으로 늘려** 상한이 실제로 막는지 본다.
    """
    monkeypatch.setattr(뼈대, "핵심씬턴들", lambda: (1, 2, 3))
    판 = client.post(챕터).json()

    for _ in range(3):
        _턴(client, 판)

    assert len(_유료호출을_끊는다["구운것"]) == 2, "셋째는 상한에 막힌다"


# ── ⛔ 안전 ──────────────────────────────────────────────


async def test_출력_검사에_막히면_안_굽는다(client: TestClient, _유료호출을_끊는다: dict):
    """**E-1 양방향 — 이미지 프롬프트도 검사 대상**이다 (PRD E-1).

    **GM 이 낸 장면이 그대로 이미지 모델로 가는 자리**라, 막히면 **굽지 않고 기본
    에셋으로 간다.** 아이 화면은 그래도 그림이 있다 — **빈 액자가 아니다.**
    """
    _유료호출을_끊는다["검사막나"] = True
    판 = client.post(챕터).json()

    몸 = _턴(client, 판)

    assert _유료호출을_끊는다["구운것"] == []
    assert 몸["artwork"] is not None, "기본 에셋이라도 자리가 있어야 한다"
    assert 몸["artwork"]["status"] == "ready"


# ── 책과 폴링 ───────────────────────────────────────────


async def test_완결한_챕터_장에_그림이_붙는다(client: TestClient):
    """**9번(A-7)이 `artwork_id` 를 비워 뒀던 자리다.** 책 한 장에 **그 챕터의
    마지막 핵심 씬**이 붙는다 — **보상의 순간(9턴)**이 그 장의 그림이다."""
    판 = client.post(챕터).json()
    for _ in range(10):
        _턴(client, 판)

    async with db.SessionLocal() as session:
        장 = (
            await session.execute(select(BookPage).where(BookPage.source == "chapter"))
        ).scalar_one()

    assert 장.artwork_id is not None


async def test_내_챕터_삽화를_폴링으로_찾는다(client: TestClient):
    """폴링은 **소유 확인**을 지난다 (`Stage0.md` 5절). 출처가 둘이 됐으니
    **챕터 갈래도 그 확인을 지나야** 한다 — 안 그러면 **아이가 자기 그림을 404 로 본다.**
    """
    판 = client.post(챕터).json()
    몸 = _턴(client, 판)
    artwork_id = 몸["artwork"]["artwork_id"]

    응답 = client.get(f"/api/v1/artworks/{artwork_id}")

    assert 응답.status_code == 200, 응답.text


async def test_남의_챕터_삽화는_못_본다(client: TestClient, 학부모행, 비밀번호: str):
    """**403 으로 가르지 않는다** — 가르는 순간 「그 삽화는 존재한다」가 샌다."""
    판 = client.post(챕터).json()
    몸 = _턴(client, 판)

    async with db.SessionLocal() as session:
        삽화 = (await session.execute(select(Artwork))).scalars().first()
        삽화.chapter_id = None
        삽화.card_attempt_id = None
        await session.rollback()  # 제약이 막는다 — 행을 고치지 않고 남의 id 로 본다

    응답 = client.get(f"/api/v1/artworks/{'0' * 8}-0000-0000-0000-{'0' * 12}")

    assert 응답.status_code == 404
    assert 몸["artwork"]["artwork_id"] != ""
