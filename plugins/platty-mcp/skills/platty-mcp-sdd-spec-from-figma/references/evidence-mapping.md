# Figma-to-product evidence mapping

## Classification First

Classify each candidate before assigning a document target.

| Class | Owner | Allowed use |
| --- | --- | --- |
| `FACT` | `platty-mcp-retrieval` | Confirm current system, policy, data, API, screen, and source facts. |
| `PRODUCT` | `platty-mcp-sdd-spec` | Decide a user-visible promise, policy, scope, rule, acceptance criterion, or success outcome. |
| `DESIGN` | `platty-mcp-sdd-design` later | Preserve implementation and visual details that can change without changing the approved user result. |

Split mixed candidates. For example, "the design shows a save checkbox" is a
direct `FACT` about Figma; "the account must persist across future
participations" is a `PRODUCT` promise; storage location and API shape are
`DESIGN`.

## Evidence Classes

- `direct`: exact copy, policy-note copy, node/property identity, component
  identity, variable, asset identity, or observed geometry.
- `inferred`: layout, color, proximity, repetition, grouping, visual hierarchy,
  naming interpretation, or paraphrase.
- `missing`: absent state or unavailable capability.

Direct evidence is eligible for mapping but does not approve product intent.
Inferred visual evidence must never create an R-NN, AC-NN, US-NN, scenario, or
notification/payment/persistence promise. Keep it in Design Decision Handoff or
as a review question. Missing evidence remains a gap; do not write an invented
empty, error, loading, invalid, retry, or failure state as if Figma specified
it.

## Mapping Table

| Figma evidence | Candidate target | Required gate |
| --- | --- | --- |
| Explicit policy-note copy | R-* / AC-* / scenario candidate | Product owner accepts the visible result; conflicting Platty facts resolved. |
| Visible CTA or field copy | AC-* or scenario observation | Product intent already establishes the action; visual presence alone is insufficient. |
| Prototype reaction | Scenario transition candidate | Destination and product meaning are current and non-conflicting. |
| Component variant or token | Design Decision Handoff | Never a product promise by itself. |
| Layout, color, proximity, visual hierarchy | Design Decision Handoff as `inferred` | Must not be promoted. |
| Missing error/loading/empty state | O-* or Design Decision Handoff gap | Add a product scenario only after product policy defines the user-visible result. |
| Source-confirmable current behavior | FACT retrieval item | Confirm through `platty-mcp-retrieval`. |

Every promoted row records `assertionId -> Figma node -> R-* / AC-* -> US-* /
scenario`. Design-only rows stop at Design Decision Handoff.

## Existing Surface Resolution

Create one record for every major Figma screen before product mapping is
complete. A major Figma screen is a frame or flow state tied to a requirement,
story/scenario, user action, or user-visible state.

```text
ExistingSurfaceResolution
- status: exact | analogous | not_found | unresolved
- figmaNodeIds
- route
- entryCaller
- entryGuards
- renderedComponent
- stateAndDataBindings
- frontendApi
- backendEndpoint
- repository
- analyzedCommit
- evidenceRefs
- comparison: REUSE | MODIFY | NEW | UNKNOWN
```

Never omit a field. Use an explicit `not_applicable`, `none_observed`, or
bounded `not_found` value with evidence instead of leaving an unknown blank.

- `exact`: the actual route and rendered component are connected. The entry
  caller and guards are identified, including an evidenced external/registry
  entry when there is no in-app caller.
- `analogous`: a similar surface is connected, but it is not the same entry
  path or product surface.
- `not_found`: the searched repositories, surfaces, query boundary, and
  analyzed commit are recorded and no candidate remains.
- `unresolved`: a candidate exists, but the route, entry caller, rendered
  component, or another required source relationship cannot be proved.

For an existing candidate, prove route -> entry caller -> rendered component.
When a proposed change is data- or API-related, also prove state/data bindings
-> frontend API -> backend endpoint. Record explicit absence when a layer does
not exist. A component hit, API hit, text match, or analogous screen alone is
partial evidence and must not be called complete existing-screen analysis.

Use `REUSE` when the current surface already supports the approved result,
`MODIFY` when the exact surface exists but needs a product-visible delta, `NEW`
when bounded evidence establishes no reusable surface, and `UNKNOWN` whenever
required evidence is unresolved. Any `unresolved` record or partial required
chain keeps the stage `NEEDS_WORK`.

Resolved source-confirmable current behavior is a `FACT`. Pass it to the
canonical spec owner and impact seed for PRD §9 rather than asking the user to
confirm it. Ask the user only about unresolved `PRODUCT` choices; source lookup
gaps remain retrieval work or explicit coverage limits.

An unresolved candidate is not permission to ask the user for the current
system fact. Continue retrieval while the route or binding can still be checked.
After the bounded current-state search is exhausted, record the search boundary
and coverage limit. A product question may ask about desired future behavior,
never as a substitute for unresolved current-state evidence. Do not fabricate a
route, caller, guard, component, binding, API, endpoint, repository, commit,
table, or task to make the record appear complete. This stage must not start
system design or tasks.

## CREATE Mode

1. Start from the raw idea; do not copy decisions from a comparison PRD.
2. Map direct design evidence to candidates.
3. Resolve FACT items through Platty retrieval.
4. Preserve PRODUCT choices under the owning spec question budget.
5. Delegate the packet to create the canonical pair.

## AUGMENT Mode

1. Copy the independent draft pair into an isolated run and record input hashes.
2. Compare each existing R-*, AC-*, US-*, scenario, O-*, and handoff row with
   direct Figma and Platty evidence.
3. Preserve IDs for unchanged meaning. Add trace or explicit gaps; do not
   replace the pair merely because the design uses different wording.
4. Route actual product contradiction to the owning spec revision flow.
5. Verify the original copied inputs are byte-identical after delegation.

## Figma Literal And Source Binding

When Figma copy differs from the current source binding:

- Current screen uses a dynamic value: classify the Figma literal as a
  `sample-copy` candidate, record the current dynamic policy as `FACT`, and open
  a product question (`PRODUCT`) only when explicit product evidence proposes a
  new fixed policy.
- Current screen uses a fixed literal: record that current behavior as `FACT`.
  The Figma literal still does not approve a new product promise by itself.
- Current binding is not yet resolved: continue retrieval and do not ask the
  user what the current policy is.
- Bounded current-state retrieval is exhausted: record the evidence coverage
  limit. Create an owned product question (`PRODUCT`) only when the product
  input separately proposes a future user-visible policy that still needs a
  product decision; never use that question to fill the current-state gap.

This rule applies equally to amounts such as `500P`, notification copy such as
KakaoTalk/카카오톡, refund dates, holiday/휴일 wording, limits, labels, and other
visible literals. Do not reserve experiment-specific O-* IDs in this reusable
skill.

## Packet Audit

The `ProductIntentFromFigmaPacket` audit must check mode, current packet
identity, Figma integrity and coverage, Platty evidence boundary,
existingSurfaceResolutions, evidenceMappings, openQuestions, designDecisionHandoff,
questionOwnershipAudit, inputHashes, and delegationTarget. Any missing owner,
trace, hash, or disposition blocks delegation as approval-ready work.
