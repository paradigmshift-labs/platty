# Impact / Trace Retrieval Guide

Use for screen-to-api, api-to-screen, DB impact, shared table, event flow, external integration, batch, and cross-layer blast-radius questions.

## First Hops

1. Identify the relevant EPIC/product area from `catalog/epics.md`, glossary, or the matched catalog row's `epicIds`; use EPIC docs to route, not to prove exact impact.
2. Anchor the entity in the right catalog:
   - API: `catalog/apis.md`
   - screen: `catalog/screens.md`
   - table/model: `catalog/tables.md`
   - event: `catalog/events.md`
   - schedule/batch: `catalog/schedules.md`
   - external service: `catalog/external-services.md`
3. Read the matching source-near spec when present.
4. Trace from the catalog `traceId`, spec `serviceMapNodes`, `db:<table>`, or external service id.

## Trace Rules

- Use upstream for callers/read carriers.
- Use downstream for effects/dependencies.
- For DB impact, run `db:<table>` upstream with `accesses_db,calls_api` when frontend/read carriers matter.
- Read `.data.confirmed` first; treat `candidates` and `relationCandidates` as leads, not confirmed impact.
- Carry `flags.omittedEdgeClasses`, truncation, and empty-trace boundaries into the answer.

## Required Coverage

- Anchor and trace seed.
- EPIC/product-area context.
- Confirmed edges by kind.
- Candidate/omitted limitations.
- Source path when exact code impact is claimed.
- Shared-table warning when table fanout is broad.

## Stop Rule

Never convert "no confirmed graph evidence" into "no impact". For high-fanout tables, narrow by epic, API, screen, or model before reporting blast radius.
