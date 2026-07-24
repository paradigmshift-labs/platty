---
name: platty-mcp-sdd-design-with-figma
description: Use when a user separately requests technical or system design from approved product documents with a Figma URL, current-session Figma evidence, or a validated figma_handoff.json discovered beside the product pair.
---

# Platty MCP SDD Design With Figma

**Prerequisite:** Read `using-platty-mcp` first. This stage starts only after a
separate user request for system design or technical design. A prior PRD request
does not authorize this stage. Read the selected approved SDD pair, resolve its
Figma target from the supplied Figma URL, current-session evidence handoff, or
validated `figma_handoff.json`, and internally create, reuse, or refresh the validated bundle through
`platty-mcp-figma-design-sync` before alignment.

This skill is a thin semantic alignment gate. It compares approved `prd.md` and
approved `user_stories.md` with current Figma evidence and the current Impact
Dossier, produces one `FigmaDesignAlignmentPacket`, and delegates technical
design to `platty-mcp-sdd-design` only when the gate allows it.

All reader-facing summaries are Korean. Preserve source identifiers, Figma node
IDs, paths, statuses, revisions, and quoted copy exactly.

## Ownership Boundary

- `platty-mcp-figma-design-sync` owns the revisioned Figma evidence bundle.
- `platty-mcp-impact-analysis` owns impact evidence and PRD §9.
- `platty-mcp-sdd-spec` owns canonical product revision and approval.
- `platty-mcp-sdd-design` owns canonical `system_design.md` and owns canonical `tasks.md`
  after the exact design approval gate.
- This skill owns only alignment dispositions and handoff packets.

Never write, modify, edit, or rewrite `prd.md`. Never write, modify, edit, or
rewrite `user_stories.md`. Record input hashes before and after every live run.
Never edit Figma, run local Platty CLI, mutate generated SOT, or write memory.

Never ask the user for a packet path, reportId, sourceRevision, integrity index,
or report-directory location. Accept a Figma URL. In the same session, reuse exact
`fileKey`, `nodeId`, `reportId`, and `sourceRevision` from the current-session
evidence handoff. In a new session, first use the validated sidecar
`figma_handoff.json` from the selected SPEC directory. Its canonical URL and source identity recover
the target automatically. Only when the handoff is absent and no current-session
evidence exists, ask the user for the node-specific Figma URL.

## Accepted Pair Shapes

- `CONNECTED`: the pair was produced with the same Figma evidence lineage.
- `INDEPENDENT`: the pair and Figma were authored separately.

INDEPENDENT is first-class. This skill does not require the PRD to be generated
from the same Figma or require shared lineage. It requires semantic alignment of
the approved user result, direct design evidence, and current system evidence.

## Input Gate

1. Parse the persisted pair with
   `../using-platty-mcp/scripts/sdd-artifacts.mjs`.
2. Require matching id/project, approved `prd.md`, and approved
   `user_stories.md`. Compute `requestRevision`, `storiesRevision`, and
   `productInputFingerprint` with the existing helper.
3. When this route was entered through automatic sidecar discovery, load it
   with `loadOptionalFigmaHandoff` from
   `../using-platty-mcp/scripts/figma-handoff.mjs`, passing the exact project,
   spec, request revision, and stories revision. Use its `canonicalUrl` and
   source identity as routing input. A corrupt/invalid, mismatched, or stale
   sidecar is `BLOCKED`; stop instead of requesting a replacement URL or
   silently switching to non-Figma design. When no sidecar exists, use the
   explicit URL or current-session handoff; if neither exists, ask only for the
   node-specific Figma URL and stop.
4. Resolve Figma evidence internally:
   - when the packet is current, reuse it if exact identity, sourceRevision,
     integrity, coverage, and drift checks pass;
   - when evidence is missing or stale, invoke
     `platty-mcp-figma-design-sync`, validate the refreshed bundle, and continue;
   - when refresh cannot close the gap, stop as `STALE` or `BLOCKED`.
   Require matching fileKey/nodeId and current sourceRevision.
5. Read PRD §9. Require a current Impact Dossier for every approval-critical
   path. Route stale or required-area partial impact to the existing impact
   owner; do not repair §9 here.
6. Hash both product inputs and retain the hashes in the packet.

Unapproved inputs are `BLOCKED`. A user may explicitly request a negative-test
draft alignment report, but no canonical design write follows from it.

## Required Workflow

1. Confirm that the current user message separately and explicitly requests
   system design or technical design. Otherwise stop after the product stage.
2. Select `CONNECTED` or `INDEPENDENT`; lineage never substitutes for evidence.
3. Apply `references/alignment-gate.md` to every Figma state, annotation,
   interaction, missing state, and product requirement exactly once.
4. Use `MATCHED`, `DESIGN_DETAIL`, `FIGMA_GAP`, `PRODUCT_CONFLICT`, `STALE`, or
   `BLOCKED` with the reference's precedence.
5. Build trace rows from Figma node -> R/AC -> US/scenario -> design decision ->
   task. The design-decision and task cells may remain pending before delegation.
6. If any row is `PRODUCT_CONFLICT`, build a
   `SpecRevisionFromFigmaConflictPacket`, route it to `platty-mcp-sdd-spec`, and
   stop. Do not create `system_design.md`. Do not create, write, or overwrite
   `tasks.md`.
7. If a row is `FIGMA_GAP`, decide whether the approved product already defines
   the visible state. When it does, preserve it as a design evidence-resolution
   item; when it does not, route the missing product result to spec revision.
8. Keep layout, token, component, spacing, color, visual hierarchy, and other
   product-preserving differences as `DESIGN_DETAIL`. They are not product
   conflicts.
9. When all blocking rows are resolved, pass the packet, exact product identity,
   Figma evidence references, and Impact Dossier to `platty-mcp-sdd-design`.
   Once the product-conflict scan is clear, do not delay delegation while
   collecting non-conflict source details: the canonical owner's Design Draft
   Persistence Gate must run by its 3-minute or 12-call boundary, with unresolved
   alignment/source details represented as `ER-*` rows.
10. The owning design skill writes and reads back `system_design.md`. It creates
   no `tasks.md` until explicit design approval of the exact `designRevision`.
11. Require the canonical `system_design.md` to retain the exact Figma evidence
    identity (`canonicalUrl`, `fileKey`, `nodeId`, `reportId`,
    `sourceRevision`) and the alignment rows that support each Figma-sensitive
    design decision. It must own one complete registry keyed by stable
    `FIGMA-SURFACE-*` ids. Each row contains the canonical URL, every exact Figma
    node used for that surface, expected sourceRevision, required live screenshot
    and bounded design-context reads, and the drift/failure action. This is the
    implementation-time Figma MCP preflight contract.
12. After exact design approval, require every Figma-sensitive UI task in
    `tasks.md` to reference its `FIGMA-SURFACE-*` id plus its R/AC, US/scenario,
    and design-decision links. Project the complete registry once near the top of
    `tasks.md`, before the module execution plan, so a new-session implementer can
    recover every canonicalUrl, exact Figma node, and expected sourceRevision
    without scanning individual tasks. This top-level registry is the single execution preflight
    and receipt location. Before any code edits, retrieve
    current screenshot and bounded design context for every referenced node and
    compare the refreshed sourceRevision with the expected sourceRevision. A task
    may not replace surface identity with a screenshot description or packet path.
13. Reread the product inputs and compare input hashes after delegation. Any
    mutation invalidates the run.

## Canonical Projection Contract

`system_design.md` must project a complete `FIGMA-SURFACE-*` registry with
`canonicalUrl`, `fileKey`, every exact `nodeId`, `reportId`, `sourceRevision`,
live-read requirements, and drift action, followed by the reviewable alignment
rows consumed by technical decisions. `tasks.md` must project that registry once
near the top, before its module execution plan. Every UI or interaction task
references the applicable surface id and retains its R/AC, scenario, and
design-decision links. Non-visual backend tasks retain product/design links only
when the same change directly constrains them.

The preflight is an execution gate, not a reminder. Authentication or Figma read
failure, a missing node, an identity mismatch, unavailable screenshot or design
context, or source drift must stop and block code edits. Refresh the evidence
through `platty-mcp-figma-design-sync`, rerun alignment, produce a new design
revision, and require design approval again. Never patch only `tasks.md` to
accept changed Figma or implement from stale captures.

The required chain is:

```text
Figma node -> R/AC -> US/scenario -> design decision -> task
```

Missing Figma identity or a complete surface registry in `system_design.md`, a
missing top-level registry/preflight in `tasks.md`, or a Figma-sensitive task
without a valid surface reference is `NEEDS_WORK` and cannot be declared
implementation-ready.

## FigmaDesignAlignmentPacket

```text
FigmaDesignAlignmentPacket
- pairMode: CONNECTED | INDEPENDENT
- projectId
- productInput
  - prdPath
  - storiesPath
  - requestRevision
  - storiesRevision
  - productInputFingerprint
  - approvalStatus
- figmaEvidence
  - handoffOrigin: explicit-url | current-session | figma_handoff.json
  - packetPath
  - canonicalUrl
  - reportId
  - sourceRevision
  - fileKey
  - nodeId
  - integrityStatus
  - coverageStatus
- impactDossier
  - impactRevision
  - impactStatus
  - sourceParity
  - blockingCoverageLimits
- alignmentRows
  - alignmentId
  - figmaNodeIds
  - productIds
  - storyScenarioIds
  - disposition
  - evidenceClass
  - rationale
  - nextOwner
- traceRows: Figma node -> R/AC -> US/scenario -> design decision -> task
- specRevisionPacket
- designEvidenceResolutionItems
- inputHashes
- delegationTarget: platty-mcp-sdd-design
```

Every direct semantic candidate and approved product requirement must have one
disposition. Missing identity, duplicate disposition, inferred product promise,
or ownerless conflict is `BLOCKED`.

## Stop Conditions

Stop when the selected product pair is unapproved; when an existing
`figma_handoff.json` is corrupt/invalid, project/spec mismatched, or stale; when
no sidecar, current-session evidence, or node-specific Figma URL is available;
when Figma evidence cannot be refreshed to current complete coverage; when a
product conflict requires spec revision; or when the canonical design owner
rejects the alignment packet. Never downgrade a failed Figma route to generic
technical design.

## SpecRevisionFromFigmaConflictPacket

Record the product ids, story/scenario ids, direct Figma nodes and copy, current
approved meaning, conflicting meaning, evidence boundary, visible trade-off,
and recommended product review. This packet authorizes no edit. The spec owner
must revise both product files, reset approval, refresh impact, and return a new
exact revision before design resumes.

## Completion Gate

Alignment completes only when inputs and evidence are current, every row has one
disposition and owner, product conflicts are absent, product hashes are
unchanged, the canonical design and tasks preserve the required Figma trace, and
the existing design owner accepts the exact packet. Technical design completion
and task readiness remain owned by `platty-mcp-sdd-design`.

Read `references/alignment-gate.md` before comparing. Read
`references/pressure-scenarios.md` when modifying or evaluating this skill.
