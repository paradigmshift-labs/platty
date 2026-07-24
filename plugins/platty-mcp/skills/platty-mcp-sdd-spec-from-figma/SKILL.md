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

Never ask the user for a packet path, reportId, sourceRevision, integrity index,
or report-directory location. Those are internal handoff details. Reuse exact
target identity only from a current-session evidence handoff; in a new session,
ask only for the node-specific Figma URL.

## Modes

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
Preserve existing IDs and approved meaning when unchanged; add missing trace,
explicit questions, scenarios, and Design Decision Handoff rows through the
owning spec revision flow. Product contradictions remain explicit rather than
being overwritten by Figma.

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

## Operational Retrieval Budget

Start one wall-clock deadline and tool-call counter when this skill begins.
Check both before and after every tool call or batch. At 5 minutes or 30 tool
calls, whichever comes first, stop broad retrieval, cancel or stop waiting for
an oversized in-flight batch when the runtime permits, and move to the Draft
Persistence Gate to persist a bounded partial NEEDS_WORK draft. Do not start
another discovery batch after the boundary.

Treat 12 current-service candidate calls or 3 minutes as the hard first-draft
boundary even when the broader progress budget remains. At that boundary,
delegate the current packet through the Draft Persistence Gate before any more
source expansion. Later targeted retrieval may replace the pair only through the
owning spec revision flow and must refresh the sidecar afterward.

## Work-Plan Gate

Before resolving Figma evidence or making a Platty retrieval call, create a
runtime-visible work plan and read `references/work-plan-contract.md`. Use
`update_plan` in Codex and `TodoWrite` in Claude Code. Add one ordered
`SurfaceResolutionChecklist` item per major Figma screen as soon as the screen
inventory is known.

The plan must expose this directional retrieval path:

```text
project map
-> candidate EPIC
-> epic_get.documentRefs
-> exact DESIGN/UCL document and item reads
-> document_spec_resolve(itemIds)
-> spec_get(specIds)
-> source confirmation when required
```

Use `spec_document_resolve` only for reverse business context and
`spec_impact_resolve` only for technical impact. Before and after every
retrieval call or batch, update the affected plan item with the exact tool,
selected IDs, and receipt or coverage boundary. Do not mark a skipped or weak
candidate step complete. The final Approval Readiness Audit stays incomplete
while any major-screen item lacks a supported terminal state.

## Scoped Retrieval Gate

Figma frames, visible terms, routes, API labels, and literals are routing hints,
not proof of a current business item, Spec, screen, or policy. For every major
screen, first select the likely EPIC and its DESIGN/UCL map through
`platty-mcp-retrieval`. Read the exact document and item, then resolve its direct
Spec links with `document_spec_resolve`. Confirm every selected candidate with
`spec_get`.

Search assist may narrow only the unresolved remainder after that map-first
receipt. Once a linked Spec exists, source search starts from that Spec rather
than from raw Figma copy. The fast path may skip unrelated EPICs, documents,
items, and repositories, but it must not skip the selected EPIC map, exact
DESIGN/UCL read, direct Spec link resolution, or selected Spec read.
It must not traverse the full document item map or entire generated-document
corpus merely because those surfaces are available.

After selecting the candidate EPIC, assess memory relevance once. Use
`memory_list` and selected `memory_get` reads only when a known correction,
constraint, historical decision, or ambiguity affects the surface; otherwise
record `not relevant` with a reason. Memory is an overlay and never proves a
current route, screen, API, binding, or absence.

## Required Workflow

1. Auto-select CREATE or AUGMENT from the supplied product documents, report the
   selected mode, and record input hashes. Do not ask the user to choose it.
2. Resolve and validate Figma evidence internally from the URL.
3. Use `platty-mcp-retrieval` to inspect the current service for existing
   product behavior, policy, journey, data, API, screen, and source-confirmable
   facts. Do not answer a `FACT` from Figma layout or from memory. If retrieval
   cannot run, stop with the capability gap instead of silently producing a
   Figma-only summary.
4. Complete the runtime-visible `SurfaceResolutionChecklist` and build one
   `ExistingSurfaceResolution` for every major Figma screen using the contract
   in `references/evidence-mapping.md`. A major screen is a frame or flow state
   that maps to a requirement, story/scenario, user action, or user-visible
   state. Do not call current-screen analysis complete after only finding a
   component, API, or similar page. For an existing candidate, close the route
   -> entry caller -> rendered component chain. For a data- or API-related
   change, also close the state/data binding -> frontend API -> backend endpoint
   chain. Record repository and analyzed commit for every source claim. If a
   candidate chain is still unresolved, continue targeted retrieval only while
   the operational budget remains; do not turn the missing current-system
   `FACT` into a user question.
5. Classify every proposed mapping as `FACT`, `PRODUCT`, or `DESIGN` using
   `references/evidence-mapping.md`.
6. Build requirement, acceptance, story, scenario, question, and design-handoff
   candidates. Keep assertion IDs and Figma node IDs on every mapping.
7. Resolve Figma literals against current source bindings before opening a
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
8. Build one `ProductIntentFromFigmaPacket` and run its ownership and
   traceability audit.
9. Delegate the packet and selected mode to `platty-mcp-sdd-spec`. That owner
   writes or revises `prd.md` and `user_stories.md`, invokes retrieval and
   impact analysis, computes canonical revisions, and applies approval gates.
   Pass resolved current behavior as `FACT`, never as a user question. Require
   material surface resolutions, source paths, commits, and comparison results
   in the impact seed so the owner persists them in PRD §9; reflect only the
   product-relevant current baseline in §0-§8. Never ask the user to reconfirm a
   source-confirmable fact that retrieval has resolved. The first delegation is
   the final product-pair write for the current response: compose both files in
   memory, write each once, and do not patch them again before sidecar binding.
10. Read back both persisted files after that final product-pair write and use
   `../using-platty-mcp/scripts/sdd-artifacts.mjs` to compute the exact
   `requestRevision` and `storiesRevision`. Build `figma-handoff.v1` from those
   revisions, the canonical Figma URL and source identity, and the exact
   Figma-node-to-product/story mappings. Persist `figma_handoff.json` with
   `persistFigmaHandoff` from
   `../using-platty-mcp/scripts/figma-handoff.mjs`, then load it back with the
   expected project, spec, and revisions. Atomically replace any prior sidecar
   and validate the loaded result before responding. The sidecar is a small durable index;
   do not copy the full evidence packet into the product documents or sidecar.
11. Using the same read-back, compare input hashes in AUGMENT mode and verify
   every promoted product claim traces to approved product intent plus direct
   Figma or Platty evidence. Visual-only details must remain in Design Decision
   Handoff. When the same evidence and explicit product answers have a prior
   same-session or cross-session QA run, compare R/AC, decisions, exclusions,
   and open-question resolutions before approval. A session boundary alone must
   not change product semantics or promote Figma sample copy into a requirement.
12. Apply the Immediate Product Question Handoff below. When an eligible open
   desired-future `PRODUCT` question remains, ask it in the completion response
   instead of waiting for the user to request the question list.
13. Stop at the product-stage completion boundary. Do not start technical design
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

After the first canonical pair and sidecar are saved and reread, inspect open
`O-*` rows and the owning spec's runtime discovery budget. If an eligible
desired-future `PRODUCT` choice remains, the completion response must
immediately ask the highest-priority open product question. Ask one question per
message and include a plain-language recommendation, its reason, and the
user-visible impact of the choice. Do not merely report that questions exist or
wait for the user to ask for them.

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
