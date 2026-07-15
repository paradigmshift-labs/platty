---
name: platty-mcp-retrieval
description: Use when answering Platty project questions through configured read-only MCP tools, including domain terms, epics, business documents, specs, exact code locations, or source confirmation, or when another Platty MCP skill needs an Impact Seed Packet.
---

# Platty MCP Retrieval

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Platty MCP retrieval is map-first: browse project, epic, document-item, and
spec maps before search hits.

<HARD-GATE>
For broad, domain-term, business-rule, data-field, system-design, capability,
journey, comparison, inventory, or semantic impact-seed questions, do not answer and do not
treat search as proof until the Full-Cycle Retrieval Ladder has been completed
or a required MCP surface is reported missing.

Do not call `document_search`, `ssot_search`, `spec_search`, `code_search`, or
`graph_trace` first. Build project overview, vocabulary when needed, epic map,
and selected BR/DD/DESIGN/UCL map first. Search narrows candidates after maps;
it cannot replace exact `epic_get`, `document_list`, `document_item_get`,
`document_resolve`, `spec_get`, or `readonly_workspace_shell` reads.
</HARD-GATE>

The MCP profile is read-only. Use configured MCP tools only. Do not read local
files, use local shell/CLI as a fallback, read local SOT, mutate projects,
generate documents, or write memory. MCP-provided source tools such as
`readonly_workspace_shell` are allowed when exposed and required by the evidence
gate; they are not local fallback. Stored SOT files are available only through
MCP artifact tools and need exact evidence reads before behavior claims.

Memory overlay reads are a first-class retrieval rung. At every selected
overview, epic, document, item, and spec read, inspect returned memory summary
cards before discarding a candidate or finalizing an answer. If a memory
`title`, `contentPreview`, kind, level, trust, or alias is related to the user
question, ambiguity, correction, constraint, why, naming, deprecated behavior,
or operational caveat, call `memory_get` for the exact body before the final
answer. Broad reads may return summary cards; use `memory_list` for scoped
discovery and `memory_get` for exact bodies. Unread relevant memory is an
incomplete route, not an optional omission.

## When To Use

Use this skill for ordinary retrieval answers about domain terms, epics, business
docs, specs, exact API or exact source-near questions, code locations, or source
confirmation. Use it also when `platty-mcp-impact-analysis` or an owning SDD
skill needs an Impact Seed Packet.

## When Not To Use

Do not use it for setup, analysis, sync, generation, mutation, memory writes,
local cache changes, or local inspection. Report those as boundary gaps.

## Impact Escalation Gate

Route explicit SDD file authoring first: request/story authoring goes to
`platty-mcp-sdd-spec`; design/task authoring goes to `platty-mcp-sdd-design`.
That intent takes precedence over generic impact or design-change wording.

Keep ordinary retrieval retrieval-only. In particular, an exact API, exact
screen, or exact source-near question remains in this skill unless the user also
asks an observable impact question.

Treat questions such as "what changes", "what breaks", "what is affected",
blast radius, affected surface, cross-EPIC impact, or design-change impact as
observable impact triggers. Use this route contract:

```text
ordinary question -> retrieval answer
user impact trigger -> retrieval(routeMode=seed-only, routeOrigin=user)
-> semantic map -> Impact Seed Packet -> platty-mcp-impact-analysis
impact without packet -> retrieval(routeMode=seed-only, routeOrigin=impact)
-> return Impact Seed Packet to impact; do not escalate
impact with packet -> dossier axes; do not re-enter retrieval
SDD file authoring intent -> platty-mcp-sdd-spec or platty-mcp-sdd-design
```

`routeMode: seed-only` makes this skill the packet producer only. It must not
escalate or route to `platty-mcp-impact-analysis`; return or hand back the
Impact Seed Packet to the caller. Reuse a packet that is already built instead
of rebuilding semantic discovery, vocabulary normalization, EPIC mapping,
business-document gates, or selected specs. Retrieval owns semantic scope and
selected specs; impact owns graph, cross-EPIC, repository, and source
convergence.

## Operating Flow

1. Resolve project context and context status.
2. Confirm the MCP capability tier needed for the question.
3. Run the Search Clarification Gate when the question is broad or ambiguous.
4. Run the Full-Cycle Retrieval Ladder for broad or semantic branches.
5. For an observable impact trigger, produce or reuse the Impact Seed Packet;
   otherwise traverse exact specs or source evidence required by the selected
   retrieval branch.
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
| Use configured MCP tools only, including MCP `readonly_workspace_shell` when exposed for bounded source confirmation. | Read local files, use local shell/CLI fallback, local SOT, DB tables, or caches. |
| Build project, epic, BR/DD/DESIGN/UCL, spec, and source maps in order. | Treat one search hit, snippet, or score as proof. |
| Read attached memory overlays on every selected overview/epic/document/item/spec surface, and use `memory_get` for relevant cards. | Treat memory as generated SOT or source-confirmed behavior. |
| On every table/field route, inspect parent `data_dictionary` document memories before item-level conclusions; use `memory_list(documentId)` if attached cards are unavailable. | Read only the `dd_field` item and skip a parent DD fallback memory. |
| Normalize vocabulary when terms may not line up. | Treat glossary normalization as behavior evidence. |
| Read exact item/spec/source evidence before implementation claims. | Claim response shape, permissions, writes, emits, or absence without the required evidence tier. |
| Treat `code_search` and MCP `readonly_workspace_shell` as a pair for code claims: find candidate files/symbols, then read bounded source before asserting exact behavior. | Stop at `code_search` when source code must be inspected. |
| Use `workspace_git_history` and `workspace_sync_status` only for managed-worktree Git questions, preserving `networkChecked: false` and deployment limits. | Call cached refs “latest GitHub” or “production deployment,” or send `git log` through `readonly_workspace_shell`. |
| After reading an exact BR/DD/DESIGN/UCL item, call `document_resolve(itemId)` before source-near search unless the answer is purely conceptual. | Jump from a business item to `document_search` or `spec_search` without first resolving linked context. |
| Ask one clarifying question only after MCP evidence leaves tied interpretations. | Ask the user before using MCP evidence to reduce ambiguity. |

## Code Search And Source Ladder

Use one identifier, symbol, file hint, or signature fragment per `code_search`
query. Never concatenate a keyword bag, Korean or English
natural-language phrase, or multiple unrelated candidates into one query.
Search candidates separately and retain `matchedQuery` for each candidate hit.
Zero results only means the pattern lacks an indexed anchor; it does not prove
absence.

For exact code claims, follow `workspace_repo_list -> select repo ->
readonly_workspace_shell search -> exact source read`. The bounded source read
is required for exact behavior claims. If missing workspace or source tools
prevent that read, report a partial capability gap and use no local fallback.

## Workspace Git History And Freshness

For recent commit history or analysis-worktree freshness, first select one
repository with `workspace_repo_list` when `repoId` is not already known.

- Use `workspace_git_history(projectId, repoId, limit?, path?)` for bounded
  history from the managed analysis worktree.
- Use `workspace_sync_status(projectId, repoId)` to distinguish worktree HEAD,
  last successfully analyzed commit, cached analysis-branch tip, and exact
  worktree refresh time.
- Preserve `networkChecked: false`. A cached origin ref is only the newest ref
  already present on the MCP server.
- Preserve `productionDeploymentObserved: false`. Neither tool proves what is
  running in production; that needs separate CI/CD or deployment evidence.
- If `availability` is `git_metadata_unavailable`, report that source files may
  still be readable while the linked worktree's Git common directory is not.
- Do not substitute local CLI/files or the shell tool's restricted Git
  commands. Missing Git tools are a capability gap.

Do not call these tools for ordinary code behavior questions unless the user
also asks about history or freshness. Continue to use exact specs and bounded
source reads for implementation behavior.

## Vocabulary Tool Choice

- Use `glossary_translate(projectId, text)` for an exact raw phrase or candidate
  term. Keep the raw phrase and any Korean/English candidates visible.
- Use `glossary_list(projectId, limit, cursor)` for broad vocabulary inventory,
  comparisons, ambiguous concepts, all-alias requests, or candidate discovery
  after translation is blank or conflicting.
- If `glossary_translate` on an exact/raw phrase is blank or conflicting while
  plausible Korean/English candidates remain, call `glossary_list` next for
  candidate discovery before translating additional candidates.
- For complete inventory, follow `pageInfo.nextCursor` until
  `pageInfo.hasNextPage` is false. For targeted discovery, stop after the needed
  candidates are found.
- Use `aliases` for query expansion. Keep `generatedAliases` and
  `memoryAliases` separate; memory aliases are overlays and glossary output is
  routing evidence, not behavior or source proof.

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

Use the ladder for broad, semantic, comparison, inventory, or impact-seed: project
context -> overview -> vocabulary -> epic map -> BR/DD/DESIGN/UCL map -> exact
items -> connected specs -> exact specs -> source confirmation when required ->
Final Route Audit.

Each rung is list/map first, exact detail second. Overview, artifacts, catalog
rows, glossary output, and search hits orient only. For the ladder and audit,
read `references/full-cycle-retrieval.md`.

## Branch Table

`references/full-cycle-retrieval.md` is the canonical order of operations.
Read `references/question-routes.md` only to choose branch-specific document
families, extra requirements, and completion checks; do not treat it as a second
copy of the ladder.

Route by question type: concept/domain term, policy/rule, data field, design,
capability/journey, exact API/screen/event/schedule, impact seed, or source
absence.

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
  when the MCP server exposes it. Use `code_search` to locate candidates, then
  actively use MCP `readonly_workspace_shell` to read the bounded source region.
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
normalized terms split; broad inventory/impact seed lacks a target map; or required
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

Use `references/pressure-scenarios.md` only when validating or changing this
skill. Do not load it for ordinary retrieval answers.
