# Platty MCP Tool Mapping

This is the MCP-only intent-to-tool map. It does not list local CLI equivalents.

## Capability Tiers

| Tier | Required tools | Supported scope |
| --- | --- | --- |
| Minimum retrieval | `project_list`, `project_get`, `context_status`, `project_overview_get`, `glossary_translate`, `epic_list`, `epic_get`, `document_list`, `document_get`, `document_item_list`, `document_item_get`, `document_resolve`, `spec_get` | map-first business/spec retrieval without source-level confirmation |
| Search assist | `ssot_search`, `ssot_get`, `ssot_resolve`, `document_search`, `spec_list`, `spec_search`, `spec_resolve` | targeted discovery, connected context, and source-near anchor resolution |
| Source parity | `graph_trace`, `code_search`, `code_snippet` | impact, exact code location, source confirmation, and negative source evidence |
| Artifact access | `sot_file_get` | stored SOT file content access, not factual proof by itself |

## Intent Map

| Intent | Tool | Required input |
| --- | --- | --- |
| List projects | `project_list` | none |
| Read one project | `project_get` | `projectId` |
| Freshness/readiness | `context_status` | `projectId` |
| Project overview | `project_overview_get` | `projectId` |
| Vocabulary normalization | `glossary_translate` | `projectId`, `text` |
| Epic catalog | `epic_list` | `projectId` |
| Epic detail | `epic_get` | `projectId`, `epicId` |
| Document list | `document_list` | `projectId`; optional `documentType`, `epicId`, `entityName`, `status`, `limit`, `cursor` |
| Document detail | `document_get` | `projectId`, `id` |
| Business document items | `document_item_list` | `projectId`, `documentId`; optional `itemType`, `query`, `limit`, `cursor` |
| Business document item detail | `document_item_get` | `projectId`, `itemId` |
| Document/item connected context | `document_resolve` | `projectId` plus `documentId` or `itemId` |
| Spec list | `spec_list` | `projectId`; optional `specKind`, `scopeId`, `status`, `filters`, `limit`, `cursor` |
| Spec search | `spec_search` | `projectId`, `query` |
| Spec detail | `spec_get` | `projectId`, `id` |
| Spec connected context | `spec_resolve` | `projectId`, `id` |
| Stored SOT file content | `sot_file_get` | `projectId`, `path` |
| SSOT targeted discovery | `ssot_search` | `projectId`, `query` |
| SSOT detail | `ssot_get` | `projectId`, `id` |
| SSOT connected context | `ssot_resolve` | `projectId`, `id` |
| Document targeted discovery | `document_search` | `projectId`, `query` |
| Graph impact/dependency trace | `graph_trace` | `projectId`, `from` |
| Code symbol/location search | `code_search` | `projectId`, `query`; optional `repoId`, `limit` |
| Source snippet | `code_snippet` | `projectId`, `repoId`, `file`, `lines` |

## Missing Tool Behavior

- Missing minimum retrieval tools: stop before retrieval and report MCP
  configuration gap.
- Missing search assist tools: continue only for branches that do not require
  targeted discovery or connected context.
- Missing source parity tools: answer only from map/spec evidence and say source
  confirmation is unavailable.
- Missing artifact access tools: answer retrieval questions from structured
  evidence, but report that stored SOT file content access is unavailable.
