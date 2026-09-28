---
name: wireframe
description: Author and verify Heroines design-system wireframes from confirmed screen behavior using the design pipeline harness, then export the completed wireframe to a new Figma file. Use only while the session stage is design_system_wireframe.
---

# BA Design System Wireframe

Run only when `session.py status` reports `stage=design_system_wireframe` and the
screen-behavior artifact is confirmed.

**This stage asks the planner nothing** — `ask --kind interview` and `ask --kind confirmation`
are both refused here. 2·3단계와 같이 **스스로 확정한다**: `sync`가 모든 타깃 `accept_ai`에
닿으면 컨트롤러가 그 자리에서 확정한다.

## 툴은 생성기가 아니라 검증 하네스다

`prepare`는 노드 하나당 태그 하나인 **빈 템플릿**을 깔 뿐이다. 렌더러·design-spec·결정
기록·이미지 검수는 전부 **당신이 작성한다**(authored). 엔진은 Ajv 계약과 Playwright DOM·상태·
전이·접근성·캡처로 **게이트만** 한다. 이걸 착각하면 템플릿 그대로 통과시키고 빈 화면을 낸다.

```
prepare → (author renderer + design-spec + traceability) → spec → runtime
        → (author design-decisions + ai-review) → freeze → gate
```

## Derivation manifest

packet은 손으로 쓰지 않는다. `wireframe_adapter.adapt_screen_behavior`가
`screen-behavior.json`에서 생성한다. 직접 쓴 packet은 이미 있는 기계를 중복하는 것이다.

## 기존 화면은 현재 코드 기준선에서 그린다

brief(= packet target)의 `origin`이 `current`·`changed`면 `current_baseline`이 있다. 그 화면은
팩 역할로 새로 조립하지 않는다.

- 렌더러의 영역 구성과 **순서**는 `current_baseline.regions[]`를 따른다. 영역 안의 글자는 기준선의
  `texts`를 그대로 쓴다 — 지금 제품에 있는 문구이므로 지어낸 문구가 아니다. 데이터 필드 이름으로
  적힌 값만 상위가 정한 샘플 값으로 채운다.
- `changed` 화면은 `changes[]`만 반영한다: `modify`는 그 영역을 고치고, `add`는 명세된 위치에
  더하고, `remove`는 뺀다. 새로 더하는 영역만 팩 역할·레시피·토큰을 따른다.
- 기준선의 컴포넌트 이름은 조판의 단서다. 대응하는 팩 컴포넌트가 있으면 그것으로, 없으면 가장
  가까운 역할로 그리고 이미지 검수 관찰에 차이를 적는다.
- 결정 6단계의 `layout`·`components` rationale에 기준선을 따랐는지(또는 어디서 벗어났는지)를
  적는다. 이미지 검수 W1(정보 위계)·W2(composition)는 캡처의 영역 순서를 기준선과 대조한다.
- `status: unavailable`이면 이유를 검수 관찰에 옮기고 역할 기반으로 그린다. 멈추지 않는다.

## 토큰을 지어내지 않는다

`scripts/pack_tokens_css.py <pack> -o renderer/tokens.css`가 팩에서 CSS 변수를 생성한다.
렌더러에 hex 값이나 임의 px을 적지 않는다. 브랜드 색을 추측하면 반드시 틀린다.

## 팩의 금지 규칙을 먼저 읽는다

`must_not`은 도메인 중립이라 항상 적용된다. 특히:

- **「모든 콘텐츠에 테두리와 그림자를 추가하지 않는다」** — 행마다 카드를 두르지 않는다.
  반복 항목은 구분선 리스트다.
- 아이콘·색만으로 텍스트 의미를 대체하지 않는다.
- 브랜드 강조색을 모든 정보 영역에 반복하지 않는다. 참조 화면은 **숫자만** 강조한다.
- 가운데 정렬 히어로·균등 카드 그리드·장식 그라데이션·이모지 아이콘을 관성적으로 넣지 않는다.
  (빈 상태 안내의 가운데 정렬은 예외로 허용된다.)

## 참조 전이

`selected-references.json`이 `referenceGap`을 남기면 게이트는 `insufficient_evidence`에서
멈춘다. 3단계가 `candidate_design_system_ref`를 바인딩했는지 확인하고, 선택된 참조
스크린샷을 **실제로 열어본 뒤** 무엇을 옮기고 무엇을 옮기지 않았는지 적는다.

## 결정 6단계

`freeze` 전에 `design-decisions.json`에 여섯 단계를 모두 `verified`로 적는다 —
`roles` · `reference_transfer` · `hierarchy` · `layout` · `components` · `tokens`.
각 단계는 rationale과 **evidence ID**를 요구하며, evidence는 런타임 산출물이어야 한다:
캡처 경로, `<renderCaseId>-<viewport>`, 전이 증거 ID, `runtime-playwright`.
`ai-review` 같은 임의 문자열은 거부된다.

## 이미지 검수

기계 검사는 상태 단정이 자기 자신과 일관되면 통과시킨다. 캡처를 보지 않으면 빈 화면과
사라진 필드를 놓친다. `ai-review.json`에 적는다.

| 항목 | 요구 |
| --- | --- |
| `viewedImages` | **모든 캡처**와 정확히 일치 (또는 exact-hash 대표) |
| `viewed_captures[]` | 캡처마다 `observations` 배열 |
| `viewed_references[]` | 참조마다 `observations` · `transferredFeatures` · `excludedFeatures` |
| `criteria` W1~W7 | 축별 `observation` + **`evidence_ids`**. 일곱이 같은 문장이면 거부된다 |
| `axes` | W1~W7 축 목록 |
| `input_hash` · `knowledge_hash` · `spec_hash` · `renderer_hash` · `capture_hashes` | **전부 현재 값과 일치해야 게이트가 돈다.** `renderer_hash`는 `renderer/index.html`의 sha256이다 |

> **칸 이름은 `evidence_ids`다.** 엔진은 `evidence`도 받지만 파이썬 완료 검증기는
> `evidence_ids`만 읽는다. `evidence`로 쓰면 **게이트는 `accept_ai`를 주고 단계는 완료되지
> 않는다** — W1~W7 일곱 칸이 전부 결손으로 뜬다.

W1~W7 축은 **정보 위계 · composition · density · spacing · typography · color · 상태 구분**
(the packaged validation command).

`verdict: revise`는 실패가 아니다. 결함을 찾았으면 `revise`로 적고, 각 finding에 `evidence`·
`retryStage`·`recommendation` 또는 `blocking`을 붙인다. 결함을 못 본 척 `accept_ai`로
적는 것이 실패다.

**다만 `revise`로 끝낸 단계는 완료되지 않는다.** `sync`가 revise면 `design_decisions`를
산출물에 복사하지 않아 단계 검증이 「design decision not verified」를 뱉는다. 결함을
고치고 `runtime`부터 다시 돌려 `accept_ai`를 받아야 단계가 닫힌다.

## 확정은 `sync`가 한다

`sync`가 모든 타깃 `accept_ai`에 닿으면 결과의 `stage_completion.completed`가 `true`가 되고,
산출물은 `status: complete`, 확정 문장은 「…기획자 확인은 받지 않았다」가 된다. 확인 질문을
만들지 않는다. `completed: false`면 `reason`이 무엇이 남았는지 말한다 — 대개 `revise`로 남은
타깃이거나 낡은 입력이다.

**사람이 캡처를 보지 않으므로 이미지 검수가 마지막 방어선이다.** 기계 검사가 전부 통과한
화면을 기획자가 「제가 정한 적 없는 문구가 들어가 있다」로 거절한 사례가 실제로 있다
(`artifacts/qa-runs-7/g-reward-history/RUN7.md`). 상위가 미정으로 둔 자리를 렌더러가 문장으로
메워도 **어떤 축에도 걸리지 않고 어떤 단정도 어기지 않는다.** 상위에 없는 문구는 렌더러에
적지 않는다 — 필요하면 역류한다.

확정 뒤에 결함을 고치면 그냥 `runtime`부터 다시 돌려 `sync`한다. 내용이 바뀌었으면 `sync`가
이전 확정을 철회하고 현재 내용으로 다시 확정하고, 그대로면 확정을 유지한다. 고치기 전에
확정을 먼저 거두려면 `session.py reopen <case> --stage design_system_wireframe`을 쓴다.
상위 판단이 필요한 결함이면 `backflow --to prd`다.

## 축의 `dimension`은 DOM 속성으로 번역된다

3단계에서 축의 `dimension`을 고르는 순간 여기 `stateAssertions`에 무엇을 적어야 하는지가
정해진다 — `design_system_wireframe.STATE_AXIS_PROPERTIES_BY_DIMENSION`이
`availability→disabled`, `value_selection→checked|selected|value`, `visibility→visible`,
`continuity→busy` … 로 매핑한다. 요구를 빠뜨리면
`missing state assertions for AX-* (disabled)` 형태로 `sync`에서 막힌다.

## 결함을 어디로 보내나

| 결함 | 처리 |
| --- | --- |
| 렌더러·조판·토큰 문제 | 이 단계에서 고치고 다시 `runtime` |
| 상태를 표현할 요소가 없다 | 3단계 내부 보강 (`retryStage: components`) |
| 상위에 없는 행동이 필요하다 (예: 빈 상태의 다음 행동) | **역류** — `session.py backflow --to prd ...` 기획 판단이므로 지어내지 않는다 |

## 확정 직후 Figma 익스포트

확정되면 `status`가 `phase: export_figma`를 내고, 영수증이 현재 내용을 덮기 전까지
`assert-yield`가 턴 종료를 막는다. **같은 턴에 바로 한다.** 매번 **새 Figma 파일**을
드래프트에 만든다. 이전 파일을 고쳐 쓰지 않는다.

엔진은 무엇을 어디에 그릴지 번들로 주고, 그리는 일은 Figma 도구로 당신이 한다. 먼저
`figma:figma-use`와 `figma:figma-create-new-file` 스킬을 로드한다.

1. `python3 scripts/wireframe.py export-bundle <case>` → `05-wireframe/figma/bundle.json`
   (단계 폴더 이전의 평평한 케이스는 `figma-export/bundle.json`). 영수증은 `05-wireframe/figma/receipts.json`.
   번들은 손으로 고치지 않는다 — 고치면 영수증이 거부된다.
   **어떤 컴포넌트를 인스턴스로 그릴지는 케이스가 쓴 디자인 팩의 `figma` 항목이 정한다.** 그 항목은
   디자인 시스템 쪽 원천 `figma/component-map.json`에서 `build-pack.py`가 만든다. 팩에 매핑이
   없거나 항목이 잘못돼도 번들은 거부되지 않는다 — 해당 요소가 `unresolved`로 그려지고 이유가
   `bundle.warnings`에 남는다. 그 경고는 영수증 `observations`에 옮겨 적는다. 매핑을 보완하는 일은
   디자인 시스템 원천을 고쳐 팩을 다시 만드는 별도 작업이며, 이 단계를 멈추지 않는다.
2. `create_new_file`로 드래프트에 새 파일을 만든다. 이름: `<title> · BA wireframe · <YYYY-MM-DD>`.
3. **변형을 흩뿌리지 않는다 — 조건으로 묶고 이름을 붙인다.** 화면(`screens[]`)마다 페이지를 만들고:
   - 페이지 맨 위에 화면 머리말: 화면 이름 · `origin`(기존/변경/신규) · 목적 · 읽는 법
     ("묶음 = 가장 많이 갈리는 상태 축의 값, 카드 = 한 상태").
   - `groups[]` 순서대로 그룹마다 Figma **Section**을 하나 만들고 이름을 `<n>. <group.label>`로
     한다. 섹션들은 위에서 아래로 쌓는다.
   - 섹션 안에서 그 그룹의 프레임(`frame.group_id`)마다 **상태 카드**를 가로로 놓는다. 카드는
     세로 auto-layout: ① 라벨 블록 — `title`(굵게), `conditions[]`를 `요소: 값 라벨 — 의미` 한 줄씩,
     `reached_by[]`를 `진입: <from_case_id>에서 <transition_ids> → <observations>` 한 줄씩(없으면
     「시작 상태」), 캡션 `target_id · render_case_id · viewport · capture <해시 앞 12자>`;
     ② 그 아래 가로 줄에 [와이어프레임 프레임 | 원본 캡처]를 「와이어프레임」「원본 캡처」 머리글과 함께.
   - 와이어프레임 프레임은 `width`×`height`, 이름 `<render_case_id> · <viewport>`. 프레임 자체는
     auto-layout이 아니다 — 안의 요소는 4번처럼 절대 좌표로 놓는다.
   - Figma 프레임에는 설명을 붙일 수 없으므로 추적 정보는 라벨 블록의 캡션으로 둔다.
   - 실제 주행에서 걸린 조판 문제 셋: 섹션은 카드를 다 그린 뒤 **실제 카드 높이로** 다시 쌓고
     섹션 크기를 카드에 맞춘다(아니면 겹친다). 머리말 폭은 1200px 안팎으로 묶는다(페이지 폭만큼
     늘어나 읽을 수 없게 된다). Section 이름은 스크린샷에 나오지 않으므로 섹션 안에도 같은 제목
     텍스트를 둔다.
4. 요소(`elements[]`)를 프레임 안에 **평평하게**, `box` 좌표 그대로 놓는다. `box`는 페이지 절대
   좌표라 부모 레이어 안에 중첩하면 위치가 어긋난다. 계층은 레이어 이름
   (`<node_id>#<occurrence>`)과 `parent_node_id`·`parent_occurrence`로만 남긴다. 글자는
   `text_runs[]`의 각 `box` 위치에 그 요소의 `style`(색·크기·굵기)로 놓는다 — `text`는 그 요소
   자신의 글자를 이은 것이고, 입력 요소의 라벨은 `label`에 있다. `figma.kind`가 무엇을 그릴지 정한다:

   | `figma.kind` | 그리는 것 |
   | --- | --- |
   | `instance` | `component_set_key`(또는 `component_key`)로 라이브러리 컴포넌트를 가져와 인스턴스를 만들고 `variant`를 설정한다. `text_property`가 있으면 `text`를 그 속성에 넣는다 |
   | `primitive` | `style`의 배경·테두리(변마다 두께)·모서리로 칠한 프레임과 `text_runs` 글자. 라이브러리 컴포넌트가 없다고 확정된 것이다 |
   | `unresolved` | `primitive`처럼 그리되 레이어 이름 앞에 `[unresolved]`를 붙인다. 매핑이 아직 없는 것이다 |

   `decoration: true`인 요소는 노드 id가 없는 렌더러 세부(화면 제목, 영역 안 라벨, 스피너)다.
   `primitive`로 그리고 레이어 이름 앞에 `[decoration]`을 붙인다 — 빼면 캡처보다 빈 화면이 된다.
   `variable_key`가 있는 토큰은 라이브러리 변수로 바인딩하고, 없으면 `value`를 그대로 칠한다.
   **컴포넌트를 이름으로 찾아 맞히지 않는다.** 번들에 키가 없으면 `unresolved`로 그린다 — 틀린
   컴포넌트가 조용히 들어가면 이미지보다 나쁘다. `visible: false`인 요소는 숨긴 레이어로 둔다.
   `layout_missing` 프레임은 원본 캡처 이미지만 넣고 관찰에 적는다.
5. 원본 캡처(`capture.path`)는 3번의 카드 안, 와이어프레임 오른쪽 자리에 참조 이미지로 넣는다.
6. `get_screenshot`으로 조립한 프레임을 찍어 원본 캡처와 나란히 보고, 차이를 `observations`에 적는다.
7. 영수증을 JSON 파일로 쓰고 `python3 scripts/wireframe.py export-receipt <case> --receipt <file>`:

   ```json
   {"status": "exported", "bundle_hash": "<bundle.bundle_hash>",
    "record_content_hash": "<bundle.record_content_hash>",
    "file_key": "…", "canonical_url": "https://www.figma.com/design/…", "created_in": "drafts",
    "exported_at": "<ISO 시각>",
    "frames": [{"target_id": "…", "render_case_id": "…", "viewport": "…", "node_id": "12:34"}],
    "stats": {"instances": 0, "primitives": 0, "unresolved": 0, "unbound_tokens": 0},
    "observations": ["…"]}
   ```

   `frames`는 번들의 모든 프레임을 덮어야 한다. `stats`는 실제로 그린 수다.

**익스포트할 수 없으면** (Figma 인증·권한 없음, 도구 실패, `export-bundle` 거부) 지어내지 말고
gap 영수증을 적는다. gap에는 번들이 필요 없다 — 번들 생성 자체가 실패한 경우에도 적을 수 있다:
`{"status": "gap", "record_content_hash": "<design-system-wireframe.json의 confirmation.content_hash>",
"gap": {"reason": "…", "needed": "…"}}`. gap도 턴 종료를 허용하고 확정은 그대로다.
`export-status`가 `gap`을 보여주므로, 막힌 것이 풀리면 1번부터 다시 돌려 `exported` 영수증을 더한다.

와이어프레임 내용이 바뀌어 다시 확정되면 이전 영수증은 `stale`이 되고 새 익스포트가 다시 필요하다.
모의 실행(`mode: simulation`) 케이스는 익스포트를 요구하지 않는다.

## References

- [파생 검증 실행](../../../artifacts/derivation-runs/reciprocate-received-support/README.md)
  — gate `revise` · errors 0 · 기계 검사가 접근성 10건, 이미지 검수가 결함 2건
- [QA 완주 기록](../../../artifacts/qa-runs-7/g-reward-history/RUN7.md) — 1a→4단계 완주.
  막힌 자리 13개와 오류 문구가 그대로 있다
