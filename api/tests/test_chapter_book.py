"""챕터 완결 = 책 한 장 (A-7 · W7 9번 백엔드 몫).

**⛔ 이 파일이 지키는 것은 하나다 — 문장이 아이 원문 그대로라는 것.**
비전 2장: **「책 문장은 아이 원문 그대로. 맞춤법 교정·AI 보정 없음」**이고
PM 이 9번 착수에 그것을 다시 못 박았다. **요약·다듬기를 넣으면 A-7 이 아니다.**

**⭐ 「내 책」(A0-4)이 이미 있다 — 넣는 것만 새것이다.** `book_pages` 가 `source` 로
`card`·`chapter` 를 이미 갈라 뒀고 응답 스키마도 그렇다. **새 테이블·새 응답이 없다.**

**⛔ 선택지 제출은 거부하고 책에는 직접 쓴 문장만 남긴다.** 선택지 라벨은
**GM 이 쓴 문장**이라 아이 글로 실을 수 없다.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import db
from app.api.v1 import stage1
from app.evaluator import 평가결과
from app.gm import GM출력, 서사결과, 선택지
from app.models import BookPage, Child
from app.moderation import 검사결과

pytestmark = pytest.mark.anyio

챕터 = "/api/v1/chapters"
턴 = "/api/v1/turns"
내책 = "/api/v1/book"

# **아이가 썼다고 치는 문장들.** 지어낸 것이고 실제 아이 문장이 아니다
문장들 = [
    "이끼 낀 돌계단을 한 칸씩 올라가며 톱니 소리를 들어본다",
    "차가운 톱니 사이로 외투 끈을 살살 밀어 넣는다",
    "톱니에 끼인 깃털을 두 손으로 조심스럽게 빼낸다",
]


@pytest.fixture(autouse=True)
def _유료호출을_끊는다(monkeypatch: pytest.MonkeyPatch) -> dict:
    센것 = {"등급": "G2", "되묻기횟수": 1}

    async def _통과(text: str):
        return 검사결과(blocked=False)

    async def _평가(text: str, *, 기록: bool = True):
        return 평가결과(grade=센것["등급"], signals=[], descriptors=[])

    async def _서사(지시: str, 프롬프트: str, *, 턴: int, 허용재시도: int = 1):
        return 서사결과(
            출력=GM출력(
                narrative=f"{턴}턴의 서사.",
                choices=[선택지(id="c1", label="GM 이 쓴 선택지 라벨이다")],
                trial_path="care" if 턴 >= 9 else None,
            )
        )

    async def _되묻기횟수(자녀id: str, 키: str, **_):
        return 센것["되묻기횟수"]

    monkeypatch.setattr(stage1, "검사하기", _통과)
    monkeypatch.setattr(stage1, "evaluate", _평가)
    monkeypatch.setattr(stage1, "서사", _서사)
    monkeypatch.setattr(stage1, "되묻기횟수", _되묻기횟수)
    return 센것


def _한판(client: TestClient, *, 선택지시도턴: set[int] = frozenset()) -> dict:
    """10번 직접 써서 완결한다. 선택지 시도는 거부된 뒤 같은 턴에 직접 쓴다."""
    판 = client.post(챕터).json()
    마지막 = {}
    for 번 in range(1, 11):
        if 번 in 선택지시도턴:
            거부 = client.post(턴, json={"chapter_id": 판["chapter_id"], "choice_id": "c1"})
            assert 거부.status_code == 422
            assert client.get(f"{챕터}/current").json()["turn"] == 번 - 1
        응답 = client.post(
            턴, json={"chapter_id": 판["chapter_id"], "text": 문장들[번 % len(문장들)]}
        )
        assert 응답.status_code == 200, 응답.text
        마지막 = 응답.json()
    assert 마지막["chapter_done"] is True, 마지막
    return 판


# ── 완결 = 한 장 ─────────────────────────────────────────


async def test_완결하면_책에_한_장이_남는다(client: TestClient):
    판 = _한판(client)

    책 = client.get(내책).json()
    장들 = [것 for 것 in 책["pages"] if 것["source"] == "chapter"]

    assert len(장들) == 1
    assert 장들[0]["source_id"] == 판["chapter_id"]
    assert 장들[0]["tier"] == "rare"  # `G2` → rare (`TIER_BY_GRADE`)
    # 굽는 중에도 artwork 참조를 건네야 책을 먼저 열어도 그 면에서 폴링할 수 있다.
    assert 장들[0]["artwork"] is not None
    assert 장들[0]["artwork"]["artwork_id"]


async def test_완결_전에는_장이_안_생긴다(client: TestClient):
    """**완결이 한 장이다.** 도중에 생기면 **끝내지 않은 이야기가 책에 실린다.**"""
    판 = client.post(챕터).json()
    for _ in range(3):
        client.post(턴, json={"chapter_id": 판["chapter_id"], "text": 문장들[0]})

    책 = client.get(내책).json()

    assert [것 for 것 in 책["pages"] if 것["source"] == "chapter"] == []


async def test_문장이_아이_원문_그대로다(client: TestClient):
    """**⛔ A-7 의 전부다** (비전 2장). 요약·다듬기·맞춤법 교정이 없다 —
    **아이가 쓴 글자가 그대로 있어야 한다.**"""
    _한판(client)

    장 = next(것 for 것 in client.get(내책).json()["pages"] if 것["source"] == "chapter")

    for 쓴것 in 문장들:
        assert 쓴것 in 장["text"], 쓴것


async def test_거부된_선택지_대신_직접_쓴_열_문장만_책에_남는다(client: TestClient):
    """선택지 시도는 진행하지 않고, 이후 직접 쓴 문장을 원래 순서로 보존한다."""
    _한판(client, 선택지시도턴={2, 5})

    장 = next(것 for 것 in client.get(내책).json()["pages"] if 것["source"] == "chapter")

    assert "GM 이 쓴 선택지 라벨이다" not in 장["text"]
    assert 장["text"] == "\n".join(문장들[번 % len(문장들)] for 번 in range(1, 11))


async def test_완결_화면이_그_장_번호를_가리킨다(client: TestClient):
    """`ChapterSummary.book_page_no` (계약 5절). **없으면 화면이 「책에 남았어」라고
    말하면서 어디에 남았는지 못 가리킨다.**"""
    판 = _한판(client)

    요약 = client.get(f"{챕터}/{판['chapter_id']}/summary").json()
    장 = next(것 for 것 in client.get(내책).json()["pages"] if 것["source"] == "chapter")

    assert 요약["book_page_no"] == 장["page_no"]


async def test_카드_페이지와_같은_책에_함께_쌓인다(client: TestClient, 자녀행: Child):
    """**「내 책」이 이미 있다** (A0-4). **새 책을 만들지 않는다** — 챕터 장이
    카드 장들과 **한 권에** 들어간다."""
    _한판(client)

    async with db.SessionLocal() as session:
        장들 = list((await session.execute(select(BookPage))).scalars())

    assert len({것.book_id for 것 in 장들}) == 1


async def test_턴_원문이_이벤트에는_여전히_없다(client: TestClient):
    """**칸이 열린 것은 책 콘텐츠 자리뿐이다** (2026-09-16 사용자 지시).
    **로그·이벤트 payload 는 그대로 금지다.**"""
    from app.models import Event

    _한판(client)

    async with db.SessionLocal() as session:
        이벤트들 = list((await session.execute(select(Event))).scalars())

    쌓인글 = " ".join(str(것.payload) for 것 in 이벤트들)
    for 쓴것 in 문장들:
        assert 쓴것 not in 쌓인글
    assert "이끼" not in 쌓인글
