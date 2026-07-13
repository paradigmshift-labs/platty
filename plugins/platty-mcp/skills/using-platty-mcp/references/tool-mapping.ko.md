# Platty MCP 도구 매핑

이 문서는 MCP 전용 intent-to-tool map이다. local CLI 대응 명령은 나열하지 않는다.

## Capability Tier

| Tier | Required tools | Supported scope |
| --- | --- | --- |
| Minimum retrieval | `project_list`, `project_get`, `context_status`, `project_overview_get`, `glossary_translate`, `epic_list`, `epic_get`, `document_list`, `document_get`, `document_item_list`, `document_item_get`, `document_resolve`, `spec_get` | source-level confirmation 없는 map-first business/spec retrieval |
| Vocabulary inventory / ambiguity | `glossary_list` | 넓거나 완전한 vocabulary inventory, comparison target map, ambiguous concept, every-alias request, blank/conflicting exact translation 이후 candidate discovery |
| Memory overlay reads | `memory_list`, `memory_get` | read-only human/agent correction, constraint, why, context overlay. `memory_list`는 기본 summary card, `memory_get`은 exact body를 읽는다 |
| Memory lifecycle | `memory_add`, `memory_update`, `memory_delete` | 명시적 user intent와 anchor resolution 이후 memory mutation |
| Search assist | `ssot_search`, `ssot_get`, `ssot_resolve`, `document_search`, `spec_list`, `spec_search`, `spec_resolve` | targeted discovery, connected context, source-near anchor resolution |
| Graph/code discovery | `graph_trace`, `code_search` | impact/dependency tracing과 source-location candidate. code claim에는 `code_search`를 `readonly_workspace_shell`과 짝으로 사용한다 |
| Workspace source parity | `workspace_repo_list`, `readonly_workspace_shell` | repository discovery와 후보 발견 이후 bounded read-only grep 및 exact source inspection |
| Artifact access | `sot_file_get` | 저장된 SOT file content access. 그 자체로 factual proof는 아니다 |

## Intent Map

| Intent | Tool | Required input |
| --- | --- | --- |
| Project 목록 | `project_list` | none |
| Project 단건 읽기 | `project_get` | `projectId` |
| Freshness/readiness | `context_status` | `projectId` |
| Project overview | `project_overview_get` | `projectId` |
| Vocabulary inventory | `glossary_list` | `projectId`; optional `limit`, `cursor` |
| Vocabulary normalization | `glossary_translate` | `projectId`, `text` |
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
| Workspace repository inventory | `workspace_repo_list` | `projectId` |
| Bounded repository exploration and source read | `readonly_workspace_shell` | `projectId`, `repoId`, `command`; optional `cwd`, `timeoutMs`, `maxBytes` |

## Missing Tool 동작

- Minimum retrieval tool이 없으면 retrieval 전에 중단하고 MCP configuration gap을
  보고한다.
- Vocabulary inventory/ambiguity tool이 없으면, required tool이 있는 무관한 exact
  API/spec 및 다른 retrieval route는 계속할 수 있다. 선택된 route가 vocabulary
  inventory, comparison, ambiguity resolution, every alias, 또는 blank/conflicting
  `glossary_translate` 이후 candidate discovery를 필요로 하면 중단하고 capability
  gap을 보고한다.
- Search assist tool이 없으면 targeted discovery나 connected context가 필요 없는
  branch만 계속한다.
- Graph/code discovery tool이 없으면 map/spec evidence만으로 답하고 graph/code
  discovery를 사용할 수 없다고 말한다.
- Workspace source-parity tool이 없으면 가능한 graph/code parity는 유지하되,
  repository source parity를 사용할 수 없다고 보고한다. local fallback을 쓰지 않는다.
- Memory overlay tool이 없으면 present한 `epic_get.memories`와
  `document_get.memories`를 사용한다. 그렇지 않으면 local file이나 CLI 대신 memory
  revision/detail을 사용할 수 없다고 말한다.
- Memory lifecycle tool이 없으면 가능한 경우 read-only로 답하거나 memory mutation
  capability gap을 보고한다. MCP에서 local CLI로 fallback하지 않는다.
- Artifact access tool이 없으면 structured evidence로 retrieval question에 답하되,
  stored SOT file content access를 사용할 수 없다고 보고한다.

`memory_add`, `memory_update`, `memory_delete`는 mutation tool이다. read-only
retrieval route가 아니라 `platty-mcp-memory`를 통해서만 사용한다.

Project-wide memory는 project overview document에 저장된다. `project_overview_get`을
호출한 뒤 `overview.id`를 `documentId`로 사용한다. MCP memory write contract에는
project-only anchor가 없다. `project_overview_get.overview`가 null이면 중단하고
epic/document/item anchor를 요청하거나 MCP에서 project-wide memory를 쓸 수 없다고
보고한다.
