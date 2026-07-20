# Screen / Route Search Guide

Use for screens, pages, routes, UI entry points, navigation, screen specs, or "where is this page?" questions.

## First Hops

1. Grep `catalog/screens.md` for route, title, component, label, or product term.
2. Read the matching `specs/screen/<file>.md`.
3. If the question asks behavior, follow screen relations to APIs/navigation from the spec or `graph trace` using the screen `traceId`.
4. Use source snippets only after the screen/spec route is narrowed.

## Required Coverage

- Screen route/path and source repo/file.
- Screen spec path.
- Similar screens distinguished.
- API calls/navigation/side effects when requested.
- Source component anchor when exact implementation location is requested.

## Stop Rule

Do not claim all related screens from one route hit. For "which screens/all screens", build the target set from `catalog/screens.md` and relations before source grep.
