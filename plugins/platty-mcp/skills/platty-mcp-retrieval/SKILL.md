---
name: platty-mcp-retrieval
description: "Internal retrieval ladder, explicit invocation by exact name only (never auto-selected for a question): map-first semantic and direct-first source-near routes over domain terms, epics, business documents, specs, and code locations, and the producer of the Impact Seed Packet used by platty-mcp-impact-analysis and the SDD skills. To answer a user's project question use platty-mcp-search."
disable-model-invocation: true
---

# Platty MCP Retrieval

Sub-skill: user-facing answers to project questions go through
`platty-mcp-search`, which runs this ladder (light path or docs collectors)
and owns the answer shape (결론 first). Read this skill for the ladder,
routes, gates, and the Impact Seed Packet contract.

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

For an SDD authoring, impact-approval, or design caller, also read
`../using-platty-mcp/references/sdd-question-ownership.md` before building the
Search Brief. Retrieval must distinguish source-confirmable facts, product
choices, and technical-design choices before it returns a question or handoff.

Platty MCP retrieval is map-first for semantic and business questions and
direct-first for exact source-near anchors.

## Question Route Precedence

Classify the question before selecting the first discovery tool:

- Exact Spec ID, API route, screen route, event, schedule, file, symbol, or
  source anchor: use the direct-first source-near branch. Start with `spec_get`
  when the Spec ID is known, `spec_search` when an exact Spec anchor is known
  but its ID is not, or `code_search` plus bounded source read for an exact code
  anchor.
- Business meaning, business rule, capability, journey, broad comparison, or
  inventory: use the map-first semantic branch through project, EPIC, and typed
  business-document maps.
- Exact code or Spec impact that asks for business context: start direct-first,
  confirm the source-near target, then traverse `spec_business_resolve` back to
  business items and EPIC context.
- A mixed business-to-implementation question with no exact source anchor:
  establish the semantic map first, then descend through connected Specs and
  bounded source reads.

Direct-first changes discovery order, not evidence quality. A search hit is
still only a routing candidate and must be followed by `spec_get` or an exact
source read.

## Discovery Packet Override

For semantic map-first discovery, send `view:"summary"` on `project_get`,
`epic_get`, and `business_rule_get`; on the BR get also send `itemLimit:20`.
This is the narrow exception to replaying returned `next.arguments`: when a
selected discovery packet for one of these three gets omits `view`, add summary
and replace its BR `itemLimit` with 20. Keep all IDs, scopes, cursors, and other
arguments unchanged. Other tools receive their returned arguments unchanged.

For BR pagination, execute a returned `business_rule_item_list` packet unchanged.
If a legacy full BR get or BR item-list response has no such packet, continue only
when its `itemPage`/`pageInfo` has `hasNextPage:true`, a nonempty `nextCursor`, and
a valid limit. Preserve project, document, scope, and the prior list limit; replace
only the cursor. For the first full-get continuation, use `itemPage.limit`. After
a summary's returned initial 20-item packet, keep 20. Stop on missing or conflicting
cursor/limit data, or a missing initial summary packet. Terminal pages need no call.
This legacy cursor continuation preserves existing full/default server output.

Replay a packet that explicitly says `view:"full"` exactly as returned. Select
the EPIC full continuation when the requested branch needs supporting-only
links; open its returned document refs. A known user document/item and the
direct-first branch retain their exact reads. Schema support alone does not
justify applying the discovery override to those reads. An older server without
the required summary input is a named capability gap; use no host/local fallback.

Project/EPIC summaries supply availability counts and typed-list continuations,
not `documentRefs`. Follow positive counts for the selected families through
the returned scoped lists, then their exact document IDs. For routing, supporting
counts are distinct from direct-list counts; an empty direct list cannot erase
supporting links. BR summary item cards route to exact item reads, not policy
proof. Details and completion checks: `references/full-cycle-retrieval.md`.

`projectId` is an opaque ID, never a display name or project name. When the
user did not name a project, omit `projectId`: the server uses its default
project (the Platty CLI's current project, or the only project you can read)
and echoes the `projectId` it used; reuse that ID for the remaining route. Do
not call `project_list` first. Call `project_list` only when a call returns
`INVALID_INPUT` naming `projectId` (no default is set; the operator can set one
with `platty project use <id>`), or when the user asks which projects exist.
When the request names a project but does not provide its exact ID, call
`project_list` once before the first project-scoped tool, select the matching
returned `id`, and reuse that ID for the remaining route.

<HARD-GATE>
For broad, domain-term, business-rule, data-field, system-design, capability,
journey, comparison, inventory, or semantic impact-seed questions without an
exact source anchor, do not answer and do not treat search as proof until the
Full-Cycle Retrieval Ladder has been completed or a required MCP surface is
reported missing.

The only exception is the `Initial Product Intent Gate` for an SDD product
caller. It may ask one raw-intent question before deep or full-cycle retrieval
when two materially different user-visible interpretations are explicit in the
request. It must make no existing-system claim and must not ask a `FACT` or
`DESIGN` question.

For a time-based reward threshold with no stated reward cadence, that exception
is mandatory: ask once-per-visit/window versus repeated-threshold earning before
overview, glossary, EPIC, document, or source retrieval. An existing reward
pattern cannot choose this user-visible earning policy.

For questions governed by this broad/semantic hard gate, do not call
`<family>_search`, `spec_search`, `code_search`, or `graph_trace` first. Build
project metadata, vocabulary when needed, domain_list/domain_get, and the EPIC map first.
Call `epic_get` in summary discovery, then use its positive availability counts
and returned typed lists to find the selected BR, DESIGN, DD, and UCL document
IDs. When the selected branch needs supporting-only links, replay its explicit
full continuation and open the returned `documentRefs` with `<family>_get`.
Search narrows candidates only when an exact ID is absent;
it cannot replace exact `epic_get`, `<family>_get`, `<family>_item_get`,
`<family>_spec_resolve`, `spec_get`, or `readonly_workspace_shell` reads.
Use `<family>_search` only after this direct route cannot identify the needed
business document or item.

Use `spec_list` for a complete API, screen, event, schedule, or DB logic inventory. Apply
the optional `epicId` and `specKind` filters, then follow every `nextCursor`
until `hasNextPage` is false. Use `spec_search` only for targeted discovery when
the exact Spec ID is unknown, then confirm selected hits with `spec_get`.
When filtering, `specKind` must use the stored values `api_spec`, `screen_spec`,
`event_spec`, `schedule_spec`, or `db_logic_spec`. Never pass the shorthand values `api`,
`screen`, `event`, or `schedule`; omit `specKind` when unsure and narrow from
the returned cards instead.
</HARD-GATE>

## MCP Tool Boundary

| Case | Required behavior |
| --- | --- |
| Allowed | Use configured MCP tools. MCP `readonly_workspace_shell` is the bounded source-read tool when exposed. |
| Prohibited | Do not use host/local files, host/local shell or CLI, local SOT, project mutation, generation, or memory writes. |
| Missing MCP surface | Report the capability gap and weaken or stop the claim; never substitute a host/local surface. |

Stored SOT files are available only through MCP artifact tools and need exact
evidence reads before behavior claims.

Memory overlay reads are a first-class retrieval rung. On selected `project_get`,
`epic_get`, typed document/item and `spec_get` reads inspect returned `memories`
summary cards (`memoryId`, `summary`, `memoryKind`, `revision`) before discarding
evidence or finalizing. Relevant rationale, correction, constraint, naming or
operational caveats require the exact body. Replay the selected response `next`
packet including `scope:"approved"`; default own-request reads are a different
route. Summaries and counts are not full bodies. Item-get results attach Memory
at the response level, not necessarily inside each item.

Use `memory_list(projectId,scope:"approved",documentId?/epicId?)` only for an
explicit scoped inventory or fallback when the selected exact read lacks cards.
For table/field questions inspect the parent DD Memory before item conclusions.
Keep approved visibility inside `READ_OWN/READ_ALL`; other people's pending/
rejected requests and glossary-level Memory stay hidden. Null persisted anchors
remain explicit gaps; never guess parents. Memory remains an overlay.

## When To Use

Use this skill as the retrieval ladder under `platty-mcp-search` (its light
path and docs-track collectors) for domain terms, epics, business docs, specs,
exact API or exact source-near questions, code locations, or source
confirmation. Use it also when `platty-mcp-impact-analysis` or an owning SDD
skill needs an Impact Seed Packet. A user's project question that arrives
without a caller routes to `platty-mcp-search` first.

## When Not To Use

Do not use it for setup, analysis, sync, generation, mutation, memory writes,
local cache changes, or local inspection. Report those as boundary gaps.

For an ordinary Q&A request (no `routeMode`, no SDD or impact caller), when
`context_status.documentAvailability` shows no business documents (`br`,
`ucl`, `design`, and `data_dictionary` all 0) or the user explicitly asks for a
code-only answer, hand off to `platty-mcp-code-qa` before the ladder instead of
building empty EPIC/business-document maps. This handoff never applies to SDD
or impact packet requests (`routeMode: seed-only`): keep producing the Impact
Seed Packet for the caller and record the empty business-document maps as a
documented gap in the packet, per the packet return contract below.

Earlier `platty-mcp-search` versions used this skill as the docs-track
collector ladder; the current docs collector follows `platty-mcp-doc-search`
and the Job Card budget in `platty-mcp-search/references/job-cards.md`, not
this skill. When this skill is invoked by name in collector style it returns
the collector JSON instead of a final answer, and the semantic ladder below
is logged as the rungs D0–D7 (every rung logged; `<family>_item_get`
→ `<family>_spec_resolve` → `spec_get(claimLimit: 5)` for every adopted
item), inside that contract's call budget and search rules (≤ 2 document
searches, each only after the rungs left no ID and logged with
`ladder_exhausted:D<n>`); a missing document family is recorded as
`coverage` with the contract's fallback, never as a stop.

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

Exemption: when this skill runs as the docs-collector ladder for
`platty-mcp-search`, or for a business-QA list handled by it, do not
escalate to `platty-mcp-impact-analysis` even if a question says "what breaks"
or "what is affected". Collect the evidence and return it to the search
orchestrator, which runs the impact sweeps (S1-S7) itself. A standalone Impact
Dossier request, outside a search or business-QA list, still routes to
`platty-mcp-impact-analysis` through the Impact Seed Packet.

`routeMode: seed-only` makes this skill the packet producer only. It must not
escalate or route to `platty-mcp-impact-analysis`; return or hand back the
Impact Seed Packet to the caller. Reuse a packet that is already built instead
of rebuilding semantic discovery, vocabulary normalization, EPIC mapping,
business-document gates, or selected specs. Retrieval owns semantic scope and
selected specs; impact owns graph, cross-EPIC, repository, and source
convergence.

`<family>` is reference notation for a concrete prefix in the transport tool map;
replay returned tools and arguments, including approved Memory scope and typed seeds.

## Operating Flow

1. Resolve project context and context status.
2. Confirm the MCP capability tier needed for the question.
3. For an SDD product caller, run the Initial Product Intent Gate before deep
   retrieval and pause only when the raw request has a material user-visible
   ambiguity. Apply the answer to narrow the Search Brief.
4. Run the remaining Search Clarification Gate and Full-Cycle Retrieval Ladder
   for broad or semantic branches.
5. For an observable impact trigger, produce or reuse the Impact Seed Packet;
   otherwise traverse exact specs or source evidence required by the selected
   retrieval branch.
6. Account for relevant memory overlays without treating them as SOT or source
   proof.
7. Classify unresolved items as `FACT`, `PRODUCT`, or `DESIGN` for an SDD
   caller. Resolve `FACT`, return safe recommended `PRODUCT` assumptions, and
   preserve `DESIGN` items for the owning design phase.
8. Run the Final Route Audit.
9. Answer with evidence boundary, direct evidence, inference, memory overlay,
   and missing MCP surfaces separated.

If the answer needs correction recording, re-anchoring, refresh, sync, or
generation, report a boundary gap.

## Quick Rules

| Do | Don't |
| --- | --- |
| For semantic and business questions, build project, epic, BR/DESIGN/DD/UCL, Spec, and source maps in order. For exact anchors, take the direct-first branch. | Treat one search hit, snippet, or score as proof. |
| On every table/field route, inspect parent `data_dictionary` document memories before item-level conclusions; use `memory_list(documentId)` if attached cards are unavailable. | Read only the `dd_field` item and skip a parent DD fallback memory. |
| Normalize vocabulary when terms may not line up. | Treat glossary normalization as behavior evidence. |
| Read exact item/spec/source evidence before implementation claims. | Claim response shape, permissions, writes, emits, or absence without the required evidence tier. |
| Treat `code_search` and MCP `readonly_workspace_shell` as a pair for code claims: find candidate files/symbols, then read bounded source before asserting exact behavior. | Stop at `code_search` when source code must be inspected. |
| Use `workspace_git_history` and `workspace_sync_status` only for managed-worktree Git questions, preserving `networkChecked: false` and deployment limits. | Call cached refs “latest GitHub” or “production deployment,” or send `git log` through `readonly_workspace_shell`. |
| After exact BR/UCL/DESIGN item reads, resolve each selected `itemId` through its concrete Spec resolver; DD usage uses `data_dictionary_spec_resolve` when needed. | Jump from a business item to search without first using its stored directional link. |
| After `spec_get`, call `spec_business_resolve` only for reverse business context and `spec_impact_resolve` only for technical impact. | Expand every direction when the question needs only one. |
| Treat `graph_trace` as one hop; continue only selected frontier node IDs and maintain a visited set. | Ask the server for an implicit recursive graph walk. |
| For SDD product work, use the optional initial intent question before deep retrieval and at most one evidence-informed follow-up after MCP evidence. | Ask an initial question about an existing fact, ask more than two discovery questions, or ask the user to choose a `FACT` or `DESIGN` item. |
| Stop expanding the selected branch after the required rungs establish the requested result and remaining uncertainty is design-owned. | Read every remotely related document, spec, or source path merely because it is available. |

## Code Search And Source Ladder

Before the first `code_search` or `readonly_workspace_shell` call for a project,
call `code_search_guide_get(projectId)` once. The operator-provided guide states
repository rules and the internal module hierarchy; use it to narrow the
repository, paths, and identifiers you search. Follow `pageInfo.nextCursor` only
when the guide is paged. When it returns `available: false`, continue with the
existing ladder. The guide only scopes the search; exact behavior claims still
need the bounded source read below.

Use one identifier, symbol, file hint, or signature fragment per `code_search`
query. Never concatenate a keyword bag, Korean or English
natural-language phrase, or multiple unrelated candidates into one query.
Search candidates separately and retain `matchedQuery` for each candidate hit.
Zero results only means the pattern lacks an indexed anchor; it does not prove
absence.

For exact code claims, follow `code_search_guide_get -> workspace_repo_list ->
workspace_search -> select repo -> readonly_workspace_shell exact source read`.
Use `workspace_search(projectId, pattern, repoIds?, globs?)` to find source-text
candidates across several repositories in one call: take the candidate
repositories, paths, and identifiers from the code search guide, pass them as
`repoIds` and `globs`, and search one exact identifier per call (a URL segment,
SQL id, table name, or class name). Read every `repositories[].status`: only
`complete` means that repository was fully searched; `timeout`,
`deadline_exceeded`, or an unavailable status means coverage is partial for
that repository, never absence. When `truncated` is true, narrow `repoIds` or
`globs` and search again before concluding. A `workspace_search` match is a
candidate location; the bounded source read is required for exact behavior
claims. If missing workspace or source tools
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
- Use `glossary_term_search(projectId, query)` for candidate discovery when a
  concept is named or ambiguous; use `glossary_term_list(projectId, limit, cursor)`
  (20 terms per page by default) only for a deliberate broad vocabulary inventory,
  comparisons, or all-alias requests.
- If `glossary_translate` on an exact/raw phrase is blank or conflicting while
  plausible Korean/English candidates remain, call `glossary_term_list` next for
  candidate discovery before translating additional candidates.
- For complete inventory, follow `pageInfo.nextCursor` until
  `pageInfo.hasNextPage` is false. For targeted discovery, stop after the needed
  candidates are found.
- Use `aliases` for query expansion: `glossary_translate` items and
  `glossary_term_list` rows carry `aliases[{id, alias, revision}]` (omitted
  when empty); `glossary_term_get` returns the term as a document item whose
  `body.aliases` is a string array; `glossary_term_search` rows carry alias
  strings. `glossary_translate` items
  add `rank`, `matchType`, and `matchedAlias` (the alias that matched, or
  null), and its envelope carries `searchMode` and `degraded`; a
  `degraded: true` result is weaker routing evidence, not a stop. Memory
  overlays arrive as `memories` cards on the owning read (`glossary_term_get`,
  document gets), never as alias fields; keep them separate from glossary
  aliases. Glossary output is routing evidence, not behavior or source proof.

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
- Ownership by unresolved item: FACT | PRODUCT | DESIGN
- Recommended product assumption:
- Design decision handoff:
- Raw terms:
- Korean candidate terms:
- English candidate terms:
- Alias candidates:
- Glossary searches attempted:
- Search-assist queries attempted:
- Candidate MCP route:
- User decision needed:
- initialQuestionUsed:
- followupQuestionUsed:
- discoveryQuestionsRemaining:
```

Keep the Search Brief in runtime context only.

### Initial Product Intent Gate

Before deep or full-cycle retrieval, ask at most one question when the raw idea
itself has two materially different user-visible interpretations and choosing
the wrong one would materially redirect the evidence branch. Ask only what the
user intends, one question per message, without claiming current-system facts.
Record `initialQuestionUsed: true`, then narrow the Search Brief from the answer.
Skip this gate when the request is already specific or a safe existing product
default can be evaluated without choosing between user-visible outcomes. Do not
apply that skip to a time-based reward whose cadence is unstated; once versus
repeated earning is itself the material user-visible outcome.

### Post-Research Product Gate

After MCP evidence, ask at most one clarifying question only when evidence
leaves tied `PRODUCT` interpretations with materially different user-visible
results, and include the recommended interpretation. Record
`followupQuestionUsed: true`. Source-confirmable `FACT` items are retrieval work.
API, DB, field, enum, migration, cache, query, ordering implementation,
tie-breaker, component, file, test, deployment, and rollback alternatives are
`DESIGN` handoff items, not Search Clarification questions.

Across both gates, ask at most two discovery questions. Final product approval does not count toward this budget. Never force either question when no material
product ambiguity remains, and never open a third discovery round.

## Typed Document And Spec Routing

Use the concrete family table in `using-platty-mcp/references/tool-mapping.md`.
`<family>` is notation, not a callable tool. Known BR document `br1` reads
`business_rule_get({projectId,documentId:"br1"})`; a known rule item uses
`business_rule_item_get({projectId,itemIds:[id]})`. Neither starts with search.

Typed get returns document sections and item cards. Select exact IDs then use
family item_get (1–5 unique IDs, full bodies). Item_list is for needed pagination
or complete inventory, with no itemType/detail filter. BR/UCL/DESIGN connect to
Specs with the matching family resolver and one `itemId` per call (or one
`documentId` for document connections). DD uses exact data-object/column reads;
`data_dictionary_spec_resolve` adds persisted usage links when requested.

For a known Spec use `spec_get({projectId,documentId})`, including DB logic.
It answers with the spec summary by default: identity, relations, outlines and
one page of claims nearest the handler, plus `claimFiles` indexing every claim
location. Page with the returned `claimCursor` continuation, or read one file's
claims with `claimPath`; send `view:"full"` only when the answer needs every claim
at once. A `platty-mcp-search` collector sends `claimLimit: 5` and never
`view:"full"`; a result too large to read is recorded as unread, not replaced
by a search. An unread claim page is not absence.
Only requested business context uses `spec_business_resolve({projectId,
specDocumentIds:[id]})`; requested technical impact uses `spec_impact_resolve`
with the same batch field and `direction:"incoming"|"outgoing"|"both"`.
Follow returned typed graph continuations for deeper selected branches.
Graph calls use one namespace per batch and visited `(kind,nodeId)` pairs.

## Full-Cycle Retrieval Ladder

Use the ladder for broad, semantic, comparison, inventory, or impact-seed: project
context -> project_get summary -> vocabulary -> domain map -> epic summary map ->
selected typed lists (full continuation for needed supporting-only links) ->
BR/DESIGN/DD/UCL maps -> exact items -> directional Spec links -> exact Specs ->
source confirmation when required ->
Final Route Audit.

Each rung is list/map first, exact detail second. Project metadata, projections, catalog
rows, glossary output, and search hits orient only. For the ladder and audit,
read `references/full-cycle-retrieval.md`.

Completing the ladder means completing the required rungs for the selected
question branch and target set. It does not require expanding every adjacent
EPIC, document payload, connected spec, or source candidate after exact evidence
has established the requested result. Preserve remaining implementation
candidates as `DESIGN` handoff instead of extending product retrieval.

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
- Project metadata and epic rows choose scope, not final behavior.
- BR, DESIGN, DD, and UCL are typed semantic routers.
- Memory overlays are human/agent notes. Use them for corrections, constraints,
  why/context, and ambiguity, but separate them from generated SOT and source
  evidence.
- Source-near behavior claims require exact spec evidence.
- Follow selected `spec_search` candidates with `spec_get`. Add
  `spec_business_resolve` or `spec_impact_resolve` only for the requested
  direction.
- Exact implementation, response shape, permission, DB write, event emit,
  external call, or negative source evidence requires source-level confirmation
  when the MCP server exposes it. Use `code_search` to locate candidates, then
  actively use MCP `readonly_workspace_shell` to read the bounded source region.
- Before an item absence claim, complete scoped pagination and inspect readState/diagnostics; empty or regeneration-required data is a coverage limit.
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

If the raw idea requires initial product-intent clarification, ask it before
deep retrieval. If MCP evidence later leaves tied `PRODUCT` interpretations,
ask one follow-up with a recommended interpretation. Stop only when that product
ambiguity cannot be resolved within MCP evidence. Never stop to ask the user to
choose a source-confirmable `FACT` or an implementation-only `DESIGN` option.

If evidence is weak, name the next read-only MCP surface. If that requires
refresh, export, sync, generation, memory write, or local files, report a
configuration/boundary gap.

## Final Route Audit

Before every final answer, audit the route in runtime context. If a required
rung is missing, perform the MCP step or weaken/stop; never turn audit failure
into a confident claim. Checklist: `references/full-cycle-retrieval.md`.

For an SDD caller, include a runtime-only `questionOwnershipAudit` containing:

```text
- factItems: resolved evidence or exact coverage limit
- productItems: adopted recommendation or tied user-visible choice
- designItems: preserved handoff items
- userQuestion: none or one PRODUCT question
- stopReason: required evidence established | product ambiguity | capability gap
```

## Stakeholder Answer Shape

A user-facing answer uses the `platty-mcp-search` answer template (결론 →
쉽게 말하면 → 근거 → 확인할 수 없는 부분). The shape below is the packet-level
order this ladder returns to its caller: answer first, evidence second,
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
