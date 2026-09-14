---
name: wireframe
description: Author and verify Heroines design-system wireframes from confirmed screen behavior using the design pipeline harness. Use only while the session stage is design_system_wireframe.
---

# BA Design System Wireframe

Run only when `session.py status` reports `stage=design_system_wireframe` and the
screen-behavior artifact is confirmed.

**This stage asks the planner nothing** — `ask --kind interview` is refused here — **but it does not confirm itself.** 2·3단계와 달리 마지막 산출물은 사람이 캡처를 보고
확정한다. 질문을 안 하는 것과 승인을 안 받는 것은 다르다.

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

## 확정은 사람이 캡처를 본다

`sync`는 `ready_for_confirmation: true`까지만 간다. 캡처 경로를 그대로 기획자에게 주고
`ask --kind confirmation --question-stage design_system_wireframe` → `answer` →
`confirm --outcome approved|conditional|refused`로 닫는다. `conditional`이면 확정이 서지
않는다 — 고치고 다시 캡처해 새 턴으로 묻는다.

기계 검사가 전부 통과한 화면을 기획자가 「제가 정한 적 없는 문구가 들어가 있다」로 거절한
사례가 실제로 있다(`artifacts/qa-runs-7/g-reward-history/RUN7.md`). 상위가 미정으로 둔
자리를 렌더러가 문장으로 메워도 **어떤 축에도 걸리지 않고 어떤 단정도 어기지 않는다.**

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

## References

- [파생 검증 실행](../../../artifacts/derivation-runs/reciprocate-received-support/README.md)
  — gate `revise` · errors 0 · 기계 검사가 접근성 10건, 이미지 검수가 결함 2건
- [QA 완주 기록](../../../artifacts/qa-runs-7/g-reward-history/RUN7.md) — 1a→4단계 완주.
  막힌 자리 13개와 오류 문구가 그대로 있다
