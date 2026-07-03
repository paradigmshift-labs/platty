---
name: platty-sdd-design
description: Use when creating technical SDD design or implementation-task documents from approved SDD request and user-story files using Platty SOT, graph traces, generated specs, and source code.
---

# Platty SDD Design

Use this skill to create the technical half of an SDD workflow: `design.md` and `tasks.md` or `tasks-<area>.md`.

This skill may author files only inside the selected SDD output directory. It must never edit regenerated SOT markdown under `~/.platty/sot/<projectId>/`.

## Required Inputs

- Platty project selector.
- SDD folder containing `request.md` and `stories.md`, normally under
  `~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/`.
- Optional target repos, APIs, screens, tables, EPICs, or business terms.

## Required Gates

1. Resolve the project id.
2. Re-anchor the SDD folder against current SOT:
   - `projectId` matches;
   - referenced SOT paths still exist;
   - `sourceCommit` and `sotExportedAt` are compared with current SOT README.
3. Hard-stop unless `request.md` and `stories.md` are `approved`, unless the user explicitly requests a draft-only design from unapproved inputs.
4. Declare evidence boundary before design claims.
5. Use source code or graph/code evidence before asserting implementation details.

Use the Platty CLI convention from `using-platty`. Inside this repository, `AGENTS.md` overrides public plugin examples: run the local build with `node packages/cli/dist/main.js <command> --json`.

## Evidence Flow

1. Read `request.md` and `stories.md`.
2. Extract actors, rules, scenarios, data concepts, screens, APIs, and areas.
3. Search `catalog/epics.md`; use `sot glossary search --project <project> --query "<raw term>" --json` for raw terms, aliases, or translated concepts.
4. Read relevant business docs:
   - `br.md`
   - `data_dictionary.md`
   - `design.md`
   - `usecases/ucl.md`
   - `usecases/ucs.md`
5. Read relevant technical specs from catalog paths:
   - `specs/api/`
   - `specs/screen/`
   - `specs/event/`
   - `specs/schedule/`
6. Trace only targeted anchors:
   - prefer spec frontmatter `serviceMapNodes[]`;
   - use catalog `traceId` when present;
   - if `traceId` is empty or trace has no confirmed edge, downgrade to risk and use `code search` or direct source reads.
7. Read registered repository files from `repo list` paths for complex flows, DTOs, transactions, UI state, error handling, or tests.

Do not report graph trace as exhaustive when it returns candidates, omitted edge classes, truncation, or no confirmed edge.

## Authoring

Read reference templates only when writing files:

- `references/design-template.md`
- `references/tasks-template.md`
- `references/design-review-rubric.md`

`design.md` must remain `draft` until user approval. `tasks.md` should be generated only after design approval unless the user explicitly asks for draft tasks.

## Design Contents

Include:

- input spec summary;
- evidence boundary and freshness;
- as-is architecture with file paths;
- proposed architecture;
- API/contract changes;
- screen or UX changes;
- data model and migration;
- business logic flow;
- error handling;
- state transitions when relevant;
- edge cases;
- observability, release, rollback;
- test strategy;
- area change summary;
- evidence appendix.

Unsupported implementation claims must be marked as assumptions or risks.

## Stop Conditions

- `request.md` or `stories.md` is not approved and the user did not explicitly request draft-only design.
- SOT documents referenced by the spec are stale or missing and the user has not accepted stale-evidence risk.
- A critical implementation path has only graph candidates and no confirmed edge or source snippet.
- The design requires a shared engine contract, persisted schema, public CLI behavior, or common resolver semantic change without explicit user approval.
- No owning repository or implementation boundary can be identified after two discovery passes.

## Red Flags

| Temptation | Required behavior |
| --- | --- |
| "Business docs mention it, so implementation is obvious." | Trace or read code before asserting implementation details. |
| "No graph edge means no impact." | Say there is no confirmed graph evidence; search code or list risk. |
| "The request is approved, so tasks are known." | Validate source/design before task generation. |
| "Generated SOT has a typo." | Do not edit SOT; suggest memory or regeneration. |
| "Tasks can be generic." | Map tasks and tests to request rules, stories, and design edge cases. |
