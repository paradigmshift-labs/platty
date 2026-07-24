# Full-Cycle Retrieval Ladder

Use this reference for broad, semantic, comparison, inventory, or impact
questions. Each rung is map first, exact detail second.

## Exact Item Fast Path

When exact business item IDs are known, do not widen with search:

```text
document_item_get(projectId, itemIds=[...], detail=summary|full)
-> document_spec_resolve(projectId, itemIds=[...])
-> rank linked api_spec/screen_spec/event_spec/schedule_spec IDs
-> spec_get(projectId, id=<selected Spec ID>)
```

`document_item_get` and `document_spec_resolve` accept 1-5 unique `itemIds`.
Split a larger set into multiple calls. Results preserve request order and
group links by the input item.

This Spec descent applies to BR, UCL, and DESIGN. DD does not use the Spec
bridge: read its Entity items, follow returned Entity item IDs, and use an
explicit DB/code graph node only when technical impact is requested.

## Evidence Depth By Question Type

| Question type | Required depth |
| --- | --- |
| Conceptual project overview with no behavior claim | `project_overview_get` -> `epic_list`/`epic_get`; state coverage limits |
| Product flow, capability, journey, or admin workflow | EPIC map -> DESIGN map -> BR/UCL as needed -> exact items -> selected Specs |
| Policy, eligibility, status transition, or enforcement | BR plus relevant DESIGN/UCL items -> connected Specs -> source read for exact enforcement |
| Entity, table, field, or data shape | DD Entity summary/full; add source or graph evidence only for exact usage/impact |
| API, screen, event, schedule, permission, response shape, write, emit, or integration | exact `spec_get`; add reverse business or technical impact only when asked; bounded source read for exact implementation truth |

`code_search` locates source candidates. `readonly_workspace_shell` reads the
bounded source region. Do not use host-local files or shell when the MCP source
surface is missing.

## Canonical Ladder

BR, DESIGN, DD, and UCL are the four core business-document families. DD maps
to `data_dictionary`; UCS is not part of the current route.

```text
project_list/project_get/context_status
-> project_overview_get
   inspect project_overview_get.overview.memories summary cards
   call memory_get for every relevant exact body
-> glossary_list for broad inventory or ambiguity
-> glossary_translate for the raw phrase and Korean/English candidates
   retain matched terms and alias candidates
-> epic_list
   inspect memoryCount; select candidates, do not call memory_list blindly
-> epic_get for every plausible EPIC before discarding it
   inspect epic_get.memories
   call memory_get for each relevant exact body named by response.next
   read epic_get.documentRefs
-> document_get directly for the BR, DESIGN, DD, and UCL IDs in documentRefs
   inspect document_get.memories for direct document Memory and item memoryCount values
   call memory_get only for relevant exact bodies named by response.next
   [MUST] DESIGN for system design, integration, architecture, product flow,
   capability, journey, admin workflow, data flow, or implementation-facing work
-> document_item_list only for pagination, explicit complete inventory, or itemType filtering
-> document_item_get(itemIds) for selected exact items
   inspect each items[*].memories and call memory_get for relevant exact bodies
-> for BR/UCL/DESIGN: document_spec_resolve(itemIds)
-> rank linked api_spec/screen_spec/event_spec/schedule_spec IDs
-> spec_get for each selected exact Spec
   inspect spec_get.memories and call memory_get for relevant exact bodies
-> optional spec_document_resolve(specIds) for reverse business context
-> optional spec_impact_resolve(specIds, direction) for one-hop technical impact
-> optional graph_trace(frontier nodeIds) to continue one selected hop
-> code_search and readonly_workspace_shell exact source read when required
-> only after the direct map cannot identify an ID, use document_search or spec_search
```

Search is deliberately last. `document_search` searches non-Spec business
documents/items. `spec_search` searches Specs. Selected hits must be opened
with the corresponding exact-read tool.

The Memory route is likewise card first and exact body last:

```text
list/map/search card.memoryCount
-> epic_get | document_get | document_item_get | spec_get
-> inspect attached memories summary cards
-> memory_get only for selected relevant memoryId values from response.next
```

Use `memory_list` only for an explicit scoped inventory or when an exact
selected surface lacks attached Memory cards.

## Typed `document_get` Continuations

- BR: the response is an item map. Read selected rule IDs with
  `document_item_get`, then resolve their Specs.
- UCL: the response is a use-case item map. Read selected use cases, then
  resolve their Specs.
- DESIGN: the response contains authored topics and authored DESIGN items.
  Read selected items, then resolve their Specs.
- DD: the response is an Entity map. Read Entity items with `detail=summary`
  first and `detail=full` only when required fields are needed.

`document_item_list` is not a compulsory extra call when `document_get` already
returned the needed cards.

## Spec-First And Code-First Routes

For a known Spec:

```text
spec_get(id)
-> spec_document_resolve(specIds=[id]) only when business context is needed
-> spec_impact_resolve(specIds=[id], direction) only when technical impact is needed
```

For complete API, screen, event, or schedule inventory, call
`spec_list(projectId, epicId, specKind?)` and follow `nextCursor` until
`hasNextPage` is false. Ranked `spec_search` results never prove completeness.

For code-first impact:

```text
code_search(one identifier or symbol)
-> workspace_repo_list/select repo
-> readonly_workspace_shell exact source read
-> graph_trace(nodeIds=[selected code node], direction=upstream|downstream|both)
```

`graph_trace` is one-hop. Its result separates confirmed edges, unresolved
candidates, and `frontier`. Continue only needed frontier IDs with another
call, maintain a visited-node set, and do not infer “no impact” from an empty
edge set.

For code-first business impact, do not restart from the EPIC map merely to find
the already named implementation target:

```text
exact file, symbol, route, or source anchor
-> code_search plus bounded source read
-> spec_search/spec_get when an exact connected Spec must be recovered
-> spec_document_resolve(specIds) for reverse business context
-> continue through only the returned business items, documents, and EPICs
```

If no exact Spec can be recovered, report that reverse business coverage is
partial. Do not substitute broad document source links for the missing direct
item-to-Spec connection.

## Runtime Evidence Checklist

- Record the selected evidence depth and whether the route ended conceptually,
  reached exact Spec/source proof, or stopped at a missing capability.
- For operational metrics, require an exposed data MCP. Without one, report
  instrumentation or hypotheses rather than observed conversion causes.
- Keep memory overlays separate from generated SOT and source evidence.
- Preserve IDs returned by directional resolvers so exact follow-up reads are
  reproducible.
- Run the Final Route Audit and expose only failures that change confidence or
  scope.

## Final Route Audit

Before a confident broad or mixed answer, verify:

1. The Search Brief preserves the raw user phrase.
2. Korean and English candidates remain visible when vocabulary may differ.
3. Glossary output was used for routing, not behavior proof.
4. Project overview and relevant memory cards were inspected.
5. Plausible EPICs were read with `epic_get`, not discarded from a search miss.
6. `epic_get.documentRefs` routed the four core business maps directly.
7. Exact business items were read before business, design, journey, or data
   claims.
8. BR/UCL/DESIGN items used `document_spec_resolve` before Spec search unless
   the answer explicitly remains conceptual.
9. DD stayed on the Entity route unless an explicit graph/code impact question
   required more.
10. Linked Spec IDs were ranked before fallback `spec_search`.
11. Exact Specs were read before source-near claims.
12. Reverse business context used `spec_document_resolve` only when needed.
13. Technical impact used `spec_impact_resolve` first, then selected one-hop
    `graph_trace` frontier calls if needed.
14. Exact source regions were read after `code_search` when the claim requires
    source truth.
15. Negative claims have the complete map or source tier they require.
16. Unread plausible surfaces and missing capabilities remain explicit.
17. The final answer separates direct evidence, inference, memory overlay,
    freshness, and coverage limits.
