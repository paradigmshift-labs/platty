---
name: platty-mcp-figma-design-sync
description: Use when a Figma URL, Figma page, Figma section, or Figma frame must become reusable, revisioned design evidence before Platty MCP product specification or technical design.
---

# Platty MCP Figma Design Sync

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn. Read `figma:figma-use` immediately before every
`use_figma` call.

Turn one exact Figma target into a validated `FigmaEvidencePacket`. This skill
collects design evidence; it does not write product requirements, system design,
tasks, generated SOT, memory, or source code.

All reader-facing summaries are Korean. Preserve Figma copy, node IDs, file
keys, status values, paths, and code identifiers exactly.

## When To Use

Use this skill when the user provides a Figma URL or exact `fileKey` and
`nodeId` and asks to sync, inventory, summarize, compare, or prepare design
evidence for later PRD or system-design work.

For a product-document request grounded in Figma, this skill runs first and
hands the current packet to `platty-mcp-sdd-spec-from-figma`. For technical
design, hand the packet to `platty-mcp-sdd-design-with-figma`.

Do not use this skill to edit Figma or to infer product intent from visual
layout. A button position, grouping, color, proximity, or visual hierarchy is
`inferred` design evidence, never a direct product rule.

## Ownership Boundary

Use configured Figma MCP capabilities for source reads and `using-platty-mcp`
for Platty project resolution. Do not run a local Platty CLI command.

This skill's only local write exception is a self-contained report under:

```text
~/.platty/design-sync/<projectId>/<targetId>/reports/<reportId>/
```

It must not mutate `~/.platty/specs`, generated-SOT artifacts, repositories,
projects, caches, memory, or Figma. It may write sanitized experiment receipts
only when the caller supplies an explicit experiment path.

## Evidence Rules

Every material assertion is classified as exactly one of:

- `direct`: explicit Figma copy, annotation, prototype reaction, property,
  component identity, variable value, asset identity, or observed geometry;
- `inferred`: an interpretation from layout, naming, repetition, proximity, or
  incomplete structural evidence;
- `missing`: information needed downstream but absent or unavailable.

Never promote `inferred` or `missing` evidence into a product promise. Keep the
source node IDs and the precise observation behind every assertion.

## Required Workflow

Follow `references/workflow.md` in order.

1. Parse and canonicalize the exact target. Resolve `projectId` through Platty
   MCP when report persistence is requested.
2. Inventory Figma MCP capability coverage. Missing capabilities remain
   explicit; do not silently substitute screenshots or local files.
3. Capture a bounded overview and initial metadata snapshot.
4. For a page target, build a Meaningful Section map and derive the complete
   bounded `semanticCandidates` set from normalized initial metadata before
   deep capture. The validator must not trust a model-supplied count alone.
5. Classify every candidate exactly once as a captured State Frame or an
   exclusion with a non-empty reason. Require:

   ```text
   stateFrames + excluded === semanticCandidates
   ```

6. Capture each admitted State Frame using node-specific metadata, screenshot,
   and bounded design context. Capture explicit annotations, interactions,
   components, tokens, and assets when their capabilities and evidence exist.
7. Build assertion-level `direct` / `inferred` / `missing` evidence and record
   warnings plus implementation gaps.
8. Repeat the identical bounded metadata read. Initial and final metadata must
   produce the same `sourceRevision`; otherwise mark `source_drift`, set the
   packet stale, and do not publish it as current.
9. Validate the packet with `scripts/validate-figma-evidence.mjs`.
10. Compute deterministic `reportId`. Reuse an existing byte-identical report;
    do not create another revision merely because observation time changed.
11. Publish one self-contained report only after validation succeeds, then run
    the validator with `--bundle <reportDir>` for byte-level read-back.

## Completion Gate

A page report is current and complete only when:

- target identity and initial/final revisions are present and stable;
- every semantic candidate is captured or excluded exactly once;
- every State Frame has a screenshot and bounded structural evidence, or is
  explicitly blocked with a capability reason;
- assertion classifications are valid;
- capability gaps, coverage limits, warnings, and implementation gaps are
  preserved; and
- the deterministic report bundle validates after write and read-back.

Partial evidence may be saved with `partial`, `blocked`, or `stale` status, but
must not claim full-page completeness or downstream readiness.

## Stop Conditions

Stop and return a capability or evidence gap when:

- the Figma target lacks an exact node ID or cannot be resolved;
- authentication or required Figma MCP capability is unavailable;
- a page target cannot produce an overview or bounded metadata inventory;
- a semantic candidate is missing, duplicated, both selected and excluded, or
  neither selected nor excluded;
- source drift occurs during capture;
- evidence identity or report closure cannot be validated; or
- the requested action would write outside the report exception or would alter
  product, design, tasks, generated-SOT, memory, code, project, or Figma state.

## Output

Return:

- canonical source identity and revision;
- report path and `reportId`, including whether it was created or reused;
- Meaningful Section, State Frame, exclusion, assertion, component, token, and
  asset counts;
- coverage equation and capability matrix;
- drift/freshness status;
- direct, inferred, and missing summaries;
- warnings, implementation gaps, and downstream readiness; and
- a handoff that names the exact current packet path.

Read `../using-platty-mcp/references/figma-evidence-contract.md` before writing
or consuming a packet. Read `references/pressure-scenarios.md` when modifying
or evaluating this skill.
