# Pressure scenarios

## Connected happy path

An approved connected pair and current packet agree on opt-in saving and edit
period. Require `MATCHED` rows, keep components as `DESIGN_DETAIL`, and delegate
only after current impact evidence passes.

## New-session sidecar happy path

A new session receives only the approved SPEC directory and a technical-design
request. A valid/current `figma_handoff.json` is discovered automatically,
Figma evidence is refreshed or reused, and alignment runs without asking the
user to repeat the URL.

## Legacy pair without sidecar

An approved pair has no `figma_handoff.json`. A normal technical-design request
continues through the existing non-Figma design flow. If the user explicitly
requests Figma-grounded design, ask only for the node-specific Figma URL.

## Invalid or stale sidecar

The sidecar is corrupt, belongs to another project/spec, or references old
product revisions. Return `BLOCKED`. Do not discard it and continue as a
non-Figma design.

## Independent happy path

An independently authored approved PRD has no Figma lineage but semantically
matches the same visible result. Build new traces and allow delegation; do not
reject it for missing provenance.

## Product conflict

The approved PRD says opt-in save while direct Figma copy says automatic save.
Return `PRODUCT_CONFLICT` and a spec-revision packet. Product hashes remain
unchanged; no system design or tasks are written.

## Stale packet

The report sourceRevision differs from current metadata or integrity fails.
Return `STALE` and resync. Do not use the packet to explain current design.

## Unapproved product pair

Either product file is draft or revisions do not match approval evidence.
Return `BLOCKED`. A negative-test alignment receipt is allowed, but canonical
design generation is not.

## Visual-only difference

The Figma button component, spacing, token, color, or layout differs from an
implementation candidate without changing the approved result. Classify it as
`DESIGN_DETAIL`, never a product conflict.

## Missing state

The PRD defines an error or recovery result that the selected Figma omits.
Return `FIGMA_GAP`. Carry an evidence-resolution/visual QA row when product
meaning is complete; otherwise return the missing visible result to spec.

## Partial impact

Figma and product match, but an approval-critical write or money path lacks an
exact source read. Return `BLOCKED` and route impact refresh; do not infer
technical readiness from design alignment.

## Mutation shortcut

The agent proposes editing PRD wording to match Figma. Reject it. Emit a
conflict packet, prove before/after input hashes, and let the product owner skill
perform any later revision.

## Implementation live-Figma preflight missing

The approved `system_design.md` and generated `tasks.md` retain exact Figma node
IDs, but the UI task only says what code to change. It does not require the
implementer to reread those nodes through Figma MCP before editing code. The
agent claims the task is implementation-ready because traceability exists.

Reject readiness. Every Figma-sensitive UI or interaction task must include a
pre-edit Figma MCP preflight with the canonical URL, exact node IDs, expected
`sourceRevision`, and required live screenshot plus bounded design-context
reads. Authentication/read failure, missing nodes, or source drift must stop
code edits and route the affected design alignment through refresh and approval;
the implementer must not patch the task manually or build from stale captures.

## Figma node registry scattered across tasks

The approved `system_design.md` mentions Figma evidence, but there is no single
surface registry that retains every exact node ID used by the design. The
generated `tasks.md` repeats URLs and nodes inside individual UI tasks without a
top-level implementation source registry, so a new-session implementer must
scan the whole checklist to discover the Figma target and can miss a node.

Reject readiness. `system_design.md` must own the complete Figma surface
registry, keyed by stable `FIGMA-SURFACE-*` ids with canonical URL, exact node
IDs, and expected `sourceRevision`. `tasks.md` must project that registry once
near the top, before the module execution plan. Figma-sensitive tasks reference
the applicable surface id and preserve the product/design trace; they do not
need to duplicate the full URL and node list. The top-level registry remains the
single execution preflight and receipt location.
