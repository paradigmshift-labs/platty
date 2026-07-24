# Runtime Work-Plan Contract

Use this contract for every `platty-mcp-sdd-spec-from-figma` run. The runtime
plan is the live control state; the evidence packet and persisted product
artifacts remain the durable outputs.

## Runtime Mapping

| Runtime | Required plan operation |
| --- | --- |
| Codex | `update_plan` |
| Claude Code | `TodoWrite` |

If the runtime has no equivalent plan tracker, keep the result `NEEDS_WORK`.
Do not claim approval-ready completion.

## Required Plan Items

Create these items before Figma evidence resolution:

```text
[ ] Select CREATE or AUGMENT and record supplied-input hashes
[ ] Resolve and validate the exact FigmaEvidencePacket
[ ] Identify major Figma screens and create one surface item per screen
[ ] Resolve project, candidate EPIC, and its DESIGN/UCL document map
[ ] Run Approval Readiness Audit
```

After the screen inventory is known, create one ordered item per major screen:

```text
SurfaceResolutionChecklist: <nodeId> — <screen purpose>
[ ] Select candidate EPIC and exact DESIGN/UCL document
[ ] Assess the candidate EPIC memory overlay
[ ] Read the exact document/item with document_get or document_item_get
[ ] Resolve direct Spec links with document_spec_resolve(itemIds)
[ ] Rank linked screen_spec candidates
[ ] Rank linked api_spec candidates, or record not_applicable with evidence
[ ] Read selected candidates with spec_get
[ ] Resolve reverse business context with spec_document_resolve only when needed
[ ] Resolve technical impact with spec_impact_resolve only when needed
[ ] Close route -> entry caller -> rendered component from source evidence
[ ] Close state/data bindings -> frontend API -> backend endpoint when applicable
[ ] Record ExistingSurfaceResolution, comparison, and evidence boundary
```

The ordered business-to-Spec path is:

```text
project_list / context_status
-> project_overview_get
-> epic_list / epic_get
-> epic_get.documentRefs
-> document_get(DESIGN or UCL)
-> document_item_get(itemIds)
-> document_spec_resolve(itemIds)
-> spec_get(specIds)
```

`spec_document_resolve` is a reverse business-context branch. Use it only when
the selected Spec must be traced back to business context. `spec_impact_resolve`
is a technical-impact branch. Use it only for impact, blast-radius, or source
frontier work. Neither branch is an unconditional completion step.

## Memory Overlay

After selecting the candidate EPIC, assess memory relevance once and reuse the
decision for its screens:

- `not relevant`, with a short reason; or
- relevant, with `memory_list` followed by `memory_get` only for selected
  cards, recording their IDs and revisions.

Memory is a correction or constraint overlay. It never proves a current route,
screen, API, source binding, or absence.

## State And Receipt Rules

1. Before each retrieval call or batch, identify the single plan gate it
   advances.
2. After the call, update that gate with the tool name, selected IDs, and
   concise outcome.
3. Mark a gate complete only when its named receipt exists.
4. Record a coverage limit only after the attempted read, candidate or
   repository boundary, analyzed commit when applicable, and next exact read.
5. Search assist may narrow an unresolved remainder only after the candidate
   EPIC and DESIGN/UCL map have been read. A Figma label is a routing hint, not
   proof of a current business item or Spec.
6. Do not start source search from a raw Figma phrase once a linked Spec exists.
   Start from the selected Spec and record the repository plus analyzed commit.
7. Before product persistence and before responding, audit every surface item
   against its `ExistingSurfaceResolution`. A pending or unsupported gate keeps
   the result `NEEDS_WORK`.

