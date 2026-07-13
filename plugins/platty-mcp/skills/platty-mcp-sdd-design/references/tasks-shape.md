---
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-tasks"
status: "planned"
executionReadiness: "partial"
projectId: "<projectId>"
outputLanguage: "ko"
designApprovedAt: "<approved design approvedAt>"
designApprovedBy: "<approved design approvedBy>"
designRevision: "<approved design designRevision>"
approvedRevision: "<approved design approvedRevision; must equal designRevision>"
productInputFingerprint: "<approved design productInputFingerprint>"
evidenceFingerprint: "<approved design evidenceFingerprint>"
impactStatus: "<seeded | investigated | partial>"
sourceParity: "<confirmed | partial | unavailable>"
sourceCommits: {}
impactRetrievedAt: "<ISO timestamp or unknown>"
evidenceBoundary: "<MCP evidence surfaces used>"
contextStatus: "<fresh | stale | unknown>"
coverageLimits: []
derivedFrom: ["request.md", "stories.md", "impact.md", "design.md"]
generatedAt: "<ISO timestamp>"
---

# Tasks - <Spec title>

> Generated only after explicit approval of the current `design.md`. If the
> design approval metadata no longer matches, this task plan is stale and must
> not be executed.

`status: planned` describes artifact lifecycle only. Production implementation
is allowed only when `executionReadiness: ready`, revision/fingerprint equality
holds, and the current design remains approved. When
`executionReadiness: partial`, only the bounded Evidence-Resolution tasks in
this artifact may run; Ready implementation tasks must not run.

## Execution Preflight

Before executing any existing `tasks.md`, the executor must reread the selected
`request.md`, `stories.md`, `impact.md`, `design.md`, and `tasks.md`. Recompute
`requestRevision`, `storiesRevision`, `productInputFingerprint`,
`impactRevision`, `evidenceFingerprint`, and `designRevision`; verify both
product inputs remain approved and require all task/design approval metadata to
match. A missing or mismatched value makes the task artifact stale. Do not run
implementation work. If either product input status is not approved, stop and
do not create a design revision. When both product inputs remain approved but a
revision or fingerprint differs, create a new unapproved design revision, stop
for later explicit approval, and regenerate tasks.

## Goal, Architecture, and Tech Stack

**Goal:** <one sentence describing the completed behavior>

**Architecture:** <two or three sentences copied from the approved design boundary>

**Tech Stack:** <source-confirmed languages, frameworks, libraries, and test tools>

## Global Constraints

- <approved request/design constraint with exact value>
- <compatibility, migration, security, or rollout constraint>
- <impact coverage limit that every task must preserve>

## Requirement And Change Coverage

| Requirement | Scenario | Disposition | Design change or rationale | Impact evidence | Implementation task | Verification or resolution |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | US-01-S01 | implemented | CHG-01 | impact.md §<n> / <entry id> | TASK-01 | VER-01 / E2E-01 |
| R-02 | US-02-S01 | non-goal | D-01 / <approved rationale> | impact.md §<n> / <entry id> | N/A | approved non-goal review |

Every request rule and stable story scenario in a generated `tasks.md` must have
exactly one disposition: `implemented` or `non-goal`. `implemented` rows map to
at least one approved `CHG-*`, implementation `TASK-*`, and automated `VER-*` or
E2E scenario. `non-goal` rows map to an approved rationale or decision id and do
not require implementation or test work. A `blocked` requirement or scenario
prevents design approval and must be resolved through MCP evidence or a revised
design before generating `tasks.md`. An incomplete or contradictory disposition
makes the design blocked rather than merely lowering task readiness.

## File Structure

### New files

- `<exact path>`: <single responsibility and owning task>

### Modified files

- `<exact path>`: <specific responsibility and owning task>

Use only source-confirmed paths. Put an unresolved path in `coverageLimits` with
its `nextExactRead`; never invent a plausible path. When a required path or
command is unresolved, use the Evidence-Resolution Task shape below instead of
an implementation task with fabricated slots.

## Task Template

Use the Ready Implementation Task shape only when the task's paths, interfaces,
test content, and commands are source-confirmed. Use the Evidence-Resolution
Task shape only for approval-eligible partial areas. A blocked design produces
no `tasks.md`; resolve the blocking finding and create a new design revision
first. Order tasks by dependency, not by a generic technical-layer checklist.

For data-changing designs, preserve the approved rollout dependency:

```text
expand schema or contract
-> compatible deploy
-> backfill or reconcile
-> validate
-> switch behavior
-> observe
-> contract old structure
```

Use only the phases that apply to the approved `CHG-*` rows.

### Ready TASK-NN: <independently testable outcome>

**Task ID:** `TASK-NN`

**Change:** `CHG-NN`

**Phase:** `<expand | compatible-deploy | backfill | validate | switch | observe | contract>`

**Verification:** `VER-NN`

**Readiness:** `ready`

**Files:**
- Create: `<exact test or source path>`
- Modify: `<exact source path and bounded region or symbol>`
- Test: `<exact test path>`

**Interfaces:**
- Consumes: `<exact earlier contract, type, function, or artifact>`
- Produces: `<exact contract, type, function, field, or artifact used later>`

**Evidence:**
- Requirements: `R-NN`
- Scenarios: `US-NN-SNN`
- Design: `CHG-NN` / `design.md §<n>`
- Impact: `impact.md §<n>` / `<evidence entry id>`
- Source: `<repoId>@<commit>:<file>:<lineStart>-<lineEnd>`

- [ ] **Step 1: Write the failing test - RED**

```text
<complete test code or exact structural assertion>
```

- [ ] **Step 2: Run test to verify it fails**

Run: `<exact focused test command>`

Expected: FAIL because `<missing behavior asserted by this task>`, not because
of syntax, configuration, fixture, or environment errors.

- [ ] **Step 3: Write minimal implementation - GREEN**

```text
<complete minimal implementation or exact skill/template content>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `<same focused test command>`

Expected: PASS with `<exact test count or observable result>`.

- [ ] **Step 5: Refactor while staying green**

Apply only `<named duplication, boundary, or naming improvement>` without adding
untested behavior. Re-run the focused command and preserve PASS.

- [ ] **Step 6: Run regression verification**

Run: `<exact affected-suite command>`

Expected: all affected tests PASS with no new warnings or errors.

- [ ] **Step 7: Commit**

```bash
git add <exact task-owned paths>
git diff --cached --check
git commit -m "<type>: <specific task outcome>"
```

### Evidence-Resolution TASK-NN: <missing implementation fact>

**Task ID:** `TASK-NN`

**Change:** `CHG-NN`

**Verification:** `VER-NN` or `<verification gap>`

**Readiness:** `partial`

**Missing evidence:** <exact unknown path, command, symbol, interface, or behavior>

**Required MCP surface:** <workspace_repo_list, readonly_workspace_shell,
graph_trace, code_search, or exact spec read>

**Next exact query/read:** <bounded query and expected repository/spec scope>

**Owner:** <task or human decision owner>

**Resolution criterion:** <observable evidence that permits a new design
revision to replace the gap with a source-backed decision or Ready Task>

**Prohibited:** Do not add speculative implementation paths, commands, symbols,
or test code to this task.

#### Completion Sequence

- [ ] **Step 1: Execute the required MCP read/query through the impact owner**

Route the bounded `Next exact query/read` through
`platty-mcp-impact-analysis`. Do not substitute a local fallback or broaden the
scope without recording why.

- [ ] **Step 2: Record the result in impact.md**

The impact owner records the returned evidence, repository/spec scope, and any
remaining unknown in `impact.md`. The design/task route does not edit dossier
entries.

- [ ] **Step 3: Recompute revisions and stale the current task artifact**

Reread `impact.md`, recompute `impactRevision` and `evidenceFingerprint`, and
mark this task artifact stale when the evidence snapshot changed. The existing
task artifact must not promote itself in place.

- [ ] **Step 4: Create a new unapproved design revision**

Refresh the affected assumptions, decisions, `CHG-*`, and `VER-*` rows from the
new impact evidence. Recompute `productInputFingerprint`, `designRevision`, and
`evidenceFingerprint`; clear approval metadata.

- [ ] **Step 5: Stop for later explicit reapproval**

Persist and verify the new design, present its path and revision, and stop. A
same-request or prior approval does not approve the new revision.

- [ ] **Step 6: Regenerate tasks after reapproval**

After later explicit reapproval, regenerate `tasks.md` from the new design and
current evidence. Never promote the existing task artifact in place; unresolved
evidence produces another bounded Evidence-Resolution task.

## E2E Scenarios

| ID | Given | When | Then | Maps to | Command/evidence |
| --- | --- | --- | --- | --- | --- |
| E2E-01 | <state> | <action> | <observable result> | R-01 / US-01-S01 | <exact command or harness> |

## Manual-Only Verification

Include only behavior that cannot reasonably be automated. Every row must say
why automation is unavailable.

| Check | Why manual | Expected evidence |
| --- | --- | --- |
| <check> | <automation limit> | <screenshot, log, or observation> |

## Rollback Checklist

- [ ] <exact rollback action and verification command>

## Plan Self-Review

- [ ] Every request rule and stable story scenario has exactly one `implemented` or `non-goal` disposition.
- [ ] Every `implemented` row maps to implementation and automated test or E2E evidence.
- [ ] Every `non-goal` row maps to an approved rationale or decision id without speculative work.
- [ ] No generated `tasks.md` contains a `blocked` requirement disposition.
- [ ] Every `CHG-*` maps to at least one `TASK-*` and `VER-*` or an explicit evidence-resolution task.
- [ ] Task order follows approved dependency and rollout phases rather than a generic technology-layer order.
- [ ] Every task observes RED before production or skill behavior changes.
- [ ] Every RED failure reason is the missing behavior, not a test error.
- [ ] Every file, symbol, command, and source commit is evidence-backed.
- [ ] Task interfaces use consistent type, function, and field names.
- [ ] Automated checks are not duplicated as manual verification.
- [ ] Remaining non-critical source or impact gaps on an approval-eligible design set `executionReadiness: partial`; critical gaps keep the design blocked and prevent task generation.
- [ ] `tasks.md` exists only for an explicitly approved current design.
- [ ] Approval metadata in `tasks.md` matches the current `design.md`.
- [ ] `tasks.md.designRevision` matches the current approved design revision.
- [ ] `designRevision == approvedRevision == tasks.md.designRevision`.
- [ ] `tasks.md.evidenceFingerprint` matches the approved design evidence snapshot.
- [ ] `tasks.md.productInputFingerprint` matches freshly read approved request/story inputs and the current design.
- [ ] The executor reruns Execution Preflight immediately before executing an existing task artifact; generation-time checks are not sufficient.
- [ ] Every task has its own readiness; global `partial` identifies which tasks remain blocked or partial.
- [ ] Every evidence-resolution task routes its bounded read through the impact owner, records it in `impact.md`, creates a new unapproved design revision when evidence changes, stops for reapproval, and regenerates tasks instead of promoting the old artifact in place.

`TBD`, `TODO`, `implement later`, `fill in details`, `Similar to Task N`,
generic "add validation/error handling", and test steps without complete test
content are plan failures. Replace every template slot before persisting the
generated `tasks.md`; template markers must never survive in the artifact.

Readiness assignment is deterministic:

```text
design unapproved -> do not create or overwrite tasks.md
design Self Review blocked or NEEDS_WORK -> reject approval; do not create or overwrite tasks.md
design approval metadata missing/mismatched -> existing tasks.md is stale; do not execute
designRevision missing/mismatched -> existing tasks.md is stale; do not execute
productInputFingerprint missing/mismatched -> existing tasks.md is stale; reread product inputs and create a new unapproved design revision
evidenceFingerprint changed after approval -> create new unapproved design revision; do not create tasks
approval-eligible design approved + any non-critical impact/source/command/path gap -> partial
design approved + required evidence confirmed + coverage complete -> ready
```
