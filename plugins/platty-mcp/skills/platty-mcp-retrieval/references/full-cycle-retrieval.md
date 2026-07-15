# Full-Cycle Retrieval Ladder

Use this reference when `platty-mcp-retrieval` routes a broad, semantic,
comparison, inventory, or impact question. Each rung is list/map first, exact
detail second.

## Contents

- Exact Item Fast Path
- Evidence Depth By Question Type
- Canonical Ladder
- Runtime Evidence Checklist
- Business Document To Source-Near Spec Descent
- Final Route Audit

## Exact Item Fast Path

When an exact BR/DD/DESIGN/UCL item has already been selected, do not widen with
search first. Use the item as the bridge into source-near evidence:

```text
document_item_get
-> document_resolve(itemId)
-> rank linked api_spec/screen_spec/event_spec/schedule_spec candidates
-> spec_get for selected source-near behavior
-> spec_resolve for related docs/items, graph seeds, and code seeds
```

Prefer `document_resolve(itemId)` over `document_resolve(documentId)` for a
selected routing card or item. Whole-document resolve is useful for inventory,
but it can return broad candidates; item-level resolve is the fast path for
screen/API/event/schedule descent.

## Evidence Depth By Question Type

Use the minimum evidence depth that can support the claim. Do not force
source-near specs or source reads for pure concept overviews, but do not stop at
overview/search for flows, policies, implementation-facing behavior, or data
claims.

| Question type | Required depth |
| --- | --- |
| Service overview, user-type explanation, high-level product inventory with no implementation/API/screen/data claim | `project_overview_get` -> `epic_list`/`epic_get` -> optional `ssot_search`/`ssot_get`; stop here if the answer remains conceptual and states coverage limits. |
| Product flow, capability, journey, admin workflow, or user action | Project/epic map -> DESIGN business document map as near-mandatory -> BR/DD/UCL as needed -> exact document/item reads -> source-near specs. |
| Business policy, eligibility, status transition, or rule enforcement | BR and relevant DESIGN/DD/UCL exact items -> connected specs -> source read when claiming enforcement. |
| Data shape, table, field, state distribution, funnel, conversion, or operational bottleneck | DD and relevant DESIGN/BR exact items -> connected specs when behavior matters. If a data MCP is exposed, read its guide and use read-only queries for observed metrics. If no operational data source is exposed, stop at measurable funnel steps, instrumentation points, and SSOT-based bottleneck hypotheses; do not claim actual conversion causes. |
| API, screen, event, schedule, job, integration, permission, response shape, DB write, emit, external call, or implementation behavior | Selected `api_spec`/`screen_spec`/`event_spec`/`schedule_spec` -> `spec_resolve` -> `code_search` -> bounded `readonly_workspace_shell` when exact source confirmation is required or the spec is thin/ambiguous. |

`readonly_workspace_shell` means the MCP-provided read-only source tool. It is
allowed when exposed and required by the evidence gate. Treat it as the
source-reading half of the `code_search` path: `code_search` locates candidate
files/symbols, then `readonly_workspace_shell` reads the bounded source region.
Do not stop at `code_search` when the claim requires source inspection. Do not
replace a missing MCP source tool with local filesystem or local shell reads.

If a conceptual answer would include concrete behavior such as "this API writes
X", "this screen calls Y", "this status changes when Z", or "users drop here",
the route is no longer a pure overview. Escalate to the deeper branch before
making that claim.

## Canonical Ladder

BR, DD, DESIGN, and UCL are semantic document families. For `document_list`
tool arguments, use MCP filter values (`br`, `data_dictionary`, `design`,
`ucl`) unless the live MCP schema advertises a different value set. DD maps to
`data_dictionary`, not `dd`.

```text
project_list/project_get/context_status
-> project_overview_get; inspect project_overview_get.overview.memories summary cards before narrowing scope and use memory_get for exact bodies when a card is relevant
-> glossary_list for broad inventory, comparison, ambiguity, all-alias requests, or blank/conflicting translation; traverse every page when completeness is required
-> glossary_translate for the raw phrase and Korean/English candidates; record matched terms and alias candidates
-> epic_list
-> epic_get for each plausible candidate epic before discarding it; inspect epic_get.memories summary cards before discarding or selecting the epic
-> document_list for the selected branch:
   documentType=br for policy/rule/eligibility
   documentType=data_dictionary for entity, table, field, or data-shape questions
   [MUST] documentType=design for product flow, capability, journey, admin workflow,
   system design, integration, data flow, architecture, or implementation-facing
   questions
   documentType=ucl for capability, journey, screen, or user action questions
-> document_get/document_item_list to map candidate items; inspect document_get.memories and item memory summaries before discarding or selecting documents/items
-> document_item_get for exact BR/DD/DESIGN/UCL evidence; inspect item memories before finalizing the item claim
-> document_resolve(itemId) after exact item reads; use document_resolve(documentId)
   only for document-wide inventory. Follow explicit links to connected API,
   screen, event, schedule, data, service, or spec anchors and collect linked
   api_spec/screen_spec/event_spec/schedule_spec spec ids when returned
-> rank linked api_spec, screen_spec, event_spec, and schedule_spec candidates
   and keep the selected spec ids visible; use spec_list/spec_search only after
   document_resolve when the explicit linked set is absent, incomplete, stale,
   too broad, or the exact spec id is unknown
-> when spec_search is used, select candidate specs before making claims
-> spec_get for exact source-near behavior
-> spec_resolve to expand selected specs to related documents, items, graph seeds, and code seeds; inspect spec memories when returned
-> code_search only when source address is incomplete and configured
-> readonly_workspace_shell to read the bounded candidate source before claiming
   exact code behavior, implementation absence, writes, emits, permissions, or response shape
```

If a map/list surface required by the ladder is missing, report an MCP
capability gap instead of replacing the rung with search.

## Runtime Evidence Checklist

Use this only for branch-level completion state; do not restate the Canonical
Ladder in runtime context or the final answer.

- Record the evidence depth selected from the table above and whether the route
  ended conceptually, reached source confirmation, or stopped at a missing MCP
  surface.
- When operational data is claimed, require an exposed data MCP, read
  `data_analysis_guide`/`domain_guide` when available, use read-only RDS/Athena
  `SELECT`, and state sample/cohort limits. Without that surface, limit funnel
  or conversion answers to SSOT-derived steps, instrumentation points, and
  hypotheses.
- When `spec_search` selects a candidate, follow it with `spec_get` and
  `spec_resolve` in the same route.
- Run the Final Route Audit and expose only failures that change confidence or
  scope.

For a complete API inventory, or a complete screen, event, or schedule
inventory, use `spec_list` with the narrowest known `specKind` and `scopeId`.
Follow `nextCursor` until `hasNextPage` is false. Do not use ranked
`spec_search` results as proof that the inventory is complete.

## Business Document To Source-Near Spec Descent

When the question starts from exact BR/DD/DESIGN/UCL evidence, use the selected
item as the bridge rather than rebuilding the whole ladder:

```text
document_item_get
-> document_resolve(itemId)
-> rank linked api_spec/screen_spec/event_spec/schedule_spec candidates
-> spec_get for selected exact specs
-> spec_resolve for reverse anchors and graph/code seeds
```

Use `document_resolve(documentId)` only for document-wide inventory. Prefer
explicit links and rank by direct link, same epic, entity/field, target, and
branch intent. Use `spec_search` only when links are absent, incomplete, stale,
too broad, or leave the exact spec unknown; then read the selected exact specs
before making source-near claims.

Apply the retrieval skill's memory-overlay invariant throughout this descent.

## Final Route Audit

For broad, ambiguous, Korean/English, comparison, inventory, impact, or mixed
business-vs-implementation questions, all of these must be true before making a
confident answer:

1. Search Brief exists and preserves the raw user phrase.
2. Raw terms, Korean candidate terms and English candidate terms are both visible
   when Korean/English vocabulary may not line up.
3. Glossary/vocabulary output was used only for routing, not as behavior proof.
4. Project overview, attached overview memory cards, and epic map were read
   before choosing the final scope.
5. Relevant candidate EPICs were not discarded from one search miss, snippet, or
   weak score.
6. Candidate BR/DD/DESIGN/UCL document maps were built for the selected branch.
7. Memory summary cards returned by every selected overview, epic, document,
   item, or spec were inspected before discarding candidates or finalizing
   claims.
8. Every relevant memory card was followed with `memory_get`, or named as an
   unread coverage limit.
9. Exact document items were read before making business, data, design, or
   capability claims.
10. If a selected document exposes item summaries but `document_item_list` returns
   empty, the answer reports an item-tier coverage gap or retries without
   narrowing filters instead of claiming exact BR/DD/DESIGN/UCL evidence from
   the document body.
11. If any exact BR/DD/DESIGN/UCL item was read, `document_resolve(itemId)` was
    run before source-near search, or the answer explicitly remains conceptual.
12. Connected context was resolved before following source-near specs.
13. Linked `api_spec`, `screen_spec`, `event_spec`, and `schedule_spec`
    candidates were ranked before exact source-near spec reads when starting
    from business docs, and returned spec ids were kept visible for the selected
    candidates. `spec_search` fallback was used only after `document_resolve`
    returned no usable links, incomplete/stale/too-broad links, or no exact spec
    id.
14. Exact specs were read before source-near behavior claims.
15. `spec_resolve` was run after selected spec reads to expose related
    docs/items, graph seeds, code seeds, and reverse anchors.
16. Bounded exact source regions were read with MCP `readonly_workspace_shell`
    after any needed `code_search`; code search hits alone were not used for
    exact source claims.
17. Negative claims such as "not present", "not independent", "not used", or
    "no impact" have the evidence tier required by Evidence Gates.
18. Unread but plausible surfaces are named as coverage limits or next MCP
    reads.
19. The final answer separates direct evidence, inference, memory overlay,
    freshness, and missing MCP surfaces.
