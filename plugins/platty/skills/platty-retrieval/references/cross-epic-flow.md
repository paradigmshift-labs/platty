# Cross-Epic / Multi-Area Flow Guide

Use for flows spanning several epics, product areas, actors, screens, APIs, tables, events, or batches.

## First Hops

1. Use glossary search and `catalog/epics.md` to identify all candidate product areas.
2. Read the overview/design docs for 1-3 relevant epics.
3. Use catalogs and `sot resolve` to find source-near specs for each area.
4. Use graph trace only after anchors are fixed.

## Required Coverage

- Primary area and secondary areas.
- The bridge: API, screen, event, table, schedule, external service, or shared model.
- Confirmed vs candidate cross-area links.
- Missing bridge evidence when not confirmed.

## Stop Rule

Do not report a cross-epic flow from one epic's prose alone. A cross-epic answer needs a bridge artifact or an explicit "bridge not confirmed" statement.
