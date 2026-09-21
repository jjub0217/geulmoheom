"""자녀 계정 삭제 — **즉시 파기** (E-4, PRD E-4 MUST · 1.1b).

**「CASCADE 라고 적혀 있다」와 「실제로 지워진다」는 다르다.** 선언만 보고 넘어가면
FK 하나에 `ondelete` 가 빠져 있을 때 **삭제가 통째로 실패**한다 — 그리고 그건
학부모가 지워 달라고 한 데이터가 남아 있다는 뜻이다.

그래서 여기서는 **실제로 행을 만들고 지운 뒤 남은 것을 센다.**
"""

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app import artwork_store, db, storage
from app.models import Artwork, Book, BookPage, CardAttempt, Chapter, Child, Event
from app.scaffold import _아이키


async def _자녀데이터를_채운다(child_id: uuid.UUID) -> None:
    """책 한 장까지 만든다 — **`book_pages` 가 `card_attempts` 를 FK 로 물고 있어서**
    거기가 캐스케이드가 끊기기 가장 쉬운 자리다.
    """
    # **카드는 만들지 않는다.** `conftest` 의 씨뿌리기가 이미 문서의 스물셋을 넣어 뒀다
    # (A0-1). 여기서 또 만들면 같은 `c01` 이 두 벌이 되고, 그중 어느 쪽이 진짜인지가
    # 테스트마다 갈린다.
    async with db.SessionLocal() as session:
        시도 = CardAttempt(
            child_id=child_id,
            card_id="c01",
            attempt=1,
            grade="G2",
            tier="rare",
            char_len=12,
            text="은빛 검을 들고 달려갔다",
        )
        session.add(시도)
        await session.flush()

        삽화 = Artwork(card_attempt_id=시도.id, tier="rare", status="ready")
        책 = Book(child_id=child_id, title="내 책")
        session.add_all([삽화, 책])
        await session.flush()

        session.add(
            BookPage(
                book_id=책.id,
                source="card",
                source_id="c01",
                page_no=1,
                card_attempt_id=시도.id,
                artwork_id=삽화.id,
                text="은빛 검을 들고 달려갔다",
                tier="rare",
                achieved_at=datetime.now(UTC),
            )
        )
        session.add(
            Event(
                child_id=child_id,
                event="turn_input",
                ts=datetime.now(UTC),
                payload={"char_len": 12},
            )
        )
        await session.commit()


async def _남은수(child_id: uuid.UUID) -> dict[str, int]:
    async with db.SessionLocal() as session:
        시도 = (
            await session.execute(
                select(func.count())
                .select_from(CardAttempt)
                .where(CardAttempt.child_id == child_id)
            )
        ).scalar_one()
        책 = (
            await session.execute(
                select(func.count()).select_from(Book).where(Book.child_id == child_id)
            )
        ).scalar_one()
        쪽 = (await session.execute(select(func.count()).select_from(BookPage))).scalar_one()
        삽화 = (await session.execute(select(func.count()).select_from(Artwork))).scalar_one()
        이벤트 = (
            await session.execute(
                select(func.count()).select_from(Event).where(Event.child_id == child_id)
            )
        ).scalar_one()
    return {"시도": 시도, "책": 책, "쪽": 쪽, "삽화": 삽화, "이벤트": 이벤트}


async def test_자녀를_지우면_책과_시도와_이벤트가_함께_간다(client, 자녀행: Child):
    await _자녀데이터를_채운다(자녀행.id)
    assert _남은수 and (await _남은수(자녀행.id))["쪽"] == 1  # 채워졌는지 먼저 본다

    응답 = client.delete(f"/api/v1/parents/children/{자녀행.id}")

    assert 응답.status_code == 204
    assert await _남은수(자녀행.id) == {"시도": 0, "책": 0, "쪽": 0, "삽화": 0, "이벤트": 0}


class 가짜Redis:
    """`scan_iter` 와 `delete` 만 있으면 된다. **진짜 Redis 를 쓰지 않는 이유**는
    `TestClient` 가 요청마다 이벤트 루프를 새로 만들어, 모듈 수준 클라이언트가
    다른 루프에 붙잡히기 때문이다 (conftest 가 엔진에 대해 적어 둔 것과 같은 성질).
    """

    def __init__(self, 값: dict[str, str]) -> None:
        self.값 = dict(값)

    async def scan_iter(self, match: str):
        앞 = match.rstrip("*")
        for 키 in list(self.값):
            if 키.startswith(앞):
                yield 키

    async def delete(self, 키: str) -> None:
        self.값.pop(키, None)


async def test_자녀를_지우면_되묻기_카운터도_지운다(client, 자녀행: Child, monkeypatch):
    """**Redis 잔여 파기** — `delete_child` 주석이 「E-4 다」로 남겨 둔 자리다.

    아이 원문은 없지만 **어느 카드에서 몇 번 되물었는지**가 남는다. 24시간 뒤에
    사라지긴 해도, 「즉시 파기」라고 해 놓고 하루를 남기는 것은 그 말과 다르다.
    """
    내키 = f"scaffold:{_아이키(str(자녀행.id))}:c01"
    남의키 = f"scaffold:{_아이키('다른-아이')}:c01"
    가짜 = 가짜Redis({내키: "2", 남의키: "1"})
    monkeypatch.setattr(db, "redis_client", 가짜)

    client.delete(f"/api/v1/parents/children/{자녀행.id}")

    # **남의 카운터는 안 건드린다.** 접두어가 해시라 실수로 넓히면 남의 것까지 지운다.
    assert 내키 not in 가짜.값
    assert 남의키 in 가짜.값


async def test_redis_가_죽어도_삭제는_끝난다(client, 자녀행: Child, monkeypatch):
    """뒷정리가 본체를 죽이지 않는다. **DB 에서는 이미 지워졌는데 500 이 나가면
    학부모는 「안 지워졌다」고 읽는다.**
    """

    class 죽은Redis:
        def scan_iter(self, match: str):
            raise ConnectionError("redis 없음")

    monkeypatch.setattr(db, "redis_client", 죽은Redis())

    응답 = client.delete(f"/api/v1/parents/children/{자녀행.id}")

    assert 응답.status_code == 204


# ── 삽화 파일 파기 ──────────────────────────────────────
#
# **「DB 행이 사라졌다」와 「파일이 지워졌다」는 다르다.** 위 검사들은 행만 센다 —
# 2026-09-21 까지 **지우는 코드가 `api/app` 전역에 0건**인 채로 전부 통과하고 있었고,
# 그동안 `MVP_PRD.md` 324 「즉시 파기」와 `페인_가이드라인정책.md` DLP-03
# 「24시간 내 파기」가 문서에만 적혀 있었다.
#
# **⛔ 여기서 지키는 것이 셋이다.**
# ① **개인 삽화 파일이 실제로 없어진다** — 출처가 둘(카드 시도·챕터)이라 **둘 다 본다**
# ② **공용 삽화는 안 없어진다** — 여러 아이가 같이 보는 파일이라 **한 아이의 삭제가
#    다른 아이의 그림을 가져가면 안 된다**
# ③ **못 지웠으면 지운 척하지 않는다** — 파일이 남았는데 204 를 주면 **학부모는
#    파기됐다고 읽는다.** 그 거짓이 이 기능에서 제일 나쁜 실패다


@pytest.fixture
def 보관함(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """**저장소 자격증명이 없을 때의 자리로 검사한다.** 테스트는 네트워크를 안 탄다 —
    `올리기()` 가 자격증명이 없으면 로컬로 떨어지는 그 경로와 같은 곳이다.
    """
    monkeypatch.setattr(storage, "로컬보관함", tmp_path)
    return tmp_path


def _파일을둔다(보관함: Path, 오브젝트키: str) -> Path:
    경로 = 보관함 / 오브젝트키
    경로.parent.mkdir(parents=True, exist_ok=True)
    경로.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 32)
    return 경로


async def _삽화를_파일과_함께_둔다(child_id: uuid.UUID) -> dict[str, str]:
    """**출처 둘을 다 만든다** — 카드 시도 하나, 챕터 하나.

    그리고 **카드 시도 쪽에는 공용 조합 키를 적는다.** 캐시가 맞은 경우가 실제로
    그렇게 저장되기 때문이다(`artwork_store.만들기`) — **그 아이 행이 가리키는 키를
    다 지우면 공용 파일이 날아가는** 바로 그 자리다.
    """
    공용키 = "artworks/c01_legendary-0123456789abcdef.png"
    개인키 = f"artworks/시도/{uuid.uuid4()}-0123456789abcdef.png"
    챕터키 = f"artworks/시도/{uuid.uuid4()}-fedcba9876543210.png"

    async with db.SessionLocal() as session:
        시도 = CardAttempt(
            child_id=child_id,
            card_id="c02",
            attempt=1,
            grade="G3",
            tier="legendary",
            char_len=20,
            text="달빛이 물결 위로 길게 깔렸다",
        )
        챕터 = Chapter(child_id=child_id, chapter_key="ch01")
        session.add_all([시도, 챕터])
        await session.flush()

        session.add_all(
            [
                # 캐시가 맞아 **공용 파일을 그대로 가리키는** 행
                Artwork(card_attempt_id=시도.id, tier="legendary", status="ready", r2_key=공용키),
                # 이 아이 문장으로 구운 것
                Artwork(card_attempt_id=시도.id, tier="rare", status="ready", r2_key=개인키),
                Artwork(chapter_id=챕터.id, tier="rare", status="ready", r2_key=챕터키),
            ]
        )
        await session.commit()

    return {"공용": 공용키, "개인": 개인키, "챕터": 챕터키}


async def test_개인_삽화_파일이_실제로_지워진다(client, 자녀행: Child, 보관함: Path):
    """**카드 시도와 챕터 둘 다다.** `artworks` 에는 `child_id` 가 없고 출처가 둘이라,
    한 쪽만 타면 **챕터 삽화가 조용히 남는다.**
    """
    키 = await _삽화를_파일과_함께_둔다(자녀행.id)
    for 이름 in ("공용", "개인", "챕터"):
        _파일을둔다(보관함, 키[이름])

    응답 = client.delete(f"/api/v1/parents/children/{자녀행.id}")

    assert 응답.status_code == 204
    assert not (보관함 / 키["개인"]).exists()
    assert not (보관함 / 키["챕터"]).exists()


async def test_여러_아이가_쓰는_공용_삽화는_남는다(client, 자녀행: Child, 보관함: Path):
    """**이 검사가 이 기능에서 제일 무섭다.** 기준을 「그 아이 행이 가리키는 키」로
    잡으면 통과하는 검사가 아니다 — 깔아 둔 `legendary` 18장이 **다른 아이들에게서
    함께 사라진다.** 기준은 **`artworks/시도/` 경로**여야 한다.
    """
    키 = await _삽화를_파일과_함께_둔다(자녀행.id)
    for 이름 in ("공용", "개인", "챕터"):
        _파일을둔다(보관함, 키[이름])

    응답 = client.delete(f"/api/v1/parents/children/{자녀행.id}")

    assert 응답.status_code == 204
    assert (보관함 / 키["공용"]).exists(), "공용 삽화가 한 아이의 삭제에 딸려 갔다"


async def test_파일을_못_지우면_아이_정보가_남고_다시_시도할_수_있다(
    client, 자녀행: Child, 보관함: Path, monkeypatch: pytest.MonkeyPatch
):
    """**지운 척하지 않는다** (2026-09-21 사용자 지시).

    파일이 남았는데 204 를 주면 학부모는 **파기됐다고 읽는다.** 그래서 DB 를 안 지우고
    오류를 낸다 — `INTERNAL_ERROR` 는 학부모 화면에서 **「잠시 문제가 생겼습니다.
    잠시 뒤에 다시 시도해 주세요.」**로 나간다(`문구.md` 3.8). **다시 누를 수 있어야
    하므로 아이가 목록에 남아 있어야 한다.**
    """
    await _삽화를_파일과_함께_둔다(자녀행.id)

    async def _못지운다(오브젝트키: str) -> bool:
        return False

    # **`artwork_store` 쪽을 갈아끼운다.** 그 모듈이 `from app.storage import 지우기` 로
    # 이름을 가져가 있어서, `storage` 쪽만 바꾸면 **이미 묶인 이름이 그대로 불린다.**
    monkeypatch.setattr(artwork_store, "지우기", _못지운다)

    응답 = client.delete(f"/api/v1/parents/children/{자녀행.id}")

    assert 응답.status_code == 500
    assert 응답.json()["error"]["code"] == "INTERNAL_ERROR"
    # **아이가 남아 있어야 다시 누를 수 있다.**
    남음 = client.get("/api/v1/parents/me")
    assert any(아이["child_id"] == str(자녀행.id) for 아이 in 남음.json()["children"])


async def test_파일이_이미_없어도_삭제가_끝난다(client, 자녀행: Child, 보관함: Path):
    """**같은 요청을 다시 보내도 안전해야 한다** (2026-09-21 사용자 지시).

    첫 시도가 파일까지 지우고 DB 커밋에서 실패했다면, 다시 눌렀을 때 **이미 없는
    파일을 지우려다 전체가 막힌다.** 그러면 학부모는 **영영 못 지운다.**
    """
    await _삽화를_파일과_함께_둔다(자녀행.id)
    # 파일을 하나도 두지 않는다 — DB 에는 키가 적혀 있고 실물은 없는 상태

    응답 = client.delete(f"/api/v1/parents/children/{자녀행.id}")

    assert 응답.status_code == 204
    assert await _남은수(자녀행.id) == {"시도": 0, "책": 0, "쪽": 0, "삽화": 0, "이벤트": 0}


async def test_공용_키는_지우라고_해도_거부한다(보관함: Path):
    """**코드가 실수해도 막히는 자리를 하나 더 둔다.** 목록을 만드는 쪽이 이미 거르지만,
    거기 버그가 나면 **공용 파일이 사라지고 다른 아이들 화면이 기본 그림으로 바뀐다.**
    AWS 권한도 같은 것을 막지만 **로컬 보관함에는 그 권한이 없다.**
    """
    공용키 = "artworks/c01_legendary-0123456789abcdef.png"
    _파일을둔다(보관함, 공용키)

    assert await storage.지우기(공용키) is False
    assert (보관함 / 공용키).exists()
