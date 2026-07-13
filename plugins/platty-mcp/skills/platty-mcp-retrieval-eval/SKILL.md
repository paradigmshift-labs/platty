---
name: platty-mcp-retrieval-eval
description: Use only when explicitly asked to compare, QA, evaluate, or regression-test Platty MCP retrieval behavior across baseline and revised retrieval profiles.
---

# Platty MCP Retrieval Eval

Use this skill only for explicit evaluation. It is not the normal retrieval
skill for answering product questions. Normal Platty MCP questions route to
`platty-mcp-retrieval`.

## Goal

Compare retrieval behavior across two profiles without changing the user's
configured MCP server:

1. **Baseline-compatible profile**: preserves the older search-first behavior
   shape, but corrects removed or invalid tool names so the route can run on the
   current MCP surface.
2. **Revised profile**: uses the current `platty-mcp-retrieval` policy,
   especially `document_resolve` before source-near spec search.

The output is an evaluation report, not a single production answer.

## Required Setup

Before comparing:

1. Read `using-platty-mcp`.
2. List available MCP tools.
3. Select the project with `project_list` or the user's explicit project id.
4. Check `context_status`.
5. Read:
   - `references/baseline-profile.md`
   - `references/revised-profile.md`
   - `references/scoring-rubric.md`

If the runtime lacks the tools required for one profile, mark that profile as
`blocked` or `partial` and explain the missing surface. Do not silently fall
back to local files or local CLI.

## Evaluation Loop

For each user question:

```text
raw question
-> run baseline-compatible route
-> record tools used, exact ids opened, and answer boundary
-> run revised route
-> record tools used, exact ids opened, and answer boundary
-> score both routes with scoring-rubric.md
-> compare answer quality and stability
```

Run each profile independently. Do not let evidence discovered by one profile
become hidden context for the other profile unless the user asks for a combined
best answer after the evaluation.

## Output Shape

Return:

```text
Question
Baseline-compatible result
Revised result
Comparison
Verdict
Recommended production route
```

Keep the report concise, but include enough exact evidence ids, document/spec
titles, and missing-tool notes for another agent to reproduce the result.

## Hard Boundaries

- Do not use `code_snippet`; it is not part of the current MCP contract.
- Do not use `document_trace`; use `document_resolve`.
- DD/Data Dictionary document filters use `data_dictionary`, not `dd`.
- `spec_search` hits are discovery only. Follow selected hits with `spec_get`
  and `spec_resolve` before source-near claims.
- For observed conversion, funnel, bottleneck, RDS, or Athena claims, use a
  configured data MCP. If no data MCP is exposed, stop at SSOT/spec-derived
  hypotheses and instrumentation points.
