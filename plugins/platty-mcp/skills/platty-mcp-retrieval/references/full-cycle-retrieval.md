# Full-Cycle Retrieval Ladder

Use this reference when `platty-mcp-retrieval` routes a broad, semantic,
comparison, inventory, or impact question. Each rung is list/map first, exact
detail second.

```text
project_list/project_get/context_status
-> project_overview_get
-> glossary_translate when raw terms, Korean/English bridges, aliases, or ambiguity matter
-> epic_list
-> epic_get for each plausible candidate epic before discarding it
-> memory overlay check from epic_get.memories; use memory_list/memory_get if needed
-> document_list for the selected branch:
   BR for policy/rule/eligibility
   DD for entity, table, field, or data-shape questions
   DESIGN for system design, integration, data flow, or architecture questions
   UCL for capability, journey, screen, or user action questions
-> document_get/document_item_list to map candidate items
-> memory overlay check from document_get.memories and document_search.memoryCount
-> document_item_get for exact BR/DD/DESIGN/UCL evidence
-> document_resolve to find connected API, screen, event, data, service, or spec anchors
-> rank linked api_spec and screen_spec candidates; use spec_list/spec_search only when the linked set is incomplete or the exact spec id is unknown
-> when spec_search is used, select candidate specs before making claims
-> spec_get for exact source-near behavior
-> spec_resolve to expand selected specs to related documents, items, graph seeds, and code seeds
-> code_search only when source-level confirmation is required and configured
-> code_snippet before claiming exact code behavior, implementation absence, writes, emits, permissions, or response shape
```

If a map/list surface required by the ladder is missing, report an MCP
capability gap instead of replacing the rung with search.

When `spec_search` is used, every selected spec candidate must be followed by `spec_get` and `spec_resolve` in the same route. Do not treat a spec search hit as complete evidence or defer resolve to a later optional step.

## Business Document To API/Screen Spec Descent

When the question starts from SOT business context, treat BR/DD/DESIGN/UCL
documents and items as the map, not as source-near proof:

```text
business question
-> document_list/document_get/document_item_list
-> document_item_get for exact business item
-> document_resolve to expose linked specs
-> rank linked api_spec and screen_spec candidates
-> spec_list/spec_search only if linked specs are incomplete or the exact spec id is unknown
-> when spec_search is used, select candidate specs before making claims
-> spec_get for selected api_spec/screen_spec details
-> spec_resolve to expand selected specs to related docs/items, graph seeds, and code seeds
```

`document_resolve` is the first bridge from a business document or item to
linked source-near specs. `spec_resolve` is not the first bridge from business
docs to specs; use it after selecting a spec to collect reverse anchors,
related items/documents, and source seed expansion.

Business document items are routing evidence. For exact API or screen behavior,
rank connected `api_spec` and `screen_spec` candidates before opening details.
Direct document/spec links, same epic, same entity/field, same route/screen/API
target, and same branch intent rank first. Do not open every connected spec up front;
read `spec_get` and then `spec_resolve` for the selected specs before
source-near claims.

Memory overlays are correction/constraint/why/context notes attached to epics
or documents. Read attached overlays before final answers for the selected
scope. If only `memoryCount` or `memoryId` is visible, use `memory_list` or
`memory_get` when the overlay could change the answer boundary. Do not treat
memory as generated SOT or source proof.

## Retrieval Order

```text
project context
-> context status
-> capability check
-> Search Clarification Gate when triggers fire
-> project overview
-> vocabulary normalization when raw terms, Korean/English bridges, aliases, or ambiguity matter
-> candidate epic
-> candidate BR/DD/DESIGN/UCL document map
-> question branch
-> relevant business document items or exact source-near anchor
-> connected api_spec/screen_spec evidence through document_resolve
-> exact spec evidence
-> spec_resolve for connected context and graph/code seeds
-> source-level confirmation only when required
-> Final Route Audit
-> answer with boundary
```

## Final Route Audit

For broad, ambiguous, Korean/English, comparison, inventory, impact, or mixed
business-vs-implementation questions, all of these must be true before making a
confident answer:

1. Search Brief exists and preserves the raw user phrase.
2. Raw terms, Korean candidate terms and English candidate terms are both visible
   when Korean/English vocabulary may not line up.
3. Glossary/vocabulary output was used only for routing, not as behavior proof.
4. Project overview and epic map were read before choosing the final scope.
5. Relevant candidate EPICs were not discarded from one search miss, snippet, or
   weak score.
6. Candidate BR/DD/DESIGN/UCL document maps were built for the selected branch.
7. Relevant attached memory overlays were checked and separated from generated
   SOT/source evidence.
8. Exact document items were read before making business, data, design, or
   capability claims.
9. If a selected document exposes item summaries but `document_item_list` returns
   empty, the answer reports an item-tier coverage gap or retries without
   narrowing filters instead of claiming exact BR/DD/DESIGN/UCL evidence from
   the document body.
10. Connected context was resolved before following source-near specs.
11. Linked `api_spec` and `screen_spec` candidates were ranked before exact
    source-near spec reads when starting from business docs.
12. Exact specs were read before source-near behavior claims.
13. `spec_resolve` was run after selected spec reads to expose related
    docs/items, graph seeds, code seeds, and reverse anchors.
14. Code snippets, not only code search hits, were read before exact source
    claims.
15. Negative claims such as "not present", "not independent", "not used", or
    "no impact" have the evidence tier required by Evidence Gates.
16. Unread but plausible surfaces are named as coverage limits or next MCP
    reads.
17. The final answer separates direct evidence, inference, memory overlay,
    freshness, and
    missing MCP surfaces.
