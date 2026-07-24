# MCP Retrieval Architecture

Use this reference when explaining how Platty MCP retrieval works, how business
documents and Specs connect, or why the route changes direction.

## Boundary

Platty MCP is a typed read model over an already prepared context DB. It does
not analyze repositories, regenerate documents, refresh caches, mutate
projects, or run the local Platty CLI.

The context DB is the primary evidence store. Stored SOT files are an optional
projection for explicit file-body requests through `sot_file_get`; they are not
the normal factual retrieval path.

## Route First

```text
question
-> project and freshness
-> EPIC map
-> epic_get.documentRefs
-> typed business document map
-> exact business items
-> selected Specs
-> optional reverse business context or technical impact
-> exact source read when the claim requires it
```

Search is a fallback for unknown IDs. It does not replace the map-first route.

## Three Separate Bridges

The former bidirectional expansion is split so every response has one purpose:

| Direction | Tool | Returns |
| --- | --- | --- |
| Business item -> Spec | `document_spec_resolve(itemIds)` | directly stored API, screen, event, and schedule Spec refs plus code-evidence refs |
| Spec -> business | `spec_document_resolve(specIds)` | directly linked business items, their documents, and owning EPIC refs |
| Spec -> technical | `spec_impact_resolve(specIds, direction)` | one-hop technical upstream/downstream edges |

These tools do not recursively return full document or Spec bodies. Select IDs,
then use `document_item_get` or `spec_get`.

Each result is grouped by the exact input key: `itemId` for
`document_spec_resolve`, and `specId` for `spec_document_resolve` or
`spec_impact_resolve`. Each `to` is a lightweight linked target. This grouping
keeps batched results traceable without repeating a `from` object.

## Typed Business Documents

`epic_get` returns the four core `documentRefs`: BR, DESIGN, DD, and UCL. They
are fixed EPIC children, so open their IDs directly with `document_get`.

| Type | `document_get` role | Exact-read continuation |
| --- | --- | --- |
| BR | item map; hides duplicated document body | `document_item_get(itemIds)` then `document_spec_resolve(itemIds)` |
| UCL | use-case item map | `document_item_get(itemIds)` then `document_spec_resolve(itemIds)` |
| DESIGN | authored topics plus authored design-item map | `document_item_get(itemIds)` then `document_spec_resolve(itemIds)` |
| DD / `data_dictionary` | Entity map | `document_item_get(itemIds, detail=summary\|full)` and follow Entity item relationships |

DD does not normally traverse to Specs. A table/code impact question may start
from an explicit returned graph node and use `graph_trace`.

`document_item_list` is for pagination, an explicit complete item inventory, or
an item-type filter. It is not a mandatory call after every `document_get`.

## Spec Routes

- `spec_list(projectId, epicId, specKind?)` is the complete, paginated inventory
  for one EPIC.
- `spec_search` discovers a specific Spec when its ID is unknown.
- `spec_get` reads exact authored Spec detail.
- `spec_document_resolve` adds reverse business context only when needed.
- `spec_impact_resolve` adds direct technical impact only when needed.

API, screen, event, and schedule are separate typed Specs. A selected
`spec_get` response is the source-near proof; graph or source reads raise the
proof tier when implementation truth is required.

## Graph And Code

`graph_trace(nodeIds, direction)` starts from explicit code, service-map, DB, or
external node IDs. It returns one-hop confirmed edges, unresolved candidates,
and frontier node IDs. Multi-depth impact is an agent workflow:

```text
graph_trace(current nodeIds)
-> inspect confirmed/candidate separation
-> select only relevant frontier nodeIds
-> graph_trace(frontier nodeIds)
-> stop at the requested depth or coverage boundary
```

Maintain a visited-node set. Empty edges mean only `no_graph_anchor` or
`no_edges` for that anchor, not “no business impact.”

For code-first questions:

```text
code_search
-> select repository and exact candidate
-> readonly_workspace_shell exact source read
-> graph_trace(code nodeId) when reverse impact is requested
```

`code_search` finds metadata candidates. The bounded source read proves exact
implementation behavior.

## Storage Relationships

The read model projects these stored relationships without exposing raw table
payloads:

```text
project
-> epics
-> epic-owned business documents
-> document items
-> direct item-to-Spec links
-> Specs
-> direct Spec-to-business reverse links
-> direct Spec-to-technical relations
-> service-map and code graph nodes
```

Memory remains a separate overlay. It can correct or constrain an answer but
does not replace generated documents, Specs, graph evidence, or source.

## Evidence Rules

- Project overview and EPIC cards orient scope.
- `epic_get.documentRefs` is the primary business-document routing source.
- Document and search cards contain summaries, not full bodies.
- Exact business claims require the selected `document_item_get` payload.
- Exact source-near claims require `spec_get`.
- Exact implementation claims require bounded source reads when available.
- Directional resolve and graph results are relationship evidence, not full
  target bodies.
- Unresolved candidates stay candidates.
- No host-local file or CLI fallback is allowed when an MCP capability is
  missing.
