---
name: platty-mcp-retrieval
description: Use when answering Platty project questions through configured read-only MCP tools, including domain terms, epics, business documents, specs, impact, code locations, or source confirmation.
---

# Platty MCP Retrieval

Platty MCP retrieval is map-first. Browse project, epic, document-item, and
spec maps before relying on search hits.

<HARD-GATE>
For broad, domain-term, business-rule, data-field, system-design, capability,
journey, comparison, inventory, or impact questions, do not answer and do not
treat search as proof until the Full-Cycle Retrieval Ladder has been completed
or a required MCP surface is reported missing.

Do not call `document_search`, `ssot_search`, `spec_search`, `code_search`, or
`graph_trace` as the primary route before project overview, vocabulary
normalization when needed, epic map, and the selected BR/DD/DESIGN/UCL document
map have been built. Search assist can narrow candidates after the map exists;
it cannot replace `epic_get`, `document_list`, `document_item_get`,
`document_resolve`, `spec_get`, or `code_snippet` when those tiers are required.
</HARD-GATE>

The MCP profile is read-only. Use configured MCP tools only; do not read local
files, read local SOT, mutate projects, generate documents, or write memory.
Stored SOT files are available only through MCP artifact tools. Artifact paths
and stored file content are not behavior proof without exact evidence reads.

## When To Use

Use this skill for read-only Platty answers about domain terms, epics, business
documents, specs, impact, code locations, source confirmation, or verification
routes.

## When Not To Use

Do not use it for setup, analysis, sync, document generation, mutation, memory
writes, local cache changes, or local file inspection. Report those as
configuration/boundary gaps.

## Operating Flow

1. Resolve project context and context status.
2. Confirm the MCP capability tier needed for the question.
3. Run the Search Clarification Gate when the question is broad or ambiguous.
4. Run the Full-Cycle Retrieval Ladder for broad or semantic branches.
5. Traverse exact specs, graph, or source evidence required by the selected
   branch.
6. Run the Final Route Audit.
7. Answer with the evidence boundary, direct evidence, inference, and missing
   MCP surfaces clearly separated.

Stay within configured MCP tools for all evidence reads.

If the answer requires recording a correction/constraint, re-anchoring memory,
refreshing exports, syncing, or generating documents, stop and report that as a
configuration/boundary gap.

## Quick Rules

| Do | Don't |
| --- | --- |
| Use configured MCP tools only. | Read local files, local SOT, DB tables, or caches. |
| Build project, epic, BR/DD/DESIGN/UCL, spec, and source maps in order. | Treat one search hit, snippet, or score as proof. |
| Normalize vocabulary when terms may not line up. | Treat glossary normalization as behavior evidence. |
| Read exact item/spec/source evidence before implementation claims. | Claim response shape, permissions, writes, emits, or absence without the required evidence tier. |
| Ask one clarifying question only after MCP evidence leaves tied interpretations. | Ask the user before using MCP evidence to reduce ambiguity. |

## Search Clarification Gate

Before choosing a route, decide whether the question is exact or needs a short
runtime Search Brief. Exact source-near questions can bypass this gate unless
the term, scope, or target set is still ambiguous.

Create a Search Brief for broad inventory, impact, Korean/English vocabulary
bridges, business-vs-implementation splits, or any case where one search hit
could look sufficient while missing the target set. For trigger details, read
`references/search-clarification.md`.

Search Brief shape:

```text
Search Brief
- Raw question:
- Question branch:
- Ambiguity triggers:
- Candidate interpretations:
- Terms to normalize:
- Candidate MCP route:
- User decision needed:
```

Keep the Search Brief in runtime working context only. Use configured MCP tools
to reduce ambiguity before asking the user. Ask exactly one clarifying question
only when MCP evidence leaves tied interpretations, and include the recommended
interpretation.

## Full-Cycle Retrieval Ladder

Use the full-cycle ladder for broad, semantic, comparison, inventory, or impact
questions: project context -> overview -> vocabulary when needed -> epic map ->
BR/DD/DESIGN/UCL map -> exact document items -> connected specs -> exact specs
-> source confirmation when required -> Final Route Audit.

Each rung is list/map first, exact detail second. Project overview, README-like
artifacts, catalog rows, glossary output, and search hits orient the route only;
they do not prove behavior. For the detailed ladder and audit checklist, read
`references/full-cycle-retrieval.md`.

## Branch Table

Route by question type: concept/domain term, policy/rule, data field, system
design, capability/journey, exact API/screen/event/schedule, impact/blast
radius, or code location/source absence. For branch routes and completion
criteria, read `references/question-routes.md`.

## Evidence Gates

- Vocabulary normalization is not proof.
- Search hits, snippets, and scores are candidates, not facts.
- Project overview and epic rows choose scope, not final behavior.
- BR, DD, DESIGN, and UCL are semantic routers.
- Source-near behavior claims require exact spec evidence.
- Exact implementation, response shape, permission, DB write, event emit,
  external call, or negative source evidence requires source-level confirmation
  when the MCP server exposes it.
- If a required read-only surface is missing, report an MCP capability gap. Do
  not switch to surfaces outside configured MCP tools.
- Stored SOT file content and artifact paths are transport evidence only.

For examples and branch-specific evidence rules, read
`references/evidence-gates.md`.

## Stop Conditions

Stop and report a boundary when selected-branch tools are missing; the user asks
for setup, analysis, sync, generation, mutation, memory writes, local cache
changes, or local reads; full-cycle maps cannot be built; only search candidates
exist; raw and normalized terms split; broad inventory/impact lacks a target
map; or source-level confirmation is required but graph/code/snippet tools are
missing.

If MCP evidence leaves two or more equally plausible interpretations, ask
exactly one clarifying question and include the recommended interpretation.
Only stop and report a boundary when that question is still required and the
ambiguity cannot be resolved within MCP evidence.

If evidence is weak, name the next read-only MCP surface that could strengthen
the answer. If the next step requires refresh, export, sync, generation, memory
write, or local file access, stop and report a configuration/boundary gap.

## Final Route Audit

Before every final answer, audit the route in runtime working context. If the
audit finds a missing required rung, perform the missing read-only MCP step or
weaken/stop the answer; never convert an audit failure into a confident product
claim. Use `references/full-cycle-retrieval.md` for the checklist.

## Stakeholder Answer Shape

For product or implementation questions, put answer first, evidence second, and
uncertainty last:

```text
## 현재 확인된 기준
## 실제 동작
## 관련 위치
## 더 확인할 후보
```

Explain internal names before listing files, symbols, enums, APIs, or spec ids.
Use "확인됨" only for exact MCP content reads; use "후보", "근거상 보임", or
"추가 확인 필요" for search hits, partial specs, or inferred behavior. For the
full template and example, read `references/answer-shape.md`.

## Answer Contract

Every answer should include the evidence boundary, normalized terms when used,
selected interpretation when a Search Brief constrained the route, surfaces
read, direct evidence separated from inference, freshness or coverage limits,
missing MCP surfaces, and any Final Route Audit result that changes confidence
or scope.

## Verification Reference

Use `references/pressure-scenarios.md` to test whether this skill prevents
search-first answers, glossary-as-proof answers, and local fallback.
