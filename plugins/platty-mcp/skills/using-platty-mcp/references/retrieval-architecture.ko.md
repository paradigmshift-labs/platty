# MCP Retrieval Architecture

사용자가 Platty MCP 검색이 어떻게 동작하는지, document와 spec이 어떻게 저장되는지,
`spec_list` 또는 `spec_resolve`가 route에 포함되는지, DB evidence가 stored SOT file과
어떻게 연결되는지 묻는 경우 이 reference를 사용한다.

## Boundary

Platty MCP는 이미 준비된 Platty context DB 위의 read-model transport다. repo를
analyze하거나, document를 generate하거나, file을 export하거나, cache를 refresh하거나,
project를 mutate하거나, local Platty CLI를 실행하지 않는다.

primary evidence store는 `PLATTY_CONTEXT_DB_PATH`다. `PLATTY_CONTEXT_SOT_ROOT`
아래의 stored SOT file은 file content access를 위한 optional projection이다. primary
retrieval path가 아니다.

## Route First

MCP architecture를 설명할 때는 tool route를 먼저 설명한다. DB 구조는 왜 다음 tool이
필요한지 설명할 때만 언급한다.

```text
question
-> choose project and check freshness
-> choose business map or source-near route
-> read exact document/item/spec detail
-> resolve connected context when crossing surfaces
-> use graph/code tools only when source confirmation or impact is required
```

## Route Map

| Question shape | Primary route | Proof threshold |
| --- | --- | --- |
| Project scope, freshness, available context | `project_list` -> `project_get` when needed -> `context_status` -> `project_overview_get` | status/overview는 scope를 잡을 수 있지만 detailed behavior를 증명하지 않는다 |
| Exact, unambiguous domain term 또는 raw phrase | `glossary_translate`; blank/conflicting인데 plausible candidate가 남아 있으면 추가 Korean/English candidate를 translate하기 전에 `glossary_list`를 호출 | glossary는 normalization/routing evidence이지 behavior 또는 source proof가 아니다 |
| Vocabulary inventory, comparison, ambiguity, every-alias request | `glossary_list` first -> targeted candidate가 분명해질 때까지만 paginate하거나, complete inventory면 `pageInfo.hasNextPage: false`까지 진행 -> raw phrase와 candidate에 `glossary_translate` | `aliases`, `generatedAliases`, `memoryAliases`를 구분한다. memory alias는 overlay이고 glossary field는 behavior를 증명하지 않는다 |
| Broad policy, business rule, design, data, journey | `epic_list` -> `epic_get` -> `document_list` -> `document_get` -> `document_item_list` -> `document_item_get` | exact item read가 business-document proof다 |
| Business item to source-near API/screen/event/schedule | `document_resolve(itemId)` -> linked `api_spec`/`screen_spec` candidate rank -> mapping이 더 필요하면 `spec_list` 또는 `spec_search` -> `spec_get` -> `spec_resolve` | exact spec read가 source-near proof다. item-level resolve가 connected context를 완성한다 |
| Known exact spec id | `spec_get` -> `spec_resolve` | exact spec read가 spec을 증명하고, resolve가 connected context를 완성한다 |
| Impact, dependency, implementation location | `document_resolve(itemId)` 또는 `spec_resolve` -> `graph_trace` / `code_search` -> `readonly_workspace_shell` | graph/code candidate와, exact source confirmation이 필요할 때 bounded source read. missing-tool caveat를 명시한다 |
| Original stored SOT file request | `sot_file_get` | file content만 제공한다. structured evidence와 함께 쓰지 않으면 behavior proof가 아니다 |

## Full Ladder

broad product, policy, data, design, journey, impact question에는 map-first ladder를
사용한다.

```text
project_list / project_get / context_status
-> project_overview_get
-> glossary_list first for inventory, comparison, ambiguity, or every-alias routes; after blank/conflicting exact translation, use it before translating additional candidates
-> glossary_translate for the exact/raw phrase and Korean/English candidates
-> epic_list / epic_get
-> memory_list / memory_get overlay when relevant and available
-> document_list by type and epic
-> document_get
-> document_item_list / document_item_get
-> document_resolve(itemId) after exact item reads; use document_resolve(documentId)
   only for document-wide inventory
-> rank linked api_spec and screen_spec candidates
-> spec_list or spec_search when connected source-near specs are incomplete or unknown
-> spec_get before exact source-near behavior claims
-> spec_resolve to expand selected specs to related documents, items, graph seeds, and code seeds
-> graph_trace / code_search / readonly_workspace_shell for impact, location, or source confirmation
```

targeted candidate discovery에서는 필요한 candidate set이 분명해지면 `glossary_list`
pagination을 멈춘다. complete inventory에서는 `pageInfo.hasNextPage`가 false가 될
때까지 `pageInfo.nextCursor`를 따라간다. query expansion에는 `aliases`,
generated vocabulary routing evidence에는 `generatedAliases`, memory overlay에는
`memoryAliases`를 보존한다. behavior claim 전에는 exact document/spec/source evidence로
이어간다.

`document_resolve(itemId)`, `spec_list`, `spec_search`, `spec_get`, `spec_resolve`는
답변에 source-near anchor가 필요할 때 search path의 일부다. business document search
result에서 API shape, screen behavior, event behavior, schedule behavior,
implementation claim으로 바로 점프하지 않는다.

`spec_search`는 paired discovery로 취급한다. candidate를 선택한 뒤에는 source-near,
impact, graph, code, implementation claim을 하기 전에 즉시 `spec_get`과
`spec_resolve`를 실행한다.

## Why These Tools Exist

이 tool들은 agent가 table을 직접 query하지 않고 DB relationship을 볼 수 있게 한다.

```text
project
-> epics
-> documents
   - business documents: br, design, data_dictionary, ucl, ucs
   - source-near specs: api_spec, screen_spec, event_spec, schedule_spec
-> document_items
   - item-level business/design/data/use-case evidence
-> document_item_document_links
   - item -> connected document or spec
-> document_item_item_links
   - item -> related item
-> document_item_relation_links
   - item -> graph/code relation candidate, source node, target, evidence nodes
-> document_item_model_links
   - item -> model or field evidence
```

Memory는 별도 overlay다. 답변을 correct, explain, constrain할 수 있지만 generated
document, spec, graph evidence, source snippet을 대체하지 않는다.

## Evidence Stores

| Store | What it contains | MCP role |
| --- | --- | --- |
| Context DB | projects, repositories, epics, documents, document items, specs, links, graph/code evidence, models, memories | tool을 통한 primary structured retrieval |
| SOT root | Markdown/JSON projection such as catalogs, epic files, specs, indexes, memories, questions | `sot_file_get`을 통한 optional stored file content |

factual answer에는 DB-backed tool을 사용한다. 사용자가 project-relative path로 original
stored SOT file을 읽어 달라고 할 때만 `sot_file_get`을 사용한다.

## Tool Roles

| Tool | Role |
| --- | --- |
| `glossary_list` | comparison, ambiguity, every-alias, blank/conflicting translation route의 inventory와 candidate discovery. pagination은 request에 따라 targeted 또는 complete |
| `glossary_translate` | exact/raw phrase와 선택한 Korean/English candidate를 normalize한다. blank/conflicting output이면 list-based discovery가 필요할 수 있다 |
| `document_list` | type/scope별 business doc 또는 source-near doc을 찾는다 |
| `document_get` | document summary/content envelope를 읽는다 |
| `document_item_list` | item-level BR/DD/DESIGN/UCL/UCS evidence를 찾는다 |
| `document_item_get` | exact item content를 읽는다 |
| `document_resolve` | exact item evidence에서 linked specs, linked docs, items, relation candidates로 가는 첫 bridge. `document_item_get` 뒤에는 `itemId`를 쓰고, `documentId`는 document-wide inventory에 남겨둔다 |
| `spec_list` | kind, scope, status, filter별 source-near spec을 나열한다 |
| `spec_search` | exact spec id를 모를 때 targeted discovery |
| `spec_get` | source-near claim 전에 exact source-near spec detail을 읽는다 |
| `spec_resolve` | spec 선택 뒤 related docs/items와 graph/code seeds로 확장한다 |
| `graph_trace` | 노출되어 있을 때 graph impact 또는 dependency path를 따라간다 |
| `code_search` / `readonly_workspace_shell` | `code_search`는 candidate file/symbol을 찾고, `readonly_workspace_shell`은 exact implementation claim 전에 bounded source를 읽는다 |
| `sot_file_get` | stored SOT file content만 읽는다. 그 자체로 proof가 아니다 |

## SOT Projection Shape

SOT root는 human/file access를 위해 DB evidence를 mirror한다. 일반적인 path는 다음과
같다.

```text
overview.md
catalog/epics.md
catalog/apis.md
catalog/screens.md
catalog/events.md
catalog/schedules.md
epics/<epic-id>/br.md
epics/<epic-id>/design.md
epics/<epic-id>/data_dictionary.md
epics/<epic-id>/usecases/ucl.md
epics/<epic-id>/usecases/ucs.md
specs/api/<name>.md
specs/screen/<name>.md
specs/event/<name>.md
specs/schedule/<name>.md
project/glossary.index.json
project/claim.index.json
```

이 file들은 stored projection으로 취급한다. 사용자가 architecture, search order,
policy, behavior, impact를 묻는다면 structured MCP tool을 먼저 사용하고, SOT file은
사용자가 file content를 요청했을 때만 사용한다.

## Common Mistakes

- `sot_file_get`, catalog text, artifact path를 behavior claim의 proof path로 취급하지 않는다.
- old bundle/download tool name을 사용하지 않는다. 이 MCP profile은 stored file content용 `sot_file_get`만 노출한다.
- broad business question에 `spec_search` 하나로 답하지 않는다. 사용자가 exact spec id를 준 경우가 아니라면 project/epic/document/item map을 먼저 걷는다.
- `spec_get`을 읽기 전에 exact API, screen, event, schedule, graph, code claim에 답하지 않는다. branch가 code parity를 요구하면 source tool을 사용한다.
- source-near branch에서는 selected spec read 뒤 `spec_resolve`를 건너뛰지 않는다. 이것이 related document/item과 graph/code seed context를 완성한다.
- MCP tool 또는 artifact access가 없을 때 local file이나 local Platty CLI로 fallback하지 않는다.
