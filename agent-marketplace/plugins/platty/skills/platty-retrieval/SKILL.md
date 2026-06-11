---
name: platty-retrieval
description: Use when answering product, business, data, design, or development questions from Platty-generated docs using deterministic Platty CLI primitives.
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
- Do not pass a natural-language question to `epics search`.
- Do not expect CLI commands to synthesize the final answer.

You, the agent, read the glossary, rewrite terms, plan branches, choose commands, and synthesize the answer.

## Red Flags

STOP if you catch yourself thinking any of these:

| Excuse | Reality |
| --- | --- |
| "One `epics search` hit looks relevant — answer from it" / "the user complained I run too many commands, so answer from what I have" | Retrieval is an EPIC-centered graph walk. A search hit is a term match, not evidence — read the catalog and traverse `epics show --include-docs` -> `docs show` before answering. Answering from titles and a score is fabrication. |
| "The question terms are clear, skip the glossary" | The user may ask in Korean while docs use English, Japanese, or code identifiers. The glossary maps aliases — skipping it is how you pick the wrong EPIC. |
| "The search score is high, trust it over the catalog" | `epics search` is a term-matching helper, not semantic RAG. If it disagrees with the catalog, inspect both candidates. |
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

Use the local CLI available in the repo, for example:

```bash
node packages/cli/dist/main.js <command> --json
```

Preferred retrieval commands:

```bash
docs list --project <project> --type glossary --track business --scope project --compact --json
docs show --project <project> --document <project-glossary-doc-id> --json
epics list --project <project> --compact --json
epics show --project <project> --epic <epic-id> --include-docs --json
epics related --project <project> --epic <epic-id> --json
docs show --project <project> --document <doc-id> --json
docs related --project <project> --document <doc-id> --json
docs targets list --project <project> --search "<route-or-code-term>" --json
```

Fallback retrieval commands:

```bash
epics search --project <project> --terms "<term1,term2,term3>" --json
```

`epics search` is a term-matching helper. It is not semantic RAG, and it must not replace reading the EPIC catalog.

`docs list` is fallback/debug inventory. It is not the normal entry point after the project glossary.

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

## Workflow

### 1. Classify The Question

Classify the question as one or more:

- `business`: rules, user journeys, use cases, product behavior.
- `data`: entities, tables, fields, persistence, model meaning.
- `development`: route/API/screen behavior, handler, service, repository, source code.
- `design`: system design, component responsibility, flow boundaries.
- `mixed`: more than one of the above.

### 2. Read The Project Glossary First

Find and open the project glossary:

```bash
docs list --project <project> --type glossary --track business --scope project --compact --json
docs show --project <project> --document <project-glossary-doc-id> --json
```

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

```bash
epics list --project <project> --compact --json
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

Use `epics search` only after reading the EPIC catalog, and only when one of these is true:

- The catalog is too large to confidently narrow candidates.
- The glossary exposes useful aliases, code identifiers, or translated terms.
- Several EPICs look plausible and need a quick term cross-check.
- The first selected EPIC does not contain the expected document types.

Example:

```bash
epics search --project <project> --terms "campaign,exclusion,group" --json
```

Treat the result as a hint. If `epics search` disagrees with the catalog, inspect both candidates instead of trusting the score.

### 6. Traverse The EPIC Graph

For each candidate EPIC:

```bash
epics show --project <project> --epic <epic-id> --include-docs --json
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

```bash
docs show --project <project> --document <doc-id> --json
docs related --project <project> --document <doc-id> --json
```

Expected paths:

```text
UCL item -> UCS document
UCS -> BR / DD / design / source technical docs
BR -> DD / source technical docs
DD -> model/table/field evidence
api_spec or screen_spec -> code node/file location
```

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
- target results from `docs targets list`

`nodeId` is graph identity. `filePath` and line numbers are what you use when source inspection is needed.

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

## Answer Contract

When answering:

- State the normalized terms used.
- Cite document ids, document types, and target file paths when available.
- Separate direct evidence from inference.
- Mention stale/freshness status for stale or orphaned evidence.
- If evidence is weak, say which command or regeneration step should run next.

Keep the final answer concise unless the user asks for a full trace.

## Fallback Inventory

Use `docs list` only when the EPIC index is missing, you need a type-specific audit, or you are debugging generated inventory:

```bash
docs list --project <project> --type br --track business --compact --json
docs list --project <project> --type api_spec --track technical --compact --json
```

## Stop Conditions

- The project has no glossary (`docs list ... --type glossary` returns nothing) AND `epics list` returns no epics: stop retrieval and report that docs/EPICs have not been generated for this project — route to the generation skills instead of answering from guesses.
- Two full graph walks (catalog -> `epics show` -> `docs show`/`docs related`) surface no evidence for a subquestion: answer "no evidence found", listing the commands tried — do not fabricate an answer and do not keep widening the search indefinitely.
- Every candidate document reports `freshness.validity === "orphaned"`: stop treating their content as evidence; report that the documents no longer map to analyzed sources and recommend regeneration before answering.
