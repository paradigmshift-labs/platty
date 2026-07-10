---
name: platty-mcp-retrieval
description: Use when answering Platty project questions through configured read-only MCP tools, including domain terms, epics, business documents, specs, impact, code locations, or source confirmation.
---

# Platty MCP Retrieval

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Platty MCP retrieval is map-first: browse project, epic, document-item, and
spec maps before search hits.

<HARD-GATE>
For broad, domain-term, business-rule, data-field, system-design, capability,
journey, comparison, inventory, or impact questions, do not answer and do not
treat search as proof until the Full-Cycle Retrieval Ladder has been completed
or a required MCP surface is reported missing.

Do not call `document_search`, `ssot_search`, `spec_search`, `code_search`, or
`graph_trace` first. Build project overview, vocabulary when needed, epic map,
and selected BR/DD/DESIGN/UCL map first. Search narrows candidates after maps;
it cannot replace exact `epic_get`, `document_list`, `document_item_get`,
`document_resolve`, `spec_get`, or `code_snippet` reads.
</HARD-GATE>

The MCP profile is read-only. Use configured MCP tools only; do not read local
files, read local SOT, mutate projects, generate documents, or write memory. Stored SOT
files are available only through MCP artifact tools and need exact evidence
reads before behavior claims.

Memory overlay reads: read selected `project_overview_get.overview.memories`,
`epic_get.memories`, and `document_get.memories`. Use `memory_list` or
`memory_get` when only counts/ids are visible or overlays may affect the answer.

## When To Use

Use this skill for read-only Platty answers about domain terms, epics, business
docs, specs, impact, code locations, or source confirmation.

## When Not To Use

Do not use it for setup, analysis, sync, generation, mutation, memory writes,
local cache changes, or local inspection. Report those as boundary gaps.

## Operating Flow

1. Resolve project context and context status.
2. Confirm the MCP capability tier needed for the question.
3. Run the Search Clarification Gate when the question is broad or ambiguous.
4. Run the Full-Cycle Retrieval Ladder for broad or semantic branches.
5. Traverse exact specs, graph, or source evidence required by the selected
   branch.
6. Account for relevant memory overlays without treating them as SOT or source
   proof.
7. Run the Final Route Audit.
8. Answer with evidence boundary, direct evidence, inference, memory overlay,
   and missing MCP surfaces separated.

If the answer needs correction recording, re-anchoring, refresh, sync, or
generation, report a boundary gap.

## Quick Rules

| Do | Don't |
| --- | --- |
| Use configured MCP tools only. | Read local files, local SOT, DB tables, or caches. |
| Build project, epic, BR/DD/DESIGN/UCL, spec, and source maps in order. | Treat one search hit, snippet, or score as proof. |
| Read attached memory overlays on selected epics/documents. | Treat memory as generated SOT or source-confirmed behavior. |
| Normalize vocabulary when terms may not line up. | Treat glossary normalization as behavior evidence. |
| Read exact item/spec/source evidence before implementation claims. | Claim response shape, permissions, writes, emits, or absence without the required evidence tier. |
| Ask one clarifying question only after MCP evidence leaves tied interpretations. | Ask the user before using MCP evidence to reduce ambiguity. |

## Search Clarification Gate

Before routing, decide whether the question is exact or needs a runtime Search
Brief. Exact source-near questions can bypass unless term, scope, or target set
is ambiguous.

Create a Search Brief for broad inventory, impact, Korean/English bridges,
business-vs-implementation splits, or any case where one search hit could miss
the target set. For triggers, read `references/search-clarification.md`.

Search Brief shape:

```text
Search Brief
- Raw question:
- Question branch:
- Ambiguity triggers:
- Candidate interpretations:
- Raw terms:
- Korean candidate terms:
- English candidate terms:
- Alias candidates:
- Glossary searches attempted:
- Search-assist queries attempted:
- Candidate MCP route:
- User decision needed:
```

Keep the Search Brief in runtime context only. Use MCP evidence before asking
the user. Ask one clarifying question only when evidence leaves tied
interpretations, and include the recommended interpretation.

## Full-Cycle Retrieval Ladder

Use the ladder for broad, semantic, comparison, inventory, or impact: project
context -> overview -> vocabulary -> epic map -> BR/DD/DESIGN/UCL map -> exact
items -> connected specs -> exact specs -> source confirmation when required ->
Final Route Audit.

Each rung is list/map first, exact detail second. Overview, artifacts, catalog
rows, glossary output, and search hits orient only. For the ladder and audit,
read `references/full-cycle-retrieval.md`.

## Branch Table

Route by question type: concept/domain term, policy/rule, data field, design,
capability/journey, exact API/screen/event/schedule, impact, or source absence.
Branch criteria: `references/question-routes.md`.

## Evidence Gates

- Vocabulary normalization is not proof.
- Search hits, snippets, and scores are candidates, not facts.
- Project overview and epic rows choose scope, not final behavior.
- BR, DD, DESIGN, and UCL are semantic routers.
- Memory overlays are human/agent notes. Use them for corrections, constraints,
  why/context, and ambiguity, but separate them from generated SOT and source
  evidence.
- Source-near behavior claims require exact spec evidence.
- Follow selected `spec_search` candidates with `spec_get` and `spec_resolve`.
- Exact implementation, response shape, permission, DB write, event emit,
  external call, or negative source evidence requires source-level confirmation
  when the MCP server exposes it.
- If `document_item_list` with `itemType` returns no rows but reports
  available items or emits
  `DOCUMENT_ITEM_FILTER_EMPTY_WITH_AVAILABLE_ITEMS`, retry the same document
  without the narrowing filter before treating the item as absent.
- If `document_list` or `document_get` shows document-level `content.items`, but
  `document_item_list` returns no rows or reports `itemTier: inconsistent`,
  report an MCP item-tier gap and weaken to document-level evidence unless exact
  `document_item_get` is available.
- If a required read-only surface is missing, report an MCP capability gap. Do
  not switch to surfaces outside configured MCP tools.
- Stored SOT file content and artifact paths are transport evidence only.

For examples and branch-specific evidence rules, read
`references/evidence-gates.md`.

## Stop Conditions

Stop and report a boundary when selected-branch tools are missing; the user asks
for setup, analysis, sync, generation, mutation, memory writes, local cache/local
reads; full-cycle maps cannot be built; only search candidates exist; raw and
normalized terms split; broad inventory/impact lacks a target map; or required
source confirmation tools are missing.

If MCP evidence leaves tied interpretations, ask one clarifying question with a
recommended interpretation. Stop only when ambiguity cannot be resolved within
MCP evidence.

If evidence is weak, name the next read-only MCP surface. If that requires
refresh, export, sync, generation, memory write, or local files, report a
configuration/boundary gap.

## Final Route Audit

Before every final answer, audit the route in runtime context. If a required
rung is missing, perform the MCP step or weaken/stop; never turn audit failure
into a confident claim. Checklist: `references/full-cycle-retrieval.md`.

## Stakeholder Answer Shape

For product or implementation questions, put answer first, evidence second, and
uncertainty last. Full template: `references/answer-shape.md`.

```text
## 현재 확인된 기준
## 실제 동작
## 관련 위치
## 더 확인할 후보
```

Explain internal names before technical ids. Use "확인됨" only for exact MCP
content reads; use "후보", "근거상 보임", or "추가 확인 필요" for search hits or
inferred behavior.

## Answer Contract

Every answer should include evidence boundary, normalized terms when used,
selected interpretation, surfaces read, direct evidence vs inference, freshness
or coverage limits, missing MCP surfaces, and any audit result that changes
confidence or scope.

## Verification Reference

Use `references/pressure-scenarios.md` to test whether this skill prevents
search-first answers, glossary-as-proof answers, and local fallback.
