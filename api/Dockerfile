# 글모험 api — Render 무료 인스턴스에 올라가는 컨테이너 (`docs/adr/0012` 결정 1).
#
# **⛔ 빌드 컨텍스트는 저장소 루트다. `api/` 만으로는 뜨지 않는다.**
# 런타임이 `docs/` 를 **읽어서** 돈다 — 장면 카드(`장면카드_초안.md`) · 루브릭 예시셋 ·
# 안전 어휘 기준 · 화면 문구(`문구.md`) · PRD(되묻기 템플릿) · 가이드 캐릭터 그림.
# **문서라서 넣는 게 아니라 입력이라서 넣는다** — 빠지면 카드도 문구도 안 나오는데
# **기동은 성공한다.**
#
# `app/config.py` 의 `REPO_ROOT` 가 `<루트>/api/app/..` 를 전제하므로 **배치를 그대로
# 옮긴다** — 앱은 `/srv/api`, 문서는 `/srv/docs`. 여기서 한 칸 어긋나면 위와 같은
# 조용한 실패다.

FROM python:3.12-slim-bookworm

# **uv 를 핀으로 박는다.** `latest` 면 빌드마다 다른 것이 들어오고 그 차이는 배포 후에만 보인다.
#
# **ghcr 의 uv 이미지에서 복사하지 않는다** — 그러면 빌드가 레지스트리 **둘**(Docker Hub +
# ghcr)에 걸린다. PyPI 는 어차피 `uv sync` 가 쓰므로, 여기로 모으면 **끊길 자리가 하나 준다.**
RUN pip install --no-cache-dir uv==0.12.10

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/srv/api \
    PATH="/srv/api/.venv/bin:$PATH"

WORKDIR /srv/api

# 의존성 층을 먼저 굽는다. 소스만 바뀌면 이 층은 캐시에 남는다.
COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev

# `[tool.uv] package = false` 라 앱은 설치되지 않고 작업 디렉터리에서 그대로 돈다.
COPY api/ ./
COPY docs/ /srv/docs/

# Render 는 `PORT` 를 준다. 기본값은 붙여 두되 **로컬에서도 같은 명령으로 뜬다**.
#
# `--proxy-headers` — 프록시(Vercel → Render) 뒤라 api 는 http 로 받는다.
# **`--forwarded-allow-ips` 를 안 주면 `--proxy-headers` 가 조용히 무시된다** (기본이
# `127.0.0.1` 인데 Render 의 앞단은 그 주소가 아니다).
#
# `*` 는 **모든 앞단을 믿는다**는 뜻이다. Render 의 앞단 IP 가 고정이 아니라 다른 수가 없다 —
# **그래서 속도 제한은 이 헤더를 안 쓴다.** 클라이언트가 채워 보낼 수 있어서다. 그쪽은
# `CLIENT_IP_HEADER` 로 따로 받는다 (`app/child_auth_limit.py`).
#
# **기동에 셋을 순서대로 붙인다 — 마이그레이션 · 장면 카드 뿌리기 · uvicorn.**
#
# **⛔ 카드 뿌리기를 빼면 기동은 성공하고 아이가 카드를 못 받는다** (2026-09-10 에
# 실제로 그랬다 — `/readyz` 의 `cards: down`). `scripts/seed_cards.py` 머리말이
# **「배포마다 돈다」**고 적어 뒀는데 **첫 Dockerfile 이 그걸 안 읽었다** — 축 ⑪ 이다.
# 둘 다 **몇 번을 돌려도 결과가 같다**(alembic 은 같은 리비전이면 넘어가고,
# 씨뿌리기는 덮어쓴다).
#
# **`&&` 로 잇는다 — 앞이 실패하면 서버가 아예 안 뜬다.** 그것이 의도다:
# 스키마 없이 뜨면 **가입이 500 이 되고**(그 자리를 겪었다), 카드 없이 뜨면
# **아이가 빈 화면을 본다.** **죽는 쪽이 보인다.**
# (문서에서 카드를 지웠는데 이미 아이가 쓴 카드면 FK 가 여기서 막는다 —
#  그건 사람이 판단할 일이라 조용히 넘기지 않는 것이 맞다.)
#
# **`exec` 로 넘겨** uvicorn 이 PID 1 을 받게 한다 — 안 그러면 Render 의 종료 신호가
# 셸에서 멈춘다.
CMD ["sh", "-c", "alembic upgrade head && python scripts/seed_cards.py && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000} --proxy-headers --forwarded-allow-ips=\"*\""]
