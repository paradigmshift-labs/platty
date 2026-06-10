# Platty Skill CLI Retrieval Design

## Goal

Build a retrieval surface where a coding agent answers user questions by combining a repo-local skill with deterministic Platty CLI primitives.

The CLI must not interpret natural language, call an LLM, or spawn an internal agent for retrieval. Natural-language understanding, clarification, question decomposition, and final synthesis belong to the external agent that reads the skill. The CLI exposes project glossary, EPIC index, document graph, technical targets, code nodes, model/table/field evidence, and freshness metadata.

The intended retrieval shape is:

```text
user question
-> project glossary term alignment
-> optional user clarification
-> subquestion decomposition
-> EPIC candidate selection
-> EPIC-scoped document graph traversal
-> DD model/table/field traversal
-> API/screen/event/source code traversal
-> answer synthesis with evidence and freshness
```

## Non-Goals

- Do not add `docs ask`, `docs investigate`, or any command that pretends to understand a natural-language question.
- Do not run Codex, Claude, or another headless agent inside the CLI.
- Do not make `docs list` the primary retrieval entry point.
- Do not return full source files from retrieval commands. Return code node identity and exact file locations so the external agent can open source when needed.
- Do not create broad new graph tables unless existing link tables cannot represent the edge.

## Design Position

Platty retrieval is an inverted-index-like graph traversal workflow, not a single full-text search call.

The project glossary is the language bridge. It maps user language to canonical business terms, aliases, multilingual terms, route/API/code identifiers, and related EPIC hints.

The EPIC list is the top-level retrieval index. An agent should first select several likely EPIC candidates, then traverse documents under those EPICs instead of scanning all documents globally.

The document graph is the detailed retrieval index. Once an EPIC or document is selected, the agent follows explicit links from UCL to UCS, BR, DD, design, source technical specs, models, and code evidence.

## Current Base

The previous business document graph design already introduced the right lower-level primitives:

- `document_links`
- `document_items`
- `document_item_document_links`
- `document_item_item_links`
- `document_item_relation_links`
- `document_item_model_links`
- `epic_document_links`
- `models`

This design builds on that work and narrows the retrieval UX around a skill-driven flow.

## CLI Responsibility

### Glossary Access

Add or standardize a project glossary command:

```bash
platty docs glossary show --project <project> --scope project --json
```

If the command is implemented through existing document APIs, the output shape must still be glossary-specific and stable.

Required output:

- project id
- glossary document id
- freshness
- canonical terms
- aliases
- multilingual equivalents when present
- code terms or route/API names when present
- related EPIC hints when present

The CLI does not decide which glossary terms answer the question. The external agent reads the glossary and performs the rewrite.

### EPIC Index

Add or standardize compact EPIC index commands:

```bash
platty epics list --project <project> --compact --json
platty epics search --project <project> --terms "<term1,term2,term3>" --json
```

`epics search` accepts already-normalized terms, not a natural-language question.

Required compact EPIC fields:

- `epicId`
- `stableKey`
- `title`
- `summary`
- canonical or generated search terms
- document counts by type
- representative source document ids
- freshness summary

The EPIC index is the default candidate-selection surface. `docs list` remains available for fallback, debugging, export checks, and type-specific inventory.

### EPIC Detail Graph

Add or standardize:

```bash
platty epics show --project <project> --epic <epic-id> --include-docs --json
platty epics related --project <project> --epic <epic-id> --json
```

Required output:

- EPIC identity and summary
- project and EPIC glossary documents
- UCL documents
- UCS documents
- BR documents
- DD documents
- system design documents
- source technical documents: `api_spec`, `screen_spec`, `event_spec`, `schedule_spec`
- freshness for every returned document
- graph edge summaries between the above documents and items

Documents must be grouped by type so an agent can choose a retrieval path without reading every document body.

### Document Detail And Traversal

Keep and harden:

```bash
platty docs show --project <project> --document <document-id> --json
platty docs related --project <project> --document <document-id> --json
```

`docs show` returns one document, active items, related links, model links, code links, source documents, and freshness.

`docs related` returns traversal edges grouped by direction and link type.

By default both commands must exclude deleted/orphaned targets and clearly mark stale targets. A flag may allow including stale/orphaned targets for diagnostics.

### Technical Targets And Code Evidence

Keep and harden:

```bash
platty docs targets list --project <project> --search "<term>" --json
```

For `api_spec`, `screen_spec`, and other technical documents, retrieval output must include code evidence when available:

```json
{
  "code": {
    "primaryNode": {
      "nodeId": "node:controller:createStoreCuration",
      "kind": "method",
      "symbol": "createStoreCuration",
      "filePath": "src/admin/store-curation/store-curation.controller.ts",
      "startLine": 42,
      "endLine": 87
    },
    "relatedNodes": [
      {
        "nodeId": "node:service:createStoreCuration",
        "role": "service",
        "symbol": "createStoreCuration",
        "filePath": "src/admin/store-curation/store-curation.service.ts",
        "startLine": 10,
        "endLine": 76
      }
    ]
  }
}
```

`nodeId` is required for graph identity. `filePath` and line numbers are required for practical source inspection. If line numbers are unavailable, the command must return `filePath` plus a `missingLocationReason`.

### DD Model Evidence

DD output must expose model/table/field links in a retrieval-friendly form:

```json
{
  "itemId": "item:dd:feed",
  "title": "Feed",
  "storage": {
    "modelId": "repo:Feed",
    "modelName": "Feed",
    "tableName": "Feed"
  },
  "fields": [
    {
      "businessName": "Feed content",
      "columnName": "content",
      "meaning": "Stores the main body text or diary content used as engagement context.",
      "modelId": "repo:Feed"
    }
  ],
  "modelLinks": [
    {
      "linkType": "describes_field",
      "modelId": "repo:Feed",
      "fieldName": "content",
      "role": "primary"
    }
  ]
}
```

The DD item remains business-facing. Physical model/table/field data is attached as evidence, not used as the DD title unless the generated document itself chose that wording.

## Skill Responsibility

The repo-local `platty-retrieval` skill is the retrieval brain.

It must instruct agents to follow this workflow:

1. Determine question type: `business`, `development`, `design`, `data`, or `mixed`.
2. Read the project glossary first.
3. Rewrite the user question into canonical business terms, aliases, multilingual equivalents, and code terms.
4. Ask the user a concise clarification question if the glossary leaves competing interpretations.
5. Split the request into 2-5 answerable subquestions.
6. Use `epics list` or `epics search --terms` to choose several candidate EPICs.
7. Use `epics show --include-docs` or `epics related` to inspect each candidate EPIC's document graph.
8. Traverse UCL to UCS for use-case detail.
9. Traverse UCS to BR, DD, design, and source technical specs.
10. Traverse DD to model/table/field evidence for data questions.
11. Traverse API/screen specs to code nodes and file locations for development questions.
12. Report freshness and stale/orphaned caveats.
13. Separate direct document evidence from inference in the final answer.

The skill must explicitly say not to start with one broad `docs search` and stop.

## Retrieval Paths

### Business Question

```text
glossary
-> EPIC candidates
-> UCL
-> UCS
-> BR
-> DD
-> design
-> source api_spec/screen_spec/event_spec when needed
```

### Data Question

```text
glossary
-> EPIC candidates
-> DD
-> model/table/field links
-> related BR/UCS
-> source api_spec
-> code node/file location when needed
```

### Development Question

```text
glossary
-> EPIC candidates when business scope matters
-> targets list
-> api_spec/screen_spec
-> code node/file location
-> related DD/BR/UCS for business meaning
```

### Design Question

```text
glossary
-> EPIC candidates
-> design
-> UCS
-> BR
-> DD
-> source api_spec/screen_spec
```

## Freshness Contract

Every retrieval output must include enough freshness metadata for the agent to tell the user when evidence may be outdated:

- `validity`
- `status`
- `isStale`
- `sourceCommit`
- `staticSnapshotId`
- `documentSourceHash`
- `updatedAt`

Default retrieval should prefer active/fresh documents. Stale results may still be returned as clues, but they must be marked so the agent can recommend sync or regeneration before treating them as authoritative.

## Command Relationship

`docs list` remains useful, but it is not the main retrieval path.

Use `docs list` for:

- debugging
- fallback when EPIC assignment is missing
- checking generated inventory
- type-specific audits
- export/report tooling

Do not instruct agents to begin normal question answering with global document lists.

## Testing Requirements

Minimum tests:

- `epics list --compact` returns EPICs with document counts and freshness.
- `epics search --terms` ranks candidate EPICs without accepting a natural-language question.
- `epics show --include-docs` groups connected documents by type.
- `docs show` returns DD model/table/field links for DD documents.
- `docs show` returns `code.primaryNode` and file location for API specs when code evidence exists.
- `docs related` exposes UCL item to UCS document traversal.
- `docs related` exposes business document to source technical document traversal.
- stale/orphaned targets are excluded or clearly marked according to command defaults.
- `platty-retrieval` skill documents glossary-first and EPIC-first retrieval.

Real-project smoke tests should use generated `heroines_back` or `heroines_web` documents and verify at least these question types:

- business rule question
- data/table question
- development/API-to-code question

## Rollout

1. Audit current command output shapes.
2. Add missing EPIC index/detail commands or stabilize existing ones.
3. Add API/spec-to-code evidence to document detail output.
4. Harden DD model/table/field output.
5. Rewrite `platty-retrieval` around glossary-first, EPIC-first graph traversal.
6. Validate with real generated documents.
7. Write an implementation plan before code changes.

## Completion Criteria

- No CLI command performs LLM-based natural-language interpretation.
- The skill contains the retrieval strategy.
- EPICs act as the top-level candidate index.
- UCL/UCS/BR/DD/design/source documents are traversable through explicit graph links.
- DD items expose model/table/field evidence.
- API/screen specs expose code nodes and file locations.
- Freshness is visible at each retrieval step.
