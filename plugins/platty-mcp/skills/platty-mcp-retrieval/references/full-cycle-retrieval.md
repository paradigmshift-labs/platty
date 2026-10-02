# Full-cycle retrieval ladder

Use the ladder for semantic, comparison, inventory or impact-seed questions.
`<family>` means the concrete prefix selected from
`../../using-platty-mcp/references/tool-mapping.md`; follow returned `next`
arguments rather than inventing tools, IDs or fields. Apply the skill's
Discovery Packet Override only to the three eligible semantic discovery gets.

## Direct known-anchor path

Known BR document -> `business_rule_get(projectId,documentId)`.
Known BR item -> `business_rule_item_get(projectId,itemIds)`.
Known Spec -> `spec_get(projectId,documentId)`, including db_logic_spec.
Known code candidate -> reuse it; graph-only provenance can follow typed next
at depth 1 without inventing another code search. Exact execution claims still
need selected repository and bounded source reads.
No semantic rediscovery/search is needed for these exact anchors.

## Semantic ladder

```text
resolve project ID only if unknown; context_status for freshness
-> project_get(view:"summary"): metadata/availability and relevant approved Memory
-> vocabulary inventory/translate when terms are broad, blank or conflicting
-> domain_list -> domain_get plausible domain(s)
-> epic_list(domainId when selected) -> epic_get(view:"summary") plausible EPIC(s)
-> selected positive availability counts -> returned scoped typed lists -> exact document IDs
-> needed supporting-only links -> returned epic_get(view:"full") -> documentRefs
-> business_rule_get(view:"summary",itemLimit:20); other family gets unchanged
-> inspect routing cards, diagnostics/readState and approved Memory
-> concrete item_get selected IDs (1–5); item_list only for needed pages/inventory
-> BR/UCL/DESIGN resolver per itemId; DD resolver for requested usage
-> rank returned five-kind Spec IDs, then spec_get(documentId)
-> inspect relevant approved Memory, preserve scope from next
-> reverse business or technical impact only when requested
-> selected typed graph frontier / exact bounded source only for required claims
-> typed family search or spec_search only when direct maps leave IDs unknown
```

DESIGN is required for system design, integration, architecture, flow, capability,
journey, admin workflow or implementation-facing work; BR supplies policy,
UCL user actions, DD data-object/column meaning. Vocabulary is routing evidence.
Do not discard plausible EPICs from a search miss. Complete only required rungs
for the selected question and target set; keep unrelated implementation choices
as DESIGN handoff after the requested product fact is established.

## Evidence depth

Summary discovery preserves the returned `projectId`, `epicId`, `documentId`,
scope and cursor. Only eligible gets receive `view`; only BR discovery receives
`itemLimit:20`. Explicit full packets, direct known-anchor reads, item/spec/Memory
reads and list pagination retain their complete returned arguments.

Use project `documentAvailability` and EPIC `documentAvailability` for selected
direct family lists. EPIC `supportingDocumentAvailability` describes references
that may be owned by another EPIC and unreachable through direct EPIC lists.
When those links matter to the selected question, select the returned full EPIC
packet and open its exact refs; otherwise leave that continuation unselected.
An empty direct list does not prove supporting absence. Counts select routes,
not complete inventory or behavior evidence. Complete inventory follows every
returned list cursor to `hasNextPage:false`, including business-item pages when
needed; targeted discovery stops after finding the required IDs.

BR summary carries `header`, `coverageSummary`, small item cards and `itemPage`,
plus diagnostics, approved Memory cards and next packets. Inspect readState and
diagnostics before selecting evidence. `evidenceCount` and coverage totals are
routing information; exact item bodies and their directional Spec links remain
required. Read a returned BR full packet when the selected branch needs omitted
sections/evidence. Preserve explicit `view:"full"` and every other argument;
full fallback is never rewritten to summary. `regeneration_required` or malformed
context stays a coverage limit, not an empty current policy.

| Claim | Required read |
| --- | --- |
| Conceptual orientation | project/domain/EPIC metadata with limits |
| Rule, journey, system flow | relevant typed maps then exact business items |
| Entity/field meaning | exact DD parent/item body, parent approved Memory |
| Source-near API/screen/event/schedule/DB logic | exact Spec; unsupported fields stay unconfirmed |
| Exact enforcement, permission, write, emit, external call, code absence | bounded exact source when exposed; otherwise named missing surface and weaker claim |
| Complete inventory | selected scoped list, every pageInfo.nextCursor until hasNextPage=false |

DD column metadata is not an invented standalone dd_field item. Follow returned
IDs and usage references; data_dictionary_spec_resolve connects stored usage but
does not prove live execution. Item get returns full bodies without detail or
itemType filters. Family Spec resolver takes exactly one itemId or documentId,
not an itemIds batch; split selected items across calls.

## Spec-first and graph continuation

```text
spec_get(projectId,documentId)
-> spec_business_resolve(projectId,specDocumentIds=[id]) if business requested
-> spec_impact_resolve(projectId,specDocumentIds=[id],direction="both") if impact requested
-> graph_trace(projectId,seeds=[{kind:"service_map",nodeId:<returned node id>}],depth=1,direction="both")
```

Code seeds use `kind:"code"`, never the service-map namespace. Batch only 1–5
unique IDs in one namespace; track visited `(kind,nodeId)` pairs. Expand only
selected confirmed frontiers, inspect both directions for impact, and retain
unresolved candidates, omissions, truncation and depth-limited frontier. A graph
edge is relationship evidence, not detailed behavior; no empty-trace no-impact
claim. Code-first business impact recovers exact Spec then reverse business
links, without restarting broad EPIC discovery.

## Memory and final audit

Inspect selected exact-read summaries at the response's memories field; relevant
bodies replay memory_get with scope:"approved" from next. Use scoped approved
memory_list only for explicit inventory or missing attached cards. Default
own_requests is for request inspection and cannot replace approved continuation.
Memory remains an overlay; never invent bodies or approval from a preview.

Before answering, verify raw terms/selected interpretation preserved, relevant
domains/EPICs and direct maps read, exact items and linked Specs read for their
claim tier, parent DD Memory inspected, and source claims backed by exact regions.
Complete inventories account for pagination. Negative claims name complete map/
source scope and searched terms. Keep unread plausible evidence, unavailable
providers, stale/regeneration-required facts, and partial frontier as limits.
Separate direct evidence, inference, Memory, freshness and missing surfaces.
No host-local fallback; metrics need an actual exposed data tool, not code inference.
