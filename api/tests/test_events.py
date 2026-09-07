"""KPI 이벤트 로깅 (F-1). **판정 데이터가 남는가가 아니라, 원문이 안 남는가를 본다.**

지표 정의는 `검증가설_성공지표.md` 2.0, 필드는 `MVP_PRD.md` 5장이 원본이다.
여기서 지키는 것은 셋이다.

1. **이벤트마다 실을 수 있는 필드가 정해져 있다.** 목록 밖은 죽는다 — `events.payload`
   는 아이 원문이 가장 쉽게 새는 자리다 (「길이만 남기려다 문장을 담는다」)
2. **`char_len` 은 공백 포함 길이**다. 이 정의 위에 H2 합격선이 서 있다
3. 기록이 실패해도 **아이 요청은 안 죽는다.** 측정이 제품을 멈추게 하지 않는다
"""

import pytest

from app import db
from app.events import EVENT_FIELDS, 기록
from app.models import Event


async def _행들(child_id=None) -> list[Event]:
    from sqlalchemy import select

    async with db.SessionLocal() as session:
        q = select(Event).order_by(Event.id)
        if child_id is not None:
            q = q.where(Event.child_id == child_id)
        return list((await session.execute(q)).scalars())


# ── 원문이 못 들어간다 ────────────────────────────────────


async def test_목록에_없는_필드는_죽는다(자녀행):
    """**이 테스트가 이 모듈의 존재 이유다.**

    `payload` 는 자유 JSON 이라 무엇이든 들어간다. 「디버깅용으로 잠깐」이 커밋에
    남는 자리가 여기다 (`api/CLAUDE.md` 「절대 하지 않는 것」).
    """
    async with db.SessionLocal() as session:
        with pytest.raises(ValueError, match="text"):
            await 기록(session, 자녀행.id, "turn_input", card_id="c01", char_len=12, text="은빛 검")


async def test_모르는_이벤트는_죽는다(자녀행):
    """이름을 지어내면 지표가 조용히 안 잡힌다 — 집계 쪽에서만 드러난다."""
    async with db.SessionLocal() as session:
        with pytest.raises(ValueError, match="card_written"):
            await 기록(session, 자녀행.id, "card_written", card_id="c01")


def test_어느_이벤트에도_원문_필드가_없다():
    """목록 자체를 지킨다. 필드를 추가할 때 걸리라고 둔 그물이다."""
    금지 = {"text", "input", "sentence", "문장", "signals", "descriptors", "message"}
    for 이벤트, 필드 in EVENT_FIELDS.items():
        assert not (금지 & set(필드)), 이벤트


# ── 남는다 ───────────────────────────────────────────────


async def test_행이_남는다(자녀행):
    async with db.SessionLocal() as session:
        await 기록(session, 자녀행.id, "turn_input", card_id="c01", input_type="free", char_len=42)
        await session.commit()

    (행,) = await _행들(자녀행.id)
    assert 행.event == "turn_input"
    assert 행.payload == {"card_id": "c01", "input_type": "free", "char_len": 42}
    assert 행.ts is not None


# ── 로그로도 나간다 ───────────────────────────────────────


def test_모든_필드가_SAFE_EXTRA_KEYS_에_있다():
    """**목록에 없는 것은 조용히 사라진다** (`app/logging_config.py`).

    `events` 행은 남는데 로그 줄만 텅 비는 것이 가장 늦게 발견되는 어긋남이다 —
    둘을 나란히 보다가 「로그가 안 남네」로 원인을 엉뚱한 데서 찾는다.
    """
    from app.logging_config import SAFE_EXTRA_KEYS

    필드 = {키 for 목록 in EVENT_FIELDS.values() for 키 in 목록}
    assert 필드 <= set(SAFE_EXTRA_KEYS), 필드 - set(SAFE_EXTRA_KEYS)


async def test_로그_줄에_이벤트_이름과_값이_실린다(자녀행, caplog):
    import logging

    with caplog.at_level(logging.INFO, logger="app"):
        async with db.SessionLocal() as session:
            await 기록(session, 자녀행.id, "daily_cap_reached", cap=5)

    (줄,) = [r for r in caplog.records if r.message == "daily_cap_reached"]
    assert 줄.cap == 5


async def test_로그를_끌_수_있다(자녀행, caplog):
    """`eval_result`·`scaffold_triggered`·`moderation_blocked` 는 **이미 자기 모듈에서
    더 자세히 로그를 남긴다** (`app/evaluator.py`·`app/moderation.py`). 행만 더한다.
    """
    import logging

    with caplog.at_level(logging.INFO, logger="app"):
        async with db.SessionLocal() as session:
            await 기록(session, 자녀행.id, "eval_result", grade="G2", 로그=False)
            await session.commit()

    assert not [r for r in caplog.records if r.message == "eval_result"]
    assert len(await _행들(자녀행.id)) == 1


# ── 흐름에 붙어 있다 ──────────────────────────────────────

아이문장 = "은빛 검을 들고 그림자 뒤로 살금살금 돌아간다"


@pytest.fixture(autouse=True)
def 판정_고정(monkeypatch):
    """네트워크를 타지 않는다. 여기서 보는 것은 판정 품질이 아니라 **무엇이 남는가**다."""
    from app.api.v1 import attempts
    from app.evaluator import 평가결과
    from app.moderation import 검사결과

    async def _판정(text: str, **_) -> 평가결과:
        return 평가결과(grade="G2", signals=["adj:은빛", "adv:살금살금"], latency_ms=12.0)

    async def _통과(text: str) -> 검사결과:
        return 검사결과(blocked=False)

    monkeypatch.setattr(attempts, "evaluate", _판정)
    monkeypatch.setattr(attempts, "검사하기", _통과)


async def test_시도가_turn_input_과_eval_result_를_남긴다(client, 자녀행):
    client.post("/api/v1/attempts", json={"card_id": "c01", "text": 아이문장})

    남은것 = {행.event: 행.payload for 행 in await _행들(자녀행.id)}
    assert "turn_input" in 남은것
    assert "eval_result" in 남은것
    # **공백 포함 원문 길이** (PRD 5장). 걷어낸 값은 아이가 쓴 문장이 아닌 것을 재는 값이다.
    assert 남은것["turn_input"]["char_len"] == len(아이문장) == 25
    assert 남은것["turn_input"]["input_type"] == "free"
    assert 남은것["turn_input"]["grade"] == "G2"


async def test_재시도는_card_retry_로_남는다(client, 자녀행):
    """H2 재시도율(합격선 20%)의 유일한 신호다 — **보상이 동기로 작동하는지**를 본다."""
    client.post(
        "/api/v1/attempts",
        json={"card_id": "c01", "text": 아이문장, "retry_of": "att_1"},
    )

    (재시도,) = [행 for 행 in await _행들(자녀행.id) if 행.event == "card_retry"]
    assert 재시도.payload["card_id"] == "c01"


async def test_상한에_닿으면_daily_cap_reached_가_남는다(client, 자녀행):
    응답 = client.post(
        "/api/v1/attempts",
        json={"card_id": "c01", "text": 아이문장},
        headers={"X-Mock-Error": "DAILY_CAP_REACHED"},
    )
    assert 응답.status_code == 409

    (상한,) = [행 for 행 in await _행들(자녀행.id) if 행.event == "daily_cap_reached"]
    assert 상한.payload["cap"] == 5


async def test_클라이언트_배치가_행으로_남는다(client, 자녀행):
    """예전에는 받아서 버렸다. **버리면 D1·D7 을 셀 수 없다** (`session_start`)."""
    응답 = client.post(
        "/api/v1/events",
        json={
            "events": [
                {"event": "session_start", "ts": "2026-09-07T10:00:00Z", "locked": False},
                {"event": "card_shown", "ts": "2026-09-07T10:00:05Z", "card_id": "c01"},
                {
                    "event": "pii_masked",
                    "ts": "2026-09-07T10:01:00Z",
                    "layer": "client",
                    "kind": "phone",
                },
            ]
        },
    )
    assert 응답.status_code == 204

    남은것 = [행.event for 행 in await _행들(자녀행.id)]
    assert 남은것 == ["session_start", "card_shown", "pii_masked"]


async def test_어느_행에도_아이_문장이_없다(client, 자녀행):
    """**이 파일의 마지막 그물이다.** 위 테스트들이 「무엇이 남는가」를 보는 동안
    이것 하나가 「무엇이 남으면 안 되는가」를 본다.
    """
    client.post("/api/v1/attempts", json={"card_id": "c01", "text": 아이문장})

    전부 = str([행.payload for 행 in await _행들(자녀행.id)])
    for 조각 in ("은빛", "살금살금", "그림자", 아이문장):
        assert 조각 not in 전부


# ── 클라이언트를 믿지 않는다 ──────────────────────────────


async def test_클라이언트는_서버_몫_이벤트를_못_남긴다(client, 자녀행):
    """`turn_input`·`eval_result` 는 서버가 판정과 함께 남긴다 (`Stage0.md` 7절).

    **받아 주면 H2 가 통째로 위조된다** — 글자 수와 등급이 곧 합격선이다.
    프론트를 믿지 않는 이유는 E-2 서버 2차와 같다: 클라이언트는 우회된다.
    """
    응답 = client.post(
        "/api/v1/events",
        json={
            "events": [
                {"event": "turn_input", "ts": "2026-09-07T10:00:00Z", "card_id": "c01"},
                {"event": "card_shown", "ts": "2026-09-07T10:00:01Z", "card_id": "c01"},
            ]
        },
    )
    assert 응답.status_code == 204  # 나머지는 받는다. 배치 전체를 물리지 않는다

    assert [행.event for 행 in await _행들(자녀행.id)] == ["card_shown"]


async def test_클라이언트가_server_라고_해도_client_로_남는다(client, 자녀행):
    """`layer` 는 **어느 층이 잡았는지**를 가르는 값이다. 클라이언트 말로 정하지 않는다."""
    client.post(
        "/api/v1/events",
        json={
            "events": [
                {
                    "event": "pii_masked",
                    "ts": "2026-09-07T10:00:00Z",
                    "layer": "server",
                    "kind": "phone",
                }
            ]
        },
    )

    (행,) = await _행들(자녀행.id)
    assert 행.payload["layer"] == "client"


async def test_기록이_실패해도_아이는_안_막힌다(client, monkeypatch, caplog):
    """**측정이 제품을 멈추게 하지 않는다.**

    반대쪽(E-1 검사)은 판정을 못 받으면 막는다. 여기는 통과시킨다 — 값이 다르기
    때문이다. 검사가 통과시키면 유해 문장이 아이 책에 인쇄되지만, 이벤트를 못 남기면
    **잃는 것은 지표 한 줄**이다.
    """
    import logging

    from sqlalchemy.exc import OperationalError

    async def _터짐(*_, **__):
        raise OperationalError("select 1", {}, Exception("DB 없음"))

    monkeypatch.setattr("app.events.기록", _터짐)

    with caplog.at_level(logging.WARNING, logger="app"):
        응답 = client.post("/api/v1/attempts", json={"card_id": "c01", "text": 아이문장})

    assert 응답.status_code == 200
    assert 응답.json()["outcome"] == "result"
    assert [r for r in caplog.records if r.message == "event_write_failed"]


async def test_클라이언트가_필드를_잘못_붙여도_500_이_안_난다(client, 자녀행):
    """`session_start` 에 `card_id` 는 없는 필드다 (PRD 5장).

    서버 코드에서는 이게 **죽어야 맞다** — 개발자 실수를 조용히 버리면 지표가 안 잡힌
    것을 집계 때나 안다. 하지만 **여기 오는 것은 남의 입력**이라 같은 규칙을 쓰면
    클라이언트가 500 을 만들 수 있다. 검증기가 죽는 곳과 안 죽는 곳을 갈라야 한다.
    """
    응답 = client.post(
        "/api/v1/events",
        json={
            "events": [
                {"event": "session_start", "ts": "2026-09-07T10:00:00Z", "card_id": "c01"},
                {"event": "card_shown", "ts": "2026-09-07T10:00:01Z", "card_id": "c01"},
            ]
        },
    )
    assert 응답.status_code == 204

    # 어긋난 건만 버리고 나머지는 남는다.
    assert [행.event for 행 in await _행들(자녀행.id)] == ["card_shown"]
