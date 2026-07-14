---
name: platty-mcp-sdd-design
description: Use when creating locally saved MCP-grounded SDD technical design and implementation-task drafts from existing prd.md and user_stories.md.
---

# Platty MCP SDD Design

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Create an evidence-gated system design from the approved product inputs and the
persisted Impact Dossier. The design owns system boundaries, technical decisions,
and the canonical change map; impact analysis owns impact discovery and the
final §9 appendix of `prd.md`.
Use `references/system-design-shape.md` for the design and
`references/tasks-shape.md` for the approval-gated task plan.

All reader-facing output is Korean. Keep code identifiers, API paths, file
paths, status values, and quoted evidence in their original form.

## Required Sub-Skills

1. Use `using-platty-mcp` for MCP capability and project context.
2. Use `platty-mcp-impact-analysis` for impact, graph, cross-EPIC, repository,
   and source convergence. It invokes `platty-mcp-retrieval` with `routeMode:
   seed-only` when a packet is missing, then owns dossier-entry changes. In SDD
   context it alone writes or refreshes only PRD §9. Do not invoke retrieval
   directly for that path.

## Inputs

- Platty project context.
- SDD directory id or spec slug containing `prd.md` (including §9) and
  `user_stories.md`.
- Optional target repo, API, screen, table, event, or job areas.

## New-Session Context Recovery Gate

`prd.md` is the product decision record; it is not a substitute for the SOT
context that led to those decisions. Before inspecting code, decide whether the
selected PRD §9 has a reusable SOT context: selected business documents,
their `document_resolve` results, terminology/EPIC mapping, freshness, evidence
boundary, and the scope limits that apply to this design.

When that context is missing, stale, partial in a required product area, or the
session cannot show that it was read, do not jump from `prd.md` to code search.
**Invoke `platty-mcp-impact-analysis` before any graph trace, code search, or
source read.** Its seed route must
recover the SOT context through `platty-mcp-retrieval`, resolve the selected
business documents with `document_resolve`, and preserve the recovered context
and limits in PRD §9 before graph and bounded source reads begin. This is
required even when the user starts a new session with only the SDD folder path
or `prd.md` as the handoff.

## Operating Flow

1. Confirm MCP tools, project context, and context freshness.
2. Read the selected local `prd.md` (including §9) and `user_stories.md`.
   Confirm both artifacts belong to the selected project and spec.
   Build `productInputMetadata` from their persisted metadata: validate canonical
   product metadata directly; adapt legacy product metadata only in this input
   packet and retain its source form. Never rewrite `prd.md` or `user_stories.md`
   merely to migrate legacy metadata. Compute `requestRevision` (also persisted
   in PRD §9 as `productSegmentRevision`) from the PRD stable product
   frontmatter and the body before the exact `## 9. 영향도 조사 및 근거`
   delimiter. Exclude mutable status/approval values, §9, and legacy `impact*`
   frontmatter fields; this prevents approval or evidence refresh from changing
   product content identity. The reader mapping is exact:
   `spec-request -> sdd-request`, `spec-stories -> sdd-stories`, and
   `derived_from -> derivedFrom`. Apply aliases only in `productInputMetadata`;
   preserve both input files byte-for-byte and hash their original persisted
   content. When both canonical and legacy keys exist, both must have the same normalized value;
   then use the canonical key in `productInputMetadata`. A conflicting pair
   is a `NEEDS_WORK` input conflict; stop without choosing a value or rewriting
   either file. Compute `storiesRevision` from stable stories frontmatter and
   body while excluding mutable status/approval values, then compute the
   canonical `productInputFingerprint` from both revisions and current statuses.
3. Stop unless request/story inputs are approved, unless the user explicitly
   asks for draft-only technical design. A draft-only design remains
   `NEEDS_WORK`, is not approval-eligible, and must be regenerated as a new
   design revision after both product inputs become approved.
4. Read PRD §9 first and inspect its Impact Dossier metadata and reusable
   SOT context before making a hard implementation claim. When it is missing,
   `seeded`, stale, source-commit-mismatched, lacks the context required by the
   New-Session Context Recovery Gate, or is `partial` in a required request or
   story area, invoke `platty-mcp-impact-analysis` before any graph or source
   tool. Record the observed refresh condition and its affected evidence id or
   coverage limit before invoking. Do not rerun it when the existing dossier is
   sufficient.
5. After impact analysis returns, reread `prd.md`. Keep impact status,
   `impactRevision`, the sorted matrix `evidenceId` snapshot, source parity,
   commits, traversal status, and `impactCoverageLimits` in the working packet
   and the final appendix. Never expose that operational log in frontmatter or
   edit an Impact Dossier entry from this skill.
6. Derive evidence-backed AS-IS facts and system TO-BE decisions from request,
   stories, and impact. Use the dossier's `document_resolve` links to connect
   product documents to selected specs, and use its `graph_trace` result as a
   fast `screen ↔ API ↔ domain ↔ DB` path map. For every hard implementation
   claim, require the dossier's matching `confirmed-path` coverage row: the
   entry/caller, orchestration, persistence or external boundary, consumers,
   and adjacent tests/configuration/migrations when present must have exact
   source reads. `partial-path` evidence becomes a risk or an
   Evidence-Resolution task, never a confirmed system fact.
   Before drafting, assemble the affected AS-IS component map and critical call
   flow from confirmed rows, then derive the TO-BE map against the same boundary.
   Classify every affected screen, synchronous API, event/job, data/DB boundary,
   external integration, and protected legacy flow exactly once as `NEW`,
   `MODIFY`, `REUSE`, `NO-CHANGE`, `DEPRECATE`, `DELETE`, or `UNKNOWN`.
   For `MODIFY`, read current request/response/error, consumers, business
   branches, data access, permissions, and adjacent tests before specifying the
   delta. For `DEPRECATE` or `DELETE`, confirm every consumer and the replacement,
   observation period, removal order, and rollback. If those reads are absent,
   keep `UNKNOWN` or `DEPRECATE`; never assert safe deletion.
7. Draft `system_design.md` from `references/system-design-shape.md`.
8. Persist and read back `system_design.md`, then report its path for user review.
9. If Self Review is `blocked` or `NEEDS_WORK`, reject approval and stop without
   creating or overwriting `tasks.md`; refresh evidence or revise the design.
10. If the current design is not explicitly approved, stop without creating or
   overwriting `tasks.md`.
11. On explicit approval, reread `system_design.md`, `prd.md`, and `user_stories.md`.
    Recompute both product input revisions and `productInputFingerprint`; reject
    approval when either status is not approved or any stored input value differs.
    Otherwise persist and read back `approvedRevision`, `approvedAt`, and
    `approvedBy` for the current design revision.
12. During task preflight, reread all three inputs, recompute
    `productInputFingerprint`, then recheck impact status, source parity, source
    commits, context status, and evidence boundary. Recompute
    `evidenceFingerprint`.
13. If either product-input status is not approved, stop, keep any existing
    `tasks.md` stale, and do not create a design revision unless the user later
    makes an explicit draft-only design request.
14. If both product inputs remain approved and a product-input revision changed,
    its fingerprint changes; create and verify a new unapproved design revision
    and stop without creating tasks. Apply the same transition for an evidence
    fingerprint change.
15. Otherwise draft `tasks.md` from `references/tasks-shape.md`, assign
    `executionReadiness` as `blocked`, `partial`, or `ready` according to the
    deterministic table below, copy only the minimal
    revision/fingerprint metadata defined by the template, inherit the
    design's `SLICE-*` groups, and create only the applicable contract,
    backend/API, frontend/screen, integration/observability, and verification
    task cards inside each slice. Record a non-applicable category once as
    `N/A` with its reason in the slice handoff instead of creating an empty task.
    Include the four-artifact Execution Preflight and a
    task-local RED/GREEN/regression verification loop only where the source and
    existing test convention are confirmed. The §0 dependency table—not the
    section order—defines actual execution order.
16. Persist and read back `tasks.md`; verify its metadata matches the current
    approved design, then run the rubric's post-task structural audit. Check
    every slice has `handoff summary -> task index -> code edit map -> detailed
    task cards`, every detailed task has exactly one matching index row, target
    ids/readiness agree, open `O-*`/`TQ-*` gates are preserved, and
    non-applicable categories are `N/A` with a reason rather than empty tasks.
    Apply `review -> revise -> read back -> review` to `tasks.md` until the audit
    passes. If it cannot pass, report task generation incomplete with the exact
    structural findings; do not report the task artifact as verified.

## Impact Ownership And Refresh Gate

SDD design must not format or write PRD §9. Missing SOT context is an
impact-analysis call, not permission for the design skill to search code first.

Delegate every missing, seeded, stale, source-commit-mismatched, or
required-area partial dossier refresh to `platty-mcp-impact-analysis`. That
sub-skill may update dossier entries and PRD §9; this skill only consumes the
updated PRD. Read PRD §9 first; optionally invoke the
impact skill only for those refresh conditions. Record the observed refresh
condition and its affected evidence id or coverage limit before invoking.
Persist that record in `system_design.md` appendix A (use `not-needed` when no
refresh ran); it participates in `evidenceFingerprint`, so changing it creates
a new unapproved design revision.
Do not always rerun impact.
Record whether the SOT context was reused, recovered, or remains partial in the
design's compact input/evidence summary; keep the detailed document list and
retrieval transcript in PRD §9.
Do not copy its Impact Evidence Matrix or search transcript into `system_design.md`.
Show only the compact path map needed for implementation, reference dossier
evidence ids, and reference PRD §9 for detailed evidence.

Hard implementation claims require the relevant bounded evidence and source
parity plus `confirmed-path` coverage. `document_resolve` selects connected
document context; `graph_trace` accelerates path discovery; `code_search` finds
exact source candidates; and `readonly_workspace_shell` reads the bounded
source. Graph output does not prove writes, permissions, contracts,
transactions, retries, or absence. Empty graph/search results are not proof of
no impact. A candidate-only or `partial-path` result is not a confirmed claim.

## Local SDD File Access

This is the only local file exception in the MCP SDD design route. Read only the
selected `prd.md` (including §9) and `user_stories.md`, then write only the design
and approval-gated task outputs in:

```text
~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/
```

Rules:

- Create the target directory if needed.
- Resolve `~` to the current user's home directory before file operations.
- Confirm the directory project id matches the selected MCP project context.
- Do not read local SOT, run local Platty CLI commands, or inspect unrelated
  local files.
- `platty-mcp-impact-analysis` owns every PRD §9 update and dossier edit.
- Write `designMarkdown` to `system_design.md`.
- Read `system_design.md` back and verify its project/evidence metadata.
- Reject approval and do not create or overwrite `tasks.md` while Self Review is
  `blocked` or `NEEDS_WORK`.
- Do not create or overwrite `tasks.md` before explicit design approval.
- After approval, write `tasksMarkdown` to `tasks.md` and read it back.
- If task write/read-back fails, report task generation as incomplete, include
  the exact failed path, and state that the verified `system_design.md` remains valid.

## Evidence And Negative-Claim Gate

Technical AS-IS statements are current facts and require evidence. Technical
TO-BE statements are decisions and must map to the product intent and impact
evidence that motivated them. Before naming exact files, APIs, DTOs, tables,
events, permissions, writes, or negative source claims, require the relevant
Impact Dossier evidence and source parity.

Every impact-assessment surface is `yes`, `no`, or `unknown`; blank is invalid.
A `no` requires positive evidence that the relevant discovery surfaces and
scope were checked. Empty, unavailable, omitted, candidate-only, or truncated
evidence cannot become `no`. An implicated `unknown` blocks readiness unless
the risk is accepted by a separately confirmed `DEC-NN` decision with owner,
rationale, affected ids, bounded scope, and revisit condition in a new design
revision. Generic design approval does not accept the risk.

Unsupported implementation claims must be marked as assumptions or risks. If
source parity is incomplete, keep `impactCoverageLimits` explicit and avoid
turning candidates into confirmed design.

## SDD Design Packet

```text
SDD Design Packet
- projectId
- projectName
- specId
- requestStatus
- storiesStatus
- requestRevision
- productSegmentRevision
- storiesRevision
- productInputFingerprint
- outputLanguage
- contextStatus
- evidenceBoundary
- productInputMetadata
- impactAppendixRef (`prd.md#9`)
- impactRevision
- impactEvidenceSnapshot
- impactStatus
- impactRefreshReason
- sourceParity
- impactRetrievedAt
- sourceCommits
- crossEpicTraversalStatus
- impactCoverageLimits
- codePathCoverage
- surfacesRead
- selectedEpics
- selectedSpecs
- sourceConfirmations
- directEvidence
- inferredEvidence
- assumptions
- risks
- designRevision
- approvedRevision
- approvedAt
- approvedBy
- evidenceFingerprint
- designMarkdown
- tasksMarkdown
- executionReadiness
- localPersistenceTarget
```

## Reader-Facing Structure

`system_design.md` is a meeting draft, not an MCP execution log. Keep its
frontmatter limited to the identity, input/revision, approval, and compact
review fields defined in `system-design-shape.md`. Do not put source parity, source
commits, impact snapshots, tool output, refresh history, or detailed coverage
maps above the title.

Write the body in the fixed reader order from `system-design-shape.md`:

1. meeting goal and decision agenda;
2. product understanding and user flows;
3. evidence-backed AS-IS structure, current call flow, and constraints;
4. TO-BE structure, responsibilities, and target call flow;
5. the single canonical component change map;
6. detailed screen, API, event/job, data/DB, external, and retirement contracts;
7. state, permission, error, and non-functional rules;
8. outcome-oriented vertical implementation packets;
9. implementation, migration, release, rollback, and operations;
10. verification contracts and development completion conditions;
11. open decisions and next actions; then
12. Appendix A for evidence, impact, code paths, graph trace, coverage, and
   uncertainty.

The meeting-facing §1–§11 may use SDD stable ids and the user/system contract
being discussed. Keep MCP document/spec/repository ids, tool-call names,
candidate files/symbols, source-confidence narration, and graph/search detail in
Appendix A. A meeting agenda or `TQ-*` row points to an appendix evidence gap;
it does not embed a `spec_get`, `document_resolve`, `graph_trace`, or code-search
instruction in the body.

The body must let a developer answer, in order: what the product intends; how
the affected system works now; what the target system does; which components
are new, modified, reused, protected, deprecated, deleted, or still unknown;
what each changed contract guarantees; and how a vertical slice is implemented,
verified, released, and rolled back. Say `해당 없음` with a reason instead of
omitting a non-applicable contract area.

Use one small AS-IS boundary diagram and one small TO-BE boundary diagram only
when they materially shorten comprehension. Use a sequence or decision diagram
only for a critical normal, failure, permission, or asynchronous flow. A diagram
must use the stable surface ids, distinguish candidate edges, and must not repeat
the adjacent table.

Section 5 is the only owner of lifecycle classification. Use exactly `NEW`,
`MODIFY`, `REUSE`, `NO-CHANGE`, `DEPRECATE`, `DELETE`, or `UNKNOWN`; later
sections reference that row instead of reclassifying it. Fully expand `NEW` and
`MODIFY`. Expand `DEPRECATE` and `DELETE` around consumer safety and removal.
Keep `REUSE` and `NO-CHANGE` compact. Preserve the next exact read and blocking
decision for every `UNKNOWN`.

Assign reader-facing surface ids once in the owning inventory: `SCREEN-*` for
screens/operational surfaces, `API-*` for synchronous contracts, `EVENT-*` for
asynchronous events or job triggers, and `DATA-*` for state, judgment, or data
ownership boundaries. Reuse those ids in rules, slices, Appendix A, and tasks;
do not reconnect the flow through free-text names alone.

Preserve product and technical ownership: `D-*` and `O-*` come from the PRD and
must not be renumbered or reclassified by design. `DEC-*` is only a confirmed
technical decision or explicit bounded risk acceptance; `TQ-*` is a new
technical question. A product `O-*` whose answer changes scope, rules,
acceptance criteria, or success judgment returns to product revision, impact,
and approval instead of being closed by a design `DEC-*`.

When screen or API evidence exists, Appendix A must preserve implementation
handoff detail: screen route/entry, component/file/symbol, role, displayed
state, actions/navigation, connected APIs/events; and API method/path,
controller/handler, service/use case, persistence/external boundary,
request/response/error, permissions/consumers. Include only exact spec/source
reads as confirmed. Candidate or partial evidence stays explicitly marked and
becomes an Evidence-Resolution task when required for implementation.

Before task generation, derive stable `SLICE-*` groups in design §8. A slice
is an independently reviewable user outcome, not a generic technical layer.
Shared contracts, migrations, or permissions may be a prerequisite slice when
several outcomes depend on them. Every `CHG-*` has one primary slice and every
slice maps to its screens, contracts/data, `VER-*`, dependencies, parallelism,
and release boundary.

Inside every task slice, keep the reader order `handoff summary -> task index ->
code edit map -> detailed task cards`. The task index is a derived navigation
view with exactly one row per detailed task. It must expose task result, area,
dependency, edit/candidate target, and readiness without promoting candidate
evidence to executable work. An open product `O-*` or technical `TQ-*` that can
change the task result also blocks `ready`; route it to product revision,
technical decision, or Evidence-Resolution as applicable.

For each changed screen, specify applicable loading, success, empty, forbidden,
error, and partial-failure states. For each changed synchronous contract,
separate AS-IS and TO-BE request, response, errors, permissions, consumers, and
compatibility; include field meaning and derivation, not names alone. For each
event/job, specify producer, condition, payload/schema, consumers, ordering,
duplication, retry, PII, and observation. For each DB change, specify schema and
index changes, readers/writers, migration, backfill, old/new compatibility,
deployment order, validation, and rollback or roll-forward-only behavior. A
schema-preserving change says explicitly that schema and writes remain unchanged.

Before task generation, require design §8 to contain one vertical packet per
outcome-oriented `SLICE-*`, connecting product ids, AS-IS gap, TO-BE `CHG-*`,
surfaces, edit/protected/candidate boundaries, implementation order, exceptions,
verification, parallelism, release, and rollback. Design §10 owns the verification
contract. `tasks.md` may expand these packets into executable cards but must not
invent a contract, decision, location, command, or dependency absent from the
approved design.

Use `EDIT-*` for executable edit targets, `CAND-*` for candidates, and
`NOEDIT-*` for protected boundaries. Every `edit-target` requires `repo + full
source commit + file + symbol + line range + change intent + bounded-read
evidence`. The symbol is the stable locator; line ranges are advisory at the
recorded commit. Search metadata, graph nodes, spec-only links, truncated
commits, or stale source become `candidate-target`; record their observed
locator, missing fields, and next bounded read instead of presenting them as an
implementation edit.

## Revision And Approval Contract

Apply `../using-platty-mcp/references/sdd-revision-contract.md` and the
frontmatter rules in `system-design-shape.md`. A new or
revised design has `status: draft`; `approvedRevision`, `approvedAt`, and
`approvedBy` are empty.

Explicit approval must reread `system_design.md`, `prd.md`, and `user_stories.md`, verify
the current design revision, recompute the canonical design hash and
`productInputFingerprint`, and require all stored values to match. Both product
inputs must currently be approved. A non-approved status stops approval without
creating a revision. When both inputs remain approved, a hash or fingerprint
mismatch creates a new unapproved revision instead. When every check matches, set
`status: approved`, set `approvedRevision = designRevision`, set `approvedAt` to
the current ISO timestamp, set `approvedBy` to the authenticated actor id or
`user`, persist, and read back the transition.

A hash mismatch creates a new unapproved revision. Never repair stored approval
metadata in place to make a mismatched revision appear current.

Any later approved product-input content, design-content, or evidence-fingerprint
change creates another revision, resets `status: draft`, and clears approval metadata:
`approvedRevision`, `approvedAt`, and `approvedBy`.

## Design Approval And Task Creation

`system_design.md` is created first. Persist it, read it back, and ask the user to
review it. Do not create or overwrite `tasks.md` until the current design has
`approvedRevision == designRevision` plus explicit `approvedAt` and
`approvedBy` values.

A draft-only design derived from an unapproved request or stories file is not
approval-eligible. After both product inputs become approved, reread them,
compute a new `productInputFingerprint`, generate a new design revision, and
present that revision separately for approval.

Self Review semantics are strict:

- `ready` is approval-eligible when it has no blocking findings.
- `partial` is approval-eligible only when it has no blocking findings and all
  remaining gaps are task-level evidence-resolution gaps. After approval, those
  gaps require `executionReadiness: partial`; preserve each exact gap and next
  read in `tasks.md` without inventing implementation detail.
- `blocked` requires `NEEDS_WORK` and is not approval-eligible.
- `NEEDS_WORK` blocks approval. A user approval message cannot override it.

Refresh MCP evidence or create a new design revision until Self Review is an
approval-eligible `partial` or `ready`, then present that revision for approval.

Prospective, blanket, or same-request approval does not count. Approval must be
a later user message received after the verified design path and
`designRevision` were presented for review.

On explicit approval, reread the design and both product inputs, require their
current revisions, statuses, and `productInputFingerprint`, recompute and verify
the canonical design hash, set `status: approved`,
`approvedRevision = designRevision`, set `approvedAt` to the current ISO
timestamp, set `approvedBy` to the authenticated actor id or `user`, then
persist and read back the approval transition.

After approval, the task preflight recomputes `productInputFingerprint`, refreshes
required impact/source evidence, and generates `tasks.md` only when both product
inputs remain approved and both product and evidence fingerprints still match.
If either product-input status is not approved, stop without creating a new
design. If both product inputs remain approved and either fingerprint changed,
create a new unapproved design revision and stop for approval. Otherwise copy
`designRevision`, `approvedRevision`, `evidenceFingerprint`,
and `productInputFingerprint` into the task artifact. Keep approval actor and
timestamp in `system_design.md`; do not duplicate them in task frontmatter.

Assign `executionReadiness` deterministically:

| Condition | Readiness | Required behavior |
| --- | --- | --- |
| Design is not approved | no task artifact | Stop after verified `system_design.md`; do not create or overwrite `tasks.md`. |
| Design Self Review is `blocked` or `NEEDS_WORK` | no task artifact | Reject approval and resolve the blocking finding through MCP evidence or a revised design. |
| Design is approved and only a task-level evidence-resolution gap remains | `partial` | Preserve the exact gap and next read; do not invent implementation detail. |
| Design is approved and every required implementation claim is evidence-backed | `ready` | Persist the execution-ready TDD plan. |
| Design approval metadata no longer matches tasks | `blocked` on stale existing task | Set `status: stale`; block execution until the revised design is approved and tasks are regenerated. |
| Either product input status is not approved | `blocked` on stale existing task | Set `status: stale`; stop execution; do not create a design revision unless the user later requests an explicit draft-only design. |
| Product input fingerprint changes after approval | no new task artifact | Create a new unapproved design revision from the current approved request and stories, then stop for reapproval. |
| Evidence fingerprint changes after approval | no new task artifact | Create a new unapproved design revision and stop for reapproval. |

If `tasks.md` cannot be written and read back after approval, report task
generation as incomplete. The already verified `system_design.md` remains available
for review.

Recompute the canonical product-input, design, and evidence hashes during every task preflight;
do not trust stored hash fields without recomputation. If the approved design is
changed or revised, the existing `tasks.md` is stale until reapproval and
regeneration.

Before executing any existing `tasks.md`, the executor must run the task
artifact's Execution Preflight, reread all four SDD artifacts, and recompute
`productInputFingerprint`, `evidenceFingerprint`, and revision/approval equality.
Generation-time checks do not authorize later execution. If either product-input
status is not approved, stop and keep tasks stale without creating a design.
When both product inputs remain approved, a revision or fingerprint mismatch
blocks execution and returns to a new unapproved design revision.

## Approval Invariants

```text
system_design.md is created and verified before tasks.md.
Blocked or NEEDS_WORK design revisions are not approval-eligible and never create or overwrite tasks.md.
Do not create or overwrite `tasks.md` until the current design is explicitly approved.
Current designRevision, approvedRevision, and tasks.md designRevision must match.
Current productInputFingerprint must match system_design.md and tasks.md.
Changed post-approval evidence creates a new unapproved design revision before tasks.
If the approved design changes, the existing tasks.md is stale until reapproval and regeneration.
```

## Answer Contract

```text
## system_design.md draft
<full markdown>

## Self Review
<verdict, readiness, blockers, warnings, and coverage>

## tasks.md draft
<full markdown; emitted only after current design approval>

## tasks.md readiness
<blocked | partial | ready, with the exact evidence reason>

## tasks.md structural audit
<PASS, or task generation incomplete with exact slice/index/card findings>

## Local persistence
Design saved and verified first:
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/system_design.md

After approval, tasks saved and verified:
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/tasks.md
```

Use "확인됨" only for exact MCP reads. Use "후보", "근거상 보임", or
"추가 확인 필요" for candidates, partial evidence, inferred behavior, or
missing source parity.

## Stop Conditions

- MCP tools are not configured.
- Request/story inputs are not approved and draft-only design was not requested.
- Impact refresh is required but `platty-mcp-impact-analysis` cannot run or its
  artifact cannot be read back.
- Required source parity is missing for a hard implementation claim; weaken or
  omit the claim and report the gap.
- Self Review is `blocked` or `NEEDS_WORK`; reject approval and resolve the
  blocking finding through MCP evidence or a revised approval-eligible design.
- Task generation is requested while the current design is not explicitly
  approved with matching revision and approval metadata.
- A task preflight product-input status is not approved; stop without creating a
  design revision or executing tasks.
- Both product inputs remain approved but recomputed product-input, design, or
  evidence hashes do not match the approved metadata; create a new unapproved
  design revision and stop before task generation.
- A shared engine contract, persisted schema, public CLI behavior, or common
  resolver semantic change is required without explicit approval.
- The target SDD directory cannot be created or written.

## Common Mistakes

| Mistake | Required behavior |
| --- | --- |
| Editing dossier entries while designing | Delegate discovery and every `prd.md §9` update to `platty-mcp-impact-analysis`. |
| Treating empty output as no impact | Keep `unknown` and record the evidence gap. |
| Hiding AS-IS only in the evidence appendix | Synthesize the confirmed affected boundary and current critical flow in design §3; keep source proof in Appendix A. |
| Describing AS-IS and TO-BE without lifecycle classification | Add every affected surface exactly once to §5 as `NEW`, `MODIFY`, `REUSE`, `NO-CHANGE`, `DEPRECATE`, `DELETE`, or `UNKNOWN`, and connect it to `CHG-*`. |
| Treating a shallow API inventory as an implementation contract | For `NEW` and `MODIFY`, separate current and target request/response/error, field semantics, permissions, consumers, compatibility, logic branches, and verification. |
| Deleting a surface before consumer convergence | Keep `DEPRECATE` or `UNKNOWN` until consumers, replacement, observation, removal order, and rollback are confirmed. |
| Leaving DB/data blank | Record `yes`, `no`, or `unknown`; when changed, include schema/index, readers/writers, migration, backfill, compatibility, validation, and rollback. When unchanged, state schema/write are unchanged. |
| Making tasks fill design gaps | Stop design readiness or create Evidence-Resolution. Tasks may expand approved §8–§10 but cannot invent contracts, targets, commands, or dependencies. |
| Claiming readiness without verification | Map every `CHG-*` row to at least one `VER-*` row and rerun Self Review. |
| Creating tasks before design approval | Stop after writing and verifying `system_design.md`; do not create or overwrite `tasks.md`. |
| Treating user approval as an override for a blocked design | Reject approval and resolve the blocking finding before presenting a new approval-eligible revision. |
| Treating a stale task plan as current | Compare design approval metadata and regenerate only after the revised design is approved. |
| Inventing task details from partial source parity or `partial-path` coverage | Set readiness to `partial`, preserve the gap and next exact read, and omit unsupported hard claims. |
| Grouping tasks only by data/backend/frontend layers | Inherit the approved design's outcome-oriented `SLICE-*` groups and place layer-specific work inside each slice. |
| Using a search-result line number as an edit instruction | Require repository, source commit, file, symbol, advisory line range, change intent, and bounded source evidence. Keep unverified locations as `candidate-target` and create Evidence-Resolution work first. |

## Verification

Use `references/pressure-scenarios.md` and
`references/design-review-rubric.md` when testing this skill.
