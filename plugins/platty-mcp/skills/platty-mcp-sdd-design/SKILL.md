---
name: platty-mcp-sdd-design
description: Use when creating locally saved MCP-grounded SDD technical design and implementation-task drafts from existing request.md, stories.md, and impact.md.
---

# Platty MCP SDD Design

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Create an evidence-gated system design from the approved product inputs and the
persisted Impact Dossier. The design owns system boundaries, technical decisions,
and the canonical change map; impact analysis owns impact discovery and
`impact.md`.
Use `references/design-shape.md` for the design and
`references/tasks-shape.md` for the approval-gated task plan.

All reader-facing output is Korean. Keep code identifiers, API paths, file
paths, status values, and quoted evidence in their original form.

## Required Sub-Skills

1. Use `using-platty-mcp` for MCP capability and project context.
2. Use `platty-mcp-impact-analysis` for impact, graph, cross-EPIC, repository,
   and source convergence. It invokes `platty-mcp-retrieval` with `routeMode:
   seed-only` when a packet is missing, then owns dossier-entry changes. In SDD
   context it alone writes or refreshes only `impact.md`. Do not invoke retrieval
   directly for that path.

## Inputs

- Platty project context.
- SDD directory id or spec slug containing `request.md`, `stories.md`, and an
  existing or refreshable `impact.md`.
- Optional target repo, API, screen, table, event, or job areas.

## Operating Flow

1. Confirm MCP tools, project context, and context freshness.
2. Read the selected local `request.md`, `stories.md`, and `impact.md` when it
   exists. Confirm all artifacts belong to the selected project and spec.
   Build `productInputMetadata` from their persisted metadata: validate canonical
   product metadata directly; adapt legacy product metadata only in this input
   packet and retain its source form. Never rewrite `request.md` or `stories.md`
   merely to migrate legacy metadata. The reader mapping is exact:
   `spec-request -> sdd-request`, `spec-stories -> sdd-stories`, and
   `derived_from -> derivedFrom`. Apply aliases only in `productInputMetadata`;
   preserve both input files byte-for-byte and hash their original persisted
   content. When both canonical and legacy keys exist, both must have the same normalized value;
   then use the canonical key in `productInputMetadata`. A conflicting pair
   is a `NEEDS_WORK` input conflict; stop without choosing a value or rewriting
   either file. Compute `requestRevision` and
   `storiesRevision` from the complete persisted files, then compute the
   canonical `productInputFingerprint` from both revisions and statuses.
3. Stop unless request/story inputs are approved, unless the user explicitly
   asks for draft-only technical design. A draft-only design remains
   `NEEDS_WORK`, is not approval-eligible, and must be regenerated as a new
   design revision after both product inputs become approved.
4. Read `impact.md` first and inspect its Impact Dossier metadata before making
   a hard implementation claim. Optionally invoke `platty-mcp-impact-analysis`
   only when it is missing, `seeded`, stale, source-commit-mismatched, or
   `partial` in a required area of the request or stories. Record the observed
   refresh condition and its affected evidence id or coverage limit before
   invoking; must not always rerun impact when the existing dossier is sufficient.
5. After impact analysis returns, reread `impact.md`. Record impact status,
   `impactRevision`, the sorted matrix `evidenceId` snapshot, source parity,
   commits, traversal status, and `impactCoverageLimits`. Never edit an Impact
   Dossier entry from this skill.
6. Derive evidence-backed AS-IS facts and system TO-BE decisions from request,
   stories, and impact. Use the dossier's `document_resolve` links to connect
   product documents to selected specs, and use its `graph_trace` result as a
   fast `screen ↔ API ↔ domain ↔ DB` path map. For every hard implementation
   claim, require the dossier's matching `confirmed-path` coverage row: the
   entry/caller, orchestration, persistence or external boundary, consumers,
   and adjacent tests/configuration/migrations when present must have exact
   source reads. `partial-path` evidence becomes a risk or an
   Evidence-Resolution task, never a confirmed system fact.
7. Draft `design.md` from `references/design-shape.md`.
8. Persist and read back `design.md`, then report its path for user review.
9. If Self Review is `blocked` or `NEEDS_WORK`, reject approval and stop without
   creating or overwriting `tasks.md`; refresh evidence or revise the design.
10. If the current design is not explicitly approved, stop without creating or
   overwriting `tasks.md`.
11. On explicit approval, reread `design.md`, `request.md`, and `stories.md`.
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
    `executionReadiness` as `partial` or `ready`, and copy revision, approval,
    and evidence metadata.
16. Persist and read back `tasks.md`; verify its metadata matches the current
    approved design.

## Impact Ownership And Refresh Gate

SDD design must not format or write impact.md.

Delegate every missing, seeded, stale, source-commit-mismatched, or
required-area partial dossier refresh to `platty-mcp-impact-analysis`. That
sub-skill may update dossier entries and write `impact.md`; this skill only
consumes the returned artifact. Read `impact.md` first; optionally invoke the
impact skill only for those refresh conditions. Record the observed refresh
condition and its affected evidence id or coverage limit before invoking.
Persist that record as the `design.md` frontmatter `impactRefreshReason` (use
`condition: not-needed` with empty lists when no refresh ran); it participates in
`evidenceFingerprint`, so changing it creates a new unapproved design revision.
Do not always rerun impact.
Do not copy its Impact Evidence Matrix or search transcript into `design.md`.
Show only the compact path map needed for implementation, reference dossier
evidence ids, and link to `impact.md` for detailed evidence.

Hard implementation claims require the relevant bounded evidence and source
parity plus `confirmed-path` coverage. `document_resolve` selects connected
document context; `graph_trace` accelerates path discovery; `code_search` finds
exact source candidates; and `readonly_workspace_shell` reads the bounded
source. Graph output does not prove writes, permissions, contracts,
transactions, retries, or absence. Empty graph/search results are not proof of
no impact. A candidate-only or `partial-path` result is not a confirmed claim.

## Local SDD File Access

This is the only local file exception in the MCP SDD design route. Read only the
selected `request.md`, `stories.md`, and `impact.md`, then write only the design
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
- `platty-mcp-impact-analysis` owns every `impact.md` write and dossier edit.
- Write `designMarkdown` to `design.md`.
- Read `design.md` back and verify its project/evidence metadata.
- Reject approval and do not create or overwrite `tasks.md` while Self Review is
  `blocked` or `NEEDS_WORK`.
- Do not create or overwrite `tasks.md` before explicit design approval.
- After approval, write `tasksMarkdown` to `tasks.md` and read it back.
- If task write/read-back fails, report task generation as incomplete, include
  the exact failed path, and state that the verified `design.md` remains valid.

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
the risk is accepted by a separately confirmed `D-NN` decision with owner,
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
- storiesRevision
- productInputFingerprint
- outputLanguage
- contextStatus
- evidenceBoundary
- productInputMetadata
- impactArtifact
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
- designApprovedAt
- designApprovedBy
- localPersistenceTarget
```

## Revision And Approval Contract

Apply the canonical hashing and frontmatter rules in `design-shape.md`. A new or
revised design has `status: draft`; `approvedRevision`, `approvedAt`, and
`approvedBy` are empty.

Explicit approval must reread `design.md`, `request.md`, and `stories.md`, verify
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

`design.md` is created first. Persist it, read it back, and ask the user to
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
`productInputFingerprint`, `designApprovedAt`, and `designApprovedBy` into the
task artifact.

Assign `executionReadiness` deterministically:

| Condition | Readiness | Required behavior |
| --- | --- | --- |
| Design is not approved | no task artifact | Stop after verified `design.md`; do not create or overwrite `tasks.md`. |
| Design Self Review is `blocked` or `NEEDS_WORK` | no task artifact | Reject approval and resolve the blocking finding through MCP evidence or a revised design. |
| Design is approved and only a task-level evidence-resolution gap remains | `partial` | Preserve the exact gap and next read; do not invent implementation detail. |
| Design is approved and every required implementation claim is evidence-backed | `ready` | Persist the execution-ready TDD plan. |
| Design approval metadata no longer matches tasks | stale existing task | Block execution until the revised design is approved and tasks are regenerated. |
| Either product input status is not approved | stale existing task | Stop execution; do not create a design revision unless the user later requests an explicit draft-only design. |
| Product input fingerprint changes after approval | no new task artifact | Create a new unapproved design revision from the current approved request and stories, then stop for reapproval. |
| Evidence fingerprint changes after approval | no new task artifact | Create a new unapproved design revision and stop for reapproval. |

If `tasks.md` cannot be written and read back after approval, report task
generation as incomplete. The already verified `design.md` remains available
for review.

Recompute the canonical product-input, design, and evidence hashes during every task preflight;
do not trust stored hash fields without recomputation. If the approved design is
changed or revised, the existing `tasks.md` is stale until reapproval and
regeneration.

Before executing any existing `tasks.md`, the executor must run the task
artifact's Execution Preflight, reread all five SDD artifacts, and recompute
`productInputFingerprint`, `evidenceFingerprint`, and revision/approval equality.
Generation-time checks do not authorize later execution. If either product-input
status is not approved, stop and keep tasks stale without creating a design.
When both product inputs remain approved, a revision or fingerprint mismatch
blocks execution and returns to a new unapproved design revision.

## Approval Invariants

```text
design.md is created and verified before tasks.md.
Blocked or NEEDS_WORK design revisions are not approval-eligible and never create or overwrite tasks.md.
Do not create or overwrite `tasks.md` until the current design is explicitly approved.
Current designRevision, approvedRevision, and tasks.md designRevision must match.
Current productInputFingerprint must match design.md and tasks.md.
Changed post-approval evidence creates a new unapproved design revision before tasks.
If the approved design changes, the existing tasks.md is stale until reapproval and regeneration.
```

## Answer Contract

```text
## design.md draft
<full markdown>

## Self Review
<verdict, readiness, blockers, warnings, and coverage>

## tasks.md draft
<full markdown; emitted only after current design approval>

## tasks.md readiness
<partial | ready, with the exact evidence reason>

## Local persistence
Design saved and verified first:
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/design.md

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
| Editing dossier entries while designing | Delegate discovery and every `impact.md` update to `platty-mcp-impact-analysis`. |
| Treating empty output as no impact | Keep `unknown` and record the evidence gap. |
| Describing AS-IS and TO-BE without a change id | Add exactly one canonical `CHG-*` row for each applicable delta. |
| Leaving DB/data blank | Record `yes`, `no`, or `unknown`; add detailed DB design only when applicable. |
| Claiming readiness without verification | Map every `CHG-*` row to at least one `VER-*` row and rerun Self Review. |
| Creating tasks before design approval | Stop after writing and verifying `design.md`; do not create or overwrite `tasks.md`. |
| Treating user approval as an override for a blocked design | Reject approval and resolve the blocking finding before presenting a new approval-eligible revision. |
| Treating a stale task plan as current | Compare design approval metadata and regenerate only after the revised design is approved. |
| Inventing task details from partial source parity or `partial-path` coverage | Set readiness to `partial`, preserve the gap and next exact read, and omit unsupported hard claims. |

## Verification

Use `references/pressure-scenarios.md` and
`references/design-review-rubric.md` when testing this skill.
