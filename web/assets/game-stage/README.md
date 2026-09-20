# 게임 무대 이미지

2026-09-17, 사용자가 요청한 전체 화면 숲 배경과 레서판다 무대용 이미지.
내장 `image_gen` 도구로 생성했다. CLI/API 별도 호출은 사용하지 않았다.
기존 `public/guide/*.png` 원본은 그대로 보존한다. 서버의 표정 선택도 바꾸지 않는다.

## 결과 파일

- `public/adventure/forest-stage.png`: 1536×1024, 전체 화면 분위기용 배경. 현재 카드의 사건이나 해결 방법을 그리지 않는다.
- `public/guide/default-stage.png`: 기본 표정, 실제 투명 배경.
- `public/guide/compass_dim-stage.png`: 되묻기 표정, 실제 투명 배경.
- `public/guide/compass_bright-stage.png`: 밝은 나침반 표정, 실제 투명 배경.
- `public/guide/session_end-stage.png`: 종료 인사 표정, 실제 투명 배경.

## 생성 프롬프트

### 숲 배경

Use case: illustration-story. Asset type: production full-bleed background for a children's writing adventure game, landscape 1536x1024 or wider. Create an inviting hand-painted storybook forest clearing, fine illustrated outlines and soft gouache watercolor shading, mature polished cozy game art suitable for ages 10–12. Tall graceful trees frame left and right edges, layered misty blue-teal forest in the distance, soft amber sunlight filtering through canopy, a softly lit sandy path/open clearing in lower center where a character sprite will stand. Clear depth, natural rich details concentrated toward the edges, calm uncluttered midground for a standing character and a speech bubble. Composition must remain coherent when center-cropped to portrait mobile. The bottom quarter will sit behind an opaque ivory game dialogue panel; keep focal beauty in upper three quarters. Palette harmonizes with warm cream, reddish-brown fur, brass and blue scarf: warm ochre wood, dusty teal foliage, deep blue shadows, golden afternoon light. Atmosphere only: no dragons, no nests, no characters, no animals, no buildings, no text, no lettering, no UI frames, no logos or watermark. This is an environment background asset, not a screenshot or mockup. Fill the entire image with the landscape.

### 기본 표정

입력: `public/guide/default.png`.

Use case: background-extraction. Input image is the edit target: existing red panda explorer-scholar mascot. Produce a clean full-body game character sprite on a genuinely transparent alpha background. Change ONLY the opaque light-gray background to transparency. Preserve the mascot identity, illustration style, exact friendly neutral facial expression, body proportions, dark scholar cap, brass goggles, blue patterned scarf, brown vest and shoulder bag, tail stripes, the compass held in its paw, all colors and details, original pose and full silhouette. Keep entire ears/cap/tail/feet visible with a small transparent margin. No white or gray box, no checkerboard drawn into the image, no restyling, no extra props, no new shadows outside the character. The output must have real transparent pixels and crisp high-resolution illustration edges, suitable for compositing over a forest game background.

### 나머지 표정 세 가지

각 입력: `public/guide/compass_dim.png`, `public/guide/compass_bright.png`, `public/guide/session_end.png`.
동일한 아래 프롬프트로 각 원본을 별도 편집했다.

Use case: background-extraction. Edit target is the supplied existing red panda explorer-scholar mascot expression. Change ONLY the light gray background to a truly transparent alpha background, to create a full body game character sprite. Preserve exact character identity, facial expression, hand pose, compass state, hat and goggles, blue patterned scarf, vest, bag, tail and all props exactly as present. Do not change the expression into a different emotion. Preserve full silhouette cap/ears/tail/feet with small transparent margin. The glowing compass in the bright expression must retain its soft blue light as semitransparent pixels on alpha; retain dimness if target has a dim compass. Clean transparent PNG, no rectangle, no checkerboard printed in image, no new shadows, no new elements, no text. Existing comic illustration linework and warm colors unchanged.
