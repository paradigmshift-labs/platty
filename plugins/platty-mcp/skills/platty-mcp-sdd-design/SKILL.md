---
name: platty-mcp-sdd-design
description: Use when creating locally saved MCP-grounded SDD technical design and executable implementation plans from existing prd.md and user_stories.md.
---

# Platty MCP SDD Design

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.
Read `../using-platty-mcp/references/sdd-question-ownership.md` before turning
any unresolved item into a user question.

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
3. Apply the shared question-ownership contract: retrieval owns `FACT`, SDD
   spec owns `PRODUCT`, and this skill owns `DESIGN`.

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

## Technical Design Kickoff

Start technical design with a bounded kickoff before broad or deep source
descent. This is the first design-stage interaction, not final design approval.
Build `technicalKickoffPacket` from every `productDesignHandoffs` (`DH-*`), any
still-visible product constraint, and the existing PRD §9 evidence boundary.
Classify each item into exactly one bucket:

- `autoDecisions`: reversible implementation choices that preserve the approved
  user result. State the recommended answer at kickoff and close it as `DEC-*`
  once the named bounded source read confirms compatibility; do not ask the
  product approver to choose.
- `evidenceResolutionItems`: current-system facts that need a named bounded read.
  State what the agent will verify and which design decision it blocks; do not
  ask a person to guess.
- `technicalOwnerQuestions`: only choices that meet the material cost/operations,
  security/privacy, data-loss, irreversible-migration, or product-feasibility
  exception. Name the decision owner, recommendation, trade-off, and affected
  product result.

If `technicalOwnerQuestions` is non-empty, present one consolidated kickoff
decision sheet and stop for a later answer. It may contain multiple `TQ-*` rows
because its purpose is to answer all carried-over design decisions before deep
design begins. Record those answers in the packet before continuing. If the
bucket is empty, show the auto-decisions and evidence plan briefly and proceed
without manufacturing a question.

Do not ask new technical-owner questions mid-design. If later evidence creates
a genuinely new exception-qualified decision, stop the revision and issue a new
kickoff decision sheet; if it changes a visible result, route feasibility
feedback to SDD spec instead. Final design approval is separate from kickoff:
it occurs only after `system_design.md` is persisted, read back, and presented
with its current `designRevision`.

## Operating Flow

1. Confirm MCP tools, project context, and context freshness.
2. Read the selected local `prd.md` (including §9) and `user_stories.md`.
   Confirm both artifacts belong to the selected project and spec.
   Use the shared executable helper
   `../using-platty-mcp/scripts/sdd-artifacts.mjs` (resolved relative to this skill)
   for all input identity values: parse the persisted inputs with
   `parseSddArtifact`, then call `computeRequestRevision`,
   `computeStoriesRevision`, and `computeProductInputFingerprint`. Later design
   approval must call `computeDesignRevision` from the same helper. Do not reimplement
   these algorithms, call `trim`/`trimStart`, strip the first body
   newline, or otherwise normalize artifact bodies outside the helper.
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
   Parse every PRD `DH-*` row into `productDesignHandoffs`. Preserve its
   invariant user result and product ids; do not turn its implementation choice
   back into an `O-*` question.
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
   sufficient. Before broad or deep source descent, build the Technical Design
   Kickoff packet. Present one consolidated kickoff decision sheet only when its
   `technicalOwnerQuestions` bucket is non-empty; otherwise record the proposed
   auto-decisions and bounded evidence-resolution plan and continue.
5. After impact analysis returns, reread `prd.md`. Keep impact status,
   `impactRevision`, the sorted matrix `evidenceId` snapshot, source parity,
   commits, traversal status, and `impactCoverageLimits` in the working packet
   and the final appendix. Never expose that operational log in frontmatter or
   edit an Impact Dossier entry from this skill.
6. Before drafting, update the kickoff `technicalDecisionPacket` from every `DH-*`,
   evidence gap, and proposed TO-BE choice. Classify each unresolved item using
   the shared question-ownership contract. Resolve source-checkable `FACT`
   items through the existing impact and bounded-read gates. For each reversible
   `DESIGN` item whose alternatives preserve the approved user result, inspect
   the owning source boundary, choose the safest compatible option, and record
   it as `DEC-*` with rationale, evidence, affected ids, risk, and revisit
   condition. Do not ask the product approver to choose an API, DTO, table,
   column, query, ordering implementation, tie-breaker, cache, component, file,
   test, deployment sequence, or rollback mechanism.

   A technical-owner question is allowed only when evidence cannot close a
   choice that materially changes cost or operational responsibility, security
   or privacy, data loss, irreversible migration, or the approved product
   result. Record why that owner is required. If the answer changes the visible
   result, scope, rule, AC, or success judgment, emit feasibility feedback to
   SDD spec instead of creating a technical `TQ-*`. A source gap remains an
   Evidence-Resolution row and bounded read, not a question asking a
   non-developer to guess current behavior.
7. Derive evidence-backed AS-IS facts and system TO-BE decisions from request,
   stories, and impact. Use the dossier's `document_resolve` links to connect
   product documents to selected specs, and use its `graph_trace` result as a
   fast `screen ↔ API ↔ domain ↔ DB` path map. For every hard implementation
   claim, require the dossier's matching `confirmed-path` coverage row: the
   entry/caller, orchestration, persistence or external boundary, consumers,
   and adjacent tests/configuration/migrations when present must have exact
   source reads. `partial-path` evidence becomes a risk or an Evidence-Resolution
   row in `system_design.md` §11, never a confirmed system fact or an executable checklist item.
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
   Before readiness, fill Appendix A-10 from bounded evidence: checkout HEAD
   equality, every API request/response/error field and value origin, exhaustive
   source-state disposition, frontend server/client/API/type/test topology, and
   command preflight receipts. In a writable compatible checkout, execute the
   command and record `PASS` or feature-missing `EXPECTED_RED`. When the selected
   MCP source tool is contractually read-only, `SOURCE_CONFIRMED` is allowed only
   after exact wrapper/build script, module, runner configuration, selector,
   adjacent test, and matched 40-character source commit are read from source;
   execution is then mandatory in the generated task Execution Preflight before
   any implementation edit. A plausible command or package script name alone is
   not source confirmation. A `confirmed-path` label without those
   rows is not implementation evidence.
   Before drafting TO-BE contracts, run a product-feasibility reconciliation:
   compare every promised user result with fields, attribution, state coverage,
   existing surfaces, and the approved no-change/no-write boundaries. For every
   promised `WHEN`, universal quantifier, rate, and `H-*` denominator, enumerate
   the source eligibility gates, intentional suppression/skip paths, and approved
   exclusions. Require `promised trigger set = source eligible set - approved
   exclusions`; a metric name or happy-path event is not proof of set equality.
   For every user-visible reason, message, label, status copy, or notification
   value, enumerate every control-flow branch in A-10-2. Every branch must derive
   only from an exact safe mapping, approved constant, or sanitization rule. A
   safe fallback does not make the non-null or success branch safe; direct raw,
   provider, exception, or original message exposure contradicts an approved
   safe-mapping promise and blocks readiness.
   If source
   evidence disproves a product premise or satisfying it requires work forbidden
   by the approved scope, emit a feasibility-feedback packet with the affected
   `R-*`/`AC-*`/`D-*`/`H-*` and story/scenario ids, the disproving source fact,
   and the recommended product trade-off. Invoke `platty-mcp-sdd-spec` to revise
   the pair, reset both product inputs to draft, and stop this design revision.
   Do not hide a changed user promise as a technical limitation, invent a field,
   or create tasks from the stale approval.
8. Draft `system_design.md` from `references/system-design-shape.md`.
9. Persist and read back `system_design.md`, then report its path for user review.
10. If Self Review is not `PASS / ready`, reject final approval and stop without
   creating or overwriting `tasks.md`; record every Evidence-Resolution item in
   `system_design.md` §11, refresh evidence, and create a new design revision.
11. If the current design is not explicitly approved, stop without creating or
   overwriting `tasks.md`.
12. On explicit approval, reread `system_design.md`, `prd.md`, and `user_stories.md`.
    Recompute both product input revisions and `productInputFingerprint`; reject
    approval when either status is not approved or any stored input value differs.
    Otherwise persist and read back `approvedRevision`, `approvedAt`, and
    `approvedBy` for the current design revision.
13. During task preflight, reread all three inputs, recompute
    `productInputFingerprint`, then recheck impact status, source parity, source
    commits, context status, and evidence boundary. Recompute
    `evidenceFingerprint`.
14. If either product-input status is not approved, stop, keep any existing
    `tasks.md` stale, and do not create a design revision unless the user later
    makes an explicit draft-only design request.
15. If both product inputs remain approved and a product-input revision changed,
    its fingerprint changes; create and verify a new unapproved design revision
    and stop without creating tasks. Apply the same transition for an evidence
    fingerprint change.
16. Otherwise draft `tasks.md` from `references/tasks-shape.md` as
    `schemaVersion: sdd-tasks.v4`, `designSchemaVersion: sdd-design.v2`,
    `planKind: implementation-checklist`, and
    `executionReadiness: ready`. Copy only the minimal revision/fingerprint
    metadata defined by the template. Project the design's outcome slices into
    a standalone module execution table and numbered backend/API, DB/data,
    frontend/screen, job/event/external, integration/release sections. Every
    implementation action is a checkbox with `Create:`, `Modify:`, or `Delete:`,
    an exact path, symbol/signature, behavior, failure handling, and verification.
    Repeat the minimum approved API request/response/error schema and state/query
    invariant required to implement without reopening `system_design.md`.
    Record a non-applicable category once as `N/A` with its reason instead of
    creating an empty checklist. Include the four-artifact Execution Preflight and a module-local
    RED/GREEN/regression verification loop with either an existing test symbol
    or an approved new test target under a confirmed parent, plus an exact test
    command preflight. Copy every `SOURCE_CONFIRMED` command into §1 as a
    before-edit execution checkbox that records `PASS` or feature-missing
    `EXPECTED_RED`. `EXPECTED_RED` is valid only when the runner
    starts and missing behavior, an assertion, or the approved-new test target
    explains the nonzero exit; runtime, package-manager, dependency, permission,
    network, workspace, or module-resolution failures remain blockers. The §0
    module table defines actual execution order and maps every row to one numbered section.
    Keep each change as a small executable sequence with an exact file path and
    symbol: RED with its expected failure, minimal implementation, GREEN using
    the same focused command, adjacent regression, self-review for spec coverage
    and contract consistency, then a commit checkpoint. A checkpoint records the
    intended coherent commit boundary; it does not authorize a commit by itself.
17. Persist and read back `tasks.md`; verify its metadata matches the current
    approved design, then run the rubric's post-task structural audit. Check
    every §0 module row maps to one numbered section; every changed section has
    checkboxes, confirmed exact file actions, symbol/signature, full source
    commit, applicable schema/state behavior, and exact test commands; and
    non-applicable categories are `N/A` with a reason rather than empty sections.
    Require task `designRevision`, `approvedRevision`, product-input fingerprint,
    and evidence fingerprint to match the current design; require every design
    `CHG-*` and `VER-*` in at least one complete module checklist containing behavior,
    failure handling, RED/GREEN, regression, and completion checks.
    The validator must recompute the canonical product-input fingerprint and
    `designRevision` from the persisted design rather than comparing stored
    strings only.
    Run `scripts/readiness-validator.mjs` against the persisted design and task
    artifact. Any score below 95 or any critical finding makes task generation
    incomplete even when prose Self Review says `PASS / ready`.
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
- Reject approval and do not create or overwrite `tasks.md` unless Self Review is
  exactly `PASS / ready`.
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
- productDesignHandoffs
- technicalKickoffPacket
- autoDecisions
- evidenceResolutionItems
- technicalDecisionPacket
- technicalOwnerQuestions
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

Preserve product and technical ownership: `D-*`, `O-*`, and `DH-*` come from
the PRD and must not be renumbered or reclassified by design. Each `DH-*` must
end as a source-grounded `DEC-*`, a bounded Evidence-Resolution row, or an
owner-qualified `TQ-*`. Reversible choices that preserve the approved user
result normally become `DEC-*` without a user question. `DEC-*` is only a
confirmed technical decision or explicit bounded risk acceptance; `TQ-*` is a
new technical question that satisfies the technical-owner exception. A product
`O-*` whose answer changes scope, rules,
acceptance criteria, or success judgment returns to product revision, impact,
and approval instead of being closed by a design `DEC-*`.

When screen or API evidence exists, Appendix A must preserve implementation
handoff detail: screen route/entry, component/file/symbol, role, displayed
state, actions/navigation, connected APIs/events; and API method/path,
controller/handler, service/use case, persistence/external boundary,
request/response/error, permissions/consumers. Include only exact spec/source
reads as confirmed. Candidate or partial evidence stays explicitly marked and
becomes an Evidence-Resolution row in `system_design.md` §11 when required for
implementation.

Before task generation, derive stable `SLICE-*` groups in design §8. A slice
is an independently reviewable user outcome, not a generic technical layer.
Shared contracts, migrations, or permissions may be a prerequisite slice when
several outcomes depend on them. Every `CHG-*` has one primary slice and every
slice maps to its screens, contracts/data, `VER-*`, dependencies, parallelism,
and release boundary.

In `tasks.md`, begin with one module execution table, then use numbered module
sections. A developer must see, in order, which repository and file changes,
which symbols/signatures and schemas to implement, how state/data changes, how
failures behave, and which exact RED/GREEN/regression commands prove completion.
Keep `SLICE-*`, `CHG-*`, `VER-*`, `EDIT-*`, and `NOEDIT-*` in a short evidence line
at the end of the applicable module; never make the reader decode IDs to learn
what to implement. Candidate targets never enter `tasks.md`. An open product
`O-*` or technical `TQ-*` that can change the result remains in design §11 and
blocks task creation.

Any open `O-*`/`TQ-*` decision that changes the result blocks task creation;
do not create or overwrite `tasks.md` until a new ready design resolves them.

Review macro-first. Before chasing file-level completeness, make one explicit
pass over actors and outcomes, end-to-end screen/API/data flows, system and data
ownership, permissions/PII, failure isolation, dependencies, release,
observability, and rollback. Only then perform bounded source reads for a named
decision that blocks one concrete contract or task. Reuse already resolved
evidence; do not reread the whole source tree to increase confidence. After one
independent semantic review, loop again only for a new P0/P1/P2 finding and stop
when none remain.

For each changed screen, specify applicable loading, success, empty, forbidden,
error, and partial-failure states. For each changed synchronous contract,
separate AS-IS and TO-BE request, response, errors, permissions, consumers, and
compatibility; include field meaning and derivation, not names alone. For each
paginated contract, specify pagination strategy, deterministic total order,
unique tie-breaker, page/cursor semantics, and exact `hasNext` derivation; an
offset or cursor without stable ordering blocks readiness. For each
event/job, specify producer, condition, payload/schema, consumers, ordering,
duplication, retry, PII, and observation. For each DB change, specify schema and
index changes, readers/writers, migration, backfill, old/new compatibility,
deployment order, validation, and rollback or roll-forward-only behavior. A
schema-preserving change says explicitly that schema and writes remain unchanged.

Every response field and user-visible message value also needs a value-capability
proof. Distinguish stored facts, deterministic derivations, constants, and
unavailable attribution. Identifier names such as `errorMessage`, `reason`,
`description`, or `label` do not prove that content is safe, user-language, or
stable; require an exact mapping, constant, sanitization rule, or formula. A
boolean or timestamp does not prove actor, cause, policy eligibility, or planned
execution time. Remove an unavailable field or revise the product/data design;
never turn it into a derived field by naming it. Enumerate every source enum or
status value and place it exactly once in mapped or excluded disposition. For
every mapped value, name the exact declared response/UI disposition that receives
it; a partition without target-bucket assignments does not make a funnel
implementable. Require this source-to-target map before claiming funnel totals,
exhaustive classification, or readiness.

Before task generation, require design §8 to contain one vertical packet per
outcome-oriented `SLICE-*`, connecting product ids, AS-IS gap, TO-BE `CHG-*`,
surfaces, edit/protected/candidate boundaries, implementation order, exceptions,
verification, parallelism, release, and rollback. Design §10 owns the verification
contract. `tasks.md` may expand these packets into executable cards but must not
invent a contract, decision, location, command, or dependency absent from the
approved design.

Every `CHG-*` must be Primary in exactly one `SLICE-*`, and every `VER-*` must
belong to at least one slice. A slice with a predecessor cannot be labeled
independent. Shared prerequisites either belong to one explicit owning slice or
to a bounded `SLICE-00`; related-only references do not establish ownership.

Use `EDIT-*` for executable edit targets, `CAND-*` for design-only candidates,
and `NOEDIT-*` for protected boundaries. Every `edit-target` requires `repo + full
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
`productInputFingerprint` through the shared `sdd-artifacts.mjs` functions, and
require all stored values to match. Both product
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

The kickoff response and the final design approval are separate interactions.
Kickoff answers authorize only the recorded design decisions; they never count
as prospective, blanket, or same-request approval of the later design revision.

A draft-only design derived from an unapproved request or stories file is not
approval-eligible. After both product inputs become approved, reread them,
compute a new `productInputFingerprint`, generate a new design revision, and
present that revision separately for approval.

Self Review semantics are strict:

- `ready` is approval-eligible when it has no blocking findings.
- `partial` is a reviewable design draft but is not final approval-eligible and
  never creates or overwrites `tasks.md`. Preserve each exact gap and next bounded
  read as Evidence-Resolution in `system_design.md` §11, resolve it through the
  impact owner, and create a new design revision.
- `blocked` requires `NEEDS_WORK` and is not approval-eligible.
- `NEEDS_WORK` blocks approval. A user approval message cannot override it.

Refresh MCP evidence or create a new design revision until Self Review is an
approval-eligible `ready`, then present that revision for approval.

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

Assign task artifact readiness deterministically:

| Condition | Readiness | Required behavior |
| --- | --- | --- |
| Design is not approved | no task artifact | Stop after verified `system_design.md`; do not create or overwrite `tasks.md`. |
| Design Self Review is `blocked` or `NEEDS_WORK` | no task artifact | Reject approval and resolve the blocking finding through MCP evidence or a revised design. |
| Design Self Review is `partial` or any candidate-only target remains | no task artifact | Preserve the exact gap and next bounded read in `system_design.md` §11; do not create or overwrite `tasks.md`. |
| Any result-changing open `O-*`/`TQ-*` remains | no task artifact | Resolve the product or technical decision, create a new design revision, and rerun Self Review. |
| Any command preflight, existing or approved-new test target, API path, or screen route is missing | no task artifact | Resolve the missing source fact in design §11; do not create or overwrite `tasks.md`. |
| Design is approved, `PASS / ready`, Appendix A-10 validates at 95+ with zero critical findings, and every implementation claim is evidence-backed | `ready` | Persist the `sdd-tasks.v4` standalone implementation checklist. |
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
Only PASS / ready design revisions are approval-eligible for task generation.
Partial, blocked, or NEEDS_WORK design revisions never create or overwrite tasks.md.
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
<not-created | stale | ready, with the exact reason>

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
- Bounded source evidence disproves an approved product premise or requires a
  write/policy/surface excluded by the approved scope; return through
  `platty-mcp-sdd-spec`, reset both product inputs to draft, and wait for explicit
  reapproval before a ready design or tasks.
- Self Review is not `PASS / ready`; reject final approval, preserve the exact
  Evidence-Resolution rows in design §11, and resolve them before task creation.
- Task generation is requested while the current design is not explicitly
  approved with matching revision and approval metadata.
- A task preflight product-input status is not approved; stop without creating a
  design revision or executing tasks.
- Both product inputs remain approved but recomputed product-input, design, or
  evidence hashes do not match the approved metadata; create a new unapproved
  design revision and stop before task generation.
- A shared engine contract, persisted schema, public CLI behavior, or common
  resolver semantic change is required without explicit approval.
- Appendix A-10 is missing/incomplete, analyzed commit differs from checkout
  HEAD, a field is unavailable, source-state coverage is not exhaustive, a
  changed screen lacks complete topology, or a command was not actually probed.
- The target SDD directory cannot be created or written.

## Common Mistakes

| Mistake | Required behavior |
| --- | --- |
| Editing dossier entries while designing | Delegate discovery and every `prd.md §9` update to `platty-mcp-impact-analysis`. |
| Asking a non-developer to choose an API, table, query, tie-breaker, component, or test | Preserve the approved user result, read the owning source boundary, and close the reversible choice as `DEC-*`; use `TQ-*` only for the bounded technical-owner exceptions. |
| Treating empty output as no impact | Keep `unknown` and record the evidence gap. |
| Hiding AS-IS only in the evidence appendix | Synthesize the confirmed affected boundary and current critical flow in design §3; keep source proof in Appendix A. |
| Describing AS-IS and TO-BE without lifecycle classification | Add every affected surface exactly once to §5 as `NEW`, `MODIFY`, `REUSE`, `NO-CHANGE`, `DEPRECATE`, `DELETE`, or `UNKNOWN`, and connect it to `CHG-*`. |
| Treating a shallow API inventory as an implementation contract | For `NEW` and `MODIFY`, separate current and target request/response/error, field semantics, permissions, consumers, compatibility, logic branches, and verification. |
| Treating a named field as proof it can be produced | Record stored/derived/constant/unavailable origin and exact source or formula; unavailable attribution blocks readiness. |
| Showing only happy-path enum examples | Enumerate the full source symbol and map or exclude every value exactly once; catch-all prose is not exhaustive coverage. |
| Calling a plausible command confirmed | Record cwd, exact command, observed time, exit, result, and output evidence; wrong runner/workspace failures do not pass. |
| Deleting a surface before consumer convergence | Keep `DEPRECATE` or `UNKNOWN` until consumers, replacement, observation, removal order, and rollback are confirmed. |
| Leaving DB/data blank | Record `yes`, `no`, or `unknown`; when changed, include schema/index, readers/writers, migration, backfill, compatibility, validation, and rollback. When unchanged, state schema/write are unchanged. |
| Making tasks fill design gaps | Keep Evidence-Resolution in `system_design.md` §11. Tasks may expand approved §8–§10 but cannot contain research work or invent contracts, targets, commands, or dependencies. |
| Claiming readiness without verification | Map every `CHG-*` row to at least one `VER-*` row and rerun Self Review. |
| Creating tasks before design approval | Stop after writing and verifying `system_design.md`; do not create or overwrite `tasks.md`. |
| Treating user approval as an override for a blocked design | Reject approval and resolve the blocking finding before presenting a new approval-eligible revision. |
| Treating a stale task plan as current | Compare design approval metadata and regenerate only after the revised design is approved. |
| Reimplementing artifact hashes or trimming parsed bodies | Use `sdd-artifacts.mjs` for parsing and every request, stories, product-input, and design revision value; a mismatch creates a new unapproved revision. |
| Inventing task details from partial source parity or `partial-path` coverage | Do not create or overwrite `tasks.md`; preserve the gap and next exact read in design §11 and create a new revision after confirmation. |
| Weakening a promised user result only in design | Send feasibility feedback to `platty-mcp-sdd-spec`; revise and reapprove the affected product rules and stories before continuing. |
| Grouping tasks only by data/backend/frontend layers | Inherit the approved design's outcome-oriented `SLICE-*` groups and place layer-specific work inside each slice. |
| Using a search-result line number as an edit instruction | Require repository, source commit, file, symbol, advisory line range, change intent, and bounded source evidence. Keep unverified locations as `candidate-target` and create Evidence-Resolution work first. |

## Verification

Use `references/pressure-scenarios.md` and
`references/design-review-rubric.md` when testing this skill.
Run the deterministic contract tests before deployment:

```bash
node --test agent-marketplace/plugins/platty-mcp/skills/platty-mcp-sdd-design/scripts/__tests__/readiness-validator.test.mjs
```
