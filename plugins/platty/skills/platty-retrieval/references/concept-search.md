# Concept / Term Search Guide

Use for concept, terminology, ambiguous Korean/English terms, product vocabulary, and "how are these different?" questions.

## First Hops

1. Preserve the raw user phrase.
2. Run glossary search for each raw term and the combined phrase.
3. Read `catalog/epics.md` to find product areas by readable name/summary.
4. Read 1-3 candidate epic `overview.md` / `design.md`; use `br.md` or `usecases/ucl.md` only when the question asks rules or flows.
5. If the concept has an enum/codeTerm, verify it once with `code search` or source grep before treating the set as complete.

## Ambiguity Rule

If a term can mean a label, menu/list, enum/model value, business concept, or implementation branch, expose the split before answering. Do not silently pick one meaning.

## Required Coverage

- Raw term and normalized/canonical term.
- Candidate product areas or epics.
- User-facing labels when relevant.
- Backend enum/model/source term when relevant.
- List/scope evidence when a label includes multiple backend types.
- Adjacent lifecycle/state area when the concept is an action domain: participation, tracking, enrollment, progress, history, log, or join records.
- Explicit unknowns if the term is only partially evidenced.

For "how are these different?" comparison questions, make a compact concept table:

| Concept / candidate | Product area | Source-near anchor | Scope boundary |
| --- | --- | --- | --- |

Do not treat participation/tracking as incidental when the compared concepts are campaigns, missions, enrollments, applications, orders, rewards, or workflows. If a separate lifecycle/tracking epic, table, API, or source model exists, include it as its own row or explicitly say it was not found.

## Stop Rule

A pure naming question may stop after glossary + epic catalog. A comparison/difference question must verify the actual product areas and at least one implementation or source-near anchor when claiming how they differ.
