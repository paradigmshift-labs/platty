# Figma and product alignment gate

## Unit Of Comparison

Build independent inventories of direct Figma semantic candidates and approved
product requirements. Compare meaning, not file lineage or visual resemblance.
Classify every candidate and every requirement exactly once; retain both sides
when one Figma node maps to several product ids.

## Dispositions

| Disposition | Meaning | Next owner |
| --- | --- | --- |
| `MATCHED` | Direct Figma evidence and approved product intent describe the same visible result. | technical design |
| `DESIGN_DETAIL` | Layout, component, token, spacing, color, typography, asset, geometry, or interaction detail preserves the approved result. | technical design |
| `FIGMA_GAP` | An approved state or scenario is absent from the selected Figma coverage, including missing error, loading, empty, validation-failure, submission-failure, or recovery states. | design evidence resolution or product review |
| `PRODUCT_CONFLICT` | Direct Figma copy/state and approved R/AC/US/scenario require materially different visible behavior, policy, money, notification, persistence, permission, or scope. | product spec revision |
| `STALE` | Packet identity, source revision, drift, integrity, or coverage is not current. | Figma resync |
| `BLOCKED` | Product approval, impact evidence, identity, ownership, or required capability is missing. | owning gate |

## Precedence

Apply terminal evidence gates before semantic classification:

```text
STALE > BLOCKED > PRODUCT_CONFLICT > FIGMA_GAP > MATCHED | DESIGN_DETAIL
```

`MATCHED` and `DESIGN_DETAIL` can coexist only as separate rows for separate
assertions. One assertion receives one disposition.

## Conflict Test

A difference is `PRODUCT_CONFLICT` only when accepting both meanings would be
impossible or would change the approved user result. Examples include fixed
versus variable money, notify versus do-not-notify, auto-save versus opt-in,
editable versus locked, or different eligibility/period rules.

A visual difference is not a `PRODUCT_CONFLICT`. Layout, token, component,
spacing, color, typography, radius, icon, and product-preserving transition
details are `DESIGN_DETAIL`, with direct/inferred evidence retained.

## Missing-State Test

Missing error, loading, empty, failure, validation, retry, or recovery evidence
is `FIGMA_GAP`, not invented Figma behavior. If the approved PRD already defines
the visible outcome, technical design may carry an evidence-resolution and
visual QA row. If the visible outcome is not product-defined, return that one
question to product revision before design.

## Connected And Independent Inputs

- `CONNECTED` may reuse existing trace ids, but every trace is revalidated
  against the current packet.
- `INDEPENDENT` starts with no assumed trace. Build semantic alignment from
  direct evidence and approved product meaning. Shared lineage is never a gate.

## Trace Contract

Every frontend or user-visible implementation row eventually completes:

```text
Figma node -> R/AC -> US/scenario -> design decision -> task
```

Before design, the final two cells may be `pending`. `tasks.md` is allowed only
after the existing design owner fills design decisions, the exact design is
explicitly approved, and every task points back through the same chain.

## Product Conflict Packet

For each `PRODUCT_CONFLICT`, include current approved meaning, conflicting
direct evidence, affected product and scenario ids, whether the Figma or product
may be outdated, visible trade-off, recommendation, and next owner. Do not edit
either source while classifying it.
