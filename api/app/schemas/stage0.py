"""Stage 0 요청·응답 스키마. `docs/api/Stage0.md` 그대로다.

**이 파일이 프론트 계약이다.** `/openapi.json` → `make contracts` → `web/src/api/types.gen.ts`.
필드를 바꾸면 커밋 메시지에 `명세 변경:` 줄을 남긴다.

아이 화면에 나가는 문자열은 `docs/용어사전.md` 「아이 화면」 열을 따른다.
**등급(G0~G3)은 어떤 응답에도 넣지 않는다** — 로그 전용이다 (용어사전 3장).
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

CardType = Literal["crisis", "discovery", "encounter"]
Tier = Literal["basic", "rare", "legendary"]
# **`failed` 를 뺐다** (2026-09-08 계약 변경, `Stage0.md` 5절). 나갈 자리가 없는
# 값이었다 — 15초 초과도, 생성 실패도, 출력 검사 차단도 전부 **안전한 기본 삽화**로
# 가서 `ready` 로 수렴한다 (PRD B-3 「플레이 중단 없음」).
# **되살리려면 그 결정을 먼저 뒤집어야 한다.**
ArtworkStatus = Literal["pending", "ready"]
Visibility = Literal["private", "family", "public"]
GuideExpression = Literal["default", "compass_bright", "compass_dim", "session_end"]
# **`moderation` 하나다** (2026-09-08 대표 판정, 미결 11-5). 종전 `moderation | pii`.
# **PII 는 막지 않고 가린 뒤 진행하므로 차단 응답이 나오지 않는다** — 값을 남겨 두면
# 영영 안 쓰이는 분기가 계약에 남는다 (`Stage0.md` 4절 (c)).
BlockedReason = Literal["moderation"]
HighlightKind = Literal["adj", "adv", "clause"]


class Guide(BaseModel):
    """가이드 캐릭터의 표정과 대사. 프론트는 `expression` → PNG 매핑만 한다."""

    expression: GuideExpression
    line: str


class Today(BaseModel):
    cards_done: int
    cap: int


class TodayState(Today):
    """`locked` 가 true 면 프론트는 세션 종료 화면만 표시한다 (A0-5)."""

    locked: bool


class ChildToday(TodayState):
    resets_at: datetime = Field(description="기기 로컬 자정. 클라이언트가 X-Timezone 을 보낸다")


# ── 1. 학부모 ────────────────────────────────────────────


class SignupRequest(BaseModel):
    email: str
    password: str
    consent: bool = Field(description="false 면 422. 동의 문구 버전은 서버가 기록한다")
    labeling_consent: bool = Field(
        default=False,
        description="아이 문장을 Evaluator 개선용 라벨링에 활용. 거부해도 서비스 이용 가능",
    )


class SignupResponse(BaseModel):
    """**토큰이 없다.** `Set-Cookie: __Host-gm_parent` 로 내려간다 (`공통규약.md` 「인증 쿠키」)."""

    parent_id: str
    consent_at: datetime


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    """토큰은 쿠키로만 간다. 프론트가 로그인 성공을 아는 것은 **이 200 응답 자체**다."""

    parent_id: str


class ChildSummary(BaseModel):
    child_id: str
    nickname: str
    age_band: int
    daily_cap: int
    played_today: bool = Field(
        description="오늘 했는지 여부. **개수가 아니다** — 「5장 중 2장」은 계약에 없다"
    )
    last_active_at: datetime | None


class ParentMe(BaseModel):
    """성장 데이터·입력 내용은 반환하지 않는다 (P1 대시보드 범위)."""

    parent_id: str
    email: str
    consent_at: datetime
    children: list[ChildSummary]


class CreateChildRequest(BaseModel):
    nickname: str = Field(description="PII 검사 통과 필수. 실패 시 422 detail.reason=PII_DETECTED")
    age_band: Literal[10, 11, 12]


class AccessCode(BaseModel):
    access_code: str = Field(description="6자리, 24시간, 1회용. 서버는 해시만 저장한다")
    access_code_expires_at: datetime


class CreateChildResponse(AccessCode):
    child_id: str
    nickname: str


class UpdateChildRequest(BaseModel):
    daily_cap: int = Field(ge=10, le=20)


class UpdateChildResponse(BaseModel):
    daily_cap: int


# ── 2. 자녀 인증 ─────────────────────────────────────────


class ChildAuthRequest(BaseModel):
    access_code: str


class ChildIdentity(BaseModel):
    child_id: str
    nickname: str
    guide_name: str | None


class ChildAuthResponse(BaseModel):
    """**토큰이 없다.** `Set-Cookie: __Host-gm_child` 로 내려간다."""

    child: ChildIdentity


class ChildMe(BaseModel):
    child_id: str
    nickname: str
    guide_name: str | None
    today: ChildToday


class UpdateGuideRequest(BaseModel):
    guide_name: str = Field(description="아이가 지어주는 이름. 1회. PII 검사")


class UpdateGuideResponse(BaseModel):
    guide_name: str


# ── 3. 카드 ──────────────────────────────────────────────


class Card(BaseModel):
    """**그림이 없다.** 카드 화면에는 상황문과 가이드만 나간다 (2026-09-09 PM 판정).

    **`sketch_url` 을 걷어냈다.** 그 값은 `https://r2.example/...` 라는 픽스처 주소였고
    가리키는 에셋은 만든 적이 없다 — **프론트가 빈 액자를 그리고 있었다.**
    프론트가 「못 불러와도 안 무너지게」 옳게 처리해 둬서 **조용히 지나갔다.**

    **다시 채우는 것이 답이 아니라고 판정됐다.** 카드 스케치와 결과 삽화가 **같은 장면
    프롬프트에서 나와서**, 쓰기 전에 그 장면을 보여주면 **결과가 카드와 같은 그림이 되고
    보상이 0 이다.** 거기에 한 겹 더 — **아이가 묘사할 것을 그림이 대신 말해 준다.**
    Stage 0 이 재는 것이 H2(묘사 노력)인데 **보고 베끼면 그 값이 오염된다.**

    **반론을 알고 넘어간다** — 글만 있으면 만 10~12세에게 진입 장벽일 수 있다.
    **관찰 신호 1번이 정확히 그것을 잰다**(30초를 넘기면 카드 문장이 실패한 것).
    **못 시작하면 그때 스케치를 설계한다** — 「모르니까 안 넣는다」가 아니다.

    **`장면카드_초안.md` 의 「스케치 프롬프트」 열은 남는다** — `app/artwork.py` 가
    **결과 삽화**를 굽는 데 쓴다. **이름이 판단을 가렸던 자리다** — 「스케치」라
    카드 화면의 밑그림처럼 읽혔는데 실제로는 결과 삽화용이다.
    """

    card_id: str
    type: CardType
    situation: str
    prompt_label: str
    guide: Guide
    today: Today


# ── 4. 시도 ──────────────────────────────────────────────


class AttemptRequest(BaseModel):
    card_id: str
    text: str = Field(
        min_length=1,
        max_length=500,
        description="클라이언트 1차 PII 마스킹 후 전송. 서버는 마스킹된 텍스트를 책 콘텐츠로 저장",
    )
    retry_of: str | None = Field(
        default=None, description="재시도면 이전 attempt_id. 카운트 미소모"
    )
    prompted: bool = Field(
        default=False, description="캐릭터 권유로 인한 재시도. Stage 0은 항상 false"
    )


class Highlight(BaseModel):
    """Evaluator 가 감지한 묘사어. 프론트는 입력문 위에 하이라이트한다."""

    text: str
    kind: HighlightKind


class ArtworkRef(BaseModel):
    """**`placeholder_url` 은 2026-09-08 계약에서 빠졌다.**

    성공이든 폴백이든 그림은 **`/artworks/{id}/image` 한 주소**로 나간다
    (미결 11-7 · PM 판정). 별도 주소를 두면 **주소만 보고 「기본 그림인가」를 알 수
    있게 되고**, 그건 「`fallback` 을 아이에게 알리지 않는다」와 정면으로 어긋난다.
    """

    artwork_id: str
    status: ArtworkStatus
    url: str | None


class AttemptResult(BaseModel):
    """정상 — 결과 연출."""

    outcome: Literal["result"]
    attempt_id: str
    tier: Tier
    highlights: list[Highlight]
    guide: Guide
    artwork: ArtworkRef
    today: TodayState
    can_retry: bool


class AttemptScaffold(BaseModel):
    """되묻기 — 카드 미소모. 프론트는 입력창과 기존 텍스트를 유지한다."""

    outcome: Literal["scaffold"]
    attempt_id: str
    guide: Guide
    scaffold_count: int = Field(description="2 이후 같은 카드 재제출은 서버가 result 로 돌려준다")
    today: TodayState


class AttemptBlocked(BaseModel):
    """차단 — 카드 미소모. **카테고리·사유를 아이에게 말하지 않는다.**"""

    outcome: Literal["blocked"]
    reason: BlockedReason
    guide: Guide
    today: TodayState


# 프론트는 `outcome` 으로 화면을 가른다 (api/CLAUDE.md).
AttemptResponse = Annotated[
    AttemptResult | AttemptScaffold | AttemptBlocked,
    Field(discriminator="outcome"),
]


# ── 5. 삽화 ──────────────────────────────────────────────


class Artwork(BaseModel):
    artwork_id: str
    status: ArtworkStatus
    url: str | None
    tier: Tier
    # **설명 문구를 안 넓혔다** (2026-09-09). 2026-09-09 에 티어 폴백이 생기면서
    # 「15초 초과」가 이 값의 전부가 아니게 됐지만, **설명만 고쳐도 `/openapi.json`
    # 이 바뀌어 `web/src/api/types.gen.ts` 재생성이 따라붙는다.** 프론트 동작은
    # 하나도 안 달라지므로 **결정 잠금(`adr/0011`)의 「더 좋게」**이고, 문구는
    # `docs/api/Stage0.md` 5절(PM 몫)에서 먼저 고친다.
    #
    # **실제 의미는 셋이다** — 15초 초과 · 같은 카드의 `legendary` 로 떨어짐 ·
    # 기본 에셋. 어느 쪽이든 **아이 화면에는 드러내지 않는다**.
    fallback: bool = Field(description="15초 초과 시 기본 에셋으로 확정된 것 (B-3)")


# ── 6. 내 책 ─────────────────────────────────────────────


class BookPage(BaseModel):
    page_no: int
    source: Literal["card", "chapter"]
    source_id: str
    tier: Tier
    artwork_url: str | None
    text: str = Field(description="아이 원문 그대로. 맞춤법·AI 보정 없음")
    achieved_at: datetime


class BookCounts(BaseModel):
    basic: int
    rare: int
    legendary: int


class Book(BaseModel):
    book_id: str
    title: str
    # **책에 속한 값이다.** `GET /child/me` 의 `nickname` 은 **보는 사람**의 이름이고
    # 이건 **쓴 사람**의 이름이다 — 공유 서재(P1)에서 남의 책을 열면 갈린다
    # (`Stage0.md` 6절). `visibility` 를 미리 넣어 둔 것과 같은 이유다.
    author: str = Field(description="지은이. 자녀 닉네임 그대로")
    visibility: Visibility = Field(description="Stage 0 에서는 항상 private. 필드만 선반영")
    pages: list[BookPage]
    counts: BookCounts


class BookToday(BaseModel):
    """세션 종료 화면용. 오늘 추가·교체된 페이지만."""

    pages: list[BookPage]


class UpdateBookRequest(BaseModel):
    title: str


class UpdateBookResponse(BaseModel):
    title: str


# ── 7. 이벤트 ────────────────────────────────────────────


class ClientEvent(BaseModel):
    """클라이언트만 아는 이벤트. **원문 필드 없음.**"""

    event: str
    ts: datetime
    card_id: str | None = None
    locked: bool | None = None
    layer: Literal["client", "server"] | None = None
    kind: str | None = None


class EventBatch(BaseModel):
    events: list[ClientEvent] = Field(max_length=50)


# ── 오류 ─────────────────────────────────────────────────


class ErrorDetail(BaseModel):
    code: str = Field(description="기계용 식별자")
    message: str = Field(description="아이가 읽는 문장")
    detail: dict = Field(default_factory=dict)


class ErrorEnvelope(BaseModel):
    """`docs/api/공통규약.md` 오류 형식."""

    error: ErrorDetail
