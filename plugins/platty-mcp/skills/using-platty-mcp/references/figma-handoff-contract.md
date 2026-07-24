# Figma handoff contract

`figma_handoff.json` is an optional, revision-bound routing sidecar for carrying
Figma lineage from product authoring into a later technical-design session. It
does not replace `prd.md`, `user_stories.md`, or the full Figma evidence bundle.

## Location and ownership

```text
~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/figma_handoff.json
```

Only `platty-mcp-sdd-spec-from-figma` writes the sidecar. The canonical design
owner reads it through `loadOptionalFigmaHandoff` in
`../scripts/figma-handoff.mjs`. Arbitrary JSON paths are not eligible for
automatic discovery.

## Schema

```json
{
  "schemaVersion": "figma-handoff.v1",
  "projectId": "<projectId>",
  "specId": "<SPEC-id>",
  "productInput": {
    "requestRevision": "sha256:<64 lowercase hex>",
    "storiesRevision": "sha256:<64 lowercase hex>"
  },
  "source": {
    "canonicalUrl": "https://www.figma.com/design/<fileKey>/<name>?node-id=1-2",
    "fileKey": "<fileKey>",
    "nodeId": "1:2",
    "targetId": "<fileKey>-1-2",
    "targetType": "PAGE",
    "targetName": "<page name>",
    "reportId": "<64 lowercase hex>",
    "sourceRevision": "<64 lowercase hex>"
  },
  "coverageStatus": "complete",
  "mappings": [
    {
      "figmaNodeIds": ["2:1"],
      "productIds": ["R-01", "AC-01"],
      "storyScenarioIds": ["US-01", "SC-01"],
      "evidenceClass": "direct",
      "disposition": "MATCHED"
    }
  ]
}
```

The sidecar stores identity and trace mappings only. Screenshots, design
context, components, tokens, and integrity files stay under the owning
`~/.platty/design-sync/.../reports/<reportId>/` bundle.

## Read behavior

- Missing file: return `null`; standard non-Figma technical design remains
  backward compatible.
- Valid/current file: route automatically through
  `platty-mcp-sdd-design-with-figma`.
- Invalid JSON or schema: `INVALID_FIGMA_HANDOFF`; block.
- Project/spec mismatch: `FIGMA_HANDOFF_MISMATCH`; block.
- Request/story revision mismatch: `STALE_FIGMA_HANDOFF`; block.

An existing invalid or stale sidecar is never treated as absent. The design
route must not silently discard known Figma lineage.

## Refresh and projection

The writer binds the sidecar only after the final product-pair write for the
current response. It reads back `prd.md` and `user_stories.md`, computes their
canonical revisions, atomically replaces `figma_handoff.json`, loads it with the
expected revisions, and validates that result before responding. Any subsequent
product edit invalidates the old binding and repeats this entire sequence.

The design-with-Figma gate uses the canonical URL and source identity to reuse
or refresh the full evidence packet through Figma MCP. It then re-evaluates
semantic alignment. `system_design.md` retains canonical URL, file/node,
report/source revisions, and alignment rows; Figma-sensitive tasks retain exact
node IDs and product/story/design-decision trace.
