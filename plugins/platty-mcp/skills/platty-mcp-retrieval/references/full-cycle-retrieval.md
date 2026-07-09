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
-> document_list for the selected branch:
   BR for policy/rule/eligibility
   DD for entity, table, field, or data-shape questions
   DESIGN for system design, integration, data flow, or architecture questions
   UCL for capability, journey, screen, or user action questions
-> document_get/document_item_list to map candidate items
-> document_item_get for exact BR/DD/DESIGN/UCL evidence
-> document_resolve to find connected API, screen, event, data, service, or spec anchors
-> spec_list/spec_resolve when connected specs must be mapped
-> spec_get for exact source-near behavior
-> code_search only when source-level confirmation is required and configured
-> code_snippet before claiming exact code behavior, implementation absence, writes, emits, permissions, or response shape
```

If a map/list surface required by the ladder is missing, report an MCP
capability gap instead of replacing the rung with search.

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
-> connected source-near evidence
-> exact spec evidence
-> source-level confirmation only when required
-> Final Route Audit
-> answer with boundary
```

## Final Route Audit

For broad, ambiguous, Korean/English, comparison, inventory, impact, or mixed
business-vs-implementation questions, all of these must be true before making a
confident answer:

1. Search Brief exists and preserves the raw user phrase.
2. Raw terms and normalized vocabulary candidates are both visible.
3. Glossary/vocabulary output was used only for routing, not as behavior proof.
4. Project overview and epic map were read before choosing the final scope.
5. Relevant candidate EPICs were not discarded from one search miss, snippet, or
   weak score.
6. Candidate BR/DD/DESIGN/UCL document maps were built for the selected branch.
7. Exact document items were read before making business, data, design, or
   capability claims.
8. Connected context was resolved before following source-near specs.
9. Exact specs were read before source-near behavior claims.
10. Code snippets, not only code search hits, were read before exact source
    claims.
11. Negative claims such as "not present", "not independent", "not used", or
    "no impact" have the evidence tier required by Evidence Gates.
12. Unread but plausible surfaces are named as coverage limits or next MCP
    reads.
13. The final answer separates direct evidence, inference, freshness, and
    missing MCP surfaces.
