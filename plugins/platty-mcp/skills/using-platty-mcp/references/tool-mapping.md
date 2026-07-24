# Platty MCP Tool Mapping

This is the MCP-only intent-to-tool map. It does not list local CLI
equivalents. Treat the live `tools/list` schema as authoritative if a deployed
server differs from this reference.

## Capability Tiers

| Tier | Required tools | Supported scope |
| --- | --- | --- |
| Minimum retrieval | `project_list`, `project_get`, `context_status`, `project_overview_get`, `glossary_translate`, `epic_list`, `epic_get`, `document_list`, `document_get`, `document_item_list`, `document_item_get`, `document_spec_resolve`, `spec_get` | map-first business-to-Spec retrieval |
| Reverse business context | `spec_document_resolve` | selected Spec to directly linked business items, documents, and EPICs |
| Technical impact | `spec_impact_resolve`, `graph_trace` | selected Spec to one-hop technical impact, then explicit frontier expansion |
| Vocabulary inventory / ambiguity | `glossary_list` | complete vocabulary inventory or ambiguous candidate discovery |
| Search assist | `document_search`, `spec_search`, `spec_list` | targeted discovery or complete EPIC-scoped Spec inventory |
| Graph/code discovery | `graph_trace`, `code_search` | one-hop relationship maps and source-location candidates |
| Workspace source parity | `workspace_repo_list`, `readonly_workspace_shell` | bounded repository discovery, grep, and exact source reads |
| Workspace Git observability | `workspace_repo_list`, `workspace_git_history`, `workspace_sync_status` | managed-worktree history and cached freshness; no fetch or deployment evidence |
| Memory overlay reads | `memory_list`, `memory_get` | read-only human/agent corrections, constraints, why, and context overlays |
| Memory lifecycle | `memory_add`, `memory_update`, `memory_delete` | explicit memory mutation after user intent and anchor resolution |
| Glossary alias lifecycle | `glossary_alias_list`, `glossary_alias_add`, `glossary_alias_remove` | explicit EPIC-scoped vocabulary-overlay lifecycle |
| Artifact access | `sot_file_get` | stored SOT file content, not factual proof by itself |

## Map And Exact-Read Tools

| Intent | Tool | Required input |
| --- | --- | --- |
| List projects | `project_list` | none |
| Read one project | `project_get` | `projectId` |
| Freshness/readiness | `context_status` | `projectId` |
| Project overview | `project_overview_get` | `projectId`; optional `memoryMode=summary\|full\|none` |
| Epic catalog | `epic_list` | `projectId`; optional `status`, `limit`, `cursor` |
| Epic detail and routing refs | `epic_get` | `projectId`, `epicId` |
| Scoped document cards | `document_list` | `projectId` and at least one of `epicId` or `documentType`; optional `limit`, `cursor` |
| Business document map | `document_get` | `projectId`, `id` |
| Paginated document items | `document_item_list` | `projectId`, `documentId`; optional `itemType`, `limit`, `cursor` |
| Exact business items | `document_item_get` | `projectId`, `itemIds` (1-5 unique IDs); optional `detail=summary\|full` |
| Business items to Specs | `document_spec_resolve` | `projectId`, `itemIds` (1-5); optional `limit`, `cursor` |
| Complete EPIC Spec inventory | `spec_list` | `projectId`, `epicId`; optional `specKind`, `limit`, `cursor` |
| Exact Spec detail | `spec_get` | `projectId`, `id` |
| Specs to business context | `spec_document_resolve` | `projectId`, `specIds` (1-5); optional `limit`, `cursor` |
| Specs to technical impact | `spec_impact_resolve` | `projectId`, `specIds` (1-5); optional `direction=upstream\|downstream\|both`, `limit`, `cursor` |

`epic_get.documentRefs` is the normal entry to the four core business
documents: BR, DESIGN, DD (`data_dictionary`), and UCL. Open those IDs directly
with `document_get`. Do not call `document_list` merely to rediscover refs that
`epic_get` already returned.

`document_get` is a typed router:

- BR and UCL return an authored item map; select IDs and call
  `document_item_get`.
- DESIGN returns its authored topics and DESIGN items; select IDs and call
  `document_item_get`.
- DD returns Entity cards; call `document_item_get` with `detail=summary` first
  and request `full` only when the field-level body is needed.

Use `document_item_list` only for pagination, an explicit complete item
inventory, or a narrowed `itemType` view. Arrays accept at most five IDs. Split
larger selections into multiple calls. Batched results preserve input order,
and shared `sourcePath`/`next` metadata is returned once rather than repeated
per item.

DD is a business data dictionary, not a source-near Spec bridge. Follow its
Entity relationships by returned item IDs. Use `graph_trace` only when an
explicit table/code node must be investigated.

## Search And Graph Tools

| Intent | Tool | Required input |
| --- | --- | --- |
| Business document/item discovery | `document_search` | `projectId`, `query`; optional `matchMode=smart\|all\|any\|phrase`, `filters`, `limit`, `cursor` |
| Spec discovery | `spec_search` | `projectId`, `query`; optional `matchMode`, `epicId`, `specKind`, `limit`, `cursor` |
| One-hop graph trace | `graph_trace` | `projectId`, `nodeIds` (1-5); optional `direction=upstream\|downstream\|both`, `kinds`, `limit` |
| Code symbol/location search | `code_search` | `projectId`, `query`; optional `repoId`, `limit` |
| Workspace repository inventory | `workspace_repo_list` | `projectId` |
| Managed-worktree Git history | `workspace_git_history` | `projectId`, `repoId`; optional `limit` (1-50), `path` |
| Analysis worktree freshness | `workspace_sync_status` | `projectId`, `repoId` |
| Bounded repository exploration | `readonly_workspace_shell` | `projectId`, `repoId`, `command`; optional `cwd`, `timeoutMs`, `maxBytes` |

Use `document_search` and `spec_search` only when exact IDs are absent. Both
accept multi-word natural-language queries. Their match modes mean:

- `smart`: normalized terms and useful token variants;
- `all`: every query token must match;
- `any`: at least one query token may match;
- `phrase`: the phrase must match.

Search results are routing cards, not proof. Open selected document/item/Spec
IDs with the corresponding exact-read tool.

`graph_trace` is deliberately one hop. Its result separates confirmed edges,
unresolved candidates, and frontier node IDs. Continue only a needed branch by
calling `graph_trace` again with frontier IDs; the MCP skill, not the server,
owns multi-depth traversal and its visited set.

## Vocabulary, Memory, And Artifact Tools

| Intent | Tool | Required input |
| --- | --- | --- |
| Vocabulary inventory | `glossary_list` | `projectId`; optional `limit`, `cursor` |
| Vocabulary normalization | `glossary_translate` | `projectId`, `text` |
| Glossary alias list | `glossary_alias_list` | `projectId`; optional `epicId`, `includeDeleted` |
| Glossary alias add | `glossary_alias_add` | `projectId`, `epicId`, `term`, `canonicalTerm`; optional `actor` |
| Glossary alias remove | `glossary_alias_remove` | `projectId`, `epicId`, `term`, `reason`; optional `actor` |
| Memory list | `memory_list` | `projectId`; optional `epicId`, `documentId`, `level`, `includeDeleted`, `memoryMode=summary\|full` |
| Memory detail | `memory_get` | `projectId`, `memoryId` |
| Memory add | `memory_add` | `projectId`, `content`; optional anchor and metadata fields |
| Memory update | `memory_update` | `projectId`, `memoryId`, `content`, `reason`; optional `actor` |
| Memory delete | `memory_delete` | `projectId`, `memoryId`, `reason`; optional `actor` |
| Stored SOT content | `sot_file_get` | `projectId`, `path` |

Project-wide memory is stored on the project overview document: call
`project_overview_get`, then use `overview.id` as `documentId`. If
`project_overview_get.overview` is null, stop and ask for an EPIC, document, or
item anchor.

Mutation tools are used only through `platty-mcp-memory` after explicit user
intent.

## Missing Tool Behavior

- Missing minimum retrieval tools: stop and report the exact MCP capability
  gap.
- Missing one directional resolver: continue only branches that do not require
  that direction and name the missing bridge.
- Missing search tools: continue exact-ID routes; do not claim discovery
  completeness.
- Missing graph/code tools: answer only from document and Spec evidence and
  state that technical traversal or source confirmation is unavailable.
- Missing workspace source tools: do not substitute host-local files or CLI.
- Missing Git tools: do not send Git commands through the restricted workspace
  shell.
- Missing memory or glossary lifecycle tools: keep the route read-only and do
  not emulate a mutation with another tool.
- Missing artifact access: answer from structured evidence but report that the
  stored file body is unavailable.
