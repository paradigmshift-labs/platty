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

If the SOT folder does not exist yet, fall back to the **CLI graph walk** in
"Fallback: CLI Graph Walk (no SOT folder)" below — do not guess.

## Boundary

- **The SOT Markdown is a read-only projection (`[regen]`).** Never edit a file under
  `~/.platty/sot/`. To change knowledge, write to the DB with the CLI (`platty memory add ...`)
  and re-run `platty sot export`. The next export regenerates the MD.
- The CLI does not understand natural language and must not be treated like an LLM.
  Do not use or invent `docs ask` / `docs investigate`, and do not pass a natural-language
  question to `epics search`.
- **Discovery is on `name`/`summary`, never on ids.** Frontmatter `id` values are opaque/large
  (`doc:<projectId>:<type>:<hash16>`, `doc:<nanoid>`, nanoid epic ids). grep readable text;
  follow ids only after you have the file.

You, the agent, read the catalog, grep terms, follow frontmatter links, choose escalations, and synthesize the answer.

## Red Flags

STOP if you catch yourself thinking any of these:

| Excuse | Reality |
| --- | --- |
| "I'll just `epics search`/`LIKE` for the term and answer from the hit" | The SOT folder is right there. `grep` `catalog/*.md` for the concept (name/summary), then read the detail MD. A term-match hit is not evidence; answering from titles and a score is fabrication. |
| "I can't read the catalog (folder missing / read failed), so I'll guess from memory" | Do not fabricate. Either run `platty sot export --project <project>` to (re)create the folder, or fall back to the CLI graph walk. If neither works, report that the SOT projection is unavailable and recommend `sync` + `sot export`. |
| "The question terms are clear, skip the catalog/glossary" | The user may ask in Korean while docs use English, Japanese, or code identifiers. `catalog/glossary.md` and `summary` columns map aliases — skipping them is how you pick the wrong EPIC. |
| "There are hundreds of MD files, I'll open them all to be safe" | Don't brute-force the tree. Use `catalog/*.md` to narrow, read only the named detail files, and for cross-layer reach use `graph trace` — high-cardinality code nodes are intentionally NOT in the MD (use `code search`). |
| "The doc is stale/orphaned but probably still right — present it as fact" | State `validity` from frontmatter and recommend `sync` + `sot export`. Do not hide stale evidence. |
| "I'll edit the MD file to fix the wrong value" | The MD is a `[regen]` projection. Edits are lost on next export. Write via `platty memory add` then `platty sot export`. |

## Stop Conditions

- **SOT folder missing AND `epics list` returns no epics**: docs/EPICs have not been generated. Route to the generation skills; do not answer from guesses.
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
~/.platty/sot/<projectId>/catalog/apis.md     # apiId | name | epicIds | validity | status | memories | path
~/.platty/sot/<projectId>/catalog/screens.md  catalog/events.md  catalog/schedules.md
~/.platty/sot/<projectId>/catalog/tables.md   # modelId | name | validity | repoId
~/.platty/sot/<projectId>/catalog/external-services.md
~/.platty/sot/<projectId>/catalog/glossary.md # project-scope terms + epic glossary pointers
```

`README.md`'s `lastExportAt` tells you how fresh the projection is. Each catalog
row's `path` column points straight at the detail MD file — read it directly
(don't try to reconstruct the hashed filename). The `memories` column tells you
which entities carry human knowledge worth reading before you assert.

### 3. Discover candidates with grep (name/summary)

grep the catalog for the user's concept, bridging language via `catalog/glossary.md`:

```bash
grep -in "환불\|refund" ~/.platty/sot/<projectId>/catalog/*.md
```

Pick 1-3 candidate epics/specs by the readable `name`/`summary` columns — not by a single matching word, and never by id (ids are opaque). The catalog is the table of contents; the `Excluded (orphaned/deleted)` section lists audit-only entries you must not treat as live.

### 4. Read the detail Markdown

Open the named files. Business docs nest under the epic; technical specs are pooled under `specs/`:

```text
epics/<epicId>/epic.md                         # epic body + relatedDocs (id + role + path)
epics/<epicId>/br.md  design.md  data_dictionary.md  glossary.md
epics/<epicId>/usecases/ucl.md  ucs.md
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
# Cross-layer / multi-repo service-map traversal. --from is the spec frontmatter serviceMapNodes id.
platty graph trace --project <project> --from <serviceMapNodes-id> --direction downstream|upstream --depth <n> --json

# High-cardinality code symbols (intentionally omitted from MD).
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

**Invariant:** the `serviceMapNodes` id in a spec's frontmatter is exactly the `--from`
input `graph trace` expects. If they disagree, the projection is stale — re-export.

### 7. Freshness

Trust the frontmatter `validity` (`fresh` | `stale` | `orphaned`) and `status`:

- `fresh`: assert normally, cite the file path + frontmatter `id`.
- `stale`: usable as a clue; state it may not reflect the latest source; recommend `sync` + `sot export`.
- `orphaned` / `status: deleted`: do not assert; these are excluded from the body tree and live only in catalog audit sections. Recommend regeneration.

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
read is not enough. Investigate four axes (parallel when the runtime supports subagents):

1. **Current state** — `epics/<id>/*.md` + `specs/<kind>/<fileId>.md` for what exists today.
2. **Constraints / background** — `epics/<id>/memory.md` / `specs/memory/<fileId>.md` (`constraint`/`correction`/`why`).
3. **Existing patterns** — `platty code search --symbol` for similar handlers/utilities to reuse.
4. **Impact / blast radius** — `platty graph trace --from <serviceMapNodes-id> --depth <n>` (carry `omittedEdgeClasses` + `candidates` forward).

Then synthesize: concrete **change points** (repo + file + node + layer), the **reusable pattern** (axis 3), an **impact map** labeled known-static-not-complete (axis 4), a **constraint check** against axis-2 memories, and a clear separation of **observed structure (evidence)** vs **recommended design (proposal)**.

## Answer Contract

- State the normalized terms used (and the alias bridge from `catalog/glossary.md`).
- Cite MD file paths and frontmatter `id`s; for code, cite repo + file + line.
- Separate direct evidence from inference.
- State `validity` for any stale/orphaned evidence.
- If evidence is weak, name the next step (`sot export`, `sync`, `code search`, or regeneration).

End with the `Platty handoff` card. `Evidence` lists the MD paths / ids / commands used.
`Recommended next` is one of: a sharper follow-up from the same SOT folder; `sync` + `sot export`
to refresh; or `platty-generated-docs` if outputs need (re)generation.

## Fallback: CLI Graph Walk (no SOT folder)

When `~/.platty/sot/<projectId>/` does not exist and you cannot/should not export it,
retrieve directly from the CLI (this is the legacy EPIC-centered graph walk):

```bash
platty docs glossary digest --project <project> --json     # term unification (aliases)
platty epics list --project <project> --compact --json      # EPIC catalog (table of contents)
platty epics show --project <project> --epic <id> --include-docs --json
platty docs show --project <project> --document <id> --json
platty docs related --project <project> --document <id> --json
platty docs targets show --project <project> --id <entry-point-id> --json
```

The same Red Flags, Stop Conditions, Freshness, and Memory rules apply. `epics search --terms`
is a term-match hint only — read the catalog before trusting it; answering from a score is fabrication.
Prefer running `platty sot export` and using the Markdown discovery flow above when possible.
