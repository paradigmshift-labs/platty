---
name: platty-retrieval
description: Use when answering product, business, design, or development questions from Platty-generated docs using Platty CLI combinations; plan retrieval first, inspect document indexes before full content, refine multilingual terminology through glossaries, search docs and targets, and report stale document freshness.
---

# Platty Retrieval

Use this skill when a user asks a question that should be answered from Platty-generated project documents or static-analysis targets.

Do not start with one broad search and stop. Treat retrieval as a short investigation loop:

```text
question -> retrieval plan -> index/list -> glossary detail -> refined queries -> docs/targets search -> evidence synthesis
```

## Required Inputs

Resolve these before running commands:

- Project selector: `--project <project-id-or-name>`.
- User question.
- Question type: `business`, `development`, `design`, or `mixed`.

If the project is unknown, run `platty project list --json` or ask for the project.

## Core CLI

Use the local CLI available in the repo, for example:

```bash
node packages/cli/dist/main.js <command> --json
```

Prefer these commands:

```bash
docs list --project <project> --type glossary --track business --compact --json
business-docs document show --project <project> --document <doc-id> --json
docs search --project <project> "<refined query>" --json
docs targets list --project <project> --search "<term>" --json
docs targets list --project <project> --kind api --method POST --search "<term>" --json
```

Useful `docs list` filters:

- `--type glossary|br|data_dictionary|design|ucl|ucs|api_spec|screen_spec`
- `--track business|technical`
- `--scope project|epic|api|screen`
- `--validity fresh|stale|orphaned`
- `--compact`
- `--limit <n>`

## Freshness Rule

`docs list` and `docs search` candidates may include:

```text
freshness.validity
freshness.isStale
freshness.sourceCommit
freshness.staticSnapshotId
freshness.documentSourceHash
freshness.updatedAt
```

`business-docs document show` returns the detailed document with:

```text
data.freshness.state
data.freshness.reason
```

If `freshness.isStale === true`, `freshness.validity !== "fresh"`, or `data.freshness.state !== "fresh"`:

- You may use the result as a clue.
- State that the document may not reflect the latest analyzed source.
- Recommend running the relevant sync/regeneration flow before treating it as authoritative.

Do not hide stale evidence.

## Retrieval Workflow

### 1. Plan Branches

Rewrite the user question into 2-5 retrieval branches.

Examples:

- Business branch: terms, rules, use cases, data dictionary.
- Development branch: routes, screens, APIs, handler files.
- Design branch: system design, data concepts, rules, target entrypoints.
- Multilingual branch: Korean, English, Japanese, code identifiers, route paths.

### 2. Inspect Indexes First

Start with compact lists. This is the equivalent of reading filenames and a table of contents before opening files.

For business/design questions:

```bash
docs list --project <project> --type glossary --track business --compact --json
docs list --project <project> --type br --track business --compact --json
docs list --project <project> --type ucl --track business --compact --json
docs list --project <project> --type design --track business --compact --json
```

For development questions:

```bash
docs list --project <project> --type api_spec --track technical --compact --json
docs list --project <project> --type screen_spec --track technical --compact --json
```

Do not open every full document. Pick likely candidates from titles, summaries, type, scope, and freshness.

### 3. Use Project Glossary As The Language Bridge

Prefer the project glossary first when it exists:

```bash
docs list --project <project> --type glossary --track business --scope project --compact --json
business-docs document show --project <project> --document <project-glossary-id> --json
```

If the project glossary is missing or too broad, inspect relevant epic glossaries from the compact glossary list.

Extract:

- canonical term
- aliases
- Korean/English/Japanese equivalents
- code names, route names, API names
- related use cases or rules

Then rewrite the search query.

### 4. Search With Refined Queries

Run multiple narrow searches, not one vague search:

```bash
docs search --project <project> "<canonical business term>" --json
docs search --project <project> "<English/code alias>" --json
docs targets list --project <project> --search "<route-or-code-term>" --json
```

If a query has multiple tokens and returns nothing, split it into atomic terms and search separately.

### 5. Choose Details By Question Type

Business answer priority:

```text
glossary -> br -> ucl -> ucs -> data_dictionary -> design
```

Use UCL as the use-case table of contents. Open UCS only for the specific use case needed.

Development answer priority:

```text
targets list -> api_spec/screen_spec -> design/data_dictionary -> source file if needed
```

Use targets for entrypoint, route, handler, and file path evidence.

Design answer priority:

```text
glossary -> design -> data_dictionary -> br -> targets -> api_spec/screen_spec
```

Mixed questions should run the relevant branches and merge evidence.

## Answer Contract

When answering:

- Say which terms were used to refine the question.
- Cite document ids, document types, and target file paths when available.
- Separate evidence from inference.
- Mention stale/freshness status for any stale result.
- If evidence is weak, say what command should be run next.

Keep the final answer concise unless the user asks for a full trace.
