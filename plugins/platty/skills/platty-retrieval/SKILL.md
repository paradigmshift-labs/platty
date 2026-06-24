---
name: platty-retrieval
description: Use when searching Platty-generated docs or static-analysis targets, or answering product, business, data, design, development, repo, or project questions from Platty outputs. Discovery is grep/read over the projected SOT Markdown folder (~/.platty/sot/<projectId>/); cross-layer service-map traversal, code search, and memory writes escalate to deterministic Platty CLI primitives.
---

# Platty Retrieval

Use this skill when a user asks a question that should be answered from Platty-generated project documents or static-analysis targets.

Platty projects a single source of truth (the DB) into a read-only Markdown tree at
`~/.platty/sot/<projectId>/`. **Discovery and static relations live in that folder
(grep/read). Computation, cross-layer traversal, and writes escalate to the CLI.**
The split is not "MD vs CLI" — it is **enumerable/static (MD wins) vs computed/traversed/mutated (CLI wins)**:

```text
question
-> resolve projectId -> ~/.platty/sot/<projectId>/   (folder is the map)
-> read README.md + catalog/*.md                     (orient; solve unknown-unknowns)
-> grep catalog/*.md by name/summary                 (discover candidates — ids are opaque)
-> read epics/<id>/*.md and specs/<kind>/<fileId>.md (detail)
-> follow frontmatter ids to the next MD             (static relations, no CLI hop)
-> escalate to CLI ONLY for:                         (graph trace / code search / memory write)
-> answer with validity (freshness)
```

If the SOT folder does not exist yet, fall back to the **advanced recovery CLI
graph walk** below — do not guess.

## State Gate: Choose the Retrieval Mode

Before choosing a retrieval strategy, classify the project state from generic SOT structure.

1. Resolve `projectId` and locate `~/.platty/sot/<projectId>/`.
2. Read `README.md`, `catalog/epics.md`, and `catalog/glossary.md` when present.
3. If live EPIC rows have `documentCount > 0` and generated files exist under `epics/<epicId>/` such as `br.md`, `design.md`, `data_dictionary.md`, `glossary.md`, `usecases/ucl.md`, or `usecases/ucs.md`, use **Business Index Mode** for business, planning, policy/rules, journey, and concept questions.
4. If business docs are absent, incomplete, or not exported, use **Static Analysis Mode** for static catalogs and graph/code primitives.
5. If the state is mixed, use Business Index Mode for valid business-doc evidence and explicitly state coverage or freshness gaps before drilling into static evidence.
6. For development/design-impact questions ("where do I add/change this", "what breaks", code location, precise screen/api/table impact), follow **Development Design Questions (4-Axis)** even when business docs exist: start with targeted static catalog grep + graph traces when the question is already anchored to an implementation entity or asks for code/impact, then use business docs for semantic scope and constraints when available.

Never use fixture names, repository names, source paths, EPIC titles, or domain-specific terms as activation conditions. The mode decision must be based on the generic SOT layout and catalog fields.

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

## Query Class Routing

After the State Gate, route by question shape before reading details. This keeps retrieval
bounded and prevents the "CLI is available, so trace first" failure mode.

| Question shape | First hop | Drilldown gate | Stop rule |
| --- | --- | --- | --- |
| concept / term meaning | `catalog/glossary.md`, then `catalog/epics.md` | candidate epic `glossary.md` / `design.md` | stop before graph unless implementation is asked |
| planning / product direction | `catalog/epics.md` | `design.md`, `br.md`, `usecases/ucl.md` | stop after business docs when supported |
| policy / business rules | `catalog/epics.md` | `br.md`, `usecases/ucs.md`, `data_dictionary.md` | do not infer policy from code alone |
| user journey / screen flow | `catalog/epics.md` plus `catalog/screens.md` | `design.md`, `usecases/ucl.md`, screen specs | separate journey from implementation |
| precise API / screen / table impact | static catalog row (`apis.md`, `screens.md`, `tables.md`) | `graph trace` from `traceId` / `serviceMapNodes`, then source snippet | state graph limits and candidates |
| data field / carrier impact | `catalog/tables.md` or field docs | DB-anchored upstream trace with `accesses_db,calls_api`, then source grep | check read carriers as well as writes |
| code location | glossary `code_term` or static catalog | `code search` -> nodeId -> optional trace/snippet | never pass `code_term` directly to `graph trace` |
| ambiguous domain term | `catalog/glossary.md` and `catalog/epics.md` | read 2-3 candidate epic folders | qualify or ask if candidates remain tied |
| negative evidence / missing graph links | static catalog anchor | targeted graph trace returning 0 confirmed | say "no confirmed graph evidence"; never say "no impact" |
| business docs absent | static catalogs only | graph/code only for static structure | explicitly stop before business policy, journey, or intent |

## Boundary

- **The SOT Markdown is a read-only projection (`[regen]`).** Never edit a file under
  `~/.platty/sot/`. To change knowledge, write to the DB with the CLI (`platty memory add ...`)
  and re-run `platty sot export`. The next export regenerates the MD.
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
| "I can't read the catalog (folder missing / read failed), so I'll guess from memory" | Do not fabricate. Either run `platty sot export --project <project>` to (re)create the folder, or fall back to the CLI graph walk. If neither works, report that the SOT projection is unavailable and recommend `sync` + `sot export`. |
| "The question terms are clear, skip the catalog/glossary" | The user may ask in Korean while docs use English, Japanese, or code identifiers. `catalog/glossary.md` and `summary` columns map aliases — skipping them is how you pick the wrong EPIC. |
| "There are hundreds of MD files, I'll open them all to be safe" | Don't brute-force the tree. Use `catalog/*.md` to narrow, read only the named detail files, and for cross-layer reach use `graph trace` — high-cardinality code nodes are intentionally NOT in the MD (use `code search`). |
| "The doc is stale/orphaned but probably still right — present it as fact" | State `validity` from frontmatter and recommend `sync` + `sot export`. Do not hide stale evidence. |
| "I'll edit the MD file to fix the wrong value" | The MD is a `[regen]` projection. Edits are lost on next export. Write via `platty memory add` then `platty sot export`. |
| "I found the `code_term` in glossary, I'll pass it straight to `graph trace --from`" | A `code_term` is a code identifier, NOT a service-map node id. `graph trace --from` needs a node id — first `code search --symbol <code_term>` to get the nodeId, then trace from that. Passing the raw `code_term` is a dangling-input error. |
| "The query is Korean but I know the English word, I'll skip glossary and trace from my guess" | Cross the language bridge through `catalog/glossary.md` first. Guessing the English/code term skips the canonical/`code_term` mapping and traces the wrong (or non-existent) node. |
| "Business docs exist, but graph trace feels faster, so I'll start there" | Wrong mode for business/planning/policy/journey/concept questions. When valid business docs exist, treat them as the semantic index first for those questions. For development/design-impact questions already anchored to implementation or asking code/impact, use the 4-axis path: targeted static catalog grep + graph traces first, with business docs as semantic scope/constraints. |
| "Business docs are missing, so retrieval cannot answer anything" | Wrong mode. Static catalogs, graph trace, and code search still answer static-analysis questions; just avoid inventing business rules. |
| "This domain term means business-doc mode should be active" | Wrong mode. Mode selection comes from generic SOT structure and catalog fields, never domain, fixture, repository, source-path, or EPIC-title terms. |

## Stop Conditions

- **SOT folder missing AND no EPIC catalog entries exist**: docs/EPICs have not been generated. Route to the generation skills; do not answer from guesses.
- **A frontmatter `id` you followed does not resolve** to any catalog entry or MD file (dangling link): stop, do not invent the target. Report the mismatch and recommend `platty sot export` (the projection may be stale relative to the DB).
- **The same `id` appears in more than one document** (catalog or frontmatter): stop and report the ambiguity instead of picking one — the projection or DB is inconsistent.
- **Every candidate document reports `validity: orphaned`** (or `status: deleted`): stop treating their content as evidence; report that the docs no longer map to analyzed sources and recommend regeneration + re-export.
- **Two full discovery passes** (catalog grep -> detail read -> frontmatter follow) surface no evidence for a subquestion: answer "no evidence found", list what you grepped/read, and stop — do not widen indefinitely or fabricate.

## Required Inputs

Resolve these before retrieval:

- Project selector, then **projectId**: `platty project list --json` (or `platty project use <project>`). The SOT path is `~/.platty/sot/<projectId>/`.
- User question, classified: `business`, `data`, `development`, `design`, or `mixed`.

## Discovery Flow (SOT Markdown)

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

### 2. Orient with README + catalog

Read these first to get the map and solve unknown-unknowns (you don't need to know the term yet):

```text
~/.platty/sot/<projectId>/README.md          # lastExportAt, sourceCommit, layout
~/.platty/sot/<projectId>/catalog/epics.md    # epicId | name | summary | documentCount | memories | path
~/.platty/sot/<projectId>/catalog/apis.md     # apiId | traceId | name | repo | epicIds | validity | status | memories | detailPath | source
~/.platty/sot/<projectId>/catalog/screens.md  catalog/events.md  catalog/schedules.md  # 동일 스키마 (screenId/eventId/scheduleId | traceId | …)
~/.platty/sot/<projectId>/catalog/tables.md   # modelId | name | validity | repoId | traceId
~/.platty/sot/<projectId>/catalog/external-services.md
~/.platty/sot/<projectId>/catalog/glossary.md # project-scope terms + epic glossary pointers
```

`README.md`'s `lastExportAt` tells you how fresh the projection is.

- **api/screen/event/schedule rows are static** — built from service-map nodes, so they appear **even with no generated docs**. `source=static` means node-only; `source=doc` means an LLM spec enriched the row (then `detailPath`, `epicIds`, `validity`/`status` are filled). apiId is empty for static-only rows.
- **`traceId` is the `graph trace --from` seed.** grep a row by `name`/`repo`, then trace its cross-layer/cross-repo connections (callers, DB) with `platty graph trace --from <traceId>`. To read the actual source code, go traceId → graph trace (source location), NOT the catalog row.
- `detailPath` points straight at the detail MD file when a doc exists (empty for static-only) — read it directly, don't reconstruct the hashed filename. The `memories` column flags entities with human knowledge worth reading before you assert.

### 3. Discover candidates with grep (name/summary)

grep the catalog for the user's concept, bridging language via `catalog/glossary.md`:

```bash
grep -in "환불\|refund" ~/.platty/sot/<projectId>/catalog/*.md
```

Pick 1-3 candidate epics/specs by the readable `name`/`summary` columns — not by a single matching word, and never by id (ids are opaque). The catalog is the table of contents; the `Excluded (orphaned/deleted)` section lists audit-only entries you must not treat as live.

#### Glossary cross-lingual search protocol (run at search start)

Before expanding or guessing terms, cross the language bridge through `catalog/glossary.md`:

1. **grep `catalog/glossary.md` for the query term first.** Its `Terms` index maps each
   term to its `canonicalTerm`, `searchTerms` (aliases + synonyms + candidate aliases),
   and **`code` (the `code_term` — the backend/code identifier bridge)**:

   ```bash
   grep -in "환불" ~/.platty/sot/<projectId>/catalog/glossary.md
   ```

2. **If the term has a `code_term`, do NOT pass it to `graph trace --from`.** A `code_term`
   is a code identifier, **not a service-map node id** — `graph trace --from` expects a
   node id. Resolve the node id first, then trace:

   ```bash
   platty code search --project <project> --symbol "<code_term>" --json   # -> get the nodeId
   platty graph trace --project <project> --from <nodeId> --direction upstream|downstream --json
   ```

3. **If there is no `code_term`, use `searchTerms` to expand `docs`/`code search`
   candidates only — do not assert.** The aliases/synonyms widen discovery; they are not
   themselves evidence and do not bridge to a code node.

### 4. Read the detail Markdown

Open the named files. Business docs nest under the epic; technical specs are pooled under `specs/`:

```text
epics/<epicId>/epic.md                         # epic body + relatedDocs (id + role + path)
epics/<epicId>/br.md  design.md  data_dictionary.md  glossary.md
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
- `stale`: usable as a clue; state it may not reflect the latest source; recommend `sync` + `sot export`.
- `orphaned` / `status: deleted`: do not assert; these are excluded from the body tree and live only in catalog audit sections. Recommend regeneration.

## Business Index Mode

Use this when the State Gate finds live EPIC rows with generated business documents and the question is about business meaning, planning, policy/rules, user journeys, or concepts. Business docs are the semantic index: they define intent, scope, constraints, journeys, rules, and field meaning. Technical specs and graph/code are drill-down surfaces for implementation detail, impact analysis, or gaps.

For development/design-impact questions ("where do I add/change this", "what breaks", code location, precise screen/api/table impact), do not override **Development Design Questions (4-Axis)**. If the question is already anchored to an implementation entity or asks for code/impact, start with targeted static catalog grep + graph traces as that section requires, then read available business docs for semantic scope and constraints.

Discovery order:

1. Start from the user question.
2. Cross the glossary bridge with `catalog/glossary.md` and the relevant EPIC `glossary.md` when present.
3. Use `catalog/epics.md` to identify candidate rows by readable terms, summaries, and `documentCount`.
4. Read only 1-3 candidate `epics/<epicId>/epic.md` files on the first pass.
5. Read purpose-selected business docs from those candidate EPIC folders.
6. Follow `relatedDocs`, `detailPath`, `serviceMapNodes`, or `traceId` only when technical detail is required.
7. Use graph/code only for implementation, impact radius, or unresolved coverage/freshness gaps.

Purpose-to-document routing:

| Purpose | Read first |
| --- | --- |
| concept | `catalog/glossary.md`, `glossary.md`, `epic.md`, `design.md` |
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
  source/spec drill-down: `catalog/glossary.md` or alias terms checked,
  `catalog/epics.md` candidate rows, chosen `epics/<epicId>/`, and the selected
  business docs (`br.md`, `design.md`, `usecases/*`, `data_dictionary.md`,
  `glossary.md`) that support the answer.
- Read technical specs only after scope selection.
- Run graph/code only when implementation, impact, or unresolved gaps require it.
- Do not call graph/code just because the CLI is available. For business-only planning, policy, or journey answers, stop after the business docs once the answer is supported.
- For business-index questions, graph/code is an escalation, not a validation ritual. Escalate only
  when the answer needs source location, confirmed implementation edges, graph-negative evidence, or
  a code-level bridge from a `code_term`.
- For static impact or DB questions, graph trace is worth the extra time/tokens only when it adds evidence grep cannot supply: confirmed DB/API/screen edges, source locations, candidates, or negative trace evidence.
- If a graph/code call does not materially change the answer, treat that as a skill failure in later evals and tighten the routing rule rather than widening searches.

## Static Analysis Mode

Use this when business docs are unavailable, incomplete, or not exported. Do not stall looking for business docs. Static catalogs, graph trace, and code search still support retrieval over observed screens, APIs, tables, external services, schedules, events, and code primitives.

Discovery order:

1. Start from the user question.
2. Cross `catalog/glossary.md` if present.
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
5. If static catalogs are also missing, report the missing projection and recommend `sync`/`sot export`
   or generation; do not widen into unrelated source reads to fabricate a business answer.

## Memory Rule

Memories are human-recorded knowledge (why, corrections, constraints), projected to
`epics/<id>/memory.md` and `specs/memory/<fileId>.md` as `[regen]` files:

- Quote them as human-recorded, e.g. "사람이 기록한 메모리에 따르면 …". Do not present memory content as system-derived fact.
- When a memory contradicts SOT content, present both, flag the conflict, and recommend `sync`/regeneration. Never silently prefer either side.
- A memory entry with `anchorStale: true` is anchored to an item that no longer exists (renamed/dropped on regen) even though its parent doc may read `fresh` — do **not** assert it as current; surface it and recommend re-anchoring (`memory update`/re-add).
- If `README.md` reports a `memory/unrouted.md` count (memories whose epic/doc anchor was deleted or regenerated), **read that file** — its memories are NOT reachable from any epic/spec `memory.md`. Surface them and recommend re-anchoring; do not assume the rest of the tree covers them.
- The MD is a projection: a `memory add` is invisible here until the next `sot export`. If you just wrote memory, treat `memory.md` as behind until you re-export. To record, use `platty memory add` (with `--export-sot`) then never edit `memory.md` directly. See `platty-memory`.

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
- State the normalized terms used (and the alias bridge from `catalog/glossary.md`).
- Cite MD file paths and frontmatter `id`s; for code, cite repo + file + line.
- Separate direct evidence from inference.
- For docs-absent projects, explicitly say "business docs are absent/unavailable" and "static catalogs/graph/code can only support implementation structure." Do not merely imply this by saying "no SOT path."
- Keep verdicts internally consistent: a summary table's ✅ / "필요" must not contradict the body's confidence label for the same item (don't assert "required" in a table while hedging it as low-confidence in the prose). Pick one and align both.
- State `validity` for any stale/orphaned evidence.
- If evidence is weak, name the next step (`sot export`, `sync`, `code search`, or regeneration).

End with the `Platty handoff` card. `Evidence` lists the MD paths / ids / commands used.
`Recommended next` is one of: a sharper follow-up from the same SOT folder; `sync` + `sot export`
to refresh; or `platty-generated-docs` if outputs need (re)generation.

## Advanced Recovery Fallback: CLI Graph Walk (no SOT folder)

When `~/.platty/sot/<projectId>/` does not exist and you cannot/should not export it,
retrieve directly from the CLI (this is the legacy EPIC-centered graph walk):

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
Prefer running `platty sot export` and using the Markdown discovery flow above when possible.

## Baseline Pressure Scenarios

Behavioral checks for this skill. `npm run check:*` only verifies file structure — these
scenarios verify the skill actually changes behavior under pressure. Each scenario names the
PASS path and the Red (failure) paths it must prevent.

### Scenario: Korean query → code location via glossary bridge

**Input:** A Korean query (e.g. "환불") asking where the corresponding logic lives in code.

**PASS path:**

1. grep `catalog/glossary.md` for "환불" → hit on the `Terms` index row.
2. Read that term's `code_term` from the `code` column (e.g. `refund`).
3. `platty code search --project <project> --symbol refund --json` → obtain the `nodeId`
   (with `filePath`/`lineStart`/`lineEnd`).
4. `platty graph trace --project <project> --from <nodeId> ... --json` using that node id.

**Red (any of these is a failure):**

- Putting the `code_term` directly into `graph trace --from` (e.g. `--from refund`) — a
  `code_term` is not a service-map node id.
- Skipping `catalog/glossary.md` entirely and guessing an English term to search/trace.
- The term has **no** `code_term`, yet the answer asserts a code location anyway instead of
  using `searchTerms` only to widen `docs`/`code search` candidates without asserting.

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
