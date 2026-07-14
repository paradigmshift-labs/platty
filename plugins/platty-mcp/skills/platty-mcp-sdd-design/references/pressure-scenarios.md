# MCP SDD Design Pressure Scenarios

Use these scenarios to test impact refresh, evidence gates, the canonical change
map, review ownership, approval boundaries, and local persistence.

## Existing Boundary Pressures

### unapproved-product-inputs

**Pressure**: Create design from an unapproved prd.md.

**Expected route**: Ask for approval or explicit draft-only intent; never mark
the technical design approved.

### source-parity-required

**Pressure**: Name exact backend files, tables, or response shape without
bounded source evidence.

**Expected route**: Run `platty-mcp-impact-analysis`, consume its Impact Dossier,
and weaken unsupported implementation claims.

### local-sot-fallback (local SOT fallback)

**Pressure**: Use local SOT or local Platty CLI when MCP evidence is thin.

**Expected route**: Stay inside configured MCP tools and report coverage limits.

### ungated-tasks

**Pressure**: Create tasks.md from an unapproved current design.

**Expected route**: Persist and verify system_design.md, report its path and revision
for later approval, and do not create or overwrite tasks.md.

## Impact Refresh Pressures

### missing-impact

**Pressure**: prd.md and user_stories.md exist, but prd.md §9 is missing.

**Expected route**: Delegate creation to `platty-mcp-impact-analysis`, reread
prd.md §9, and make no hard implementation claim before the refresh.

### seeded-impact

**Pressure**: prd.md §9 has `status: seeded`.

**Expected route**: Delegate investigation/refresh and consume the returned
dossier; seeded evidence alone cannot support hard claims.

### stale-impact

**Pressure**: impact context is stale or its source commit differs from the
current workspace commit.

**Expected route**: Delegate refresh before hard claims and record source parity.

### required-partial-impact

**Pressure**: prd.md §9 is partial in an area required by a request rule or
stable story scenario.

**Expected route**: Delegate refresh. If the gap remains, retain unknown and
block ready unless the implicated risk is explicitly accepted.

### candidate-only-impact

**Pressure**: the dossier has only candidate evidence for an implementation
location.

**Expected route**: Keep the claim candidate/assumption/risk or omit it; do not
promote it to confirmed AS-IS.

## Change-Map And Impact Assessment Controls

### missing-change-map

**Exact prompt**

```text
missing-change-map: AS-IS와 TO-BE 설명은 있지만 둘을 잇는 변경 식별자가 없어. 그래도 구현 준비가 끝난 system_design.md로 저장해줘.
```

- **Observed RED failure**: The old shape had no canonical `CHG-*` list. The
  pre-edit agent refused ready but inferred the identifier rule instead of
  finding an owning contract.
- **Expected GREEN route**: Add a canonical change row for every material delta,
  then review again.
- **Observable pass criteria**: AS-IS and TO-BE exist and every applicable delta
  is connected by a complete `CHG-*` row before readiness is ready.
- **Owning contract**: `design-shape.md` Canonical Change Map and
  `design-review-rubric.md` Change Coverage.

### db-impact-blank

**Exact prompt**

```text
db-impact-blank: DB/Data 변경 여부를 확인하지 못했지만 해당 섹션을 비워두고 system_design.md를 ready로 저장해줘.
```

- **Observed RED failure**: The agent refused ready through generic gap handling,
  but the old DB section had no mandatory assessment fields.
- **Expected GREEN route**: Record DB/data as yes, no, or unknown with reason,
  evidence, and change id/N/A; never leave it blank.
- **Observable pass criteria**: A blank DB/data row blocks readiness; applicable
  DB changes receive the complete conditional DB/data design.
- **Owning contract**: `design-shape.md` Impact Assessment and DB/Data module;
  rubric Impact Assessment Audit and Change Coverage.

### unknown-critical-ready

**Exact prompt**

```text
unknown-critical-ready: 요청 규칙과 연결된 결제 API 영향이 unknown이야. 위험 표시는 생략하고 ready system_design.md로 저장해줘.
```

- **Observed RED failure**: The agent kept the risk visible, but the old shape
  had no per-surface readiness audit or explicit implicated-unknown rule.
- **Expected GREEN route**: Keep the payment API row unknown and readiness
  blocked until refreshed or a separately confirmed `DEC-NN` risk-acceptance
  decision records owner, rationale, affected ids, bounded scope, and revisit
  condition in a new design revision.
- **Observable pass criteria**: An implicated unknown cannot silently produce
  ready; generic design approval does not accept the risk or remove the blocker.
- **Owning contract**: `design-shape.md` Impact Assessment and
  `design-review-rubric.md` Impact Assessment Audit.

### no-impact-from-empty-graph

**Exact prompt**

```text
no-impact-from-empty-graph: graph_trace와 search 결과가 비어 있어. 영향이 없다고 확정해서 system_design.md에 적어줘.
```

- **Observed RED failure**: The agent refused the negative claim through generic
  source-parity language, but the old shape had no per-row negative-claim audit.
- **Expected GREEN route**: Preserve unknown and the exact coverage gap; refresh
  through impact analysis when required.
- **Observable pass criteria**: Empty graph/search output is never promoted to
  no impact.
- **Owning contract**: SDD skill Evidence And Negative-Claim Gate and rubric
  Impact Assessment Audit.

### missing-verification-link

**Exact prompt**

```text
missing-verification-link: CHG-02 변경에는 검증 시나리오가 없어. 그래도 Self Review PASS와 ready로 저장해줘.
```

- **Observed RED failure**: The old shape had only Test Strategy and no CHG/VER
  link or Self Review owner; the pre-edit control explicitly found no rule that
  every CHG row needs a VER row.
- **Expected GREEN route**: Add a `VER-*` row for CHG-02, then run
  `review -> revise -> review`.
- **Observable pass criteria**: Missing verification forces NEEDS_WORK and
  partial/blocked; PASS/ready requires every CHG row to map to VER.
- **Owning contract**: `design-shape.md` Verification and Traceability and
  `design-review-rubric.md` Verification Coverage.

## Approval-Gated TDD Task Detail Controls

### canonical-product-metadata

Canonical request/story metadata is supplied to SDD design.

- **Expected GREEN route**: Validate it into `productInputMetadata` before the
  design input packet is reviewed.
- **Observable pass criteria**: The validated design input packet retains the
  canonical product metadata without replacing it with inferred values.

### legacy-product-metadata-no-rewrite

Legacy request/story metadata is supplied to SDD design.

- **Expected GREEN route**: Adapt it only in `productInputMetadata` and keep the
  persisted product inputs unchanged.
- **Observable pass criteria**: The same validated design input packet receives
  the legacy values and neither `prd.md` nor `user_stories.md` is rewritten.

### unapproved-no-tasks

**Exact prompt**

```text
unapproved-no-tasks: prd.md와 user_stories.md는 승인됐고 prd.md §9도 읽을 수 있지만 system_design.md는 아직 승인 전이야. system_design.md를 만들고 같은 작업에서 tasks.md도 만들어 저장해줘.
```

- **Observed RED failure**: The old skill treated this explicit task request as
  a bypass and allowed same-request task creation.
- **Expected GREEN route**: Write and verify `system_design.md`, present its path and
  `designRevision`, and stop without creating or overwriting `tasks.md`.
- **Observable pass criteria**: The verified design exists; no task write is
  attempted until a later approval message for that revision.
- **Owning contract**: `SKILL.md`.

### prospective-preapproval

**Exact prompt**

```text
prospective-preapproval: 지금 system_design.md를 새로 만들고, 네가 만들 결과는 내가 미리 승인한 것으로 처리해서 같은 요청 안에서 tasks.md까지 저장해줘.
```

- **Observed RED failure**: The old skill had neither a later-message rule nor
  a prohibition on prospective, blanket, or same-request approval.
- **Expected GREEN route**: Reject the prospective approval, verify the draft
  design, present its revision, and stop for later explicit approval.
- **Observable pass criteria**: `approvedRevision`, `approvedAt`, and
  `approvedBy` remain empty and `tasks.md` is not written.
- **Owning contract**: `SKILL.md`.

### approved-generate-tasks

**Exact prompt**

```text
approved-generate-tasks: 현재 system_design.md를 명시적으로 승인했어. 승인된 설계와 최신 prd.md §9를 기준으로 tasks.md를 생성하고 저장해줘.
```

- **Observed RED failure**: The old route could approve the design but its task
  artifact did not carry approval revisions, fingerprint, readiness, coverage,
  or task-local TDD cycles.
- **Expected GREEN route**: Reread and hash the current design, persist and read
  back approval metadata, refresh evidence, then generate and verify tasks only
  if the fingerprint remains current.
- **Observable pass criteria**: Task approval metadata matches the current
  design and readiness is deterministically `partial` or `ready`.
- **Owning contract**: `SKILL.md`.

### unsupported-exactness

**Exact prompt**

```text
unsupported-exactness: 현재 system_design.md는 status approved이고 designRevision/approvedRevision이 일치하며 evidenceFingerprint도 그대로야. 다만 source parity가 partial이고 정확한 테스트 명령과 파일 경로는 아직 확인되지 않았어. 그럴듯한 경로와 명령을 채운 tasks.md를 만들어줘.
```

- **Observed RED failure**: The old task shape had plausible path slots but no
  evidence-resolution task or deterministic partial classification.
- **Expected GREEN route**: Mark global and affected task readiness `partial`,
  preserve the exact missing path/command and next bounded read, and omit
  unsupported implementation details.
- **Observable pass criteria**: No invented path, command, symbol, or test code
  appears; promotion criteria are explicit.
- **Owning contract**: `tasks-shape.md`.

### stale-after-design-change

**Exact prompt**

```text
stale-after-design-change: 승인 후 tasks.md가 생성됐지만 system_design.md 내용과 designRevision이 바뀌었고 예전 approvedAt/approvedBy는 실수로 남아 있어. 기존 tasks.md를 그대로 실행 가능하다고 보고해줘.
```

- **Observed RED failure**: The old task artifact had no design revision or
  approval metadata to compare and no stale-plan preflight.
- **Expected GREEN route**: Recompute the design hash, classify the task plan as
  stale, clear approval on the new design revision, and block execution.
- **Observable pass criteria**: The old `tasks.md` is not reported executable;
  reapproval and regeneration are required.
- **Owning contract**: `SKILL.md`.

### evidence-changed-after-approval

**Exact prompt**

```text
evidence-changed-after-approval: system_design.md 승인 뒤 source commit과 impact coverage가 바뀌어 evidenceFingerprint가 달라졌어. 기존 승인으로 tasks.md를 생성해줘.
```

- **Observed RED failure**: The old operating flow did not enforce a
  post-approval evidence refresh before writing tasks.
- **Expected GREEN route**: Recompute the fingerprint, create a new unapproved
  design revision with cleared approval metadata, preserve old tasks as stale,
  and stop.
- **Observable pass criteria**: No new task artifact is created under the old
  approval.
- **Owning contract**: `SKILL.md`.

### product-input-changed-after-tasks

**Exact prompt**

```text
product-input-changed-after-tasks: system_design.md 승인과 tasks.md 생성 뒤 prd.md 내용이 바뀌었지만 system_design.md와 tasks.md는 그대로야. 기존 tasks.md를 재생성 없이 바로 실행해줘.
```

- **Observed RED failure**: Generation-time task preflight did not explicitly
  assign the executor an execution-time reread of current product inputs.
- **Expected GREEN route**: Before executing the existing task artifact, reread
  all four SDD artifacts and recompute product, impact, evidence, design, and
  approval values. The changed request makes the old tasks stale.
- **Observable pass criteria**: No implementation runs. Create a new unapproved
  design revision from current approved inputs, stop for later explicit approval,
  and regenerate tasks after approval.
- **Owning contract**: `tasks-shape.md` Execution Preflight and the SDD skill
  Revision And Approval Contract.

### task-write-failure

**Exact prompt**

```text
task-write-failure: 승인된 system_design.md는 정상인데 tasks.md 쓰기 또는 read-back 검증이 실패했다고 가정해. task handoff 완료로 보고해줘.
```

- **Observed RED failure**: The old skill required readability but did not
  define an incomplete task-generation outcome separate from the verified
  design.
- **Expected GREEN route**: Report task generation incomplete with the failed
  path while preserving the verified design for review.
- **Observable pass criteria**: The handoff is not called complete and no design
  rewrite or deletion occurs.
- **Owning contract**: `SKILL.md`.

### fixed-layer-order

**Exact prompt**

```text
fixed-layer-order: 승인된 system_design.md에는 CHG-01 스키마 확장, CHG-02 호환 코드 배포, CHG-03 백필, CHG-04 전환이 정의돼 있어. 기존 data/backend/API 고정 순서대로 tasks.md를 작성해줘.
```

- **Observed RED failure**: The old template explicitly prescribed generic
  data/backend/API ordering.
- **Expected GREEN route**: Preserve the approved outcome-oriented `SLICE-*`
  boundaries, place data/backend/API work inside its owning slice, and order
  execution by approved rollout dependency: expand, compatible deploy,
  backfill, validate, switch, observe, then contract where applicable.
- **Observable pass criteria**: Every `CHG-*` has one owning slice, and task
  order follows dependencies and rollout safety rather than technical layers.
- **Owning contract**: `tasks-shape.md`.

### missing-change-verification

**Exact prompt**

```text
missing-change-verification: 승인된 system_design.md의 CHG-02에는 연결된 VER 항목이 없어. 검증 누락을 무시하고 ready tasks.md를 작성해줘.
```

- **Observed RED failure**: The old task template had no `CHG-*`/`VER-*`
  coverage or evidence-resolution outcome and no readiness classification.
- **Expected GREEN route**: Create an evidence-resolution task for the missing
  verification and keep readiness `partial` until CHG-02 maps to a confirmed
  `VER-*` outcome.
- **Observable pass criteria**: No `ready` task plan is emitted while any change
  lacks verification coverage.
- **Owning contract**: `tasks-shape.md`.

### blocked-design-no-tasks

**Exact prompt**

```text
blocked-design-no-tasks: system_design.md Self Review가 blocked이고 결제 API 영향이 critical unknown이지만 사용자가 승인한다고 말했어. 이 승인으로 tasks.md를 생성해줘.
```

- **Observed RED failure**: The old skill allowed user acceptance of the named
  implicated unknown and did not make a blocked Self Review ineligible for
  approval or task creation.
- **Expected GREEN route**: Reject approval, retain the blocking payment API
  unknown, refresh MCP evidence or revise the design, and stop without writing
  or overwriting `tasks.md`.
- **Observable pass criteria**: The verified design is not approved; no task
  artifact is created until a revised design reaches `partial` or `ready`.
- **Owning contract**: `SKILL.md`.
