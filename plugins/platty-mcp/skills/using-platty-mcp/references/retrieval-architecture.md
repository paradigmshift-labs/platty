# MCP Retrieval Architecture

Use this reference when a user asks how Platty MCP search works, how documents
and specs are stored, whether `spec_list` or `spec_resolve` are part of the
route, or how DB evidence relates to stored SOT files.

## Boundary

Platty MCP is a read-model transport over an already prepared Platty context DB.
It does not analyze a repo, generate docs, export files, refresh caches, mutate
projects, or run the local Platty CLI.

The primary evidence store is `PLATTY_CONTEXT_DB_PATH`. Stored SOT files under
`PLATTY_CONTEXT_SOT_ROOT` are an optional projection for file content access.
They are not the primary retrieval path.

## Route First

Explain MCP architecture by the tool route first. Mention DB structure only to
explain why the next tool is needed.

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
| Project scope, freshness, available context | `project_list` -> `project_get` when needed -> `context_status` -> `project_overview_get` | status/overview can frame scope, not prove detailed behavior |
| Domain term, alias, Korean/English wording | `glossary_translate` -> continue to the relevant route | glossary is normalization, not proof |
| Broad policy, business rule, design, data, journey | `epic_list` -> `epic_get` -> `document_list` -> `document_get` -> `document_item_list` -> `document_item_get` | exact item read is the business-document proof |
| Business item to source-near API/screen/event/schedule | `document_resolve` -> rank linked `api_spec`/`screen_spec` candidates -> `spec_list` or `spec_search` when more mapping is needed -> `spec_get` -> `spec_resolve` | exact spec read is the source-near proof; resolve completes connected context |
| Known exact spec id | `spec_get` -> `spec_resolve` | exact spec read proves the spec; resolve completes connected context |
| Impact, dependency, implementation location | `document_resolve` or `spec_resolve` -> `graph_trace` / `code_search` -> `code_snippet` | graph/code result or snippet, with missing-tool caveat when unavailable |
| Original stored SOT file request | `sot_file_get` | file content only; not proof for behavior unless paired with structured evidence |

## Full Ladder

For broad product, policy, data, design, journey, or impact questions, use the
map-first ladder:

```text
project_list / project_get / context_status
-> project_overview_get
-> glossary_translate when terms, aliases, or Korean/English mapping matter
-> epic_list / epic_get
-> memory_list / memory_get overlay when relevant and available
-> document_list by type and epic
-> document_get
-> document_item_list / document_item_get
-> document_resolve
-> rank linked api_spec and screen_spec candidates
-> spec_list or spec_search when connected source-near specs are incomplete or unknown
-> spec_get before exact source-near behavior claims
-> spec_resolve to expand selected specs to related documents, items, graph seeds, and code seeds
-> graph_trace / code_search / code_snippet for impact, location, or source confirmation
```

`document_resolve`, `spec_list`, `spec_search`, `spec_get`, and `spec_resolve`
are part of the search path when the answer needs source-near anchors. Do not
skip from a business document search result directly to a claim about API shape,
screen behavior, event behavior, schedule behavior, or implementation.

Treat `spec_search` as paired discovery: after it selects a candidate, immediately run `spec_get` and `spec_resolve` before making source-near, impact, graph, code, or implementation claims.

## Why These Tools Exist

The tools expose DB relationships without requiring the agent to query tables
directly:

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

Memory is a separate overlay. It can correct, explain, or constrain an answer,
but it does not replace generated documents, specs, graph evidence, or source
snippets.

## Evidence Stores

| Store | What it contains | MCP role |
| --- | --- | --- |
| Context DB | projects, repositories, epics, documents, document items, specs, links, graph/code evidence, models, memories | primary structured retrieval through tools |
| SOT root | Markdown/JSON projection such as catalogs, epic files, specs, indexes, memories, questions | optional stored file content through `sot_file_get` |

Use DB-backed tools for factual answers. Use `sot_file_get` only when the user
asks to read an original stored SOT file by project-relative path.

## Tool Roles

| Tool | Role |
| --- | --- |
| `document_list` | finds business docs or source-near docs by type/scope |
| `document_get` | reads one document summary/content envelope |
| `document_item_list` | finds item-level BR/DD/DESIGN/UCL/UCS evidence |
| `document_item_get` | reads exact item content |
| `document_resolve` | first bridge from document/item evidence to linked specs, linked docs, items, relation candidates |
| `spec_list` | lists source-near specs by kind, scope, status, or filters |
| `spec_search` | targeted discovery when the exact spec id is unknown |
| `spec_get` | reads exact source-near spec detail before source-near claims |
| `spec_resolve` | post-selection expansion from a spec to related docs/items plus graph/code seeds |
| `graph_trace` | follows graph impact or dependency paths when exposed |
| `code_search` / `code_snippet` | confirms exact code location or implementation when exposed |
| `sot_file_get` | reads stored SOT file content only; not proof by itself |

## SOT Projection Shape

The SOT root mirrors DB evidence for human/file access. Common paths include:

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

Treat these files as a stored projection. If the user asks about architecture,
search order, policy, behavior, or impact, prefer structured MCP tools first
and use SOT files only as requested file content.

## Common Mistakes

- Do not treat `sot_file_get`, catalog text, or artifact paths as the proof path
  for behavior claims.
- Do not use old bundle/download tool names. This MCP profile exposes
  `sot_file_get` for stored file content only.
- Do not answer broad business questions from `spec_search` alone. Walk the
  project/epic/document/item map first unless the user gave an exact spec id.
- Do not answer exact API, screen, event, schedule, graph, or code claims before
  reading `spec_get`; use source tools when the branch requires code parity.
- Do not skip `spec_resolve` after selected spec reads in source-near branches;
  it completes related document/item and graph/code seed context.
- Do not fall back to local files or the local Platty CLI when MCP tools or
  artifact access are missing.
