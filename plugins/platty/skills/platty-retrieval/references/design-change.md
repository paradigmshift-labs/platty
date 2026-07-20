# Design / Change Retrieval Guide

Use this reference for questions like:

- "what must change if we add X?"
- "what breaks if we touch X?"
- "where do we patch this?"
- "add a new type/status/category/classification"
- "this bug exists; where should I investigate?"

## Core Rule

A design/change answer is not a single lookup. It must produce a bounded impact map:

1. **Current state** — source-near specs and business docs when present; otherwise static catalogs, `sot resolve`, graph trace, and code search.
2. **Constraints / background** — memories, business rules, design docs, stale/unknown boundaries.
3. **Existing patterns** — similar handlers, DTOs, components, tests, migrations.
4. **Impact / blast radius** — upstream callers and read carriers, not just write paths.

Start from the EPIC/product area, then descend only through question-relevant purpose docs and connected specs. BR/design/UCL/data docs route the search; source-near specs and source/code prove exact behavior or impact. Start cheap and targeted: grep generated spec catalogs (`apis.md`, `screens.md`) and static catalogs (`tables.md`, `external-services.md`) to fix entry points and `traceId`s before broad code search.

## Type / Status / Category Changes

For requests that add or change a **type, status, category, workflow state, tier, role, channel, or classification**, do not treat it as a single enum edit. Build this mandatory coverage table before final prose:

| Axis | Status | Evidence |
| --- | --- | --- |
| Primary entity | covered / not found | table/model/API/screen that owns the value |
| Grouping / segmentation | covered / not found | group, cohort, segment, bundle, schedule bucket, routing table |
| Participation / tracking | covered / not found | participation, assignment, enrollment, progress, history, log, audit, state transition |
| Preset / configuration | covered / not found | preset, template, default setting, seeded constant, rule/mission config |
| Management surfaces | covered / not found | admin create/edit/list/detail screens and APIs |
| Consumer surfaces | covered / not found | user/seller/customer screens, read APIs, exports/reports, batches, notifications, events, external integrations |
| Tests / generated artifacts | covered / not found | enum tests, DTO/API schema, client types, migrations, seed data, fixtures, E2E, generated SDK/docs |

**Evidence requirement:** an axis is not covered just because it is named. Each covered axis needs a concrete anchor: catalog row, spec path, resolver row, graph trace row, source file:line, or test file:line. If no anchor is found, write `not found in checked surfaces` and list the searches/surfaces checked.

## Grouping / Segmentation Search

For grouping/segmentation, check `catalog/tables.md` before source grep.

Generate candidates from the primary entity and glossary/code terms:

- singular/plural forms
- snake_case forms
- `<primary>_groups`
- `<primary>_group`
- `<primary>_segments`
- `<primary>_segment`
- model names ending in `Group` or `Segment`

If `catalog/tables.md` has an exact row, cite that row or its `db:<table>` trace seed before discussing related screens/APIs. A related team/cohort screen is not enough when a concrete group table/model exists.

## Read Carrier / Blast Radius

For a changed table/column, trace both directions:

```bash
platty graph trace --project <project> --from <serviceMapNodes-id> --direction upstream --depth <n> --json
platty graph trace --project <project> --from db:<table> --direction upstream --kinds accesses_db,calls_api --depth <n> --json
```

The DB-anchored trace surfaces read handlers and frontend screens that call those handlers. If it is empty or short, do not conclude "no read carriers"; cross-check with targeted code search for export/report/download/stats/batch terms.

## Graph-Invisible Checks

Graph trace misses code that bypasses service-map edges. After graph/catalog narrowing, run code search for:

- SDK clients or singleton imports
- direct service/class imports
- `process.env.<PREFIX>_` reads
- exports/reports/batches
- generated DTO/client/type artifacts

Label graph evidence as connected impact and grep/code-search evidence as graph-invisible candidates.

## Final Answer Shape

1. Evidence boundary and freshness.
2. Coverage table with every applicable axis.
3. Confirmed change points grouped by axis.
4. Existing pattern to reuse.
5. Known-static-not-complete impact map.
6. Constraints and unknowns.
7. Proposed implementation order.

Do not STOP after the primary enum/model and one admin screen. A named-but-uncited axis is partial, not covered.
