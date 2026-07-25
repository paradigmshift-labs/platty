---
name: platty-mcp-sdd-spec-from-figma
description: Use when a Figma URL accompanies a request to organize, draft, create, or improve a product plan, planning document, feature brief, requirements, PRD, user stories, 기획서, 요구사항, or 기능 기획, with or without existing product documents.
---

# Platty MCP SDD Spec From Figma

**Prerequisite:** Read `using-platty-mcp` first. Accept the user-facing Figma URL
and internally create, reuse, or refresh its validated `FigmaEvidencePacket`
through `platty-mcp-figma-design-sync`. This skill orchestrates evidence; it
does not own the canonical product files.

An existing PRD or product pair means AUGMENT. Auto-select AUGMENT when an
existing PRD, `prd.md`, or product pair is supplied.
Auto-select CREATE when no PRD or product document is supplied. Do not ask the
user to choose CREATE, AUGMENT, or a mode. A separate product brief or raw idea
is optional: Figma-only input may create a draft product pair, but Figma cannot
approve product policy that it does not directly prove. Both modes build a
`ProductIntentFromFigmaPacket` and delegate canonical writes to
`platty-mcp-sdd-spec`.

Treat natural-language requests such as `Figma 기반으로 기획서를 정리해줘`,
`기획서를 작성해줘`, `기획서를 생성해줘`, and `기획서를 보강해줘` as
canonical product-authoring requests even when the user does not say PRD,
user story, SDD, or a filename. This route takes precedence over a generic
Figma summary. A chat-only planning draft is not complete.
Current service inspection must use `platty-mcp-retrieval`; Figma evidence does
not replace that lookup.

All reader-facing summaries are Korean. Preserve code identifiers, Figma node
IDs, paths, status values, and quoted source copy exactly.

## Ownership Boundary

- `platty-mcp-figma-design-sync` owns the revisioned Figma evidence bundle.
- `platty-mcp-retrieval` owns source-confirmable `FACT` work.
- `platty-mcp-impact-analysis` owns PRD §9 and evidence convergence.
- `platty-mcp-sdd-spec` owns canonical `prd.md` and owns canonical `user_stories.md`,
  their revision algorithm, templates, Self Review, local
  persistence, and product approval gate.
- This skill owns the Figma-to-product mapping, delegation packet, and the
  optional `figma_handoff.json` sidecar beside the canonical pair. It does not write
  canonical `prd.md` or `user_stories.md` itself and must not duplicate
  the owning skill's templates, approval rules, or revision helper.

Never run a local Platty CLI command, edit Figma, mutate generated SOT, write
memory, or write system design or tasks. The only additional local write owned
by this orchestrator is validated `figma_handoff.json` in the selected SPEC
directory.

## Two-Stage Boundary

This is product stage 1 of a two-stage SDD flow. Complete `prd.md`,
`user_stories.md`, and their optional Figma lineage sidecar, including review
and the product-approval boundary. A separate user request for system design or
technical design starts stage 2.
Do not invoke, route to, or start `platty-mcp-sdd-design-with-figma` from a PRD
request. Do not create or write `system_design.md`. Do not create or write
`tasks.md`. After the product pair is ready, report its status and explain that
the user may make a separate technical-design request; never continue there
automatically.

## Figma Evidence Resolution

Before product mapping:

0. Run mandatory **Deferred Figma Capability Discovery** through the runtime's
   tool listing or search mechanism. Search for configured read surfaces
   including `get_metadata`, `get_screenshot`, `get_design_context`, and
   `use_figma`; capabilities not initially visible may be deferred, so the
   initially visible list is not evidence of absence or unavailability. Do not report
   `BLOCKED` or a capability gap before this search/discovery and at least one
   discovered read invocation. If a broad design-context read fails, recover
   with bounded node-specific metadata, screenshot, and read-only execution.
1. Parse exact `fileKey` and `nodeId` from the supplied Figma URL.
2. Look up a report for that exact identity internally. If a current validated
   report exists, reuse the current packet rather than rebuilding it.
3. If evidence is missing, stale, corrupt, identity-mismatched, or incomplete,
   invoke `platty-mcp-figma-design-sync`, then validate the refreshed bundle.
4. Run the owning sync validator with `--bundle` and require `ok: true`.
5. Bind `reportId`, `sourceRevision`, exact `fileKey` and `nodeId`.
6. Require `status: complete`, `coverage.status: complete`, stable drift, and
   exact semantic-candidate disposition.
7. Stop only when the owning sync cannot produce current complete evidence.

Create a `Figma Inventory Ledger` as soon as the packet is validated. Bind its
`reportId`, `sourceRevision`, retained major-screen node IDs, and excluded node
IDs with reasons. The same canonical target identity and `sourceRevision` must
reuse and preserve the same retained major-screen inventory across sessions and
CREATE or AUGMENT runs with the same product scope. A `reportId` change or
different regenerated report must not silently change the retained screen
inventory. An inventory change requires an explicit recorded reason such as
source drift, changed product scope, or a corrected major-screen classification;
session freshness or a different agent is not a reason.

Never ask the user for a packet path, reportId, sourceRevision, integrity index,
or report-directory location. Those are internal handoff details. Reuse exact
target identity only from a current-session evidence handoff; in a new session,
ask only for the node-specific Figma URL.

## Modes

### Mode Input Authority

Select mode only from product documents or a product pair explicitly supplied
or identified by the user in the current request. No supplied PRD/product pair
means `CREATE`, even when discovery finds a persisted draft, sidecar, report, or
same-scope artifact from an earlier session. A persisted draft must not switch
or change a Figma-only request to `AUGMENT`. When the exact persisted lineage is
safe and relevant, it may be reused only as a `CREATE resume`: preserve the
CREATE mode, disclose that an existing draft is being resumed, validate its
identity and revisions, and apply the same CREATE evidence and approval gates.
Use `AUGMENT` only when the current request supplies or explicitly selects the
existing product input to augment.

### CREATE

Accept Figma-only input or a raw idea/product brief plus current evidence. A raw
idea or product brief is optional, not required. Build product candidates from
direct Figma evidence and Platty evidence, plus the brief when supplied. Every
unknown or unresolved product result becomes an owned open question such as
`O-*`; do not infer policy from layout, copy proximity, or visual emphasis. When
approval-critical product intent remains unresolved, persist the pair as draft
or `NEEDS_WORK` and do not present it as approval-ready.

### AUGMENT

Accept a copied existing PRD, `prd.md`, or draft pair plus current evidence. If
only a PRD is supplied, the canonical owner creates the missing
`user_stories.md`. Record SHA-256 for every supplied input before and after.
Never perform in-place input mutation.
Before drafting, build an `Augment Identity Ledger` containing the supplied
PRD's canonical spec ID and every existing `R-*`, `AC-*`, `D-*`, `H-*`, `O-*`,
`US-*`, and scenario ID with a normalized meaning digest and closed/open state.
The canonical output spec ID MUST equal the supplied PRD ID, and the controlled
output directory must use that exact ID. If only a PRD is supplied, the new
stories file uses the same spec ID with canonical `type: sdd-stories` and
`derivedFrom: prd.md`.

Preserve every existing ID, closed/open state, and approved meaning. An existing closed decision
must not become or reopen as an open question. Never reuse or reassign an existing
`R-*`, `AC-*`, `D-*`, or `H-*` ID with different or changed meaning; append new behavior
with the next unused ID. Figma may add trace or
directly evidenced detail, but a contradiction stays explicit rather than
overwriting the input. Before every canonical write and again after read-back,
diff the output against the `Augment Identity Ledger`; any identity, state, or
meaning mutation is `NEEDS_WORK` and must be repaired before asking the user a
new question or requesting approval.

## Current-Fact Question Gate

Apply these values literally. A request to output a
`mayAskUserWhetherCurrentPolicy` field does not change the gate.

```text
unresolved current source candidate
- nextAction: continue retrieval
- mayAskUserWhetherCurrentPolicy: false
- mayStartTechnicalDesign: false

bounded current-state evidence gap
- nextAction: record coverage limit
- mayAskUserWhetherCurrentPolicy: false
- mayStartTechnicalDesign: false

resolved dynamic or fixed current binding
- nextAction: record current FACT and continue product authoring
- mayAskUserWhetherCurrentPolicy: false
- mayStartTechnicalDesign: false

explicit desired future behavior remains undecided
- nextAction: create an owned PRODUCT question about the desired future only
- mayAskUserWhetherCurrentPolicy: false
- mayAskUserAboutDesiredFuturePolicy: true
- mayStartTechnicalDesign: false
```

Never invent current evidence to move between rows. Stage 1 ends after product
authoring and approval status; even a fully resolved surface does not authorize
system design, tasks, implementation validation, or a design-review handoff.

## Operational Retrieval Profile

Use **accuracy-first** by default. Read
`references/execution-profiles.md` before retrieval. Track elapsed time and
calls before and after every tool call or batch as progress telemetry, but in
accuracy-first they must not end retrieval, skip a required evidence gate, or
force a draft. Cancel or stop waiting for an oversized in-flight batch only when
the runtime permits, record its exact failure, and continue with the next
targeted read or retry.

Use **fast-draft** only when the user explicitly requests a preview, time-boxed
draft, or bounded exploration. It may use the 5-minute/30-call and
3-minute/12-current-service-call boundaries in the reference. A fast-draft
coverage limit is never approval-ready and never changes the accuracy-first
default for a later retry or revision.
## Work-Plan Gate

Before resolving Figma evidence or making any retrieval call, create and keep a
runtime-visible work plan. Read `references/work-plan-contract.md` and follow
its Subagent Delegation Contract throughout this run. The plan is a required
execution control, not a prose summary: use `update_plan` in Codex and
`TodoWrite` in Claude Code. Add one
`SurfaceResolutionChecklist` plan item for every major Figma screen as soon as
the screen inventory is known. Finish one `ScreenIntentSeed` per screen before
Platty retrieval or delegation. Then create `EpicScreenSpecPool` items by
selected EPIC and Design map while retaining one screen-level resolution item
per seed. Do not collapse pool collection, matching, and source closure into
one completed item.

Before every retrieval tool call or batch, consult the current plan; after every
retrieval tool call or batch, update the affected item with its receipt or exact
coverage boundary. A plan item becomes `complete` only with the named receipt.
It becomes `coverage_limit` only with the attempted read, candidate boundary,
and next exact read. Do not mark an unattempted, skipped, or weakly matched
step complete. The final `Approval Readiness Audit` plan item may be complete
only after all major-screen items have a valid terminal state and their
`ExistingSurfaceResolution` records have been checked. Otherwise the pair stays
`NEEDS_WORK` and must not be reported as approval-ready.

## Scoped Retrieval Gate (Not a Search Fast Path)

Use a targeted fast path only to limit current-service scope. A Figma node,
visible domain term, route/API label, literal, or `ScreenIntentSeed.retrievalHints`
value is a routing hint, not a semantic candidate and not proof of an existing
screen, API, policy, or source binding.

The coordinator ranks EPICs for the complete seed inventory using EPIC
summaries and DESIGN/UCL maps. Screens with the same selected EPIC and Design
map share one collection lane. That `EpicScreenSpecPool` reads the union of
selected exact DESIGN/UCL items, runs `document_spec_resolve`, collects
the complete explicitly linked `screen_spec` union, runs `spec_get` for every
candidate, and runs `spec_impact_resolve` for every candidate still plausible for an
owned screen.

A Platty semantic candidate is an exact selected DESIGN/UCL document or item.
Before calling `document_search`, `spec_search`, or `code_search`, require that
selection and its `document_spec_resolve` receipt. Only then may search-assist narrow
missing, stale, or broad links; confirm `spec_search` with `spec_get` and
`spec_impact_resolve`, and follow source-near specs for `code_search`.

The fast path may skip unrelated EPICs, documents, items, and repositories. It
must not traverse the full document item map, entire generated-doc corpus, or
every repository merely because they are available. It must never skip the
selected Design/UCL map, exact item read, or `document_spec_resolve` receipt. A time
or call budget does not authorize bypassing those gates: persist a `NEEDS_WORK`
draft with a `coverage_limit` instead.

## Surface Resolution Checklist Gate

Treat this as a blocking TODO list. Keep one checklist and terminal receipt per
major Figma screen, but reuse EPIC pool reads. A checklist item may be
`complete` only with the named receipt; it may be `coverage_limit` only when
its exact attempted MCP read, candidate boundary, and next read are recorded.
No other status allows delegation as approval-ready work.

### Memory Overlay Checkpoint

Assess memory relevance once per `EpicScreenSpecPool`; record `not relevant`
with a reason or use selected `memory_list` / `memory_get` reads, then reuse the
receipt for all owned screens. Memory is context, never proof of a current
`FACT`, route, API, screen, or absence.

**Screen-spec-first Classification Guard.** Follow the pool and matrix contract
in `references/work-plan-contract.md`: account for every linked candidate,
resolve every plausible candidate, and record one `screenSpecReceipt` per
screen before source closure or classification.
If a candidate does not explain an essential Figma action, field, or persistence control, mark it `not_matching` with reason and return to the candidate EPIC/Design map; a generic, broad, component-only, or API-only hit never closes this guard.
Until the receipt exists, you must not assign `REUSE`, `MODIFY`, `NEW`, or `UNKNOWN`; state a current-system `FACT`; or open an `O-*` question about a Figma-visible control's behavior or persistence policy. Keep it `unresolved` with `coverage_limit` and the next exact read. An explicitly requested future-policy question is allowed only when independent of that control and current state.

For `not_found`, require the Design document map, `document_spec_resolve`, exhausted
ranked EPICs, searched repositories, analyzed commit, and next exact read. Empty
or weak direct results are not absence proof. Otherwise retain `unresolved` /
`coverage_limit` and keep the pair `NEEDS_WORK`.

## Required Workflow

1. Auto-select CREATE or AUGMENT from the supplied product documents, report the
   selected mode, and record input hashes. Do not ask the user to choose it.
2. Resolve and validate Figma evidence internally from the URL.
3. Finish the major-screen inventory and one complete `ScreenIntentSeed` per
   screen. Do not begin current-service retrieval or delegation before this
   inventory is complete.
4. Build `ScreenToEpicRoutingTable`, then use `platty-mcp-retrieval` to inspect
   the current service for existing
   product behavior, policy, journey, data, API, screen, and source-confirmable
   facts. Do not answer a `FACT` from Figma layout or from memory. If retrieval
   cannot run, stop with the capability gap instead of silently producing a
   Figma-only summary.
5. Build one `EpicScreenSpecPool` per selected EPIC and Design map, then create
   the complete screen-to-spec matrix and one `screenSpecReceipt` per owned
   screen. Apply alternate-EPIC rules for `partial`, `analogous`,
   `not_matching`, and `ambiguous`; only receipt-backed candidates proceed.
6. Complete the runtime-visible `SurfaceResolutionChecklist` and build one
   `ExistingSurfaceResolution` for every major Figma screen using the contract
   in `references/evidence-mapping.md`. A major screen is a frame or flow state
   that maps to a requirement, story/scenario, user action, or user-visible
   state. Do not call current-screen analysis complete after only finding a
   component, API, or similar page. For an existing candidate, close the route
   -> entry caller -> rendered component chain. For a data- or API-related
   change, also close the state/data binding -> frontend API -> backend endpoint
   chain. Record repository and analyzed commit for every source claim. If a
   candidate chain is still unresolved, continue targeted retrieval until the
   required source boundary is proved or recorded; do not turn the missing
   current-system `FACT` into a user question merely because time or calls grew.
7. Apply the Screen-spec-first Classification Guard. Figma, `document_spec_resolve`,
   search, component/API, or broad-candidate evidence alone permits only a bounded
   `unresolved` / `coverage_limit` current-surface result.
8. Classify every proposed mapping as `FACT`, `PRODUCT`, or `DESIGN` using
   `references/evidence-mapping.md`.
9. Build requirement, acceptance, story, scenario, question, and design-handoff
   candidates. Keep assertion IDs and Figma node IDs on every mapping.
10. Resolve Figma literals against current source bindings before opening a
   product question. Dynamic source bindings make the Figma literal a
   `sample-copy` candidate while the current dynamic behavior remains a `FACT`.
   A current fixed literal is a current-behavior `FACT`. Only an explicit new
   fixed-policy statement creates a `PRODUCT` candidate. An unresolved current
   binding remains retrieval work; after bounded retrieval is exhausted, record
   its evidence boundary as a coverage limit. Persist that bounded result through
   the Draft Persistence Gate instead of withholding all files. A later question may ask which
   future product behavior the user wants, never what the current code does.
   Direct design copy proves what the design says, not that the promise is
   approved.
11. Build one `ProductIntentFromFigmaPacket` and run its ownership and
   traceability audit.
12. Delegate the packet and selected mode to `platty-mcp-sdd-spec`. That owner
   writes or revises `prd.md` and `user_stories.md`, invokes retrieval and
   impact analysis, computes canonical revisions, and applies approval gates.
   Pass resolved current behavior as `FACT`, never as a user question. Require
   material surface resolutions, source paths, commits, and comparison results
   in the impact seed so the owner persists them in PRD §9; reflect only the
   product-relevant current baseline in §0-§8. Never ask the user to reconfirm a
   source-confirmable fact that retrieval has resolved. The first delegation is
   the final product-pair write for the current response: compose both files in
   memory, write each once, and do not patch them again before sidecar binding.
13. Read back both persisted files after that final product-pair write and use
   `../using-platty-mcp/scripts/sdd-artifacts.mjs` to compute the exact
   `requestRevision` and `storiesRevision`. Build `figma-handoff.v1` from those
   revisions, the canonical Figma URL and source identity, and the exact
   Figma-node-to-product/story mappings. Persist `figma_handoff.json` with
   `persistFigmaHandoff` from
   `../using-platty-mcp/scripts/figma-handoff.mjs`, then load it back with the
   expected project, spec, and revisions. Atomically replace any prior sidecar
   and validate the loaded result before responding. The sidecar is a small durable index;
   do not copy the full evidence packet into the product documents or sidecar.
14. Using the same read-back, compare input hashes in AUGMENT mode and verify
   the `Augment Identity Ledger`: the canonical spec ID, every original ID,
   meaning digest, and closed/open state must remain unchanged, and every new ID
   must be appended rather than reused. Verify every promoted product claim
   traces to approved product intent plus direct Figma or Platty evidence.
   Visual-only details must remain in Design Decision Handoff. When the same
   evidence and explicit product answers have a prior same-session or
   cross-session QA run, compare the `Figma Inventory Ledger`, R/AC, decisions,
   exclusions, and open-question resolutions before approval. A session
   boundary alone must not change product semantics, select a different retained
   screen set, or promote Figma sample copy into a requirement.
   In AUGMENT mode, require the canonical owner to run
   `product-readiness-validator.mjs --prd <prd.md> --stories <user_stories.md> --augment-prd <original-prd.md> --json`
   after the final pair write and every approval-status transition. Do not bind
   or refresh the sidecar, ask another question, request approval, or report
   completion until it returns `PASS`, score 100, and zero critical findings.
15. Apply the Immediate Product Question Handoff below. When an eligible open
   desired-future `PRODUCT` question remains, ask it in the completion response
   instead of waiting for the user to request the question list.
16. Stop at the product-stage completion boundary. Do not start technical design
    unless a later user message separately requests it.

Any subsequent product edit, including an answer to an `O-*` question or a
product-approval metadata update, invalidates the bound revisions. Perform the
new final product-pair write, read back both files, recompute both revisions,
atomically replace `figma_handoff.json`, load it against the new revisions, and
validate it before the response. Never leave a sidecar bound to a pre-final
draft revision.

The sidecar must contain `schemaVersion`, `projectId`, `specId`,
`productInput.requestRevision`, `productInput.storiesRevision`, canonical Figma
source identity (`canonicalUrl`, `fileKey`, `nodeId`, `targetId`, `targetType`,
`targetName`, `reportId`, `sourceRevision`), `coverageStatus: complete`, and
non-empty mappings with exact Figma node, product, and story/scenario IDs.
Stage 2 re-evaluates every provisional disposition against current Figma and
product evidence; the sidecar is lineage and routing input, not design approval.

## ProductIntentFromFigmaPacket

```text
ProductIntentFromFigmaPacket
- mode: CREATE | AUGMENT
- projectId
- figmaEvidence
  - packetPath
  - reportId
  - sourceRevision
  - fileKey
  - nodeId
  - integrityStatus
  - coverageStatus
- plattyEvidence
  - retrievalPacket
  - impactSeedPacket
- screenIntentInventory
  - one ScreenIntentSeed per major Figma screen
- screenToEpicRoutingTable
- epicScreenSpecPools
  - one revision-bound pool per selected EPIC and Design map
- screenSpecReceipts
  - one complete matching receipt per major Figma screen
- existingSurfaceResolutions
  - one ExistingSurfaceResolution per major Figma screen
- sourceProductInput
  - figmaOnly | rawIdea | copiedPrd | copiedDraftPair
- evidenceMappings
  - assertionId
  - figmaNodeIds
  - classification: FACT | PRODUCT | DESIGN
  - evidenceClass: direct | inferred | missing
  - proposedTarget: R-* | AC-* | US-* | scenario | O-* | Design Decision Handoff
  - disposition
- openQuestions
- designDecisionHandoff
- figmaHandoff
  - schemaVersion: figma-handoff.v1
  - requestRevision
  - storiesRevision
  - canonicalUrl
  - sourceIdentity
  - mappings
  - sidecarPath
- questionOwnershipAudit
- inputHashes
- delegationTarget: platty-mcp-sdd-spec
```

Every packet row must retain the exact evidence boundary. An empty mapping,
unclassified item, inferred product promise, or missing owner is `NEEDS_WORK`.
The skill must not ask the user to supply or confirm a current-system `FACT`.
Continue retrieval, or record the exhausted evidence boundary. It must not
fabricate missing source evidence. This product stage must not start system
design or tasks, regardless of how plausible an implementation candidate looks.

## Immediate Product Question Handoff

Create one shared `Product Question Ledger` before the first question. It carries
`initialQuestionUsed`, `followupQuestionUsed`, and
`discoveryQuestionsRemaining` through Figma orchestration, canonical-owner
delegation, draft writes, and later answers. Every delegation passes the same
ledger and remaining budget; it must not reset or replenish the question budget.
The one-question-per-message rule does not authorize more than the owning
skill's two total discovery questions.

After the first canonical pair and sidecar are saved and reread, inspect open
`O-*` rows and the owning spec's runtime discovery budget. If an eligible
desired-future `PRODUCT` choice remains, the completion response must
immediately ask the highest-priority open product question. Ask one question per
message and include a plain-language recommendation, its reason, and the
user-visible impact of the choice. Do not merely report that questions exist or
wait for the user to ask for them.

A recommendation is a `PRODUCT` and user-visible outcome only; it must not add
or prescribe a server, API, field, config, storage, timer authority, or other
implementation mechanism. Source-confirmed current behavior may explain the
recommendation but does not turn a DESIGN choice into product policy. Unknown
metric baseline or target values are a `NON_BLOCKING` measurement guard and
must not block product approval unless the metric itself defines the promised
user result.

When asking that question, the response must not ask for product approval in
the same message. After the answer, delegate the decision to
`platty-mcp-sdd-spec`, update and reread the persisted product pair, recompute
its revisions, refresh and validate `figma_handoff.json`, and close the matching
`O-*` through the owning decision flow. Ask the next eligible question if one
remains and budget is available; otherwise ask for product approval only when
no approval-critical product question remains.

Never expose a current-system `FACT` or implementation `DESIGN` choice through
this handoff, and never exceed the owning spec skill's discovery-question
budget. If that budget is exhausted while an approval-critical `O-*` remains,
report the pair as draft or `NEEDS_WORK`, show the unresolved product item, and
do not ask for approval. This response ordering overrides a generic approval
prompt while an eligible product question remains; it does not change the
canonical owner's revision or approval rules.

## Draft Persistence Gate

This gate controls whether useful artifacts are saved; it is intentionally
separate from approval readiness. Once Figma evidence is valid and Platty
retrieval has either resolved the current candidates or reached the operational
coverage limit, delegate and persist canonical `prd.md` and `user_stories.md`.
Every unresolved surface must be recorded as `unresolved` / `UNKNOWN` with its
searched scope and evidence boundary. The current-screen analysis remains
`NEEDS_WORK`. The product pair remains `NEEDS_WORK` until each bounded source gap
is classified as either a product blocker or a `NON_BLOCKING design guard`.
For a missing screen-spec receipt, persist `unresolved` with the attempted candidate/rejection boundary and next exact read; never backfill a current `FACT`, comparison, or Figma-control-related `O-*` question.
Do not withhold the canonical pair merely because route, caller, component, or
binding closure is incomplete. Persist a bounded `NEEDS_WORK` draft and ask only
eligible desired-future product questions.

Passing this gate does not mean existing-screen analysis is complete and does
not make the pair approval-ready. If Figma evidence itself is invalid or Platty
retrieval is unavailable, use the Stop Conditions instead of fabricating a
draft baseline.

## Approval Readiness Gate

The product pair is approval-ready only when:

- the current Figma bundle validates and is stable;
- CREATE or AUGMENT was auto-selected and reported;
- all mappings are classified and traceable;
- `FACT` work has been resolved or bounded by retrieval;
- every major Figma screen has an `ExistingSurfaceResolution`;
- the complete `ScreenIntentSeed` inventory preceded current-service retrieval;
- every selected EPIC/Design-map group has a complete or bounded
  `EpicScreenSpecPool` with candidate accounting and revisioned receipts;
- every major Figma screen has a `screenSpecReceipt` with the complete pool
  accounting, selected/rejected IDs, `spec_get` outcomes for every candidate,
  and `spec_impact_resolve` outcomes for every plausible candidate, or an explicit
  bounded `not_matching` / absent-candidate boundary;
- every existing-screen candidate proves route -> entry caller -> rendered
  component, and every data- or API-related change also resolves current
  state/data bindings, frontend API, and backend endpoint;
- each surface comparison is `REUSE`, `MODIFY`, `NEW`, or `UNKNOWN`, and
  `unresolved`, missing required chain evidence, or partial evidence remains
  `NEEDS_WORK` rather than being reported as complete current-screen analysis;
- an unresolved bounded source path may permit product approval only as a
  `NON_BLOCKING design guard` when the product promise does not depend on the
  missing current fact and the gap can affect implementation placement only;
  it must not be called current-screen analysis complete, and technical design
  must re-resolve the route/binding guard before declaring design ready;
- resolved current-service facts are delegated as facts and persisted through
  the owning spec/impact flow instead of being asked back to the user;
- unresolved `PRODUCT` choices remain visible as O-* items;
- the highest-priority eligible open `PRODUCT` question is asked immediately in
  the completion response, before any product-approval prompt;
- `DESIGN` details remain in Design Decision Handoff;
- same evidence and explicit product answers preserve the same product semantics
  across same-session and recovered cross-session runs; any unexplained R/AC,
  decision, exclusion, or question-resolution difference remains `NEEDS_WORK`;
- the owning spec skill has written and reread both canonical files; and
- `figma_handoff.json` was persisted, loaded back, and matched to the current
  project, spec, request revision, and stories revision; and
- AUGMENT input hashes prove the supplied inputs were not edited in place.

Every response after draft persistence must report the selected project, CREATE
or AUGMENT mode, Platty MCP
retrieval status, product-document status, and absolute saved paths for
`prd.md` and `user_stories.md`. Printing an inline `기획서 초안` without those
persisted files and evidence status is not complete.
Also report the absolute `figma_handoff.json` path. If its write or read-back
fails, report the product files accurately but mark Figma-connected stage 1
`NEEDS_WORK`; do not claim that a new session can continue with Figma context.

Product approval is not implied. If open approval-critical questions remain,
both files stay draft or `NEEDS_WORK` under `platty-mcp-sdd-spec`.

## Stop Conditions

Stop when the Figma packet remains stale, incomplete, corrupt, or
identity-mismatched after the owning sync route;
when Platty retrieval required for a `FACT` is unavailable; when an inferred
layout detail is being promoted to product intent; when a supplied draft would
be edited in place; or when the route would bypass the canonical spec or impact
owners. Keep the product stage `NEEDS_WORK` when any major surface is
`unresolved` or a required current route, caller, component, or binding chain is
partial. Stop as `BLOCKED` when a written sidecar is corrupt, project/spec
mismatched, or stale against the persisted request/story revisions.

Read `references/evidence-mapping.md` before mapping. Read
`references/pressure-scenarios.md` when modifying or evaluating this skill.
