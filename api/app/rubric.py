"""루브릭·예시셋·판정 경계를 **문서에서 읽어** Evaluator 프롬프트를 조립한다.

**코드에 복사하지 않는다.** 기준은 `MVP_PRD.md` 4.3절과 `docs/루브릭_예시셋.md` 다.
복사해 두면 문서와 갈라지고, **갈라진 쪽이 실제로 아이를 판정한다.**
절 번호나 표 모양이 바뀌면 여기가 즉시 실패한다 — 조용히 옛 루브릭으로 도는 것이 최악이다.

`scripts/bench_evaluator.py` 가 이 모듈을 쓴다. 벤치에서 잰 프롬프트와 운영이 쓰는
프롬프트가 갈라지면 `benchmarks/W2-evaluator-bench.md` 의 수치가 근거를 잃는다.
"""

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from app.config import REPO_ROOT

예시셋문서 = REPO_ROOT / "docs" / "루브릭_예시셋.md"
PRD = REPO_ROOT / "docs" / "MVP_PRD.md"

등급 = Literal["G0", "G1", "G2", "G3"]
등급들: tuple[str, ...] = ("G0", "G1", "G2", "G3")


@dataclass(frozen=True)
class 예시:
    등급: str
    카드: str
    입력: str
    유형: str  # 전투 / 비전투

    @property
    def 비전투(self) -> bool:
        return self.유형 == "비전투"


def _읽기(문서: Path) -> str:
    try:
        return 문서.read_text(encoding="utf-8")
    except OSError as exc:  # 배포 형태가 바뀌어 docs/ 가 함께 오지 않은 경우
        raise RuntimeError(f"루브릭 문서를 읽지 못했다: {문서.name}") from exc


def _표행(줄: str) -> list[str]:
    return [칸.strip() for 칸 in 줄.strip().strip("|").split("|")]


def _민(글: str) -> str:
    """마크다운 강조·인라인 코드를 뗀다. 프롬프트에 별표가 들어갈 이유가 없다."""
    return re.sub(r"[*`]", "", 글).strip()


@lru_cache
def 예시셋읽기() -> tuple[예시, ...]:
    """`## G0 — …` 섹션마다 표를 읽는다. 열 개수가 등급마다 다르므로 앞 4열만 쓴다."""
    묶음: list[예시] = []
    현재: str | None = None
    for 줄 in _읽기(예시셋문서).splitlines():
        머리 = re.match(r"^## (G[0-3]) ", 줄)
        if 머리:
            현재 = 머리.group(1)
            continue
        if 줄.startswith("## "):
            현재 = None
        if 현재 is None or not 줄.startswith("|"):
            continue
        칸 = _표행(줄)
        if len(칸) < 4 or not 칸[0].isdigit():
            continue  # 머리글·구분선
        묶음.append(예시(등급=현재, 카드=칸[1], 입력=칸[2], 유형=칸[3]))
    if not 묶음:
        raise RuntimeError("예시셋을 하나도 못 읽었다. 문서 표 모양이 바뀌었는지 본다")
    return tuple(묶음)


@lru_cache
def 경계읽기() -> tuple[str, ...]:
    """「판정 경계」 표를 규칙 줄로. 예시셋만으로는 안 잡히는 것들이다."""
    규칙: list[str] = []
    구간 = False
    for 줄 in _읽기(예시셋문서).splitlines():
        if 줄.startswith("## 판정 경계"):
            구간 = True
            continue
        if 구간 and 줄.startswith("## "):
            break
        if not 구간 or not 줄.startswith("|"):
            continue
        칸 = _표행(줄)
        if len(칸) != 2 or 칸[0] in {"상황", ""} or set(칸[0]) <= {"-", ":"}:
            continue
        규칙.append(f"- {_민(칸[0])} → {_민(칸[1])}")
    return tuple(규칙)


@lru_cache
def 루브릭읽기() -> str:
    """PRD 4.3절의 표와 규칙을 그대로 가져온다. 요약하지 않는다 — 요약이 곧 해석이다."""
    조각 = re.search(r"^### 4\.3 .*?$(.*?)^### 4\.4 ", _읽기(PRD), re.S | re.M)
    if not 조각:
        raise RuntimeError("PRD 4.3절을 못 찾았다. 절 번호가 바뀌었으면 여기를 고친다")
    줄들 = []
    for 줄 in 조각.group(1).strip().splitlines():
        if set(줄.strip()) <= {"-", "|", ":", " "} and 줄.strip():
            continue  # 표 구분선
        줄들.append(_민(줄))
    return "\n".join(줄들).strip()


def 번갈아(few: tuple[예시, ...]) -> list[예시]:
    """등급을 번갈아 배치한다. 문서 순서대로 넣으면 프롬프트 끝이 전부 G3 라
    최근 예시 쪽으로 판정이 쏠린다. **무작위로 섞지 않는다** — 매 호출 순서가
    달라지면 context caching 이 깨지고 재현도 안 된다."""
    통: dict[str, list[예시]] = {}
    for e in few:
        통.setdefault(e.등급, []).append(e)
    줄: list[예시] = []
    for i in range(max((len(v) for v in 통.values()), default=0)):
        for 급 in sorted(통):
            if i < len(통[급]):
                줄.append(통[급][i])
    return 줄


@lru_cache
def 프롬프트(few: tuple[예시, ...]) -> str:
    보기 = "\n".join(f"- 「{e.입력}」 → {e.등급}" for e in 번갈아(few))
    경계 = "\n".join(경계읽기())
    return (
        "너는 초등 5~6학년이 쓴 '행동 묘사 문장'을 4단계로 판정한다.\n"
        "루브릭은 아래가 전부다. 여기 없는 기준을 스스로 만들지 않는다.\n\n"
        f"[루브릭]\n{루브릭읽기()}\n\n"
        f"[판정 경계]\n{경계}\n\n"
        f"[예시]\n{보기}\n\n"
        "출력은 {grade, signals, descriptors}. "
        'signals 는 "adj:은빛", "adv:재빨리", "clause:방법" 형식이고 '
        "descriptors 는 문장에서 그대로 뽑은 묘사어다."
    )


@lru_cache
def 시스템지시() -> str:
    """운영이 쓰는 프롬프트. 예시셋 전체를 붙인 형태다 (벤치 `all` 모드와 같다)."""
    return 프롬프트(예시셋읽기())
