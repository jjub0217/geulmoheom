# W1 6번 — 이미지 모델 벤치 계획 (실행 전)

작성 2026-09-01 · 근거 PRD 9장 #1b · B-5 화풍 일관성 · `docs/api/미결.md` 11-1
**아직 실행하지 않았다.** `IMAGE_API_KEY` 가 비어 있고 결제수단이 정리되지 않았다.

이 문서는 키가 들어오는 즉시 기계적으로 돌릴 수 있도록 **무엇을 고정하고 무엇을 잴지**를
먼저 정해둔 것이다. 프롬프트는 대표·PM 검토 대상이다.

## 왜 미리 정하나

"모델 2~3개를 동일 프롬프트로 비교"(9장 #1b)에서 **동일**이 성립하려면 프롬프트·시드·
크기를 먼저 못 박아야 한다. 돌리면서 프롬프트를 손보면 비교가 아니라 인상이 된다.

## 고정할 것

### 1. 화풍·캐릭터 태그 (B-5 MUST — 모든 프롬프트에 시스템 주입)

`docs/캐릭터/도우미캐릭터설명.md` 색상코드를 그대로 쓴다.

```
STYLE: warm 3D-animated storybook illustration, soft rim light, rounded shapes,
       children's picture-book palette, no text, no watermark
GUIDE: red panda explorer-scholar, cream face markings (#F6EADB),
       orange-russet fur (#D45B28), brown leather explorer vest (#8F5C3E),
       blue scarf (#457B9D), scholar cap, brass-rimmed magic compass (#C29B59)
       with cyan glowing crystal (#33E1FF)
```

### 2. 장면 프롬프트 — 카드 c01 (위기)

`docs/장면카드_초안.md` c01 의 상황문을 영어 장면 묘사로 옮긴 것. 아이 입력이 아니다.

```
SCENE: misty forest at dusk, a huge shadow moving slowly between tall trees,
       a snapped twig on the ground, the explorer standing alert with the guide
```

**무기 접촉 장면을 만들지 않는다** — `안전_어휘_기준.md` 5장이 이미지 프롬프트를 서사보다
엄격히 두고 "대치·준비 자세·승리 후" 컷만 허용한다. 위 장면은 대치 컷이다.

### 3. 티어 접미어 3종 (B-5 SHOULD)

| 티어 | 접미어 |
|---|---|
| basic | `simple flat colors, minimal background detail` |
| rare | `richer lighting, detailed background, subtle depth of field` |
| legendary | `dramatic cinematic lighting, intricate detail, painterly finish` |

### 4. 그 외 고정

- **시드 고정** (같은 시드를 전 모델에 사용). 시드를 못 받는 모델은 그 자체가 탈락 사유다 — B-5 MUST 가 "동일 시드 계열 사용"이다
- 해상도·종횡비 1024x1024 통일
- 티어 3종 x 모델 N개 = 비교 대상. 카드는 c01 하나로 고정

## 잴 것

| 항목 | 왜 |
|---|---|
| **생성 지연 (p50·최대)** | **미결 11-1(폴링 vs SSE)의 결정 입력.** 3초 안쪽이면 폴링으로 충분, 10초를 넘으면 대기 화면 설계가 달라진다 (`미결.md`) |
| 장당 단가 | 9장 #1b 추정이 $0.03~0.05, 파일럿 $100~150. 실측으로 대체 |
| 시드 고정 지원 | B-5 MUST. 미지원이면 탈락 |
| 스타일 참조 지원 | 9장 #1b 명시 조건 |
| 티어 3종의 시각적 차이 | 아이가 "올라갔다"고 느껴야 보상이 된다 (B-3) |
| 15초 초과 여부 | PRD 7장 — 초과 시 기본 에셋 대체. 초과가 잦으면 폴백 빈도가 문제가 된다 |

## 판정

- **"가장 좋은 것"이 아니라 "쓸 만한 것"을 고른다** — 주차계획 W1 위험 표의 지시다
- 시드 고정을 못 하면 화풍 일관성(B-5)이 깨지므로 화질과 무관하게 탈락
- 지연이 15초를 자주 넘으면 폴백 에셋만 보이게 되어 보상이 성립하지 않는다

## 돌리려면 필요한 것

1. **결제수단** — Fal.ai / Replicate 각각 별도 결제다 (Gemini 유료 티어와 무관)
2. `.env` 의 `IMAGE_PROVIDER` · `IMAGE_API_KEY` · `IMAGE_MODEL`
3. 후보 모델 2~3개 선정 — 키 발급 후 각 서비스의 모델 목록에서 시드·스타일 참조 지원 여부로 1차 거른다

**생성물은 저장소에 커밋하지 않는다.** 비교용 이미지는 로컬에 두고, 이 문서에는 수치와
판정만 남긴다.

## 지금 막혀 있는 것의 성격

주차계획 W1 위험 표는 "이미지 벤치가 2일을 넘기면" 미결 11-1이 밀린다고 보고 대응책을
"모델 2개로 줄인다"로 적어뒀다. **이번 차단은 벤치 시간이 아니라 결제라 그 대응이 듣지
않는다.** 11-1 → W3 B-3 삽화 보상까지 연쇄로 걸려 있다.
