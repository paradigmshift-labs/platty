---
name: platty-retrieval
description: Use when searching local Platty SOT outputs, generated docs, graph traces, code search, or source-grounded project evidence through the full Platty operator plugin.
---

# Platty Retrieval

Use this skill when a user asks a question that should be answered from local
Platty evidence through the full `platty` operator plugin.

Remote read-only MCP retrieval is handled by the separate
`platty-mcp:platty-mcp-retrieval` skill. Do not use this local retrieval skill
as the MCP transport entry point.

Platty projects a single source of truth (the DB) into a read-only Markdown tree at
`~/.platty/sot/<projectId>/`. **Discovery and static relations live in that folder
(grep/read). Computation, cross-layer traversal, and writes escalate to the CLI.**
The split is not "MD vs CLI" — it is **enumerable/static (MD wins) vs computed/traversed/mutated (CLI wins)**:

```text
question
-> resolve projectId -> ~/.platty/sot/<projectId>/   (folder is the map)
-> read overview.md + catalog/*.md                   (orient; solve unknown-unknowns)
-> use project overview/personas + catalog/epics.md  (choose candidate EPIC + purpose doc)
-> read epics/<id>/overview.md when it exists         (compact epic routing context)
-> choose BR / DD / DESIGN / UCL by question intent  (business-doc routing)
-> list connected source-near specs before opening details
-> read the source-near detail before code search     (API/screen/event/schedule)
-> stay on the EPIC spine: use epic ids/docs as the semantic route map before final synthesis
-> use `sot resolve` when holding an id              (epic/doc/item/model -> specs/models/trace seeds)
-> grep catalog/*.md by name/summary                 (discover candidates — ids are opaque)
-> read epics/<id>/*.md and specs/<kind>/<fileId>.md (detail)
-> follow frontmatter ids to the next MD             (static relations, no CLI hop)
-> escalate to CLI ONLY for:                         (graph trace / code search / memory write)
-> pass the Completeness Gate (3 axes) before STOP   (depth / width / macro — not a partial answer)
-> answer with validity (freshness)
```

When the evidence at a step is enough, STOP there; when it is not, go one step deeper.
But before any STOP, run the **Completeness Gate (3 Axes)** (see Stop Conditions) so a plausible
partial answer doesn't pass for the authoritative one — go down to code where the answer lives
(depth), expose a split question instead of silently picking one branch (width), and for a
multi-target question build the spec/BR map first and let code only verify it (macro). A pure
definition / naming question is exempt.

If the SOT folder does not exist yet, use the **advanced recovery CLI graph
walk** below only when local CLI access is appropriate. For MCP retrieval, route
to `platty-mcp:platty-mcp-retrieval` instead of falling back to local files or
CLI.

## Boundary

`platty-retrieval` is the local operator retrieval skill:

```text
using-platty -> platty-retrieval
using-platty-mcp -> platty-mcp-retrieval
```

Discovery starts from the local SOT Markdown projection at
`~/.platty/sot/<projectId>/`, and computed traversal or writes escalate to
Platty CLI commands such as `platty sot resolve`, `platty graph trace`,
`platty code search`, `platty code snippet`, or `platty memory add`.

Do not silently switch from MCP questions to local SOT files or local CLI. Route
remote MCP questions to `platty-mcp:using-platty-mcp`.

## Case Guides

Keep this file as the router and common evidence rules. For case-specific depth,
read the linked reference before answering:

| Question shape | Required reference |
| --- | --- |
| concept, term meaning, ambiguous Korean/English term, "how are these different?" | `references/concept-search.md` |
| exact endpoint, response shape, params, API side effects, "what does this API do/return?" | `references/exact-api.md` |
| screen, page, route, UI entry point, screen spec | `references/screen-search.md` |
| screen-to-api, api-to-screen, DB impact, event flow, external integration, batch, blast radius | `references/impact-tracing.md` |
| source file, symbol, snippet, code location, concrete implementation | `references/code-search.md` |
| business rule, policy, permission, eligibility, documented constraint | `references/business-policy.md` |
| "what must change", "what breaks", "where do we patch this", add/change a field/type/status/category/classification | `references/design-change.md` |
| bug, incident, root-cause investigation, regression suspicion | `references/bug-diagnosis.md` |
| negative evidence, "does this exist?", graph gap, missing docs, coverage boundary | `references/negative-evidence.md` |
| cross-epic, cross-product-area, multi-area flow | `references/cross-epic-flow.md` |

If a reference applies, load it. Do not rely on memory of its checklist. If no
reference clearly applies, use this SKILL.md's common State Gate, Query Class
Routing, Completeness Gate, and Answer Contract. When the same uncovered shape
causes repeated misses, promote it into a new reference file and add a row here.

## SOT Resolve Gate (Local transport CLI or MCP equivalent)

The commands below are local-transport-only. In MCP mode, use configured
resolver/read tools such as `epic_get`, `document_get`,
`document_spec_resolve`, `spec_get`, `spec_document_resolve`, or
`spec_impact_resolve`. If the MCP server cannot expose an equivalent
resolver/read path, stop with a configuration/boundary gap. Do not read
`~/.platty/sot/` or run local `platty` commands from MCP mode.

When you already have an EPIC id, document id, item key, or model id/name and
need connected APIs, screens, events, schedules, models, or graph-trace seeds,
use the resolver before graph traversal:

```bash
platty sot resolve --project <project> --epic <epicId> --json
platty sot resolve --project <project> --document <documentId> --json
platty sot resolve --project <project> --item <documentId#stableKey> --json
platty sot resolve --project <project> --model <modelId-or-name> --json
```

Resolver output is a machine-readable routing layer. It does not prove business
claims; it chooses connected specs, models, and safe next hops. After resolve,
assert exact behavior only from source-near specs and, when needed, graph
trace/source code. Treat source-near API/screen/event/schedule `traceId`s as
the normal first trace seeds. Treat model `db:<table>` traces as broad impact
tools, not as the default next hop for business/concept retrieval.

Use the default resolver output first. It is intentionally compact for agents.
For shared models such as `User`, `Workspace`, `Channel`, `Order`, or `Project`,
model-only resolve may be too broad. If the question already has an EPIC or
document context, scope the model resolve:

```bash
platty sot resolve --project <project> --model <modelId-or-name> --within-epic <epicId> --json
```

Use `--detail full` only when you truly need the complete machine inventory.
Do not use full detail as the default search path.

If a model-only resolve returns a shared-model warning, do not jump straight to
`graph trace --from db:<table>`. First scope the model with `--within-epic`, read
the connected source-near specs, then trace from the returned API/screen/event/
schedule ids. Use `--detail full` or a DB-anchored trace only for explicit global
table/field impact questions.

## State Gate: Choose the Retrieval Mode (Local SOT flow or MCP equivalent)

The numbered flow below is the local-transport SOT projection path. In MCP
mode, mirror the same judgment through configured MCP tools such as
`context_status`, `epic_list`, `epic_get`, `document_search`, `document_get`,
`document_spec_resolve`, `spec_get`, `spec_document_resolve`, and
`spec_impact_resolve`. If the MCP server cannot expose the required overview,
catalog, document, or resolver surfaces, stop with a
configuration/boundary gap instead of reading local files or running local CLI
commands.

Before choosing a retrieval strategy, classify the project state from generic SOT structure.

1. Resolve `projectId` and locate `~/.platty/sot/<projectId>/`.
2. Read project `overview.md` when present and `catalog/epics.md` to choose the
   candidate EPIC route. Do not use `README.md` as retrieval evidence; it is
   layout/freshness audit only.
3. Extract domain terms from the user question, preserving the raw phrase. For
   raw user terms, aliases, synonyms, abbreviations, Korean/English variants, or
   domain slang, call
   `platty sot glossary search --project <project> --query "<raw term>" --json`
   instead of expecting a glossary Markdown file. Do not guess English terms before glossary search.
4. If live EPIC rows have `documentCount > 0` and generated files exist under `epics/<epicId>/` such as `overview.md`, `br.md`, `design.md`, `data_dictionary.md`, or `usecases/ucl.md` (`usecases/ucs.md` only when exported), use **Business Index Mode** for business, planning, policy/rules, journey, and concept questions. Project `overview.md` / `personas.md` when present and epic `overview.md` docs are coarse route maps: they choose an EPIC and purpose docs, not exhaustive API/screen/event/schedule evidence.
5. If business docs are absent, incomplete, or not exported, use **Static Analysis Mode** for static catalogs and graph/code primitives.
6. If the state is mixed, use Business Index Mode for valid business-doc evidence and explicitly state coverage or freshness gaps before drilling into static evidence.
7. For development/design-impact questions ("where do I add/change this", "what breaks", code location, precise screen/api/table impact), load `references/design-change.md` even when business docs exist: start with targeted static catalog grep + graph traces when the question is already anchored to an implementation entity or asks for code/impact, then use business docs for semantic scope and constraints when available.

Never use fixture names, repository names, source paths, EPIC titles, or domain-specific terms as activation conditions. The mode decision must be based on the generic SOT layout and catalog fields.

## Alias Overlay Gate

Before glossary routing, preserve the raw user phrase and check memory overlays for
user-confirmed aliases. This handles domain slang, abbreviations, Korean/English
mixes, and team-specific words that generated docs may never contain.

1. Read alias memories when present:
   - `epics/<epicId>/memory.md` after candidate EPICs are known.
   - spec frontmatter `memories` when already on a source-near spec.
   - document/item memories when a candidate document is already known.
2. Treat alias memories only as query-normalization hints, not source-grounded
   business facts. They may help search for `친구` when the user says `응원친구`,
   but they do not prove a business rule.
3. Search both raw and normalized terms. Example: if memory says
   `alias: 응원친구 -> canonical: 친구`, grep/search `응원친구`, `친구`,
   and likely code-language equivalents from glossary hits.
4. If the raw term has no glossary/spec/code hit and fuzzy candidates are tied,
   ask one clarifying question before answering.
5. When the user confirms a new alias, recommend recording it with
   `platty memory alias add --project <project> --epic <epicId> --term "<raw>" --canonical "<canonical>" --json`.
   If no EPIC is known, ask one clarifying question and find the candidate EPIC
   before recording. In MCP mode, do not recommend a local alias write; stop and
   report a configuration/boundary gap, and route the user to the full `platty`
   operator plugin for alias recording. Alias memory is query normalization, not
   business proof.

## Boundary Declaration

Before answering, decide and state the evidence boundary in one or two sentences:

- **Project evidence state:** business docs available, static-only, mixed, stale, or unavailable.
- **Allowed answer scope:** what this evidence can answer.
- **Stop boundary:** what must not be asserted from this evidence.

This is not citation polish; it prevents false product claims. If business docs are absent,
a product/planning question can still get an implementation-structure answer, but it cannot get
retrieved business intent, policy, priority, or a complete journey. If graph trace returns no
confirmed edge, say there is no confirmed graph evidence for that anchor/depth/kind set, not that
there is no impact.

## Source Confirmation Guard

For exact behavior, permissions, response shape, DB writes, event emits, external calls, policy/rule enforcement, and negative source-absence claims, generated business docs are only the route map. Confirm through the connected source-near spec first (`specs/api`, `specs/screen`, `specs/event`, or `specs/schedule`), then inspect original source code using the spec path, `graph trace`, `code search`, `docs show` code evidence, or direct worktree reads. Assert from the source-near spec/code; cite business docs only as the index that located it.

Before declaring that a handler, source file, permission check, response field, write, emit, or external call is absent, confirm the intended project repository id/path from the SOT catalog row, spec frontmatter, graph/code evidence, or `docs show` evidence. Do not search a sibling repo, tutorial variant, generated example, or adjacent monorepo package and conclude the project lacks the behavior.

## Business Docs As Routers, With Bypass Gate

Use business docs as detailed routers when the question is business-contextual,
ambiguous, or asks about a capability, rule, data area, user journey, or design
area. They narrow the search inside an EPIC:

- **Project overview/personas:** pick the candidate EPIC and purpose docs
  (`rules`, `design`, `data`, `terms`). They intentionally do not enumerate
  every API/screen/event/schedule; use catalogs or the EPIC Technical Index for that.
- **epic.md Technical Index:** lists that EPIC's source-near API, screen, event,
  and schedule spec files with `traceId`. This is the preferred bridge from
  business context to source-near detail.
- **UCL:** user action / capability router.
- **BR:** rule, permission, policy, and constraint router.
- **DD:** data, model, table, and field router.
- **Design:** component, API, DB, event, and service connection router.

Business-doc ladder for ambiguous or domain-term questions:

1. Project `overview.md` plus `catalog/epics.md` candidate EPIC rows.
2. `epics/<epicId>/overview.md` routing context.
3. Intent doc: BR business rules, DD data dictionary, DESIGN system design, or
   UCL feature list.
4. List connected source-near specs before opening details.
5. Read the source-near detail before code search when exact behavior, screen,
   response, DB/state, side effect, or absence is being asserted.

When using these docs, prefer item-level `docLinks`, `items[].docLinks`,
`source_mapping[].documentId`, the EPIC Technical Index, and linked catalog rows
to choose the relevant `api_spec`, `screen_spec`, `event_spec`, `schedule_spec`,
and source files. Business-doc prose is routing evidence, not final truth.

Bypass business docs when the question is already anchored to a specific endpoint,
specific file, specific symbol, specific model field, screen, event, schedule,
trace id, or exact implementation fact. In those cases, go directly to the
relevant catalog/spec and source code. In short: go directly to the relevant catalog/spec and source code when the question is already source-near, then use business docs only if semantic scope or cross-feature context is still needed.

## Query Class Routing

After the State Gate, route by question shape before reading details. This keeps retrieval
bounded and prevents the "CLI is available, so trace first" failure mode.

| Question shape | First hop | Drilldown gate | Stop rule |
| --- | --- | --- | --- |
| concept / term meaning | `sot glossary search`, then `catalog/epics.md` | candidate `epic.md` / `design.md` | stop before graph unless implementation is asked |
| planning / product direction | `catalog/epics.md` | `design.md`, `br.md`, `usecases/ucl.md` | stop after business docs when supported |
| policy / business rules | `catalog/epics.md` | `br.md`, `usecases/ucs.md`, `data_dictionary.md` | do not infer policy from code alone |
| user journey / screen flow | `catalog/epics.md` plus `catalog/screens.md` | `design.md`, `usecases/ucl.md`, screen specs | separate journey from implementation |
| precise API / screen / table impact | static catalog row (`apis.md`, `screens.md`, `tables.md`) | `graph trace` from `traceId` / `serviceMapNodes`, then source snippet | state graph limits and candidates |
| data field / carrier impact | `catalog/tables.md` or field docs | DB-anchored upstream trace with `accesses_db,calls_api`, then source grep | check read carriers as well as writes |
| code location | glossary search `codeTerm` or static catalog | `code search` -> nodeId -> optional trace/snippet | never pass `codeTerm` directly to `graph trace` |
| ambiguous domain term | `sot glossary search` and `catalog/epics.md` | read 2-3 candidate epic folders | qualify or ask if candidates remain tied |
| negative evidence / missing graph links | static catalog anchor | targeted graph trace returning 0 confirmed | say "no confirmed graph evidence"; never say "no impact" |
| business docs absent | static catalogs only | graph/code only for static structure | explicitly stop before business policy, journey, or intent |

## Boundary

- **Local transport only:** The SOT Markdown is a read-only projection (`[regen]`).
  Never edit a file under `~/.platty/sot/`. To change knowledge in local mode,
  write to the DB with the CLI (`platty memory add ...`) and re-run
  `platty sot export`. The next export regenerates the MD. In MCP mode, do not
  touch local projection files or attempt memory writes; use only server-exposed
  read tools, or stop with a configuration/boundary gap when the needed surface
  is unavailable.
- The CLI does not understand natural language and must not be treated like an LLM.
  Do not use or invent `docs ask` / `docs investigate`, and do not pass a natural-language
  question to a legacy term-search command.
- **Discovery is on `name`/`summary`, never on ids.** Frontmatter `id` values are opaque/large
  (`doc:<projectId>:<type>:<hash16>`, `doc:<nanoid>`, nanoid epic ids). grep readable text;
  follow ids only after you have the file.

You, the agent, read the catalog, grep terms, follow frontmatter links, choose escalations, and synthesize the answer.

## Red Flags

STOP if you catch yourself thinking any of these:

| Excuse | Reality |
| --- | --- |
| "I'll just use a legacy term-search command/`LIKE` for the term and answer from the hit" | The SOT folder is right there. `grep` `catalog/*.md` for the concept (name/summary), then read the detail MD. A term-match hit is not evidence; answering from titles and a score is fabrication. |
| "I can't read the catalog (folder missing / read failed), so I'll guess from memory" | Do not fabricate. In local mode, either run `platty sot export --project <project>` to (re)create the folder, or fall back to the local advanced recovery CLI graph walk. In MCP mode, stop and report a configuration/boundary gap; do not fall back to local files or CLI. |
| "The question terms are clear, skip glossary search" | The user may ask in Korean while docs use English, Japanese, or code identifiers. `sot glossary search` maps raw terms and aliases to candidate EPICs and code terms — skipping it is how you pick the wrong EPIC. |
| "There are hundreds of MD files, I'll open them all to be safe" | Don't brute-force the tree. Use `catalog/*.md` to narrow, read only the named detail files, and for cross-layer reach use `graph trace` — high-cardinality code nodes are intentionally NOT in the MD (use `code search`). |
| "The doc is stale/orphaned but probably still right — present it as fact" | State `validity` from frontmatter. In local mode, recommend `sync` + `sot export`. In MCP mode, stop and report a configuration/boundary gap, and route refresh work to the full `platty` operator plugin. Do not hide stale evidence. |
| "I'll edit the MD file to fix the wrong value" | The MD is a `[regen]` projection. Edits are lost on next export. In local mode, write via `platty memory add` then `platty sot export`. In MCP mode, retrieval is read-only: do not edit local MD or attempt memory writes. |
| "I found the `codeTerm` in glossary search, I'll pass it straight to `graph trace --from`" | A `codeTerm` is a code identifier, NOT a service-map node id. `graph trace --from` needs a node id — first `code search --symbol <codeTerm>` to get the nodeId, then trace from that. Passing the raw `codeTerm` is a dangling-input error. |
| "I have an epicId/BR id/model id, so I'll pass it directly to graph trace" | EPIC ids, business document ids, item keys, and model ids are not necessarily graph node ids. Run `platty sot resolve` first. Prefer returned source-near `traceId`s. Use model `db:<table>` traces only after explicit scope/full-detail or when the question is a global table/field impact question. |
| "The query is Korean but I know the English word, I'll skip glossary and trace from my guess" | Cross the language bridge through `sot glossary search` first. Guessing the English/code term skips the canonical/`codeTerm` mapping and traces the wrong (or non-existent) node. |
| "Business docs exist, but graph trace feels faster, so I'll start there" | Wrong mode for business/planning/policy/journey/concept questions. When valid business docs exist, treat them as the semantic index first for those questions. For development/design-impact questions already anchored to implementation or asking code/impact, use the 4-axis path: targeted static catalog grep + graph traces first, with business docs as semantic scope/constraints. |
| "The business doc says it, so I'll assert it as fact" | Business docs are an **index, not ground truth**. LLM-generated business docs (`usecases/ucs.md`, `design.md`, `br.md`) can overclaim — an `authenticated user` written up as `owner`/`member-only`/`participant-only`, a minimal `"ok"` response written up as a returned/created record — or lag the source. Before asserting a behavior, actor/permission, response shape, or rule from a business doc, drill into the **connected** `specs/api/<id>.md` / `specs/screen/<id>.md` (via `relatedDocs`/`serviceMapNodes`/`traceId`, **only the related ones**) — and code via `graph trace`/`code search` when the spec is thin — and confirm it there. Assert from the source-near spec/code; cite the business doc as the index that located it. If they disagree, surface the gap. |
| "The connected spec says the handler persists/broadcasts/returns X, so I don't need to inspect the source" | Specs are source-near but still LLM-authored. If the source handler body is empty, only logs values, returns no value, or is a stub/TODO/not implemented shell, **source code wins**: report that the implementation is not confirmed. Do not trust a spec claim that a stub delegates to a service, persists data, emits events, enforces permissions, or returns a business result unless the code or included shared-module evidence shows it. |
| "I grepped nearby repos and did not find it, so the project lacks it" | Wrong boundary. Before any absence claim, verify the repo id/path from SOT catalog/spec/code evidence and search only the intended project repository or explicitly state which repo scope was searched. Sibling examples or alternate implementations are not negative evidence for this project. |
| "Business docs are missing, so retrieval cannot answer anything" | Wrong mode. Static catalogs, graph trace, and code search still answer static-analysis questions; just avoid inventing business rules. |
| "This domain term means business-doc mode should be active" | Wrong mode. Mode selection comes from generic SOT structure and catalog fields, never domain, fixture, repository, source-path, or EPIC-title terms. |
| "The glossary/BR already lists them, so that's the complete set — STOP" | **Depth gap.** An enumeration / "what types/values exist" question answered from a glossary or BR list is an *abstraction or partial list*, not the authoritative set. The authoritative enum/constant usually lives in code. Verify against the code enum/constant once (`code search --symbol <EnumOrConstant>`) before STOP. |
| "The question is clear enough, I'll answer the most likely reading and STOP" | **Width gap.** If a core noun is polysemous, or the intent level is undecided, or a cross-cutting flow spans several targets, the question reads two+ ways. **Expose the split first** ("this reads N ways: (a)… (b)…"); never silently pick one interpretation. For a cross-cutting flow, **count the applicable targets** (enum/grep) before answering. If the answer makes the discarded alternatives invisible, that is a width violation. |
| "It's a multi-target question but one grep hit covers it, so STOP" | **Macro gap.** A single code grep matches *one mechanism* and misses the set boundary (missing pages, hidden call sites, other mechanisms). For "all / every / which screens / across / each / list of …" questions, build the full map from spec (`relations.navigation` / `relations.api_calls`) / BR **first**, then use code only to verify and fill that map. Going straight to code for a multi-target question is how you deep-dive one mechanism and falsely report "I saw everything". |

## Stop Conditions

- **SOT folder missing AND no EPIC catalog entries exist**: docs/EPICs have not been generated. Route to the generation skills; do not answer from guesses.
- **A frontmatter `id` you followed does not resolve** to any catalog entry or MD file (dangling link): stop, do not invent the target. Report the mismatch. In local mode, recommend `platty sot export` because the projection may be stale relative to the DB. In MCP mode, stop and report a configuration/boundary gap, and route export/recovery to the full `platty` operator plugin.
- **The same `id` appears in more than one document** (catalog or frontmatter): stop and report the ambiguity instead of picking one — the projection or DB is inconsistent.
- **Every candidate document reports `validity: orphaned`** (or `status: deleted`): stop treating their content as evidence; report that the docs no longer map to analyzed sources. In local mode, recommend regeneration + re-export. In MCP mode, stop and report a configuration/boundary gap, and route regeneration/export recovery to the full `platty` operator plugin.
- **Two full discovery passes** (catalog grep -> detail read -> frontmatter follow) surface no evidence for a subquestion: answer "no evidence found", list what you grepped/read, and stop — do not widen indefinitely or fabricate.
- **Completeness gate not yet passed**: do NOT STOP on a glossary/BR list, a single interpretation, or a single grep hit until you have run the **Completeness Gate (3 Axes)** below. A plausible partial answer is not an authoritative one. Only a pure definition / naming question ("what does X mean") may STOP at the glossary without the gate.

## Completeness Gate (3 Axes) — Before STOP

The core rule is: **when the evidence is enough, STOP; when it is not, go one step deeper.** But before any STOP, pass these three checks so a plausible partial answer doesn't pass for an authoritative one. The axes are **depth** (did you go down to code where the answer lives), **width** (did the question split and you answered only one branch), and **macro** (is it multi-target but you saw only part of the set). A pure definition / naming question is exempt from all three.

1. **Depth — enumeration / exact-value / structure questions go to code.**
   - "what types/values exist", "kinds of", "all of", "the list of": a glossary/BR list is an abstraction or partial list. The authoritative enum/constant lives in code — verify it **once** (`platty code search --project <project> --symbol "<EnumOrConstant>"` or worktree grep) before STOP.
   - "how does it differ / exactly / by what criterion / where": don't STOP at a glossary definition — confirm the actual routing/branch/numeric value in code.
   - structure / mapping ("tab↔section", "screen↔component"): a glossary's structural description may be abstracted or stale — cross-check the structure against code.

2. **Width — expose ambiguity before answering (do not silently pick one).** A question is ambiguous if any of these hold:
   - the core noun is polysemous (one word, two domains/meanings),
   - the intent level is undecided ("tell me about X" = definition vs page/API vs code branch),
   - a cross-cutting flow spans several targets (one "A→B flow" applies to several types/screens at once).

   When ambiguous, in this fixed order: (a) **expose the split in one line first** ("this reads N ways: (a)… (b)…"); (b) for a cross-cutting flow, **count the applicable targets before answering** (enum/grep: is it one target or several?); (c) then either answer both briefly (if cheap) or answer the most likely reading while naming why it was chosen, naming the discarded reading, and offering to switch. **Forbidden:** silently choosing one branch and finishing. If the discarded interpretation is invisible in the answer, the width axis failed.

3. **Macro — multi-target questions build the spec/BR map first, code verifies.** Triggers (any one ⇒ multi-target): "all / every / which screens / across / each / list of / the whole flow / categorize / …" — if the target set is **not exactly one**, it is multi-target. Mandatory order:
   1. **Before** any code grep, build the full map from spec (`relations.navigation` / `relations.api_calls`) or BR — fix that as the expected target list.
   2. Use code **only to verify and fill** that map (grep/snippet each listed item). That is: **spec/BR = map, code = verification.**
   3. If spec/BR is missing or abstracted/stale, cross-reinforce with code — but never treat "one symbol grep = the whole set" (one grep catches one mechanism only).
   - **Self-check before STOP:** "Did I check this answer's target set against the spec/BR map? Did I finish on a single grep? Are there other mechanisms / types / screens I haven't accounted for?" — a single page or single symbol is exempt.
   - **MCP mode:** the macro gate maps to split-tool inventory calls, not shell grep: use `glossary_translate`, then `spec_list`/`spec_search` with `specKind` and scope filters, and then exact `*_get` calls.

## Required Inputs

Resolve these before retrieval:

- Local transport: project selector, then **projectId** via
  `platty project list --json` (or `platty project use <project>`). The SOT
  path is `~/.platty/sot/<projectId>/`.
- MCP transport: the configured project/context identifier from MCP tools such
  as `project_list` or `context_status`. Do not resolve it by reading local SOT
  paths or running local CLI commands.
- User question, classified: `business`, `data`, `development`, `design`, or `mixed`.

## Discovery Flow (Local SOT Markdown)

This section is local-transport-only. In MCP mode, use the configured MCP
search/get/resolve tools that expose equivalent SSOT, document, spec, glossary,
and status surfaces. If the server lacks an equivalent surface for a required
step, stop with a configuration/boundary gap instead of reading local files or
running local CLI commands.

### 1. Resolve project and locate the SOT folder

```bash
platty project list --json     # or: platty project use <selector>
```

Build the absolute path `~/.platty/sot/<projectId>/`. If it does not exist, run:

```bash
platty sot export --project <project> --json
```

`sot export` writes the whole tree atomically (temp + rename) and prints
`{ outDir, lastExportAt, sourceCommit, counts, skipped }`. If `sync` reports the
DB is stale, run `sync` first; a failed `sync` means the existing MD stays — treat
its `validity` as the freshness signal.

### 2. Orient with project overview + catalog

Read these first to get the map and solve unknown-unknowns (you don't need to know the term yet):

```text
~/.platty/sot/<projectId>/overview.md         # project-level business/context map when present
~/.platty/sot/<projectId>/catalog/epics.md    # epicId | name | summary | documentCount | memories | path
~/.platty/sot/<projectId>/catalog/apis.md     # apiId | traceId | name | repo | epicIds | validity | status | memories | detailPath | source
~/.platty/sot/<projectId>/catalog/screens.md  catalog/events.md  catalog/schedules.md  # 동일 스키마 (screenId/eventId/scheduleId | traceId | …)
~/.platty/sot/<projectId>/catalog/tables.md   # modelId | name | validity | repoId | traceId
~/.platty/sot/<projectId>/catalog/external-services.md
~/.platty/sot/<projectId>/project/glossary.index.json # machine glossary index used by CLI/fallback only
~/.platty/sot/<projectId>/README.md           # layout/freshness audit only, not retrieval evidence
```

`README.md` is layout/freshness audit only. Do not use `README.md` as retrieval
evidence for product meaning, EPIC selection, business rules, APIs, screens,
models, or code behavior.

- **api/screen/event/schedule rows are static** — built from service-map nodes, so they appear **even with no generated docs**. `source=static` means node-only; `source=doc` means an LLM spec enriched the row (then `detailPath`, `epicIds`, `validity`/`status` are filled). apiId is empty for static-only rows.
- **`traceId` is the `graph trace --from` seed.** grep a row by `name`/`repo`, then trace its cross-layer/cross-repo connections (callers, DB) with `platty graph trace --from <traceId>`. To read the actual source code, go traceId → graph trace (source location), NOT the catalog row.
- `detailPath` points straight at the detail MD file when a doc exists (empty for static-only) — read it directly, don't reconstruct the hashed filename. The `memories` column flags entities with human knowledge worth reading before you assert.

### 3. Discover candidates with grep (name/summary)

grep the catalog for the user's concept, and use glossary search for raw terms or aliases:

```bash
grep -in "환불\|refund" ~/.platty/sot/<projectId>/catalog/*.md
platty sot glossary search --project <project> --query "환불" --json
```

Pick 1-3 candidate epics/specs by the readable `name`/`summary` columns — not by a single matching word, and never by id (ids are opaque). The catalog is the table of contents; the `Excluded (orphaned/deleted)` section lists audit-only entries you must not treat as live.

#### Glossary cross-lingual search protocol (run at search start)

Before expanding or guessing terms, extract domain terms from the user question
and cross the language bridge through deterministic glossary search. Include the
raw term, obvious aliases/synonyms, and Korean/English variants when asking the
CLI, but treat all glossary hits as routing hints only. Do not guess English terms before glossary search.

1. **Run `sot glossary search` for the raw query term first.** Its matches map the
   raw term to candidate EPICs, aliases, `canonicalTerm`, and **`codeTerm`** when
   the generated glossary exposed a code identifier bridge:

   ```bash
   platty sot glossary search --project <project> --query "<raw term>" --json
   platty sot glossary search --project <project> --query "환불" --json
   ```

2. **If the match has a `codeTerm`, do NOT pass it to `graph trace --from`.** A `codeTerm`
   is a code identifier, **not a service-map node id** — `graph trace --from` expects a
   node id. Resolve the node id first, then trace:

   ```bash
   platty code search --project <project> --symbol "<codeTerm>" --json   # -> get the nodeId
   platty graph trace --project <project> --from <nodeId> --direction upstream|downstream --json
   ```

3. **If there is no `codeTerm`, use aliases/canonical terms from the matches to expand `docs`/`code search`
   candidates only — do not assert.** The aliases/synonyms widen discovery; they are not
   themselves evidence and do not bridge to a code node.

### 4. Read the detail Markdown

Open the named files. Business docs nest under the epic; technical specs are pooled under `specs/`:

```text
epics/<epicId>/epic.md                         # epic body + relatedDocs (id + role + path)
epics/<epicId>/br.md  design.md  data_dictionary.md
epics/<epicId>/usecases/ucl.md  epics/<epicId>/usecases/ucs.md
epics/<epicId>/memory.md                        # human memories anchored here ([regen])
specs/api/<fileId>.md  screen/<fileId>.md  event/<fileId>.md  schedule/<fileId>.md
specs/memory/<fileId>.md                        # spec-anchored memories ([regen])
```

Each file's frontmatter carries `id`, `name`, `type`, `scope`, `scopeId`, `validity`, `status`, `sourceCommit`, `items[]`, `relatedDocs[]`, and `serviceMapNodes[]`.

### 5. Follow static relations via frontmatter (no CLI hop)

Static doc↔doc, item↔item, and item↔model relations are encoded in frontmatter — follow them by reading the next MD, not by calling the graph CLI:

```text
epic.md relatedDocs[]      -> {id, role, path}; read `path` directly (the spec filename is a hash)
items[].docLinks           -> <docId>#<stableKey>
items[].modelLinks         -> <modelId> (see catalog/tables.md) or <modelId>#<field>
```

`relatedDocs[].path` and the catalog `path` column give a direct file to read —
the filename is a hash of the id you cannot recompute, so use the supplied path.
The destination's frontmatter `id` confirms identity. If a supplied `path` (or a
followed id) resolves to no file, that is a **Stop Condition** (dangling link) —
do not invent it; re-run `platty sot export`.

### 6. Escalate to the CLI (computation / cross-layer / writes)

Only these need the CLI; everything static stays in MD:

```bash
# Cross-layer / multi-repo service-map traversal. --from is any service-map node id:
# a spec frontmatter `serviceMapNodes` id, OR a catalog id you can grep directly —
# external-services.md `serviceId` (e.g. external_service:azure_blob) or tables.md `traceId`
# (the db:<table> id). No spec is needed to start an upstream trace from an external service.
platty graph trace --project <project> --from <node-id> --direction downstream|upstream --depth <n> --json

# High-cardinality code symbols (intentionally omitted from MD). Matches return
# filePath / lineStart / lineEnd / signature (the field is `filePath`, not `file`).
platty code search --project <project> --symbol "<identifier>" --json
platty code snippet --project <project> --repo <repo-id> --file <path> --lines <start>-<end> --json

# Record human knowledge, then re-project so the MD reflects it.
platty memory add --project <project> --document <doc-id> [--item-type <item-type> --item-key <stable-key>] --content "<text>" --kind why|correction|constraint|context --json
platty sot export --project <project> --json
```

`graph trace` is **known static service-map impact, not complete impact**: it returns
`omittedEdgeClasses` (ORM includes, indirect writes, event side effects, dynamic URLs) and
`candidates` (unresolved edges). Assert only `confirmed` edges; treat `candidates` as
leads to cross-check with `code search`; skip `omitted`. With `--depth N` it accumulates
per hop and reports `truncated`/`truncatedBy` — never report a trace as an exhaustive blast radius.

`relationCandidates` are separate non-traversable recall hints from business/docs or
unresolved relation gaps. They are not confirmed impact. Use them after confirmed edges
for missing-evidence investigations, ambiguous implementation follow-up, or candidate
code searches. Prefer compact trace output; use `--verbose-candidates` only when the
candidate evidence text is needed in the final answer.

Graph evidence tiers:

- exact impact answers: answer from `.data.confirmed`; mention `relationCandidates` only as follow-up checks.
- missing-evidence investigations: inspect `relationCandidates` after confirmed edges.
- business/planning/policy questions: use the business index first; use graph candidates only for implementation follow-up.
- never turn `relationCandidates` into confirmed impact without source/code validation.

### Field Addition / Schema Change Design Flow

For requests like "add a field", "change response field", "DB column impact",
or "design the implementation impact", do not stop at the first screen/API hit:

1. Anchor the user-facing surface from `catalog/screens.md`, the API from
   `catalog/apis.md`, or the table/model from `catalog/tables.md`.
2. Read 1-3 relevant business docs (`design.md`, `br.md`,
   `data_dictionary.md`) to capture semantic constraints and product wording.
3. Run `graph trace` from the screen/API for confirmed screen -> API flow.
4. If a persisted field/table is involved, also run a DB/table upstream trace
   for read carriers. Do this even when the write path is already found.
5. If the DB/table trace returns no confirmed edges, say "no confirmed graph
   evidence for this table anchor" and continue through
   `catalog/relation-candidates.md` plus targeted code search. Do not conclude
   "no impact" from an empty table trace.
6. Inspect `relationCandidates` for side-effect classes: `analytics_event`,
   `cache_access`, `navigation`, `external_service`, `notification`,
   `event_publish`, and `db_access`. Report them as "candidate checks", not
   confirmed impact.
7. Read source snippets only for confirmed nodes or high-value candidates after
   graph/catalog narrowing.

Default candidate output should be grouped and capped. Use the CLI default
candidate limit (`20`) for normal impact answers, lower it only for explicitly
brief summaries (`--candidate-limit 10`), and raise it for side-effect
completeness checks (`--candidate-limit 50` or a purpose-specific higher cap).
Group by `kind` and a normalized target label, report
`relationCandidatesReturned` / `relationCandidatesTotal`, mention
`relationCandidatesTruncated` when true, and use `--verbose-candidates` only
when the final answer needs candidate evidence text. If candidates duplicate
confirmed edges or each other, summarize them as corroborating hints instead of
separate impacts.

Read **`.data.confirmed`** (flattened across all hops), not `.data.hops[0]` alone — the
first hop only holds direct neighbors, so reading it alone undercounts multi-hop entry
points (e.g. a controller two layers above an external-service call). Each confirmed edge
also carries **`sourceFile` / `sourceLineStart` / `sourceLineEnd`** (the source handler's
location, joined read-time), so you get the entry point's `file:line` from the trace itself
— no separate `code search` per entry point.

**Invariant:** the `serviceMapNodes` id in a spec's frontmatter is exactly the `--from`
input `graph trace` expects. If they disagree, the projection is stale — re-export.

### 7. Freshness

Trust the frontmatter `validity` (`fresh` | `stale` | `orphaned`) and `status`:

- `fresh`: assert normally, cite the file path + frontmatter `id`.
- `stale`: usable as a clue; state it may not reflect the latest source. In local mode, recommend `sync` + `sot export`. In MCP mode, stop and report a configuration/boundary gap, and route refresh work to the full `platty` operator plugin.
- `orphaned` / `status: deleted`: do not assert; these are excluded from the body tree and live only in catalog audit sections. In local mode, recommend regeneration. In MCP mode, stop and report a configuration/boundary gap, and route regeneration to the full `platty` operator plugin.

## Business Index Mode

Use this when the State Gate finds live EPIC rows with generated business documents and the question is about business meaning, planning, policy/rules, user journeys, or concepts. Business docs are the semantic index: they define intent, scope, constraints, journeys, rules, and field meaning. Technical specs and graph/code are drill-down surfaces for implementation detail, impact analysis, or gaps.

**Verify business-index claims against the connected spec (index ≠ ground truth).** A business doc routes you to the right entity; it does not certify its own wording. LLM-generated business docs can overclaim — an authentication-only guard written up as `owner`/`member-only`/`participant-only`, a minimal `"ok"` response written up as a returned/created record — or lag the source. So **do not assert a behavior, actor/permission, response shape, or rule from a business doc alone.** For each such claim, follow item-level links first: `items[].docLinks`, `items[].content.source_mapping[].documentId`, `items[].content.detailPath`, then document-level `relatedDocs`/`serviceMapNodes`/`traceId`. Read only the connected `specs/api/<fileId>.md` or `specs/screen/<fileId>.md` for that item — never open specs in bulk — and confirm it there; drill to code via `graph trace`/`code search` when the spec itself is thin. If item-level links are empty for the relevant claim, treat the business doc as an unverified index clue: say the item has no direct source link, use catalog/spec grep to find the nearest source-near evidence, and do not assert the business-doc wording as fact. Assert from the source-near spec/code, citing the business doc as the index that located it. If the connected spec contradicts the business doc, surface the gap and route a `correction` (see Memory Rule); never assert the index's wording over the source.

For development/design-impact questions ("where do I add/change this", "what breaks", code location, precise screen/api/table impact), do not override **Development Design Questions (4-Axis)**. If the question is already anchored to an implementation entity or asks for code/impact, start with targeted static catalog grep + graph traces as that section requires, then read available business docs for semantic scope and constraints.

Discovery order:

1. Start from the user question.
2. Cross the glossary bridge with `sot glossary search` when raw terms, aliases, or translated concepts may affect EPIC selection.
3. Use `catalog/epics.md` to identify candidate rows by readable terms, summaries, and `documentCount`.
4. Read only 1-3 candidate `epics/<epicId>/epic.md` files on the first pass.
5. Read purpose-selected business docs from those candidate EPIC folders.
6. Follow item-level links before document-level links: `items[].docLinks`, `items[].content.source_mapping[].documentId`, `items[].content.detailPath`, then `relatedDocs`, `serviceMapNodes`, or `traceId`, only when technical detail is required.
7. Use graph/code only for implementation, impact radius, or unresolved coverage/freshness gaps.

Purpose-to-document routing:

| Purpose | Read first |
| --- | --- |
| concept | `sot glossary search`, `epic.md`, `design.md` |
| planning | `design.md`, `br.md`, `usecases/ucl.md`, `usecases/ucs.md` |
| policy/rules | `br.md`, `usecases/ucs.md` |
| user journey | `design.md`, `usecases/ucl.md` |
| data/fields | `data_dictionary.md`, `catalog/tables.md`, `catalog/model-links.md` |
| code location/implementation | when anchored to code/API/screen/table, use the 4-axis path first; otherwise read business docs for intent and constraints, then specs -> graph trace -> code search/snippet |
| impact radius | when asking precise screen/API/table impact, use the 4-axis path first; otherwise read business docs for semantic scope, then graph trace and code search for graph-invisible leads |

Token/speed budget:

- Catalogs first; do not open EPIC folders until candidate rows are narrowed.
- Read at most 3 candidate EPIC folders on the first pass.
- Open only docs matching the question intent.
- For Business Index Mode answers, name the actual index path used before any
  source/spec drill-down: glossary search or alias terms checked,
  `catalog/epics.md` candidate rows, chosen `epics/<epicId>/`, and the selected
  business docs (`br.md`, `design.md`, `usecases/*`, `data_dictionary.md`)
  that support the answer.
- Read technical specs only after scope selection.
- Run graph/code only when implementation, impact, or unresolved gaps require it.
- Do not call graph/code just because the CLI is available. For business-only planning, policy, or journey answers, stop after the business docs once the answer is supported.
- For business-index questions, graph/code is an escalation, not a validation ritual. Escalate only
  when the answer needs source location, confirmed implementation edges, graph-negative evidence, or
  a code-level bridge from a `codeTerm`.
- For static impact or DB questions, graph trace is worth the extra time/tokens only when it adds evidence grep cannot supply: confirmed DB/API/screen edges, source locations, candidates, or negative trace evidence.
- If a graph/code call does not materially change the answer, treat that as a skill failure in later evals and tighten the routing rule rather than widening searches.

## Static Analysis Mode

Use this when business docs are unavailable, incomplete, or not exported. Do not stall looking for business docs. Static catalogs, graph trace, and code search still support retrieval over observed screens, APIs, tables, external services, schedules, events, and code primitives.

Discovery order:

1. Start from the user question.
2. Use `sot glossary search` when raw terms, aliases, or translated concepts may affect candidate selection.
3. Search static catalogs: `catalog/screens.md`, `catalog/apis.md`, `catalog/tables.md`, and `catalog/external-services.md` plus relevant static `events`/`schedules`.
4. Pick candidate rows by readable `name`/`summary`/`repo` fields, not ids alone.
5. Trace from `traceId` or `serviceMapNodes` when cross-layer relationships are needed.
6. Use code search/snippet for high-cardinality symbols, source locations, and graph-invisible leads.

Static-only answers must not invent business rules. Distinguish observed static evidence from product inference, and say when a conclusion is only an implementation or structural observation.

For product/planning questions in Static Analysis Mode, use this exact boundary:

1. Say business docs are absent, incomplete, or unavailable from the SOT state you checked.
2. List the static surfaces you can inspect (`catalog/apis.md`, `catalog/screens.md`,
   `catalog/tables.md`, static specs when present, graph trace, code search/snippet).
3. Answer only the observed implementation structure: APIs, tables, handlers, screens, source
   locations, and confirmed graph edges.
4. Stop before product intent, business policy, prioritization, or complete user journeys unless
   the user explicitly wants a proposal. If proposing, label it as a proposal, not retrieved fact.
5. If static catalogs are also missing, report the missing projection. In local mode, recommend
   `sync`/`sot export` or generation. In MCP mode, stop and report a configuration/boundary gap,
   and route refresh/generation work to the full `platty` operator plugin. Do not widen into
   unrelated source reads to fabricate a business answer.

## Memory Rule (Local writes only; MCP retrieval is read-only)

Memories are human-recorded knowledge (why, corrections, constraints), projected to
`epics/<id>/memory.md` and `specs/memory/<fileId>.md` as `[regen]` files:

- Quote them as human-recorded, e.g. "사람이 기록한 메모리에 따르면 …". Do not present memory content as system-derived fact.
- When a memory contradicts SOT content, present both and flag the conflict. In local mode, recommend `sync`/regeneration. In MCP mode, stop and report a configuration/boundary gap if resolving the conflict requires refresh, regeneration, or memory mutation. Never silently prefer either side.
- A memory entry with `anchorStale: true` is anchored to an item that no longer exists (renamed/dropped on regen) even though its parent doc may read `fresh` — do **not** assert it as current; surface it. In local mode, recommend re-anchoring (`memory update`/re-add). In MCP mode, stop and report a configuration/boundary gap, and route re-anchoring to the full `platty` operator plugin.
- If `README.md` reports a `memory/unrouted.md` count (memories whose epic/doc anchor was deleted or regenerated), **read that file** — its memories are NOT reachable from any epic/spec `memory.md`. Surface them. In local mode, recommend re-anchoring. In MCP mode, stop and report a configuration/boundary gap, and route re-anchoring to the full `platty` operator plugin; do not assume the rest of the tree covers them.
- Local transport only: the MD is a projection, so a `memory add` is invisible here until the next `sot export`. If you just wrote memory, treat `memory.md` as behind until you re-export. To record, use `platty memory add` (with `--export-sot`) then never edit `memory.md` directly. See `platty-memory`.
- In MCP mode, memory is read-only. You may quote server-exposed memory evidence, but do not attempt local memory writes, project mutation, sync, or export. If the answer requires recording a correction/constraint or re-anchoring memory, stop and report that as a configuration/boundary gap for the MCP profile.

## Development Design Questions (4-Axis)

For "where do I add this", "how do I change this", or "what breaks if I touch this", a single
read is not enough. **Start cheap and targeted**: grep the catalog (`apis.md`/`screens.md`/`tables.md`)
to fix entry points + `traceId`s first, then run a *few targeted* graph traces. Spawn subagents only
when grep + targeted trace genuinely cannot cover it — fanning out one subagent per repo is the main
cause of slow, token-heavy runs (it does not improve recall over the checklist below). **This whole protocol runs on static-analysis output alone — `catalog/*.md` + the service-map graph + `code search` — so it works even when no business/technical docs have been generated.** Investigate four axes:

1. **Current state** — `specs/<kind>/<fileId>.md` + `epics/<id>/*.md` when those exist; **otherwise `catalog/{apis,screens,tables}.md` + `code search`** (static-only projects have no generated docs).
2. **Constraints / background** — `epics/<id>/memory.md` / `specs/memory/<fileId>.md` (`constraint`/`correction`/`why`).
3. **Existing patterns** — `platty code search --symbol` for similar handlers/utilities to reuse.
4. **Impact / blast radius — BOTH directions.** From the changed entity's node: `platty graph trace --from <serviceMapNodes-id> --direction upstream --depth <n>` (who calls/depends on it). **AND, for a changed table/column, anchor on the db node and trace the READ path too:** `platty graph trace --from db:<table> --direction upstream --kinds accesses_db` — this surfaces the **data carriers**: read handlers that SELECT the entity and map it into a response for a frontend. **To enumerate the affected screens cross-repo in ONE trace, extend that same db-anchored trace with `calls_api` and a depth:** `platty graph trace --from db:<table> --direction upstream --kinds accesses_db,calls_api --depth <n>` returns, in a single call, both the backend handlers that read the entity *and* the frontend screens that call those handlers — across every repo. This is the graph's headline value: do **not** grep each frontend repo for endpoint strings by hand when the trace already joins DB→API→screen for you. (The screen hops can include weaker `suffix_match`/`navigates` edges — those are medium-confidence; keep `calls_api` as the backbone and verify the medium hits.) Fixing only the write path while missing the read carrier means the new field is stored but **never reaches the frontend** (the screen component can be edited but the response payload still lacks the field). Read **all** `.data.confirmed` (not `.hops[0]`); each edge's `sourceFile`/`sourceLineStart`/`sourceLineEnd` gives the entry-point location directly. Carry `omittedEdgeClasses` + `candidates` forward.

**Graph-invisible leaks (hybrid check).** A refactor scope is not complete from the graph alone. `graph trace` only sees nodes joined by a service-map edge; code that bypasses DI has **no edge** and never appears in the trace — a bootstrap/singleton SDK client, a service imported across a module boundary, a `process.env.<X>` read inside a usecase, a polluted/wrong import. This is exactly what `omittedEdgeClasses` warns about. So after the trace, also: `platty code search --symbol "<SDK client / class>"` to surface direct call sites, and — when the analyzed source tree is reachable — grep its imports and `process.env.<PREFIX>_` directly. A trace with zero leaks is not proof there are none; it is the half of the picture the graph can see. Label trace findings (connected impact) vs grep findings (graph-invisible) separately.

**Completeness checklist (run before synthesizing — apply whichever items fit the change).** Recurring blind spots a write-path-only trace misses:
- **Data carriers (read path):** every read handler that SELECTs the changed entity and returns it to a frontend must also carry the new field (axis 4 read-direction) — otherwise it is stored but the screen shows nothing. Include not just screen queries but **export / report / batch consumers**; when the change's goal is collecting or analyzing data, an export/report path is usually a required carrier. The graph trace surfaces screen carriers cheaply, but **an empty or short trace is NOT proof there are no backend carriers** — a consumer the engine failed to link (no `accesses_db` edge) is graph-invisible (see the hybrid-check rule above). Cross-check with a keyword grep for the change's intent (export / report / download / stats / batch) so a carrier the graph missed still surfaces; never conclude "no export/report path" from the trace alone.
- **Naming collision (text search, NOT the graph — the graph only sees call/access edges, never identifier reuse):** grep the new identifier — **including the very field name you are about to introduce** — across **all repos and all layers, not just the DB schema**: prisma/SQL models, backend DTOs, **and frontend models/types/components**. If the same name already exists on a *different* path, model, or domain (even a frontend-only type), warn against reuse so data isn't routed to — or rendered from — the wrong place. A DB-schema-only grep misses a name that lives only in a frontend model.
- **Conditional scope:** if a path is gated (a type/enum branch, a feature flag, a role check), state that scope — never present a one-branch path as if it applies to all.
- **Derived artifacts:** a schema/contract change usually forces a regen of generated code (DB client, types, API SDK, schema docs). Flag it or downstream builds break.

Then synthesize: concrete **change points** (repo + file + node + layer), the **reusable pattern** (axis 3), an **impact map** labeled known-static-not-complete (axis 4), a **constraint check** against axis-2 memories, and a clear separation of **observed structure (evidence)** vs **recommended design (proposal)**.

## Answer Contract

- Start with the evidence boundary when the project is static-only, mixed, stale, or docs are missing.
- State the normalized terms used (and the alias bridge from `sot glossary search` when used).
- Cite MD file paths and frontmatter `id`s; for code, cite repo + file + line.
- Separate direct evidence from inference.
- For docs-absent projects, explicitly say "business docs are absent/unavailable" and "static catalogs/graph/code can only support implementation structure." Do not merely imply this by saying "no SOT path."
- Keep verdicts internally consistent: a summary table's ✅ / "필요" must not contradict the body's confidence label for the same item (don't assert "required" in a table while hedging it as low-confidence in the prose). Pick one and align both.
- State `validity` for any stale/orphaned evidence.
- If evidence is weak, name the next step. In local mode, that may be `sot export`, `sync`, `code search`, or regeneration. In MCP mode, name only configured MCP read tools; if the answer instead requires refresh, export, generation, or memory writes, stop and report a configuration/boundary gap, and route to the full `platty` operator plugin.

End with the `Platty handoff` card. `Evidence` lists the MD paths / ids / commands used.
`Recommended next` is one of: a sharper follow-up from the same evidence surface; in local mode,
`sync` + `sot export` to refresh or `platty-generated-docs` if outputs need (re)generation; in
MCP mode, stop and report a configuration/boundary gap, and route refresh/generation work to the
full `platty` operator plugin.

## Advanced Recovery Fallback: CLI Graph Walk (Local transport only; never MCP)

When `~/.platty/sot/<projectId>/` does not exist and you cannot/should not export it
in the local transport profile, retrieve directly from the CLI (this is the
legacy EPIC-centered graph walk). In MCP mode, stop and report a
configuration/boundary gap instead of falling back to local CLI or local files:

Advanced recovery commands:

```bash
platty docs glossary digest --project <project> --json     # term unification (aliases)
platty epics list --project <project> --compact --json      # EPIC catalog (table of contents)
platty epics show --project <project> --epic <id> --include-docs --json
platty docs show --project <project> --document <id> --json
platty docs related --project <project> --document <id> --json
platty docs targets show --project <project> --id <entry-point-id> --json
```

The same Red Flags, Stop Conditions, Freshness, and Memory rules apply. Legacy term-search
commands are hints only — read the catalog before trusting them; answering from a score is fabrication.
Prefer running `platty sot export` and using the Markdown discovery flow above when possible in
local transport only. In MCP mode, stop and report a configuration/boundary gap, and route export
work to the full `platty` operator plugin instead of suggesting local CLI recovery.

## Baseline Pressure Scenarios

Behavioral checks for this skill. `npm run check:*` only verifies file structure — these
scenarios verify the skill actually changes behavior under pressure. Each scenario names the
PASS path and the Red (failure) paths it must prevent.

### Scenario: Korean query → code location via glossary bridge

**Input:** A Korean query (e.g. "환불") asking where the corresponding logic lives in code.

**PASS path:**

1. Run `platty sot glossary search --project <project> --query "환불" --json`.
2. Read the top match's `codeTerm` when present (e.g. `refund`) and candidate EPIC path.
3. `platty code search --project <project> --symbol refund --json` → obtain the `nodeId`
   (with `filePath`/`lineStart`/`lineEnd`).
4. `platty graph trace --project <project> --from <nodeId> ... --json` using that node id.

**Red (any of these is a failure):**

- Putting the `codeTerm` directly into `graph trace --from` (e.g. `--from refund`) — a
  `codeTerm` is not a service-map node id.
- Skipping `sot glossary search` entirely and guessing an English term to search/trace.
- The term has **no** `codeTerm`, yet the answer asserts a code location anyway instead of
  using aliases/canonical terms only to widen `docs`/`code search` candidates without asserting.

### Scenario: Product question but business docs are absent

**Input:** A product/planning question for a project whose SOT state has static catalogs but no
generated business docs under `epics/<epicId>/`.

**PASS path:**

1. State that business docs are absent/unavailable from the checked SOT state.
2. Answer only from static catalogs, graph trace, and source snippets when those are relevant.
3. Label any product direction as a proposal, or stop before policy/journey/intent if the user asked
   for retrieved facts.
4. Mention that graph trace can support static implementation structure but not a complete business
   journey.

**Red (any of these is a failure):**

- Inventing business rules, prioritization, or complete user journeys from source names.
- Saying retrieval cannot answer anything even though static catalogs/graph/code can answer
  implementation structure.
- Reporting only "SOT path missing" without naming the business-doc absence boundary and the static
  surfaces that remain available.

### Scenario: "what types/values exist" STOPped at the glossary list (Depth axis)

**Input:** An enumeration question ("what kinds of X are there / list all X") for a project that
has both a glossary/BR list of X and an authoritative enum/constant in code.

**Trap:** The glossary or BR shows a readable list, so the answer STOPs there and reports that list
as the complete set. The glossary list is an abstraction / partial list; the authoritative set lives
in the code enum/constant, and the two can disagree.

**PASS path:**

1. Read the glossary/BR list as the candidate set.
2. Before STOP, verify against the authoritative enum/constant once:
   `platty code search --project <project> --symbol "<EnumOrConstant>"` (or worktree grep).
3. Reconcile: report the code-authoritative set, flagging any item the glossary list missed or added.

**Red (any of these is a failure):**

- Presenting the glossary/BR list as the complete set without checking the code enum/constant.
- Treating a partial list as authoritative because it "looked complete".

### Scenario: polysemous core noun answered with one silent interpretation (Width axis)

**Input:** A question whose core noun is polysemous (one word, two domains), or whose intent level is
undecided, or whose flow is cross-cutting across several targets.

**Trap:** The answer silently picks the single most likely reading and finishes, so the discarded
interpretation never surfaces and the user can't tell a choice was made.

**PASS path:**

1. Expose the split in one line first: "this reads N ways: (a)… (b)…".
2. For a cross-cutting flow, count the applicable targets (enum/grep) before answering — is it one
   target or several?
3. Either answer both briefly, or answer the most likely reading while naming why it was chosen,
   naming the discarded reading, and offering to switch.

**Red (any of these is a failure):**

- Choosing one branch silently and finishing — the answer makes the discarded reading invisible.
- For a cross-cutting flow, answering as if it applies to one target without counting the set.

### Scenario: multi-target question answered by a single grep (Macro axis)

**Input:** A multi-target question ("all / every / which screens / across / each / list of …") whose
target set is spread across several pages / call sites / mechanisms.

**Trap:** A single `code search` / grep matches one mechanism, returns hits, and the answer concludes
"that's all" — missing the other pages, hidden call sites, and other mechanisms that make up the set.

**PASS path:**

1. Before any code grep, build the full map from spec (`relations.navigation` / `relations.api_calls`)
   or BR — fix it as the expected target list.
2. Use code only to verify and fill that map (grep/snippet each listed item): spec/BR = map,
   code = verification.
3. If spec/BR is absent or abstracted/stale, cross-reinforce with code, but do not treat one symbol
   grep as the whole set.

**Red (any of these is a failure):**

- Going straight to code for a multi-target question and reporting the single grep's hits as the set.
- Deep-diving one mechanism/type/screen and claiming the full set was covered.
- Concluding "there are no others" from one grep without checking the spec/BR map for the boundary.

### Scenario: business-doc claim asserted without checking the connected spec

**Input:** A business question whose answer touches a behavior, actor/permission, or response shape
that a business doc (`usecases/ucs.md` / `design.md` / `br.md`) states more strongly than the source
supports — e.g. the doc reads "only the workspace owner can manage members" while the connected API
spec shows the route only checks an authentication guard, or the doc says an upload "returns the
created record" while the endpoint returns `"ok"`.

**Trap:** The business doc reads cleanly, so the answer asserts its wording verbatim as fact and STOPs,
never opening the connected `specs/api|screen/<id>.md` the doc points to. Business docs are an index;
their claims are LLM-generated and can overclaim or lag.

**PASS path:**

1. Use the business doc as the index to locate the relevant entity (`relatedDocs` / `serviceMapNodes` / `traceId`).
2. Read the **connected** `specs/api/<fileId>.md` or `specs/screen/<fileId>.md` (only the related one), and when it is thin, drill to code via `graph trace` / `code search`.
3. Assert the behavior / actor-permission / response shape from the source-near spec/code, citing the business doc only as the index that found it. If the spec and the business doc disagree, surface the gap and route a `correction` (Memory Rule).

**Red (any of these is a failure):**

- Asserting a behavior, actor/permission, or response shape from a business doc without confirming it in the connected spec/code.
- Opening unrelated specs in bulk instead of only the connected one(s) the business doc points to.
- Presenting the business doc's wording as ground truth when the connected spec shows a weaker reality.

### Scenario: connected spec overclaims an empty handler

**Input:** A question about an API whose connected `specs/api/<fileId>.md` claims implemented behavior, but the source handler body is empty, only logs, returns nothing, or is a stub/TODO/not implemented shell.

**PASS path:**

1. Use the spec to locate the handler/source path.
2. Inspect the handler source when the claim matters.
3. If the source handler is empty or stub-like, **source code wins**: answer that the implementation is not confirmed, and name the spec/source mismatch.
4. Continue with another source-backed implementation of the same capability only if the catalog/spec map shows one; keep the stub variant separate.

**Red (any of these is a failure):**

- Treating the spec's prose as authoritative when the handler body is empty.
- Claiming a stub delegates to a service, persists data, emits events, checks permissions, or returns a business result without visible source evidence.
- Merging a complete implementation from another file/repo variant into the stub route without saying they are different targets.
