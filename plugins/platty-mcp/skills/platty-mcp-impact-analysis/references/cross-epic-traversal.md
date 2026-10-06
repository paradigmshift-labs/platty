# Cross-EPIC Traversal

## Evidence Classes

Every class is built only from fields the Enterprise MCP tools emit; no
response carries a precomputed cross-EPIC edge list, so the agent derives
each edge from one of the sources below and records where it came from.

```text
Confirmed: a DESIGN document link or connection whose two ends resolve to
different EPICs; a route relation whose connection resolves to a target
route owned by another EPIC; a spec_impact_resolve edge whose provenance
documents belong to different EPICs; one data_dictionary data object (one
itemId) whose usedBy documents belong to different EPICs.
Likely: a confirmed graph_trace edge joins specs owned by different EPICs
without any DESIGN or connection evidence.
Adjacent candidate: a graph candidate edge, a search hit or glossary term
whose epicId differs from the seed EPIC, a multi-EPIC spec without an exact
role, a repository match, a common term, or a table-name match between two
EPICs' design_database_scope rows whose data object is not yet proven.

State: frontierEpicIds, visitedEpicIds, visitedSpecIds, visitedGraphSeeds,
visitedCodeQueries, confirmedEdges, likelyEdges, candidateEdges, currentDepth,
maxDepth: 2, truncationReasons.

Normalized directed edge: sourceEpicId, targetEpicId, direction, originLayer,
sourceDocumentId, sourceDocumentIds, documentId, documentType, originalKind,
derivedKind, role, reason, confidence, relationIds.
```

## Confirmed Evidence Sources (MCP fields)

| Source | Fields that carry the edge | How the EPICs are resolved |
| --- | --- | --- |
| `design_get` section `design_document_map` | `links[{from{id,type,title}, to{id,type,title}, kind}]` | open each end's document (`<family>_get` / `spec_get`) and read `header.epicId`; the design document's own `header.epicId` is the source EPIC |
| `design_get` section `design_connections` | `connections[{via, label, operation}]` | the connection names the counterpart in `label`/`via`; resolve it with `<family>_search` or `route_resolve` and read the hit's `epicId` / the spec's `header.epicId` |
| `data_dictionary_item_get` (`data_object` item) | `body.usedBy[{document{id,type}, operation}]` on one item (`itemId`) | one data object is one `itemId`: every `usedBy` document resolves to its EPIC (`<family>_get` / `spec_get` `header.epicId`); two different EPICs on the same item is a confirmed shared data object |
| `design_get` section `design_database_scope` | `rows[{table, operation, source{id,type}}]` | a lead only: the row carries a table name and no database, schema, or model id, so a table-name match between two EPICs' rows is an adjacent candidate (same-named tables can live in different databases); each `source` document resolves to its EPIC, and the candidate is promoted only when the data object is proven as above |
| `spec_impact_resolve` | `edges[{id, sourceId, targetId, kind, confidence, provenance[{source, documentIds, relationIds}], verificationStatus}]`, `links[{documentId, specDocumentId, nodeId}]`, `nodes[].documentIds` | map every `documentIds` entry to its EPIC through `spec_get.header.epicId`; an edge whose two ends map to different EPICs is confirmed when `confidence` is high, otherwise likely |
| `route_relations` | `sources[].relations[].connection{status, targetRepoId, targetEntryPointId}` with `relationId` and the route's `specDocumentIds` | the target route's `specDocumentIds` (via `route_resolve` / `route_relations` on `targetEntryPointId`) → `spec_get.header.epicId` names the target EPIC; the source route's `specDocumentIds` → `header.epicId` names the source EPIC |

Record the provenance that these fields give: `sourceDocumentIds` (the DESIGN
document, the spec documents, the `provenance[].documentIds`), `relationIds`
(`relationId` of the route relation, `provenance[].relationIds`, the
`spec_impact_resolve` edge `id`), `documentType`, and the `confidence` the
tool returned. Ambiguous targets (a `label` that resolves to several EPICs, a
`connection.status` that is not resolved, a document whose `epicId` is null)
remain gaps, never confirmed edges.

Shared tables: table-name equality alone never confirms a shared table. Prove
the same data object first — one `data_dictionary` `data_object` item
(`itemId`) whose `body.usedBy` names documents of both EPICs, or the two
`design_database_scope` `source` documents resolving (through their specs'
`db` section or `spec_business_resolve`) to that same DD item. Until then the
pair is an adjacent candidate with `reason: "table-name match; data object
unproven"`; a project with several databases or schemas can hold same-named
tables that are different data.

## Canonical Vocabulary

| Vocabulary | Canonical value | Dependency mapping |
| --- | --- | --- |
| kind | `cross_domain_policy` | `cross_domain_state_change` |
| kind | `reward_or_coupon_effect` | `cross_domain_state_change` |
| kind | `state_change` | `cross_domain_state_change` |
| kind | `event_flow` | `event_flow` |
| kind | `shared_user_journey` | `cross_screen` |
| kind | `operational_dependency` | `external_call` |
| role | `impact` | n/a |
| role | `supporting` | n/a |
| role | `reference` | n/a |

The dependency mapping is: `event_flow -> event_flow`,
`operational_dependency -> external_call`, `shared_user_journey -> cross_screen`,
and every remaining kind -> `cross_domain_state_change`.

Two edge fields carry the kind, and they are not the same value:

- `originalKind` is the kind exactly as the tool emitted it, verbatim — the
  `design_document_map` link `kind`, the `design_connections` `operation`,
  the route relation `kind`, or the `spec_impact_resolve` edge `kind`. Never
  rewrite it to a canonical word; `scripts/impact-revision.mjs` hashes
  `originalKind` and `derivedKind` as two separate scalars exactly as given,
  so collapsing the original into the canonical kind changes the revision
  and loses the evidence.
- `derivedKind` is reached in two steps: the emitted kind maps to a canonical
  kind from the vocabulary table, and the canonical kind maps to the
  dependency kind through the dependency mapping above.

The table covers every kind the server emits: `design_document_map` link
kinds, route relation kinds (`route_relations`), service-map edge kinds
(`spec_impact_resolve` / `graph_trace` `edges`), service-map candidate kinds
(`spec_impact_resolve` / `graph_trace` `candidates`), and code-graph edge
relations (`graph_trace` with `{kind:"code"}` seeds). A route relation
`event_listen` becomes the service-map edge `triggers`, so the same flow
arrives under either name depending on the tool.

| Emitted kind (`originalKind`) | Canonical kind | `derivedKind` |
| --- | --- | --- |
| `calls_api`, `internal_service_call`, `api_call` | `operational_dependency` | `external_call` |
| `uses_external_service`, `external_service`, `opens_external_link`, `external_link`, `notification`, `analytics_event` | `operational_dependency` | `external_call` |
| a code-graph edge relation (`calls`, `imports`, `re_exports`, `re_exports_ns`, `contains`, `extends`, `implements`, `mixes`, `uses_type`, `decorates`, `type_ref`, `type_resolved`, `depends_on`, `renders`, `resolves_to`) | `operational_dependency` | `external_call` |
| `publishes_event`, `event_publish`, `event_listen`, `triggers`, `trigger_target`, `scheduled_action`, `schedule_trigger`, `webview_message_send`, `webview_message_listen` | `event_flow` | `event_flow` |
| `navigates`, `navigation` | `shared_user_journey` | `cross_screen` |
| `db_access`, `accesses_db`, `uses_db_logic`, `calls_db_object`, `executes_db_object`, `state_access`, `cache_access` on a proven shared data object | `state_change` | `cross_domain_state_change` |
| a DESIGN link or connection whose text states a policy | `cross_domain_policy` | `cross_domain_state_change` |
| a reward, coupon, or point effect stated by the DESIGN text | `reward_or_coupon_effect` | `cross_domain_state_change` |
| `symbol_binding`, `unknown`, a null link `kind`, a `design_connections` `operation` that names no relationship | none (`derivedKind: ""`) | `""` until the DESIGN or relation text names the relationship |

Kind mapping and evidence class are two independent decisions:

- The evidence class (confirmed, likely, adjacent candidate) comes only from
  the evidence-source table above: which tool emitted the edge, which fields
  carry it, how both EPICs were resolved, and the `confidence` the tool
  returned. The kind never changes the class.
- The kind mapping only fills `derivedKind`. An emitted kind that is not in
  the table keeps its `originalKind` verbatim, takes `derivedKind: ""`, and
  records `reason: "kind unmapped: <kind>"` on the edge; it is never demoted
  from confirmed to likely or candidate because of that, and a confirmed edge
  with an unmapped kind is still expanded. It takes
  `derivedKind: cross_domain_state_change` only after the DESIGN or relation
  text confirms a state effect.

Never invent a kind the evidence does not support; a link with a null `kind`
and no operation keeps `originalKind: ""` and `derivedKind: ""`. It stays a
candidate only when its evidence source makes it one (a graph candidate, a
search hit, an unresolved connection): a DESIGN link whose two ends resolve
to different EPICs is confirmed even with a null `kind`, and the missing kind
is a gap on that confirmed edge, not a demotion.

## Provenance And Membership

Preserve source document, `originalKind`, `role`, `reason`, and `confidence`
on every edge, because the normalized edge is the only place they survive.
Prefer original cross-domain design evidence (a `design_document_map` link or
a `design_connections` row) when both it and a derived graph/route edge exist
for the same pair. A spec that several EPICs'
documents cite (its `header.epicId` is one EPIC, but `design_document_map`
links or `provenance[].documentIds` from another EPIC reach it) is a
multi-EPIC spec: record each citing EPIC with the role the citing document
gives it, and keep the spec itself under its `header.epicId` owner.

## Traversal Rules

Inspect both upstream and downstream. Expand confirmed evidence only; a
`graph_trace` edge on its own is at most likely — verify a likely edge with
DESIGN, connection, or route-relation evidence before promotion — and
do not expand adjacent candidates. Record an
edge before using `visitedEpicIds` to suppress a revisit, so cycles retain every
confirmed relationship. Never revisit a visited EPIC, spec, graph seed, or code
query.

Stop at a fixed point or `maxDepth: 2`. Preserve `truncationReasons` and the
unvisited confirmed `frontierEpicIds` at the depth limit. The structural test
must assert every kind and role, every mapping row, the evidence-source table,
and every provenance field so drift is visible.

## Typed graph identity

Use graph_trace seeds `{kind:"code",nodeId}` or `{kind:"service_map",nodeId}`,
one namespace per batch, depth 1 per frontier step. Map upstream to incoming
and downstream to outgoing at the public tool boundary. Preserve returned
namespace in visitedGraphSeeds and all continuation packets (a row without
`namespace` uses the response's top-level `namespace`); a same-spelled
node ID in the other namespace is a different identity. Hidden nodes do not
become visible through cycles or retained frontiers.
