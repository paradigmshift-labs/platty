# Figma evidence workflow

## 1. Exact target

Parse `fileKey` from `/design/<fileKey>/...` and normalize `node-id=12-34` to
`12:34`. Preserve the canonical URL. Never widen an unresolved Frame or Section
to a Page or file-wide fallback.

Set `targetId` to `<fileKey>-<nodeId with colons replaced by hyphens>`.

## 2. Capability inventory

Record each required or conditional capability as `complete`, `partial`,
`missing`, or `not_applicable`:

- overview screenshot;
- bounded metadata;
- per-State-Frame screenshot;
- bounded design context;
- variables/tokens;
- components or Code Connect/library context; and
- assets.

Load `figma:figma-use` immediately before every `use_figma` call. Record the
actual capability used; tool visibility alone is not successful execution.

## 3. Overview and initial metadata

For a page target, take an overview screenshot and a bounded metadata read that
contains the Page identity, direct semantic boundaries, and direct semantic
children of those boundaries. Do not traverse primitive descendants during
candidate discovery.

Normalize metadata deterministically and hash it as `sourceRevision`. Store the
initial normalized metadata and revision before any per-frame capture.

## 4. Meaningful Sections and semantic candidates

A Meaningful Section is a native Section or a bounded Page-level flow grouping
supported by direct metadata and overview evidence. Record its exact node ID,
name, bounds when available, and evidence classification.

For a page target, the validator derives `semanticCandidates` from normalized
initial metadata: visible Page-level Frames and Component Sets, plus visible
direct Frame and Component Set children of each included Meaningful Section.
Every visible native Section is included or placed in `excludedSections` with a
reason exactly once. Do not add primitive layers, invisible scratch work, or
descendants outside the bounded depth.

Every candidate must appear exactly once in either:

- `stateFrames`, preserving exact node identity; or
- `excluded`, with a specific non-empty reason.

Validate both uniqueness and set equality. Count equality alone is insufficient.
The final count must satisfy:

```text
stateFrames + excluded === semanticCandidates
```

## 5. Bounded capture

For every State Frame:

1. capture a screenshot of that exact node;
2. read node-specific metadata;
3. obtain bounded design context when supported and safe for node size;
4. collect explicit copy and annotations;
5. collect prototype reactions or record their absence;
6. identify component instances and variants;
7. resolve variables/tokens and assets when supported; and
8. record unavailable evidence as `missing`, never as an empty success.

For complex nodes, recurse through bounded metadata and request design context
for smaller implementation-relevant regions. Preserve the parent composition
instead of treating generated code as authoritative product intent.

## 6. Assertion ledger

Use `direct` only for an explicit observed value. Explicit copy and annotation
text are direct. Layout-derived meaning is inferred. A plausible rule that is
not written or wired in Figma is missing product evidence.

Each assertion contains a stable ID, classification, claim, exact source node
IDs, and evidence note. Keep uncertainty on the assertion itself; do not hide it
only in a report-level caveat.

## 7. Final metadata and drift

After every selected State Frame reaches a terminal capture state, repeat the
initial bounded metadata operation with identical target and bounds. Normalize
and hash it as the final revision.

- equal revisions: `stable`;
- unequal revisions or changed admitted node identity: `source_drift`;
- final read failure: `recheck_failed`.

Drift or recheck failure makes the report stale. Do not mix evidence from two
revisions or claim current completeness.

## 8. Validation, identity, and persistence

Validate against the shared `FigmaEvidencePacket` contract. Compute `reportId`
from canonical evidence while excluding observation timestamps and the report
ID itself.

Persist to:

```text
~/.platty/design-sync/<projectId>/<targetId>/reports/<reportId>/
```

The report directory contains at least `figma-evidence-packet.json`, a Korean
`report.md`, normalized initial/final metadata, referenced screenshots and
assets, and an integrity index with path, byte length, and SHA-256.

If the exact report already exists and every indexed byte matches, return
`reused`. If identity matches but bytes differ, stop on integrity conflict.

Run:

```text
node scripts/validate-figma-evidence.mjs --bundle <reportDir>
```

The bundle validator requires the packet, report, both metadata snapshots, all
referenced capture artifacts, safe relative paths, exact bytes and SHA-256, no
unindexed extra files, and a directory name equal to `reportId`.

## 9. Handoff

Downstream skills consume an exact packet path and report ID. They must recheck
source identity, freshness, coverage, and integrity before using it. A partial,
blocked, or stale packet may explain gaps but cannot satisfy a current-evidence
gate.
