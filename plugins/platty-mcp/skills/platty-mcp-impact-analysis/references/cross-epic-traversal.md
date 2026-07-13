# Cross-EPIC Traversal

## Evidence Classes

```text
Confirmed: exact cross-domain/dependency, design counterpart, event
publisher/listener, shared-table epicsTouching, or cross_epic membership.
Likely: confirmed graph edge joins different EPIC-owned specs without explicit
cross-domain/design evidence.
Adjacent candidate: graph candidate, multi-EPIC spec without exact role,
repository match, or common term.

State: frontierEpicIds, visitedEpicIds, visitedSpecIds, visitedGraphSeeds,
visitedCodeQueries, confirmedEdges, likelyEdges, candidateEdges, currentDepth,
maxDepth: 2, truncationReasons.

Normalized directed edge: sourceEpicId, targetEpicId, direction, originLayer,
sourceDocumentId, sourceDocumentIds, documentId, documentType, originalKind,
derivedKind, role, reason, confidence, relationIds.
```

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

## Provenance And Membership

Preserve source document, `originalKind`, `role`, `reason`, and `confidence`
because `epic_dependencies` persistence loses them. Prefer original cross-domain
or design evidence when both it and the derived dependency exist. Record design
connection sources `counterpartEpicId`, `publisherEpicId`, `listenerEpicId`,
`epicsTouching`, `relationIds`, and `sourceDocumentIds`; ambiguous targets
remain gaps.

An exact technical-document `cross_epic` membership is confirmed evidence; it
is not the only cross-EPIC source. `epic_document_links` can persist that role
generically, current build-epics API links are owner-only, and screen, event,
and schedule links may carry `cross_epic`.

## Traversal Rules

Inspect both upstream and downstream. Expand confirmed evidence only; verify a
likely edge before promotion and do not expand adjacent candidates. Record an
edge before using `visitedEpicIds` to suppress a revisit, so cycles retain every
confirmed relationship. Never revisit a visited EPIC, spec, graph seed, or code
query.

Stop at a fixed point or `maxDepth: 2`. Preserve `truncationReasons` and the
unvisited confirmed `frontierEpicIds` at the depth limit. The structural test
must assert every kind and role, every mapping row, the membership nuance, and
every provenance field so drift is visible.
