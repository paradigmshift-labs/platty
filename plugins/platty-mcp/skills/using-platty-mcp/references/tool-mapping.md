# Platty MCP Tool Mapping

This is the MCP-only intent-to-tool map. It does not list local CLI equivalents.

## Capability Tiers

| Tier | Required tools | Supported scope |
| --- | --- | --- |
| Minimum retrieval | `project_list`, `project_get`, `context_status`, `project_overview_get`, `glossary_translate`, `epic_list`, `epic_get`, `document_list`, `document_get`, `document_item_list`, `document_item_get`, `document_resolve`, `spec_get` | map-first business/spec retrieval without source-level confirmation |
| Vocabulary inventory / ambiguity | `glossary_list` | broad or complete vocabulary inventory, comparison target maps, ambiguous concepts, every-alias requests, and candidate discovery after blank/conflicting exact translation |
| Memory overlay reads | `memory_list`, `memory_get` | read-only human/agent correction, constraint, why, and context overlays; `memory_list` defaults to summary cards, `memory_get` reads exact bodies |
| Memory lifecycle | `memory_add`, `memory_update`, `memory_delete` | explicit memory mutation after user intent and anchor resolution |
| Glossary alias lifecycle | `glossary_alias_list`, `glossary_alias_add`, `glossary_alias_remove` | explicit EPIC-scoped vocabulary-overlay listing, addition, correction, and removal |
| Search assist | `ssot_search`, `ssot_get`, `ssot_resolve`, `document_search`, `spec_list`, `spec_search`, `spec_resolve` | targeted discovery, connected context, and source-near anchor resolution |
| Graph/code discovery | `graph_trace`, `code_search` | impact/dependency tracing and source-location candidates; pair `code_search` with `readonly_workspace_shell` for code claims |
| Workspace source parity | `workspace_repo_list`, `readonly_workspace_shell` | repository discovery plus bounded read-only grep and exact source inspection after candidates are found |
| Workspace Git observability | `workspace_repo_list`, `workspace_git_history`, `workspace_sync_status` | bounded managed-worktree history and cached branch/analysis freshness; no fetch and no production deployment evidence |
| Artifact access | `sot_file_get` | stored SOT file content access, not factual proof by itself |

## Intent Map

| Intent | Tool | Required input |
| --- | --- | --- |
| List projects | `project_list` | none |
| Read one project | `project_get` | `projectId` |
| Freshness/readiness | `context_status` | `projectId` |
| Project overview | `project_overview_get` | `projectId` |
| Vocabulary inventory | `glossary_list` | `projectId`; optional `limit`, `cursor` |
| Vocabulary normalization | `glossary_translate` | `projectId`, `text` |
| Glossary alias list | `glossary_alias_list` | `projectId`; optional `epicId`, `includeDeleted` |
| Glossary alias add | `glossary_alias_add` | `projectId`, `epicId`, `term`, `canonicalTerm`; optional `actor` |
| Glossary alias remove | `glossary_alias_remove` | `projectId`, `epicId`, `term`, `reason`; optional `actor` |
| Epic catalog | `epic_list` | `projectId` |
| Epic detail | `epic_get` | `projectId`, `epicId` |
| Memory list | `memory_list` | `projectId`; optional `epicId`, `documentId`, `level`, `includeDeleted`, `memoryMode=summary|full` |
| Memory detail | `memory_get` | `projectId`, `memoryId` |
| Memory add | `memory_add` | `projectId`, `content`; optional `epicId`, `documentId`, `itemType`, `itemKey`, `memoryKind`, `actor`, `confidence` |
| Memory update | `memory_update` | `projectId`, `memoryId`, `content`, `reason`; optional `actor` |
| Memory delete | `memory_delete` | `projectId`, `memoryId`, `reason`; optional `actor` |
| Document list | `document_list` | `projectId`; optional `documentType`, `epicId`, `status`, `limit`, `cursor` |
| Document detail | `document_get` | `projectId`, `id` |
| Business document items | `document_item_list` | `projectId`, `documentId`; optional `itemType`, `limit`, `cursor` |
| Business document item detail | `document_item_get` | `projectId`, `itemId` |
| Document/item connected context | `document_resolve` | `projectId` plus `documentId` or `itemId` |
| Spec list (complete inventory) | `spec_list` | `projectId`; optional `specKind`, `scopeId`, `status`, `filters`, `limit`, `cursor`; follow `nextCursor` until `hasNextPage` is false |
| Spec search (targeted discovery; not a completeness surface) | `spec_search` | `projectId`, `query`; follow selected hits with `spec_get` and `spec_resolve` |
| Spec detail | `spec_get` | `projectId`, `id` |
| Spec connected context | `spec_resolve` | `projectId`, `id` |
| Stored SOT file content | `sot_file_get` | `projectId`, `path` |
| SSOT targeted discovery | `ssot_search` | `projectId`, `query` |
| SSOT detail | `ssot_get` | `projectId`, `id` |
| SSOT connected context | `ssot_resolve` | `projectId`, `id` |
| Document targeted discovery | `document_search` | `projectId`, `query` |
| Graph impact/dependency trace | `graph_trace` | `projectId`, `from` |
| Code symbol/location search | `code_search` | `projectId`, `query`; optional `repoId`, `limit` |
| Workspace repository inventory | `workspace_repo_list` | `projectId` |
| Managed-worktree Git history | `workspace_git_history` | `projectId`, `repoId`; optional `limit` (1-50), `path` below analyzed source root |
| Analysis worktree and cached branch freshness | `workspace_sync_status` | `projectId`, `repoId` |
| Bounded repository exploration and source read | `readonly_workspace_shell` | `projectId`, `repoId`, `command`; optional `cwd`, `timeoutMs`, `maxBytes` |

## Missing Tool Behavior

- Missing minimum retrieval tools: stop before retrieval and report MCP
  configuration gap.
- Missing vocabulary inventory/ambiguity tools: continue unrelated exact
  API/spec and other retrieval routes whose required tools are present. Stop and
  report the capability gap when the selected route requires vocabulary
  inventory, comparison, ambiguity resolution, every alias, or candidate
  discovery after blank/conflicting `glossary_translate`.
- Missing search assist tools: continue only for branches that do not require
  targeted discovery or connected context.
- Missing graph/code discovery tools: answer only from map/spec evidence and say
  graph/code discovery is unavailable.
- Missing workspace source-parity tools: retain graph/code parity when it is
  available; otherwise report that repository source parity is unavailable. Do
  not use a local fallback.
- Missing workspace Git observability tools: do not pass `git log` to
  `readonly_workspace_shell` or use local CLI/files as a substitute. Report
  that managed-worktree history or freshness is unavailable.
- Missing memory overlay tools: use attached `epic_get.memories` and
  `document_get.memories` when present; otherwise name memory revision/detail as
  unavailable instead of using local files or CLI.
- Missing memory lifecycle tools: answer read-only when possible, or report a
  memory mutation capability gap. Do not fall back to local CLI from MCP.
- Missing glossary alias lifecycle tools: continue unrelated memory and
  retrieval routes, but stop the requested alias operation and name the exact
  missing `glossary_alias_*` capability. Do not emulate it with `memory_add`.
- Missing artifact access tools: answer retrieval questions from structured
  evidence, but report that stored SOT file content access is unavailable.

`memory_add`, `memory_update`, and `memory_delete` are mutation tools. Use them
only through `platty-mcp-memory`, not from the read-only retrieval route.
`glossary_alias_add` and `glossary_alias_remove` are also mutation tools and use
the same explicit-intent gate through `platty-mcp-memory`.

Project-wide memory is stored on the project overview document: call
`project_overview_get`, then use `overview.id` as `documentId`. The MCP memory
write contract has no project-only anchor. If `project_overview_get.overview`
is null, stop and ask for an epic/document/item anchor or report that
project-wide memory cannot be written from MCP.
