---
name: platty-retrieval
description: Use when searching Platty-generated docs or static-analysis targets, or answering product, business, data, design, development, repo, or project questions from Platty outputs using deterministic Platty CLI primitives.
---

# Platty Retrieval

Use this skill when a user asks a question that should be answered from Platty-generated project documents or static-analysis targets.

Do not start with one broad search and stop. Retrieval is an EPIC-centered graph walk:

```text
question
-> project glossary
-> optional clarification
-> subquestions
-> EPIC catalog
-> EPIC candidates
-> EPIC document graph
-> docs show/related
-> DD model evidence or API code evidence
-> answer with freshness
```

## Boundary

The CLI does not understand natural language and must not be treated like an LLM.

- Do not use or invent `docs ask`.
- Do not use or invent `docs investigate`.
- Advanced retrieval: do not pass a natural-language question to `epics search`.
- Do not expect CLI commands to synthesize the final answer.

You, the agent, read the glossary, rewrite terms, plan branches, choose commands, and synthesize the answer.

## Red Flags

STOP if you catch yourself thinking any of these:

| Excuse | Reality |
| --- | --- |
| "One advanced retrieval command `epics search` hit looks relevant — answer from it" / "the user complained I run too many commands, so answer from what I have" | Retrieval is an EPIC-centered graph walk. A search hit is a term match, not evidence — read the catalog and traverse advanced retrieval commands `epics show --include-docs` -> `docs show` before answering. Answering from titles and a score is fabrication. |
| "The question terms are clear, skip the glossary" | The user may ask in Korean while docs use English, Japanese, or code identifiers. The glossary maps aliases — skipping it is how you pick the wrong EPIC. |
| "The search score is high, trust it over the catalog" | Advanced retrieval command `epics search` is a term-matching helper, not semantic RAG. If it disagrees with the catalog, inspect both candidates. |
| "The doc is stale but probably still right — present it as fact" | State `freshness.isStale` / `validity` and recommend regeneration. Do not hide stale evidence. |

## Required Inputs

Resolve these before running retrieval commands:

- Project selector: `--project <project-id-or-name>`.
- User question.
- Question type: `business`, `data`, `development`, `design`, or `mixed`.

If the project is unknown, run:

```bash
platty project list --json
```

or ask the user for the project.

## Core CLI

Use the installed global CLI by default:

```bash
platty <command> --json
```

If the installed global CLI appears stale, follow `using-platty`: stop and
report that the global CLI needs reinstall/rebuild before continuing.

Advanced retrieval commands:

```bash
platty docs glossary digest --project <project> --json
platty epics list --project <project> --compact --json
platty epics show --project <project> --epic <epic-id> --include-docs --json
platty epics related --project <project> --epic <epic-id> --json
platty docs show --project <project> --document <doc-id> --json
platty docs related --project <project> --document <doc-id> --json
platty docs targets list --project <project> --search "<route-or-code-term>" --json
platty docs targets show --project <project> --id <entry-point-id> --json
platty code snippet --project <project> --repo <repo-id> --file <path> --lines <start>-<end> --json
platty code search --project <project> --symbol "<identifier>" --json
platty graph trace --project <project> --from <node-id> --direction downstream|upstream --json
```

Advanced fallback retrieval commands:

```bash
platty epics search --project <project> --terms "<term1,term2,term3>" --json
platty docs list --project <project> --type glossary --track business --scope project --compact --json
```

`docs glossary digest` is the term-unification entry point: it returns terms with
definitions and aliases in one call. (`docs list --compact` returns only an item count,
not the terms — use it only as fallback/debug inventory.)

Advanced retrieval command `epics search` is a term-matching helper. It is not semantic RAG, and it must not replace reading the EPIC catalog.

Advanced retrieval command `docs list` is fallback/debug inventory. Use the project glossary flow before falling back to inventory.

`docs targets show --id <entry-point>` returns the reachable code bundle (BFS slice) for one
API/screen entry point. `code snippet` reads a bounded source range without opening the whole
file. `code search --symbol` finds code nodes by identifier — the static-only bridge when no
docs/glossary exist yet.

## Freshness Rule

Retrieval outputs may include:

```text
freshness.validity
freshness.isStale
freshness.sourceCommit
freshness.sourceRunId
freshness.staticSnapshotId
freshness.documentSourceHash
freshness.updatedAt
```

If `freshness.isStale === true` or `freshness.validity !== "fresh"`:

- You may use the result as a clue.
- State that the document may not reflect the latest analyzed source.
- Recommend sync or regeneration before treating it as authoritative.

Do not hide stale evidence.

## Memory Rule

Retrieval outputs may include human-recorded memories alongside SOT content:

- Advanced retrieval commands `docs show`, `epics show`, and `business-docs document show --document <id>` return a `memories` array with `memoryId`, `level`, `kind`, `content`, `revision`, `updatedBy`, `updatedAt`. In advanced retrieval command `docs show`, item-anchored memories attach to the matching item view; memories whose item anchor no longer matches a live item stay in the document-level `memories` array.
- Advanced retrieval commands `docs list` and `docs search` document hits carry a per-document `memoryCount`; advanced retrieval command `epics show` grouped documents carry `memoryCount` per document; advanced retrieval command `epics list` carries an epic-level `memoryCount`.

Synthesis rules:

- SOT content is system-derived from analyzed code. `memories` are human-recorded knowledge (why, corrections, constraints) — see `platty-memory` for recording them.
- Quote memories as human-recorded, for example "사람이 기록한 메모리에 따르면 …". Do not present memory content as system-derived fact.
- When a memory contradicts SOT content, present both, flag the conflict, and recommend business-docs sync or regeneration. Never silently prefer either side.

## Workflow

### 1. Classify The Question

Classify the question as one or more:

- `business`: rules, user journeys, use cases, product behavior.
- `data`: entities, tables, fields, persistence, model meaning.
- `development`: route/API/screen behavior, handler, service, repository, source code.
- `design`: system design, component responsibility, flow boundaries.
- `mixed`: more than one of the above.

If the question is a **development design question** — "where do I add X", "how should I
change/structure Y", "what is the impact / blast radius of touching Z" — do not answer with a
single retrieval path. Use the 4-axis flow in "Development Design Questions" below.

### 2. Read The Project Glossary First

Read the glossary digest in one call (it returns terms + definitions + aliases directly;
`docs list --compact` does not return terms, only a count):

Advanced retrieval commands:

```bash
platty docs glossary digest --project <project> --json
```

If the digest reports `truncated: true`, the glossary was too large to return whole — lower
your confidence and warn the answer may miss a term that was cut.

Extract:

- canonical business terms
- aliases
- Korean/English/Japanese equivalents
- code identifiers
- API or route names
- related EPIC hints

If terms are ambiguous, ask the user one concise clarification question before continuing.

### 3. Split Into Subquestions

Rewrite the user question into 2-5 answerable subquestions.

Example:

```text
User: 캠페인 제외 그룹은 어떤 API와 테이블을 거치니?

Subquestions:
1. Which EPIC owns campaign exclusion group behavior?
2. Which BR/UCS documents define the business behavior?
3. Which DD items describe the data entities?
4. Which API specs implement the behavior?
5. Which code nodes implement those APIs?
```

### 4. Read The EPIC Catalog

Always read the compact EPIC catalog before choosing candidates:

Advanced retrieval command:

```bash
platty epics list --project <project> --compact --json
```

Use the catalog like a table of contents. Compare the normalized terms and subquestions against:

- EPIC title
- EPIC summary
- `terms`
- `documentCounts`
- freshness

Select 1-3 likely EPICs. Prefer candidates whose summaries explain the user's concept, not candidates that merely contain one matching word.

Do not skip this step. String matching can be wrong when the user asks in Korean and the generated docs use English, Japanese, code identifiers, or business aliases.

### 5. Optional Term Search For Disambiguation

Use advanced retrieval command `epics search` only after reading the EPIC catalog, and only when one of these is true:

- The catalog is too large to confidently narrow candidates.
- The glossary exposes useful aliases, code identifiers, or translated terms.
- Several EPICs look plausible and need a quick term cross-check.
- The first selected EPIC does not contain the expected document types.

Example:

Advanced retrieval command:

```bash
platty epics search --project <project> --terms "campaign,exclusion,group" --json
```

Treat the result as a hint. If advanced retrieval command `epics search` disagrees with the catalog, inspect both candidates instead of trusting the score.

### 6. Traverse The EPIC Graph

For each candidate EPIC:

Advanced retrieval command:

```bash
platty epics show --project <project> --epic <epic-id> --include-docs --json
```

Use the grouped documents as the retrieval index:

```text
glossary
ucl
ucs
br
data_dictionary
design
api_spec
screen_spec
event_spec
schedule_spec
```

Do not open every document. Choose the likely documents based on type, title, summary, links, and freshness.

### 7. Follow Document Links

Open relevant documents and then traverse their graph:

Advanced retrieval commands:

```bash
platty docs show --project <project> --document <doc-id> --json
platty docs related --project <project> --document <doc-id> --json
platty docs search --project <project> "<ucl-item-stable-key>" --json
```

Expected paths:

```text
UCL item -> UCS document
UCS -> BR / DD / design / source technical docs
BR -> DD / source technical docs
DD -> model/table/field evidence
api_spec or screen_spec -> code node/file location
```

#### UCL Item To Specific UCS

UCL documents are use-case lists. Do not treat a UCL document as the final use-case detail when the user asks for a specific UCS.

To find one UCS:

1. Open the candidate EPIC's UCL document with advanced retrieval command `docs show`.
2. Select the relevant UCL item by title, summary, or `stableKey`.
3. Search the item `stableKey` exactly:

Advanced retrieval command:

```bash
platty docs search --project <project> "<ucl-item-stable-key>" --json
```

4. From the results, choose the document where `type === "ucs"`.

The UCS document is linked by scope identity, not necessarily by a visible advanced retrieval command `docs related` document edge:

```text
UCL item stableKey: ucl:<epic-id>:<use-case-key>
UCS scopeId: epic:<epic-id>:use_case:ucl:<epic-id>:<use-case-key>
```

Advanced retrieval command `docs search` may return the parent UCL document, UCL item, UCS document, and UCS items together. For specific UCS retrieval, filter to the UCS document before opening it with advanced retrieval command `docs show`.

### 8. Inspect Data Evidence

For data questions, use DD documents and item `modelLinks`.

Look for:

- `modelName`
- `tableName`
- `fieldName`
- `linkType`: `describes_model`, `describes_field`, or `uses_model`
- field metadata
- model source file and lines when present

If DD has a gap item such as `missing_model_evidence`, say that the generated evidence did not identify a backing model/table.

### 9. Inspect Code Evidence

For API/screen/development questions, use technical documents and `code`.

Look for:

- `code.primaryNode.nodeId`
- `code.primaryNode.filePath`
- `code.primaryNode.startLine`
- `code.relatedNodes`
- target results from `platty targets list`

`nodeId` is graph identity. `filePath` and line numbers are what you use when source inspection is needed.

When you must read actual source, prefer the bounded reader over opening whole files:

```bash
code snippet --project <project> --repo <repo-id> --file <path> --lines <start>-<end> --json
```

It returns only the requested range plus a freshness `contentHash`. To see everything an entry
point reaches (handler + dependencies), pull its bundle:

```bash
docs targets show --project <project> --id <entry-point-id> --json
```

If the project has only static analysis (no generated docs/glossary), search code nodes by
identifier — guess the English term yourself, since there is no glossary to bridge it:

```bash
code search --project <project> --symbol "<identifier>" --json
```

An empty `code search` result is a valid "no anchor here" answer: widen the identifier or stop.

For cross-layer/multi-repo impact ("if I change this table/API/screen, what else breaks?"), trace
service-map edges:

```bash
graph trace --project <project> --from <node-id> --direction downstream|upstream --json
```

`downstream` follows screen→API→DB; `upstream` reverses (which APIs write a table, which screens
call an API). This is **known static service-map impact, not complete impact** — it returns
`omittedEdgeClasses` (ORM includes, indirect writes, event side effects, dynamic URLs it cannot
see), and `candidates` (unresolved edges) you must judge before claiming an impact set is complete.
Never report a trace result as an exhaustive blast radius.

## Retrieval Paths

Business question:

```text
glossary -> EPIC candidates -> UCL -> UCS -> BR -> DD -> design -> source technical docs
```

Data question:

```text
glossary -> EPIC candidates -> DD -> model/table/field -> related BR/UCS -> api_spec -> code
```

Development question:

```text
glossary -> EPIC candidates if business scope matters -> targets list -> api_spec/screen_spec -> code -> related DD/BR/UCS
```

Design question:

```text
glossary -> EPIC candidates -> design -> UCS -> BR -> DD -> source technical docs
```

Mixed questions should run the relevant paths and merge evidence.

## Development Design Questions (4-Axis)

For "where do I add this", "how do I change this", or "what breaks if I touch this", a single
retrieval path is not enough. Investigate four axes, then synthesize. When the runtime supports
subagents, run the axes in parallel; otherwise run them in sequence. Each axis uses the same CLIs.

1. **Current state** — what exists today around the feature.
   `epics show` → `docs show` (api_spec/screen_spec) → `docs targets show --id` for the code bundle.
2. **Constraints / background** — why it is the way it is, what must not break.
   adjacent `memory` (correction/constraint/why) on the relevant doc/EPIC anchors.
3. **Existing patterns** — what to reuse instead of inventing.
   `code search --symbol` for similar handlers/utilities already in the repos.
4. **Impact / blast radius** — what else is affected.
   `graph trace --from <node> --direction upstream|downstream` and the entry-point bundle.

Then synthesize a design answer that:

- lists the concrete **change points** (repo + file + node + layer), grounded in evidence;
- names the **reusable pattern** found in axis 3;
- gives an **impact map** from axis 4, explicitly labeled as known static impact, not complete
  (carry `omittedEdgeClasses` and unresolved `candidates` forward — never claim an exhaustive
  blast radius);
- runs a **constraint check**: compare the proposed change against axis-2 memories and flag any
  `constraint`/`correction` it would violate;
- **separates "observed current structure" (evidence) from "recommended design" (proposal)** —
  code shows what the system does, not what it should do.

If docs/EPICs are missing for the area, fall back to static-only: `docs targets list` +
`docs targets show` + `code search` + `code snippet`, and say the design rests on code evidence
alone (no SOT/constraints available).

## Answer Contract

When answering:

- State the normalized terms used.
- Cite document ids, document types, and target file paths when available.
- Separate direct evidence from inference.
- Mention stale/freshness status for stale or orphaned evidence.
- If evidence is weak, say which command or regeneration step should run next.

Keep the final answer concise unless the user asks for a full trace.

## Handoff

End retrieval with the `Platty handoff` card after the answer. The `Evidence`
line should list the document ids and commands used. The `Recommended next`
line should be one of:

- ask a sharper follow-up question from the same evidence graph
- regenerate stale/orphaned docs with `platty-docs-generation`
- generate epics or business docs if the user needs planning/output artifacts

## Fallback Inventory

Use advanced retrieval command `docs list` only when the EPIC index is missing, you need a type-specific audit, or you are debugging generated inventory:

Advanced retrieval commands:

```bash
platty docs list --project <project> --type br --track business --compact --json
platty docs list --project <project> --type api_spec --track technical --compact --json
```

## Stop Conditions

- The project has no glossary (advanced retrieval command `docs list ... --type glossary` returns nothing) AND advanced retrieval command `epics list` returns no epics: stop retrieval and report that docs/EPICs have not been generated for this project — route to the generation skills instead of answering from guesses.
- Two full graph walks (catalog -> advanced retrieval command `epics show` -> advanced retrieval commands `docs show`/`docs related`) surface no evidence for a subquestion: answer "no evidence found", listing the commands tried — do not fabricate an answer and do not keep widening the search indefinitely.
- Every candidate document reports `freshness.validity === "orphaned"`: stop treating their content as evidence; report that the documents no longer map to analyzed sources and recommend regeneration before answering.
