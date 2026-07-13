# Baseline-Compatible Retrieval Profile

Use this profile to simulate the older retrieval behavior while staying
compatible with the current MCP tool contract.

## Purpose

This profile is intentionally less strict than the revised profile. It helps QA
compare whether the revised `document_resolve`-first route improves grounding,
coverage, and reproducibility over a search-first route.

## Compatibility Fixes

The historical baseline may mention stale or invalid surfaces. Correct them
before running:

| Historical/stale behavior | Current compatible behavior |
| --- | --- |
| `code_snippet` source reads | `code_search` to find candidates, then bounded `readonly_workspace_shell` when exposed |
| `document_trace` | `document_resolve` |
| `documentType=DD` or `documentType=dd` | `documentType=data_dictionary` |
| uppercase document type filters | use stored MCP values: `br`, `data_dictionary`, `design`, `ucl` |

Do not intentionally call removed tools to prove they fail. The purpose is to
compare retrieval strategy, not tool-name breakage.

## Route Shape

```text
project_list / project_get
-> context_status
-> project_overview_get
-> glossary_translate when terms are ambiguous
-> epic_list / epic_get
-> document_search or spec_search may be used early for candidate discovery
-> document_list for likely BR/DD/DESIGN/UCL maps when the branch is known
-> document_get / document_item_list / document_item_get for exact business evidence
-> document_resolve when connected context is needed
-> spec_search/spec_list for missing source-near candidates
-> spec_get for selected source-near specs
-> spec_resolve after selected specs
-> code_search
-> readonly_workspace_shell only for exact source confirmation when exposed
```

## Expected Weaknesses To Measure

- Stops at search hits without exact `*_get`.
- Uses `spec_search` before reading the business document map.
- Misses DESIGN when explaining product/admin/user flows.
- Treats absence from search as absence from the product.
- Produces plausible but weakly grounded answers when linked specs existed but
  were not followed first.

These weaknesses are not automatic failures. Score them only when they affect
the answer.
