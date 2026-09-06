"""루브릭·예시셋을 **문서에서** 읽는지 본다 (`app/rubric.py`).

코드에 복사해 두면 문서와 갈라지고 갈라진 쪽이 실제로 아이를 판정한다. 이 파일은
그 규율이 깨졌는지 — 문서 절 번호·표 모양이 바뀌었는지 — 를 CI 에서 먼저 알린다.
"""

from app.rubric import 경계읽기, 루브릭읽기, 번갈아, 시스템지시, 예시셋읽기, 프롬프트


def test_예시셋_40개를_읽는다():
    """등급별 10개 (`docs/루브릭_예시셋.md`)."""
    예시들 = 예시셋읽기()

    assert len(예시들) == 40
    for 급 in ("G0", "G1", "G2", "G3"):
        assert sum(1 for e in 예시들 if e.등급 == 급) == 10


def test_비전투가_등급마다_절반_이상이다():
    """전투 편향을 막으려고 넣은 조건이다 (`루브릭_예시셋.md`)."""
    예시들 = 예시셋읽기()

    for 급 in ("G0", "G1", "G2", "G3"):
        같은급 = [e for e in 예시들 if e.등급 == 급]
        assert sum(1 for e in 같은급 if e.비전투) >= len(같은급) / 2


def test_PRD_4_3_절을_읽는다():
    본문 = 루브릭읽기()

    assert "G0" in 본문 and "G3" in 본문
    assert "맞춤법" in 본문  # 「맞춤법·띄어쓰기 무시」 규칙
    assert "*" not in 본문  # 마크다운 강조는 떼고 넣는다


def test_판정_경계도_프롬프트에_들어간다():
    경계 = 경계읽기()

    assert 경계
    assert all(줄.startswith("- ") and "→" in 줄 for 줄 in 경계)
    assert all(줄 in 시스템지시() for 줄 in 경계)


def test_예시를_등급별로_번갈아_배치한다():
    """문서 순서대로 넣으면 프롬프트 끝 10개가 전부 G3 라 최근 예시로 판정이 쏠린다."""
    줄 = 번갈아(예시셋읽기())

    assert [e.등급 for e in 줄[:8]] == ["G0", "G1", "G2", "G3"] * 2


def test_같은_예시셋이면_프롬프트가_같다():
    """매 호출 순서가 달라지면 context caching 이 깨지고 재현도 안 된다."""
    assert 시스템지시() == 프롬프트(예시셋읽기())


def test_운영_프롬프트에_예시_40개가_다_들어간다():
    지시 = 시스템지시()

    assert all(e.입력 in 지시 for e in 예시셋읽기())
