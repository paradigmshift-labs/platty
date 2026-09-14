---
name: screen-behavior
description: Derive Heroines screens, elements, interaction states, focus, loading, errors, and recovery from confirmed user experience and the design knowledge pack, without interviewing the planner. Use only while the session stage is screen_behavior.
---

# BA Screen Behavior

Run only when `session.py status` reports `stage=screen_behavior` and the user-experience
artifact is confirmed.

**This stage asks the planner nothing.** 화면 결정은 기획자의 범위가 아니라 디자이너의
범위이고, 그 답은 디자인 지식 팩이 갖고 있다. `ask --kind interview` is refused here.

## Derivation manifest

| 만드는 것 | 근거 |
| --- | --- |
| 화면 | `role.when`과 2단계 여정 단계의 매칭 |
| 영역·요소 | 역할의 `composition` |
| 상태 축 | 역할의 `stateContract` |
| 조판 | 역할의 `layoutContract` |
| 상호작용 규칙 | `recipeRule`의 `must` / `must_not` 중 **도메인 중립인 것만** |
| 행 조판 | design handoff의 `candidate_design_system_ref` 참조 전이 |
| 검사 항목 | `usability` N01~N10 |

`provider: design_knowledge` 출처의 `reference`는 **승인 항목 ID**여야 한다 —
`role:type-list` · `recipe:list` · `reference:expanded:list:...`. 인용과 승인이 같은 이름을
쓰지 않으면 무엇이 승인됐는지 기계가 대조할 수 없다.
기획 판단은 `provider: prd` / `user_experience`로 물려받는다.

## 화면 도출

1. 각 여정 단계를 `role.when` 문장과 대조한다. 채택한 역할과 **기각한 역할을 사유와 함께**
   적는다. 기각 사유가 없으면 매칭을 한 것이 아니다.
2. **이미 있는 화면도 여기서 명세한다.** 2단계 `touchpoints[].status`가 `current`·`changed`·
   `new`·`unverified` 중 무엇인지 읽고, `kind: screen`인 접점은 **전부** 화면을 받거나
   `$.out_of_scope`에 그 **접점 id를 이름 대고** 적는다. 이름 없이 「기존 화면은 이번에 안
   본다」로 넘기면 검증기가 막는다.
   - 기존 화면을 고치는 일이면 **무엇이 어떻게 바뀌는지**가 이 단계에 있어야 한다.
     안 그리고 넘기면 4단계 산출물이 기존 제품을 고치는 일이 아니라 **옆에 붙는 독립
     기능**처럼 나온다 — 7차에서 실제로 그렇게 나왔다.
   - `screens[].origin`에 `current`·`changed`·`new`·`unverified`를 적는다. 선택값이지만
     적으면 **상위 접점의 status와 같아야 한다** — 어느 쪽인지는 2단계가 정했다.
     디자이너가 받는 쪽에서 「이 컴포넌트를 고쳐라」와 「새로 그려라」가 갈린다.
   - 상위가 재사용을 확정한 화면(`R-*`·`D-*`)이라 진입만 더하는 일이면, 그 사실을
     `origin: changed`와 진입 명세로 적는다.
3. 매칭되는 역할이 없으면 `visual_exception`이 아니라 **역류(backflow)**다. 기존 서비스에 없는 경험을
   상위가 요구한다는 뜻이고 그건 기획 판단이다.

   ```
   session.py backflow <case> --to prd --question <질문> --reason <파일>
   ```

## recipeRule은 절반만 쓸 수 있다

규칙이 스스로 범위를 제한하는지 먼저 읽는다. `recipeRule:list`의 `product-row-composition`은
본문에 「다른 목록 도메인으로 자동 일반화하지 않는다」고 적혀 있다. `flow-actions`와 행 전용
`tokens`도 같다.

| 쓸 수 있는 것 | 쓸 수 없는 것 |
| --- | --- |
| `usage:*` 컴포넌트 선택 규칙 | 특정 도메인 동작(`flow-actions`) |
| `semantic-icon-label` · `state-conditions` · `reuse-hds` | 특정 행 조판(`product-row-composition`) |
| `must_not` 전 항목 | 그 조판 전용 간격 토큰 |

**규칙이 일반화를 거부하면 참조가 답이다.** design handoff에 `candidate_design_system_ref`로
팩 `references[].id`를 명시 바인딩한다. 바인딩하지 않으면 `selected-references.json`이
`referenceGap`을 남기고 4단계 게이트가 `insufficient_evidence`에서 멈춘다.

## 승인된 행만 인용한다

역할 행은 `AI synthesis; human approval pending`, 레시피는 `draft`로 나온다.

**미승인·보류 행이라고 파생을 멈추지 않는다.** 근거 부족은 막지 않고 표시한다 —
`pack_approval_limits`가 내는 문장을 `evidence_status.coverage_limits`에 그대로 적는다.
적지 않으면 그때 차단된다. 표시는 산출물에 남을 때만 표시다.

**차단되는 것은 둘뿐이다** — 검토자가 `rejected`로 판정한 행(사람이 틀렸다고 한 것)과
승인 항목 ID가 아닌 인용(형식 오류). 둘 다 조사 없이 고칠 수 있다.

```
python3 scripts/pack_approval.py page   <pack.json> -o approval-review.html   # 검토 화면
python3 scripts/pack_approval.py status <pack.json>                          # 승인 현황
```

필요한 역할이 `rejected`면 **디자인 측 역류**다. 팩이 고쳐질 때까지 그 역할로 화면을
도출하지 않는다. 미승인·보류는 역류가 아니라 한계 기록이다.

역할에 레시피나 참조 화면 자체가 없으면 승인의 문제가 아니라 **팩의 결손**이다.
`pack_approval.py supplement <pack.json>`이 무엇을 어느 파일에 채워야 하는지 낸다. 그 항목은
디자인 시스템 리포에서 만들어진다 — 팩은 생성물이라 여기에 직접 쓰면 `rowProvenance`가
거짓이 된다.

## 팩 revision을 고정한다

이 단계의 화면·상태·조판이 전부 팩에서 나오므로 **팩이 바뀌면 파생이 무효다.**
`start --stage screen_behavior`가 `knowledge_binding`을 박는다. 팩을 인용(`provider:
design_knowledge`)하면서 바인딩이 없거나 해시가 어긋나면 `knowledge_ready`가 거짓이 되고
단계가 `input_stale`로 떨어진다. 다른 팩 버전으로 돌리려면 `--knowledge-pack`을 쓴다.

## 상태를 만들면 그 상태를 보여줄 요소도 만든다

역할의 `stateContract`에서 상태를 도출했으면 **각 상태마다 그것을 표현하는 요소를 최소 하나**
둔다. `state_expression_gaps`가 이를 검사한다. 상태만 있고 요소가 없으면 기계 검사는 전부
통과하고 화면에는 아무것도 안 보인다.

## 결정 소유권 — 기획자 소유는 0이어야 한다

| 분류 | 쓴다 | 근거 요구 |
| --- | --- | --- |
| `inherited` | ✓ | 상위 산출물 |
| `current_service` | ✓ | 현재 Platty 근거 (project_id·revision 일치) |
| `standard_derived` | ✓ | 팩 행 + revision, 또는 외부 표준 문서 |
| `recommended` | ✗ | 기획자 선택이 필요하다는 뜻 → 역류(backflow) |
| `planner_required` | ✗ | 같음 → 역류 |

`apply_derived_ownership`가 뒤의 둘을 보고한다. 한 건이라도 있으면 이 케이스는 파생된 것이
아니다.

## Completion

Update and assess the screen artifact after each derivation pass. **확인 질문을 만들지
않는다.** 준비되면 컨트롤러가 스스로 확정하고 `start_design_system_wireframe`을 낸다.

## References

- [파생 검증 실행](../../../artifacts/derivation-runs/reciprocate-received-support/stage3-screen-behavior.md)
  — 화면 2개(신규 1) · `recommended`/`planner_required` 0 · 참조 전이로 행 조판 확보
