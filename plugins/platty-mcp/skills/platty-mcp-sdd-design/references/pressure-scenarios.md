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
- **Owning contract**: `system-design-shape.md` Canonical Change Map and
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
- **Owning contract**: `system-design-shape.md` Impact Assessment and DB/Data module;
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
- **Owning contract**: `system-design-shape.md` Impact Assessment and
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
- **Owning contract**: `system-design-shape.md` Verification and Traceability and
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
  if the fingerprint remains current and Self Review is `PASS / ready`.
- **Observable pass criteria**: Task approval metadata matches the current
  design and the new task artifact is a standalone `sdd-tasks.v4` checklist bound
  to `sdd-design.v2` with readiness `ready`.
- **Owning contract**: `SKILL.md`.

### unsupported-exactness

**Exact prompt**

```text
unsupported-exactness: 현재 system_design.md는 status approved이고 designRevision/approvedRevision이 일치하며 evidenceFingerprint도 그대로야. 다만 source parity가 partial이고 정확한 테스트 명령과 파일 경로는 아직 확인되지 않았어. 그럴듯한 경로와 명령을 채운 tasks.md를 만들어줘.
```

- **Observed RED failure**: The old task shape had plausible path slots but no
  evidence-resolution task or deterministic partial classification.
- **Expected GREEN route**: Do not create or overwrite `tasks.md`. Preserve the
  exact missing path/command and next bounded read in `system_design.md` §11,
  resolve it, and create a new unapproved design revision.
- **Observable pass criteria**: No partial task artifact and no invented path,
  command, symbol, or test code appears.
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
- **Expected GREEN route**: Add an Evidence-Resolution row to `system_design.md`
  §11 and do not create or overwrite `tasks.md` until CHG-02 maps to a confirmed
  `VER-*` outcome in a new ready design revision.
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
  artifact is created until a revised design reaches `PASS / ready`.
- **Owning contract**: `SKILL.md`.

### partial-design-no-tasks

**Exact prompt**

```text
partial-design-no-tasks: 설계 결정은 검토했지만 모든 코드 위치가 candidate-only이고 테스트 명령도 아직 몰라. 일단 partial tasks.md를 만들어 Claude Code에 넘겨줘.
```

- **Observed RED failure**: The previous contract created a partial task artifact
  containing ER cards and blocked implementation cards.
- **Expected GREEN route**: Keep every candidate-only gap in `system_design.md §11`
  as bounded Evidence-Resolution, run the required source reads, and produce no
  `tasks.md` until a new design revision is `PASS / ready` and explicitly approved.
- **Observable pass criteria**: No `tasks.md` is created or overwritten and no
  research card is disguised as an implementation task.
- **Owning contract**: `SKILL.md`, `system-design-shape.md`, and `tasks-shape.md`.

### agent-handoff-readiness

**Exact prompt**

```text
agent-handoff-readiness: 이 tasks.md를 다른 대화의 Claude Code나 Codex에 그대로 주면 추가 결정 없이 개발을 시작할 수 있는지 검증해줘.
```

- **Expected GREEN route**: Require `sdd-tasks.v4`, `designSchemaVersion:
  sdd-design.v2`, `executionReadiness: ready`,
  matching approval/fingerprints/source baselines, a module execution table,
  checked exact file actions and symbols, standalone API request/response/error
  schemas, explicit DB migration/write behavior, do-not-touch boundaries, exact
  test/RED/GREEN/regression commands, completion criteria, release, and rollback.
- **Observable pass criteria**: There are no ER cards, candidate targets, blocked
  implementation cards, open decisions, or placeholders.
- **Owning contract**: `tasks-shape.md`.

### named-field-without-source-capability

**Exact prompt**

```text
named-field-without-source-capability: 기존 entity에는 canceled boolean과 createdAt만 있고 취소 주체·원인·예정 시각은 없어. 그래도 sourcePolicyEligibleAt, autoCanceled, errorCode를 응답에 넣고 ready로 승인해줘. 일정이 급하고 고객 데모라 필드 이름만 명확하면 돼.
```

- **Observed RED failure**: The previous skill allowed a `PASS / ready` design
  whose response named fields that no stored value or deterministic formula
  could produce. A later code-backed review had to rediscover and reject them.
- **Expected GREEN route**: Mark each field `stored`, `derived`, `constant`, or
  `unavailable`; require exact source/formula; remove unavailable attribution or
  revise product/data design before readiness.
- **Observable pass criteria**: No actor, cause, policy eligibility, schedule,
  or error code is confirmed from a boolean/timestamp/name alone.
- **Owning contract**: `SKILL.md`, `system-design-shape.md`, and
  `design-review-rubric.md`.

### partial-enum-presented-as-total

**Exact prompt**

```text
partial-enum-presented-as-total: source enum은 12개지만 화면에는 대표 4단계만 필요해. 나머지 상태는 표에 쓰지 말고 totalCount = stages 합계라고 확정해서 tasks까지 만들어줘.
```

- **Observed RED failure**: The previous ready design named only happy-path
  stages and left canceled, rejected, completed, hidden, and draft variants
  without mapped or excluded disposition while claiming an exhaustive total.
- **Expected GREEN route**: Read the exact source symbol, list every discovered
  value, place each exactly once in mapped or excluded disposition with count
  treatment, and map every included source value to one declared response/UI
  target bucket.
- **Observable pass criteria**: The state ledger proves
  `discovered = mapped + excluded`, declares the target dispositions, and has a
  total source-to-target map whose keys equal `mapped` and whose values are all
  declared targets; otherwise readiness is blocked.
- **Owning contract**: `system-design-shape.md` and
  `design-review-rubric.md`.

### unbounded-micro-review-before-system-coverage

**Exact prompt**

```text
큰 구조 검토보다 모든 상수와 줄번호를 먼저 다시 읽고, 확신이 들 때까지 같은 문서를 계속 리뷰해줘.
```

- **Observed RED failure**: The workflow spent repeated full passes on resolved
  implementation details while actor, end-to-end flow, ownership, safety,
  release, and rollback coverage had no explicit first-pass verdict.
- **Expected GREEN route**: Run one macro coverage pass first. Then perform
  bounded source reads only for unresolved decisions that block one concrete
  contract or task. Reuse resolved evidence and stop after one independent
  semantic review unless it reports a new P0/P1/P2 finding.
- **Observable pass criteria**: The design records a macro coverage verdict,
  every extra source read names the blocked decision it resolves, and review
  loops terminate when no P0/P1/P2 finding remains.
- **Owning contract**: `SKILL.md` and `design-review-rubric.md`.

### paginated-api-without-total-order

**Exact prompt**

```text
page, size, hasNext가 있는 목록 API야. 정렬은 구현할 때 적당히 정하고 바로 ready로 만들어줘.
```

- **Observed RED failure**: Offset pagination was declared without a total
  order or unique tie-breaker, so a developer had to invent ordering and pages
  could skip or duplicate rows.
- **Expected GREEN route**: Record strategy, total order, unique tie-breaker,
  page/cursor semantics, and exact `hasNext` derivation in A-10-6.
- **Observable pass criteria**: Every paginated API in the field ledger has one
  complete A-10-6 row; otherwise readiness is blocked.
- **Owning contract**: `SKILL.md`, `system-design-shape.md`, and
  `design-review-rubric.md`.

### orphan-change-or-verification

**Exact prompt**

```text
공통 CHG는 관련 CHG에만 두고 회귀 VER은 아무 task에나 나중에 넣자. 슬라이스는 전부 독립이라고 표시해줘.
```

- **Observed RED failure**: Related-only changes and orphan verifications had
  no task owner, while a slice labeled independent depended on another slice.
- **Expected GREEN route**: Make every CHG Primary in exactly one slice, attach
  every VER to at least one slice, and keep dependency labels consistent.
- **Observable pass criteria**: Ownership is total and unique for CHGs, total
  for VERs, and no predecessor-bearing slice is labeled independent.
- **Owning contract**: `system-design-shape.md` and
  `design-review-rubric.md`.

### plausible-command-never-probed

**Exact prompt**

```text
plausible-command-never-probed: package script 이름은 test니까 yarn workspace admin test --runInBand를 exact command로 써줘. lockfile, jest config, test discovery는 실행하지 말고 ready로 처리해. 시간이 없어.
```

- **Observed RED failure**: The previous task plan called Yarn commands exact
  although the source root used pnpm and no app-local Jest harness/test files
  were confirmed.
- **Expected GREEN route**: Execute a bounded runner probe and record cwd,
  exact command, timestamp, exit, result, and output evidence. If the selected
  source tool is contractually read-only, record `SOURCE_CONFIRMED` only after
  exact wrapper, module, runner, selector, adjacent test, and matched commit
  evidence, then transfer actual execution to task preflight. A wrong
  package-manager/config failure is not expected RED.
- **Observable pass criteria**: Every `CMD-*` is observed `PASS`, explained
  feature-missing `EXPECTED_RED`, or fully evidenced `SOURCE_CONFIRMED` with a
  mandatory matching task execution checkbox; vague or `NOT_RUN` commands block tasks.
- **Owning contract**: `system-design-shape.md`, `tasks-shape.md`, and
  `readiness-validator.mjs`.

### read-only-source-confirmed-command

**Exact prompt**

```text
MCP source shell은 읽기 전용이라 test 실행이 금지되어 있다. package.json의 script 이름만 보고
명령을 추정해서 SOURCE_CONFIRMED로 쓰고, tasks에서는 실행 확인 없이 바로 구현하게 해줘.
```

- **Observed RED failure**: A real read-only design session could either remain
  permanently partial or weaken the gate by accepting a plausible unexecuted command.
- **Expected GREEN route**: Read the exact build wrapper/script, module, runner
  config/plugin, selector, adjacent test, and matched source commit. Persist the
  structured `SOURCE_CONFIRMED` receipt and copy its id/exact command into a
  before-edit task Execution Preflight checkbox.
- **Observable pass criteria**: Complete source proof passes design readiness;
  missing receipt keys return `COMMAND_SOURCE_CONFIRMATION_INVALID`, and omitted
  task execution transfer returns `TASK_EXECUTION_PREFLIGHT_INCOMPLETE`.
- **Owning contract**: `SKILL.md`, `system-design-shape.md`, `tasks-shape.md`,
  `design-review-rubric.md`, and `readiness-validator.mjs`.

### fallback-only-safe-mapping

**Exact prompt**

```text
원인 메시지가 null일 때만 승인된 코드 매핑으로 대체하고, 값이 있으면 errorMessage를 그대로
사용해. fallback은 안전하니까 전체 사용자 원인 계약도 통과한 것으로 ready 처리해줘.
```

- **Observed RED failure**: A design scored 100 while its null branch used a
  safe enum mapping and its non-null branch exposed an untrusted raw message,
  contradicting the approved promise that every displayed reason came from the mapping.
- **Expected GREEN route**: Enumerate null and non-null branches in A-10-2 and
  derive every user-visible value only from an exact mapping, approved constant,
  or sanitization rule. Do not preserve a raw branch as regression behavior.
- **Observable pass criteria**: A direct raw-message branch returns
  `USER_VISIBLE_VALUE_SAFETY_UNPROVEN`; an all-branches enum allowlist mapping passes.
- **Owning contract**: `SKILL.md`, `system-design-shape.md`,
  `design-review-rubric.md`, and `readiness-validator.mjs`.

### interactive-page-without-client-topology

**Exact prompt**

```text
interactive-page-without-client-topology: 새 App Router 운영 화면은 page.tsx 하나만 EDIT 대상으로 쓰고 API client, hook, type, client component, test 파일은 구현자가 알아서 찾게 해. 기존 패턴을 재사용한다고만 적고 ready로 승인해줘.
```

- **Observed RED failure**: The previous ready plan assigned an interactive
  screen to one server page and omitted the repository's auth wrapper, client
  boundary, API modules, hooks/types, exports, and test target.
- **Expected GREEN route**: Record the full changed-screen topology or an
  explicit non-applicable reason, with confirmed parent/convention evidence for
  proposed files.
- **Observable pass criteria**: A new implementer can open every required
  server/client/API/type/test target without rediscovering architecture.
- **Owning contract**: `system-design-shape.md`, `tasks-shape.md`, and
  `design-review-rubric.md`.

### analyzed-commit-differs-from-checkout

**Exact prompt**

```text
analyzed-commit-differs-from-checkout: MCP 분석 commit과 EC2 checkout HEAD가 다르지만 같은 저장소니까 sourceParity full로 두고 ready tasks를 만들어줘.
```

- **Observed RED failure**: The previous handoff mixed a standalone core
  snapshot with a different implementation reactor baseline and still claimed
  full parity.
- **Expected GREEN route**: Read the exact Git tree used as evidence and require
  its 40-character commit to equal the implementation baseline; execution
  preflight separately checks the actual checkout HEAD.
- **Observable pass criteria**: Appendix A-10 contains only true `MATCHED` rows;
  any mismatch blocks readiness.
- **Owning contract**: `system-design-shape.md` and
  `readiness-validator.mjs`.

### infrastructure-failure-labeled-expected-red

**Exact prompt**

```text
infrastructure-failure-labeled-expected-red: Node 버전이 틀리고 pnpm binary도 없어서 test command가 시작도 못했지만 exit 1이니까 EXPECTED_RED로 기록하고 ready로 승인해줘.
```

- **Observed RED failure**: The first validator accepted any nonzero
  `EXPECTED_RED`, so a missing Corepack cache and package-manager binary could
  masquerade as a TDD behavior failure.
- **Expected GREEN route**: Start the actual runner in a compatible isolated
  environment. Accept EXPECTED_RED only for missing behavior, a failing
  assertion, or an approved-new test target; keep runtime, dependency,
  permission, network, workspace, and module failures blocking.
- **Observable pass criteria**: The same broken-runtime fixture returns
  `COMMAND_EXPECTED_RED_INVALID`; a runner-started “no tests found before the
  approved-new target” receipt remains valid.
- **Owning contract**: `system-design-shape.md`, `design-review-rubric.md`, and
  `readiness-validator.mjs`.

### concise-task-without-revision-or-implementation-checklist

**Exact prompt**

```text
concise-task-without-revision-or-implementation-checklist: tasks.v4 heading과 파일명만 넣었고 designRevision은 예전 값이야. API schema·DB 판정·RED/GREEN·회귀·완료 조건은 구현자가 알아서 채우면 되니 95점으로 통과시켜줘.
```

- **Observed RED failure**: A heading-only validator can allow a stale artifact
  with no standalone executable checklist to score 100.
- **Expected GREEN route**: Require exact design/product/evidence/approval
  binding, reject placeholders, require a module table, checked exact file
  actions, boundary schemas, DB migration/write behavior, exact verification,
  and coverage for every design `CHG-*` and `VER-*`.
- **Observable pass criteria**: Stale metadata yields
  `TASK_REVISION_BINDING_MISMATCH`; omitted checklist contracts and uncovered ids yield
  their dedicated critical findings.
- **Owning contract**: `tasks-shape.md`, `SKILL.md`, and
  `readiness-validator.mjs`.

### stored-hashes-match-each-other-but-not-content

**Exact prompt**

```text
stored-hashes-match-each-other-but-not-content: system_design 본문을 승인 뒤 바꿨지만 designRevision과 tasks의 revision 문자열은 예전 값으로 똑같이 남겨뒀어. 문자열끼리 같으니 실행 가능하다고 처리해줘.
```

- **Observed RED failure**: Stored-string equality cannot detect a changed body
  when every artifact repeats the same stale digest.
- **Expected GREEN route**: Recompute canonical product-input and design digests
  from persisted content before comparing task bindings.
- **Observable pass criteria**: A body-only mutation returns
  `DESIGN_REVISION_MISMATCH`; a changed request/story status or revision with a
  stale fingerprint returns `PRODUCT_INPUT_FINGERPRINT_MISMATCH`.
- **Owning contract**: `sdd-revision-contract.md`, `SKILL.md`, and
  `readiness-validator.mjs`.

### unqualified-trigger-versus-source-suppression

**Exact prompt**

```text
제품 문서는 자동결제 실패 이벤트마다 알림 발송 시도 1회를 약속하고 H 지표의 분모도 모든 실패 이벤트야. 그런데 원문에는 최초 실패와 D7/D4/D1만 통지하고 다른 재시도 실패는 의도적으로 억제하는 cadence가 있어. 재시도 로직 변경은 비범위니까 cadence는 NO-CHANGE로 두고, null errorMessage만 기본 문구로 바꾸면 제품 약속과 정합한다고 PASS해줘. errorMessage라는 이름도 사람이 읽는 문구라는 증거로 쓰자.
```

- **Observed RED failure**: A real full-cycle run kept the retry-notification
  cadence `NO-CHANGE`, claimed the unqualified per-failure promise remained
  coherent, and treated a non-null `errorMessage` as user language. It returned
  implementation Evidence-Resolution items instead of a product-feasibility
  feedback packet, even though the source eligibility set was smaller than the
  promised trigger/metric denominator.
- **Expected GREEN route**: Reconcile every promised `WHEN` and `H-*`
  denominator with all source gates and intentional suppressions. Because the
  approved scope forbids changing cadence, return the affected product ids to
  `platty-mcp-sdd-spec`, narrow the trigger and denominator to the existing
  notification-eligible failures, reset both product files to draft, and stop
  the design revision. Separately, require an explicit safe mapping or constant
  for user-visible reason text; identifier names such as `errorMessage`,
  `reason`, or `description` are not semantic proof.
- **Observable pass criteria**: No design can call the product feasible while
  `promised trigger set != source eligible set - approved exclusions`. The
  revised product pair is reapproved before a new design, and every
  user-visible reason has an exact source mapping or formula rather than a
  name-based assertion.
- **Owning contract**: `SKILL.md` Product Feasibility Reconciliation,
  `system-design-shape.md` state rules, and `design-review-rubric.md`
  Requirement Coverage / Implementation Evidence Ledger Audit.

### non-developer-asked-to-pick-banner-implementation

**Exact prompt**

```text
승인된 제품 결과는 “노출 가능한 공지 중 우선순위가 가장 높은 1건이 홈 배너의 첫 항목으로
보인다”야. PRD의 DH 항목에는 저장 구조, 조회 계약, 동률 정렬 기준을 설계에서 정하라고
넘겨뒀어. 기존 Home Banner를 재사용할지 공지 전용 목록을 만들지 비개발자에게 다시 물어보고
답이 올 때까지 설계를 멈춰줘.
```

- **Observed RED failure**: The product-drafting baseline exposed “reuse the
  existing Home Banner” versus “create a notice-specific list and priority” as
  a product question even though both were implementation alternatives for the
  same visible result.
- **Expected GREEN route**: Read the confirmed Home Banner path and dispose every
  `DH-*` in a Technical Decision Packet. Choose each reversible, compatible
  storage/query/order option as `DEC-*`; preserve the invariant visible result
  and ask no product approver for API, DB, query, or tie-breaker selection. A
  missing source fact becomes bounded Evidence-Resolution. Only a material
  cost/operations, security/privacy, data-loss, irreversible-migration choice
  can become an owner-qualified `TQ-*`; a changed visible result returns to SDD
  spec.
- **Observable pass criteria**: Every incoming `DH-*` maps exactly once to
  `DEC-*`, Evidence-Resolution, or an exception-qualified `TQ-*`; the first
  design review contains zero technical-choice questions for the product
  approver.
- **Owning contract**: `SKILL.md`,
  `using-platty-mcp/references/sdd-question-ownership.md`, and
  `system-design-shape.md` Technical Decision Packet / §11.

### home-banner-design-kickoff

**Exact prompt**

```text
홈 공지 배너의 승인된 기획에는 우선순위 최상위 1건, 노출 기간, 동률 처리의 DH 항목이 있어.
설계 조사를 다 끝낸 뒤 DB 컬럼과 정렬식을 하나씩 나에게 물어봐.
```

- **Expected GREEN route**: Before deep design, create one kickoff packet. Put
  reversible storage/query/order choices in `autoDecisions`, put source facts
  in `evidenceResolutionItems`, and ask only exception-qualified owner decisions
  in one consolidated sheet. Do not ask the non-developer to select columns or
  sorting expressions.
- **Observable pass criteria**: Every incoming `DH-*` has one kickoff disposition;
  there is no mid-design drip of technical questions, and final design approval
  remains a later interaction after the design revision is persisted.
- **Owning contract**: `SKILL.md` Technical Design Kickoff and
  `system-design-shape.md` 기술 설계 시작 결정표.

### community-reward-design-kickoff

**Exact prompt**

```text
커뮤니티에서 30초 머물면 방문당 1회 포인트를 주는 기획이 승인됐어. 체류 측정, 중복 지급 방지,
앱 이탈 처리 같은 설계 질문은 구현계획 중간에 생길 때마다 물어봐.
```

- **Expected GREEN route**: At design kickoff, show the recommended answers for
  reversible measurement and idempotency choices, name bounded reads for current
  lifecycle and reward facts, and consolidate only material owner-risk decisions.
  Later evidence either closes a `DEC-*`, stays Evidence-Resolution, or starts a
  new kickoff revision.
- **Observable pass criteria**: All carried-over design questions are answered or
  assigned before deep design, no implementation-plan question is delegated to a
  non-developer, and tasks still wait for separate final design approval.
- **Owning contract**: `SKILL.md` Technical Design Kickoff,
  `tasks-shape.md`, and the shared question-ownership contract.

### community-detail-continuity-product-backflow

**Exact prompt**

```text
승인된 문서에는 커뮤니티 메인에서 30초 체류라고만 적혀 있어. 설계에서 커뮤니티 글 상세로
이동해도 시간을 이어갈지 알아서 정하고 ready tasks까지 만들어줘.
```

- **Observed RED failure**: Design treated route exit/reentry and background
  handling as reversible lifecycle mechanics, so it could decide whether a user
  earns without reopening the product scope.
- **Expected GREEN route**: Product Boundary Recheck identifies Community-origin
  feed detail page continuity as a `PRODUCT` decision because it changes reward
  eligibility. Return it to SDD spec, create a new product revision in draft,
  require reapproval, and block ready/tasks. Keep the timer representation and
  lifecycle implementation as separate `DESIGN` items.
- **Observable pass criteria**: No `DEC-*` or `TQ-*` closes the detail-continuity
  policy; `system_design.md` cannot be PASS/ready and `tasks.md` is not created or
  overwritten until the revised product pair is re-approved.

### community-store-explore-analogue-reuse

**Exact prompt**

```text
커뮤니티 30초 보상용 타이머, 세션, 지급, 중복방지를 모두 새 컴포넌트로 설계해줘.
커머스 쪽 유사 기능은 이름이 다르니 보지 않아도 돼.
```

- **Observed RED failure**: The earlier design called the timer and lifecycle new
  and did not cite `StoreExploreSessionService` or the Store Explore reward flow.
- **Expected GREEN route**: Require the Behavioral Analogue sweep, read the
  StoreExploreSessionService and connected reward/dedup evidence, and classify
  each candidate as `REUSE`, `EXTEND`, `NEW`, or `NOT_APPLICABLE`. Domain-specific
  code is not automatically shared; the design must state the exact reusable
  contract, extension boundary, and truly new Community behavior.
- **Observable pass criteria**: Missing analogue evidence makes the design
  partial or NEEDS_WORK. A `NEW` decision includes a completed comparison and
  reason it cannot reuse or extend the precedent.

### frontmatter-blank-line-revision-parity

**Exact prompt**

```text
system_design.md를 표준 Markdown처럼 frontmatter 종료선 다음에 빈 줄을 두고 저장했어.
shared helper로 계산한 designRevision을 readiness validator에서도 검증해줘.
```

- **Observed RED failure**: The shared helper preserved the leading body newline,
  while the readiness validator removed it and independently rebuilt the digest.
  A canonical persisted document therefore failed with
  `DESIGN_REVISION_MISMATCH` even though its helper revision was current.
- **Expected GREEN route**: Parse the persisted design and compute its revision
  with the same exported `parseSddArtifact` and `computeDesignRevision`
  functions used by approval. Do not normalize or reimplement the body hash in
  the validator.
- **Observable pass criteria**: Documents with or without a presentation blank
  line after frontmatter validate against the exact revision returned by the
  shared helper, and a real body change still fails until a new revision is
  persisted.
- **Owning contract**: `SKILL.md` Revision and approval gate,
  bundled `../using-platty-mcp/scripts/sdd-artifacts.mjs`, and
  `scripts/readiness-validator.mjs`.
