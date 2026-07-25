# Runtime Work-Plan Contract

Use this contract for every `platty-mcp-sdd-spec-from-figma` run. The runtime
plan is live control state; durable evidence remains in the product packet and
canonical artifacts.

## Runtime Mapping

| Runtime | Required operations |
| --- | --- |
| Codex | `update_plan`; `spawn_agent` when delegation is available |
| Claude Code | `TodoWrite`; `Task` when delegation is available |

Create the plan before Figma evidence resolution. If no plan tracker exists,
keep the run `NEEDS_WORK`; never claim approval-ready completion.

## Phase 1: ScreenIntentInventory

Resolve and validate Figma evidence, then finish the complete screen inventory
before any current-service retrieval or subagent delegation. Create one
`ScreenIntentSeed` per major Figma screen:

```text
ScreenIntentSeed
- surfaceId
- figmaNodeIds
- screenName
- screenPurpose
- userActions
- visibleFieldsAndControls
- visibleStates
- inboundTransitions
- outboundTransitions
- visibleLiterals
- directEvidenceRefs
- inferredDesignHints
- missingStatesOrPolicy
- retrievalHints
```

A meaningful loading, error, modal, or confirmation state may be its own major
screen only when it maps to a distinct requirement, action, or user-visible
outcome. Otherwise keep it with its parent intent.

`retrievalHints` are search or routing hints, never a current-system `FACT`,
semantic candidate, or proof. Do not add an EPIC, route, API, persistence
policy, or reuse disposition to a seed without Platty evidence. Bind the
inventory receipt to the Figma `reportId` and `sourceRevision`.

## Phase 2: ScreenToEpicRoutingTable

After the inventory is complete, the coordinator may read project/EPIC lists,
EPIC summaries, DESIGN/UCL maps, and map-level document/item metadata. It must
not read exact document items, run `document_spec_resolve`, or resolve specs during
routing.

```text
ScreenToEpicRoutingRow
- surfaceId
- rankedCandidateEpics
- selectedEpic
- selectedDesignDocuments
- selectedUclDocuments
- routingEvidence
- alternateEpicIds
- ownerLaneId
```

Routing selects a retrieval scope only. It cannot authorize `REUSE`, `MODIFY`,
`NEW`, `UNKNOWN`, or a current-system `FACT`.

## Subagent Delegation Contract

When delegation is available, use one bounded collection worker for each
`EpicScreenSpecPool`, not one worker or lane per Figma screen. Screens with the
same selected EPIC and Design map share a lane. The lane takes the union of
their selected exact DESIGN/UCL documents and items. Partially overlapping
document sets must not create a separate lane merely because their sets differ.
Do not spawn one worker per Figma screen for candidate collection.

Start only the runtime's available worker slots and queue remaining EPIC groups
or pools. Each screen has one active owner lane. Reassign it only after a
receipt-bearing disposition requires another ranked EPIC; never run overlapping
screen ownership concurrently.

Pool workers may read only:

- selected exact DESIGN/UCL documents/items;
- one EPIC-lane memory overlay;
- `document_spec_resolve` for those item selections;
- explicitly linked `screen_spec` and applicable `api_spec` candidates; and
- a targeted supplement for a recorded link-set or matching gap.

They must not repeat project/EPIC-map discovery. Workers return evidence only.
They must not make final `REUSE/MODIFY/NEW/UNKNOWN` or product-policy decisions
and must not write or persist `prd.md`, `user_stories.md`,
`figma_handoff.json`, memory, or Figma changes. The coordinator validates
receipts, resolves conflicts, classifies surfaces, creates questions, runs the
approval audit, and delegates canonical writes.

If delegation is unavailable, record `delegation_unavailable` and execute the
same non-overlapping EPIC pools sequentially. Do not fall back to repeated
screen-by-screen discovery.

## EpicScreenSpecPool

For each lane:

1. Read every selected exact DESIGN/UCL document or item relevant to its owned
   screens.
2. At the **Memory Overlay Checkpoint**, assess memory relevance once for the
   candidate EPIC. Record `not relevant` with a reason, or run `memory_list`
   followed by `memory_get` only for selected cards. Retain selected memory IDs,
   revisions, and affected fields and reuse the receipt for every owned screen.
3. Run `document_spec_resolve` for every selected exact document item.
4. Collect and deduplicate the complete union of every explicitly linked
   `screen_spec`, retaining `linkOrigins`.
5. Run `spec_get` for every collected `screen_spec` and record
   `specGetAccounting` for every screen/candidate pair.
6. Reject before deep resolution only when `spec_get` proves incompatible
   purpose, route, journey position, or action. Missing matching visible copy is
   not enough.
7. Run `spec_impact_resolve` for every candidate still plausible for at least one
   owned screen, in revision-bound batches.
8. Collect applicable `api_spec` candidates or record `not_applicable` with a
   screen-specific evidence reason in `apiSpecApplicabilityBySurface`.

```text
EpicScreenSpecPool
- laneId
- epicId
- designMapId
- designDocumentIds
- uclDocumentIds
- ownedSurfaceIds
- memoryOverlayReceipt
- linkedScreenSpecIds
- linkOrigins
- specGetAccounting
- resolvedScreenSpecs
- applicableApiSpecIds
- apiSpecApplicabilityBySurface
- collectionStatus: pending | in_progress | partial | complete | coverage_limit | failed
- documentResolveReceipts
- specGetReceipts
- specResolveReceipts
- searchSupplementReceipts
- nextExactRead
```

“All related screen specs” means this complete explicit-link union for the
selected exact EPIC/DESIGN/UCL branch, not every screen spec in the project.
`complete` requires all selected document/item resolves, `spec_get` accounting
for every linked candidate, and `spec_impact_resolve` for every plausible candidate.

Accuracy-first may batch large pools but never silently samples or stops because
of time or call count. Record candidate IDs and revisions per batch. Compact
metadata-rejection rows are allowed; plausible candidates require detailed
resolved rows.

Use `spec_search` only after the explicit link set is absent, incomplete, stale,
or too broad. Also allow one targeted supplement per affected surface after its
first matrix returns only `not_matching`. Search results enter the plausible
pool only after `spec_get` and `spec_impact_resolve`. `code_search` waits for a
resolved source-near candidate. Before calling `document_search`,
`spec_search`, or `code_search`, retain the exact selected DESIGN/UCL document
item and its `document_spec_resolve` receipt. A fast path may scope unrelated
corpus branches out; it must never bypass that gate.

## Per-Screen Matching Matrix

After pool collection, compare each owned Figma screen against every accounted
candidate. This is a `Figma-screen x screen_spec` matrix.

```text
ScreenSpecMatchRow
- surfaceId
- screenSpecId
- purposeResult
- entryContextResult
- actionResult
- fieldControlResult
- stateTransitionResult
- dataBehaviorResult
- evidenceRefs
- disposition: exact | partial | analogous | not_matching | ambiguous
- reason
```

`exact` explains every essential action and control. `partial` explains only
some fields or behavior. `analogous` is a similar surface in a different entry
path or flow. `not_matching` names the essential action/state it fails to
explain. `ambiguous` retains every plausible conflicting candidate.

A generic account-input spec cannot match `이 계좌 저장하기` unless the resolved
spec explains that control. Source closure and classification must not start
before the full accounting matrix exists and every plausible row is resolved.

```text
screenSpecReceipt
- surfaceId
- epicPoolId
- candidateIds
- matrixRows
- selectedIds
- rejectedIdsAndReasons
- result: exact | partial | analogous | not_matching | ambiguous
- poolReceiptRef
- nextExactRead
```

## Disposition-to-Action Contract

| Best result | Required next action |
| --- | --- |
| `exact` | Proceed to source closure. |
| `partial` | Evaluate any unvisited alternate EPIC first. After ranked EPIC exhaustion, source-close as a `MODIFY` candidate and retain unmatched actions/states. |
| `analogous` | Evaluate any unvisited alternate EPIC first. After exhaustion, source-close it, but analogy alone must not authorize `REUSE`. |
| `not_matching` | Run the allowed targeted supplement, then visit the next ranked EPIC. After exhaustion, enter bounded absence discovery. |
| `ambiguous` | Visit the next ranked EPIC. After exhaustion, remain `UNKNOWN` / `unresolved` / `NEEDS_WORK` with conflicts and next exact read. |

When the alternate EPIC already has a complete revision-matching pool, reuse
that resolved alternate-EPIC pool and calculate only the new screen's matrix.
Spawn a new pool worker only when no reusable pool exists. Do not repeat
DESIGN/UCL or spec reads.

## Source Closure

Only receipt-backed candidates that have completed required alternate-EPIC
evaluation may enter source closure. Prove:

- route -> entry caller -> rendered component; and
- when applicable, state/data bindings -> frontend API -> backend endpoint.

The ban on one worker per screen applies to EPIC-level candidate collection.
After matching, the coordinator may delegate source closure in parallel by
unique route/data path or bounded surface group. A source-closure worker receives
immutable pool receipts and must not repeat `document_spec_resolve`, `spec_get`, or
`spec_impact_resolve`, nor EPIC/DESIGN/UCL discovery. It returns source evidence only;
the coordinator retains final classification and canonical-write authority.

After all ranked EPICs are exhausted, the coordinator owns the bounded
repository/search boundary and may delegate one bounded absence lane.
`not_found` requires that receipt plus exhausted ranked branches. An empty pool
or direct search result is never absence proof.

## DelegationLedger And Recovery

Maintain one `DelegationLedger` row per EPIC/DESIGN-map pool with child surface
states. Record Figma report/source revision, EPIC/map and exact document/item
revisions, candidate IDs, per-batch receipts, per-screen matrix state, attempted
reads, and next read.

If a worker fails after a partial batch, retry only the missing document/spec
receipts when the Figma, document, and completed-spec revisions still match.
Reuse a revision-matching receipt after interruption or alternate-EPIC
reassignment. On drift, invalidate only the affected pool or batch.

## Required Plan Items

```text
[ ] Select CREATE or AUGMENT and record supplied-input hashes
[ ] Resolve and validate exact FigmaEvidencePacket
[ ] Complete ScreenIntentInventory with one ScreenIntentSeed per major screen
[ ] Complete ScreenToEpicRoutingTable
[ ] EpicScreenSpecPool: <EPIC/Design map> — <owned surface IDs>
    [ ] selected exact DESIGN/UCL reads
    [ ] one memory relevance receipt
    [ ] document_spec_resolve receipts
    [ ] complete linked screen_spec union
    [ ] spec_get accounting for every candidate
    [ ] spec_impact_resolve for every plausible candidate
    [ ] full per-screen matching matrix
[ ] SurfaceResolutionChecklist: <surface ID> — <Figma node / screen purpose>
    [ ] screenSpecReceipt
    [ ] accounted screen_spec candidates
    [ ] selected source-closure target
    [ ] route -> entry caller -> rendered component
    [ ] api_spec candidates or not_applicable reason
    [ ] applicable state/data bindings -> frontend API -> backend endpoint
    [ ] ExistingSurfaceResolution and evidence boundary
[ ] Approval Readiness Audit
```

Before every retrieval call or batch, consult the current plan. After every call
or batch, update its receipt, selected IDs, outcome, and next read. Use
`pending`, `in_progress`, `complete`, and `coverage_limit`; a gate is complete
only with its named receipt. A coverage limit requires the attempted read,
candidate/repository boundary, analyzed commit when source was inspected, and
next exact read.

Do not mark a later gate complete while an earlier required gate is missing.
The final audit may complete only when every screen has a valid terminal receipt
and `ExistingSurfaceResolution`. Otherwise keep the pair `NEEDS_WORK` and do not
report approval-ready completion.
