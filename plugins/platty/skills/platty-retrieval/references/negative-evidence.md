# Negative Evidence / Coverage Boundary Guide

Use for "does this exist?", "is there no impact?", "why can't we find it?", graph gaps, missing docs, and coverage-boundary questions.

## First Hops

1. State the evidence surface checked: SOT freshness, catalogs, specs, graph, code, memories.
2. Search exact term, aliases, canonical terms, and likely code terms.
3. Check the right catalog before source grep.
4. If graph returns no confirmed edges, inspect candidates/omitted/truncation flags.

## Required Coverage

- Search scope and terms.
- Surfaces checked.
- Whether absence is "not confirmed" or "not present in checked scope".
- Next evidence needed to make a stronger absence claim.
- Stale/orphaned/missing-doc boundary when relevant.

## Stop Rule

Do not say "does not exist" unless the searched scope is complete for the claim. Prefer "not found in checked surfaces" for partial evidence.
