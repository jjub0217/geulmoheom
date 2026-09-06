"""`docs/` 마크다운을 읽는 공통 조각.

루브릭·장면 카드·되묻기 템플릿이 전부 문서를 원본으로 삼는다 (`app/rubric.py` ·
`app/scene_cards.py` · `app/scaffold.py`). 읽는 방법이 갈라지지 않게 여기 모은다.
"""

import re
from pathlib import Path


def 읽기(문서: Path) -> str:
    try:
        return 문서.read_text(encoding="utf-8")
    except OSError as exc:  # 배포 형태가 바뀌어 docs/ 가 함께 오지 않은 경우
        raise RuntimeError(f"기준 문서를 읽지 못했다: {문서.name}") from exc


def 표행(줄: str) -> list[str]:
    return [칸.strip() for 칸 in 줄.strip().strip("|").split("|")]


def 민(글: str) -> str:
    """마크다운 강조·인라인 코드를 뗀다. 프롬프트나 아이 화면에 별표가 갈 이유가 없다."""
    return re.sub(r"[*`]", "", 글).strip()
