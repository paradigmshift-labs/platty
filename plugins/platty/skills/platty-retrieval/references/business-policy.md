# Business Policy / Rule Guide

Use for business rules, policy, permissions, constraints, eligibility, validation, and documented behavior.

## First Hops

1. Use glossary search and `catalog/epics.md` to pick the business area.
2. Read `br.md`, `usecases/ucl.md`, `usecases/ucs.md` when present, and relevant `design.md`.
3. Follow only question-relevant item-level links or `sot resolve --item` to connected API/screen/model specs.
4. Confirm actor, permission, response shape, side effect, table impact, or enforcement in source-near spec/code before asserting it as implementation fact.

## Required Coverage

- Rule/policy text and path.
- Connected implementation evidence when claiming enforcement or exact behavior.
- Actor/permission boundary.
- Difference between business intent, generated doc wording, and source-confirmed behavior.

## Stop Rule

Business docs are an index, not ground truth. If connected source evidence is absent, label the rule as documented intent or generated-doc evidence, not confirmed enforcement.
