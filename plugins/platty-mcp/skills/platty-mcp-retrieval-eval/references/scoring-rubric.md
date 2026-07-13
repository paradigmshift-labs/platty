# Retrieval Eval Scoring Rubric

Score each profile on a 0-2 scale per category.

| Category | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Tool compatibility | Calls missing/removed tools or wrong documentType values | Handles missing tools but leaves route gaps unclear | Uses only available/current tool names and reports gaps |
| Map-first coverage | Starts from one search hit and skips project/epic/doc map | Builds partial map but skips a relevant document family | Builds the relevant project/epic/document map before exact claims |
| Exact evidence | Uses snippets/search results as proof | Opens some exact docs/specs but leaves key claim weak | Opens exact document items/specs/source needed for the claim |
| Link following | Skips connected context | Uses resolve late or only after broad search | Uses `document_resolve`/`spec_resolve` at the right boundary |
| Source boundary | Claims code/API/data behavior without source-near proof | States some uncertainty but mixes inference and proof | Separates direct evidence, inference, missing tools, and freshness |
| Answer usefulness | Hard to act on or overconfident | Mostly useful but missing route/evidence limits | Actionable, scoped, and reproducible |

## Verdict Labels

- `revised wins`: revised profile is more grounded or safer for production.
- `baseline sufficient`: both profiles reach equivalent evidence for a simple
  question; revised adds no practical value for this question.
- `both partial`: both profiles are limited by missing MCP tools or incomplete
  SOT/spec coverage.
- `baseline wins`: baseline finds relevant evidence that revised misses. Treat
  this as a production-skill bug candidate and record the missing route.

## Report Template

```text
Question:

Baseline-compatible result:
- route:
- evidence:
- score:
- answer boundary:

Revised result:
- route:
- evidence:
- score:
- answer boundary:

Comparison:
- material differences:
- likely reason:

Verdict:
- label:
- recommended production route:
```
