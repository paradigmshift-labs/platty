# Figma evidence contract

`FigmaEvidencePacket` is the reusable, revision-bound handoff from a Figma
target to Platty MCP product or technical SDD orchestration. It records design
evidence and uncertainty; it does not own product or system-design documents.

## Persistence

One validated report is stored at:

```text
~/.platty/design-sync/<projectId>/<targetId>/reports/<reportId>/
```

`targetId` binds `fileKey` and `nodeId`. `reportId` is a deterministic hash of
canonical evidence, excluding observation timestamps and `reportId` itself.

## Required shape

```json
{
  "schemaVersion": "figma-evidence-packet.v1",
  "status": "complete",
  "sourceIdentity": {
    "canonicalUrl": "https://www.figma.com/design/<fileKey>/<name>?node-id=1-2",
    "fileKey": "<fileKey>",
    "nodeId": "1:2",
    "targetId": "<fileKey>-1-2",
    "targetType": "PAGE",
    "sourceRevision": "<sha256-of-normalized-initial-metadata>"
  },
  "metadata": {
    "initial": {
      "target": { "fileKey": "<fileKey>", "nodeId": "1:2", "type": "PAGE", "name": "Page" },
      "boundaries": []
    },
    "final": {
      "target": { "fileKey": "<fileKey>", "nodeId": "1:2", "type": "PAGE", "name": "Page" },
      "boundaries": []
    }
  },
  "capabilities": {
    "overview": "complete",
    "metadata": "complete",
    "screenshot": "complete",
    "designContext": "partial",
    "variables": "missing",
    "components": "partial",
    "assets": "partial"
  },
  "meaningfulSections": [],
  "excludedSections": [],
  "semanticCandidates": [],
  "stateFrames": [],
  "excluded": [],
  "annotations": [],
  "interactions": [],
  "components": [],
  "tokens": [],
  "assets": [],
  "assertions": [],
  "coverage": {
    "semanticCandidates": 0,
    "stateFrames": 0,
    "excluded": 0,
    "exactlyOnce": true,
    "status": "complete"
  },
  "drift": {
    "initialSourceRevision": "<sha256>",
    "finalSourceRevision": "<sha256>",
    "status": "stable",
    "driftedNodeIds": []
  },
  "warnings": [],
  "implementationGaps": []
}
```

## Source and freshness

`sourceIdentity` binds `canonicalUrl`, `fileKey`, exact `nodeId`, target type,
`targetId`, and `sourceRevision`. The initial and final metadata snapshots use
the same bounded operation. Their hashes are stored as
`initialSourceRevision` and `finalSourceRevision`.

If the revisions differ, drift status is `source_drift` and packet coverage
status is `stale`. A final metadata failure uses `recheck_failed` and is also
stale. A downstream consumer must reject a stale packet as current evidence.

## Evidence classification

Every assertion uses one classification:

- `direct`: explicit copy, annotation, reaction, node/property identity,
  component/variant, variable value, asset identity, or observed geometry;
- `inferred`: interpretation derived from layout, naming, proximity,
  repetition, or incomplete structure;
- `missing`: required information absent from the captured source or capability.

Explicit copy may be `direct`. Layout evidence must be `inferred`. Neither
`inferred` nor `missing` can become a product rule without the owning product
flow making and approving that decision.

Classification uses a closed `basis` vocabulary. Direct bases are
`explicit_copy`, `explicit_annotation`, `prototype_reaction`, `node_property`,
`component_identity`, `variable_value`, `asset_identity`, and
`observed_geometry`. Inferred bases are `layout`, `name`, `proximity`,
`repetition`, `visual_hierarchy`, `color`, `grouping`, `paraphrase`, and
`incomplete_structure`. Missing bases are `absent` and
`capability_unavailable`. Direct copy and annotation assertions preserve an
exact `quotedValue`; a paraphrase cannot validate as direct copy.

## Page coverage

For a page target, `semanticCandidates` is a set of exact node IDs derived by
the validator from normalized initial metadata. Every visible native Section is
represented exactly once in `meaningfulSections` or `excludedSections`; visible
direct Frames and Component Sets of included Sections plus visible Page-level
Frames and Component Sets form the candidate set. Every candidate appears
exactly once in `stateFrames` or `excluded`, and no unknown ID may appear in
either collection. An exclusion has a non-empty reason.

Set equality is mandatory in addition to the count equation:

```text
stateFrames + excluded === semanticCandidates
```

## Capability and gaps

The closed capability set is `overview`, `metadata`, `screenshot`,
`designContext`, `variables`, `components`, and `assets`. Capabilities use
`complete`, `partial`, `missing`, or `not_applicable`.
Unavailable evidence becomes an explicit `missing` assertion, warning, or
implementation gap. Screenshot availability does not substitute for metadata,
design context, components, variables, interactions, or assets.

Every State Frame contains `capture.metadata`, `capture.screenshot`, and
`capture.designContext` receipts. A receipt is `complete`, `partial`, `missing`,
or `blocked`; successful receipts name a safe relative artifact and failed
receipts name a reason. Packet status `complete` requires all three receipts and
the four core capabilities (`overview`, `metadata`, `screenshot`,
`designContext`) to be complete.

## Reuse and integrity

Canonical key sorting makes packet identity deterministic. Observation time is
provenance but not identity. A matching `reportId` may be reused only when the
integrity index proves that every required file has identical bytes. Identity
collision with different bytes is a stop condition.

`integrity-index.json` uses schema `figma-evidence-index.v1` and records
`reportId`, path, byte length, and SHA-256 for every report file except the index
itself. Bundle validation requires `figma-evidence-packet.json`, `report.md`,
both normalized metadata snapshots, every referenced capture/asset artifact,
safe relative paths, exact indexed file closure, and a directory basename equal
to `reportId`.
