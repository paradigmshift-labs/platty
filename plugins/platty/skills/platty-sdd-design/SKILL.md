---
name: platty-sdd-design
description: Use when creating technical SDD design or implementation-task documents from approved SDD request and user-story files using Platty SOT, graph traces, generated specs, and source code.
---

# Platty SDD Design

Use this skill to create the technical half of an SDD workflow: developer-facing
`design.md` and evidence-linked `tasks.md` or `tasks-<area>.md`.

This skill may author files only inside the selected SDD output directory. It must never edit regenerated SOT markdown under `~/.platty/sot/<projectId>/`.

## Required Inputs

- Platty project selector.
- SDD folder containing `request.md`, `stories.md`, and `impact.md` when it has
  been created by the SDD spec workflow, normally under
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
6. Complete the Affected Code Path Gate and Convention Discovery Gate before
   finalizing an implementation-ready design.
7. Carry `outputLanguage` forward from `request.md`; translate developer-facing
   prose while preserving source identifiers, paths, APIs, types, and statuses.

Use the Platty CLI convention from `using-platty`. Inside this repository, `AGENTS.md` overrides public plugin examples: run the local build with `node packages/cli/dist/main.js <command> --json`.

## Evidence Flow

1. Read `request.md` and `stories.md`. Read `impact.md` when it exists; reuse
   its confirmed paths, freshness, limits, and next reads instead of recreating
   its detailed evidence matrix in the design.
2. Compare project, source-commit, freshness, and evidence-boundary metadata
   across the input files. A missing or stale impact dossier is a named design
   risk until the affected evidence is refreshed.
3. Extract actors, rules, scenarios, data concepts, screens, APIs, and areas.
4. Search `catalog/epics.md`; use `sot glossary search --project <project> --query "<raw term>" --json` for raw terms, aliases, or translated concepts.
5. Read relevant business docs:
   - `br.md`
   - `data_dictionary.md`
   - `design.md`
   - `usecases/ucl.md` (read the Use Case Index first, then relevant sections)
   - `usecases/ucs.md` when present
6. Read relevant technical specs from catalog paths:
   - `specs/api/`
   - `specs/screen/`
   - `specs/event/`
   - `specs/schedule/` when present
7. Trace only targeted anchors:
   - prefer spec frontmatter `serviceMapNodes[]`;
   - use catalog or `sot resolve` compact-row `traceId` when present;
   - read default compact `graph trace` output from `.data.confirmed`, `.data.candidates`, `.data.relationCandidates`, and `.data.flags`;
   - use `--detail full` only when raw hop/source-line metadata is required;
   - if `traceId` is absent or trace has no confirmed edge, downgrade to risk and use `code search` for incomplete addresses or bounded `readonly_workspace_shell` reads for exact source.
8. Read registered repository files with bounded `readonly_workspace_shell` commands for complex flows, DTOs, transactions, UI state, error handling, or tests.

Do not report graph trace as exhaustive when it returns candidates, omitted edge classes, truncation, or no confirmed edge.

## Affected Code Path Gate

Before writing a hard implementation claim, map and read the affected path from
entry point to side effect. Read the applicable caller, API/handler or job,
orchestration/domain code, persistence or external-service boundary, and nearby
tests. For UI work, include the screen/state boundary; for asynchronous work,
include the producer and consumer. Do not claim the entire repository was read:
the requirement is complete coverage of the affected path and explicit disclosure
of any remaining boundary.

If an address is incomplete, use `code search`; if it is a candidate, use a
bounded `readonly_workspace_shell` read before naming a file, method, contract,
transaction, state transition, or failure behavior as fact. Label every
implementation-sensitive statement as **확인됨**, **가정**, or **위험**.

## Convention Discovery Gate

Before proposing changes, read applicable repository instructions and at least
one neighboring implementation and test in the owning layer. Record the observed
module/file placement, naming and type/DTO style, validation and error handling,
transaction or external-call pattern, test placement/style, and formatting,
lint, or migration convention. Follow an observed convention unless the design
names an intentional deviation and its reason.

Do not infer a framework, ORM, vendor, or repository layout from another project.

## Authoring

Read reference templates only when writing files:

- `references/design-template.md`
- `references/tasks-template.md`
- `references/design-review-rubric.md`

`design.md` must remain `draft` until user approval. `tasks.md` should be generated only after design approval unless the user explicitly asks for draft tasks.

Use the requested output language consistently in `design.md` and `tasks.md`.
For Korean output, write headings, explanations, decisions, and task prose in
Korean while preserving code identifiers and quoted source evidence exactly.

## Design Contents

Use `design-template.md` in this reading order: implementation summary,
input/evidence boundary, as-is structure, to-be changes by responsibility,
contracts and data, key flow and failure paths, state/concurrency/edge cases,
observed code conventions, validation/release/rollback, area summary, and compact
evidence references. Keep detailed source/SOT matrices in `impact.md`.

### Mermaid Guidance

- Use a component or flow diagram when three or more components or repositories
  interact.
- Use a sequence diagram for cross-boundary calls, external services, async jobs,
  transactions, retries, or compensating actions.
- Use a state diagram only for a meaningful named lifecycle or transition rule.
- Use a flowchart for branch-heavy validation, authorization, partial failure,
  rollback, or retry behavior.
- Omit diagrams for a simple one-boundary CRUD change; use a short table or prose
  instead.

Every diagram must agree with the contracts, data, errors, and task plan, and
state its evidence or assumption boundary.

## Stop Conditions

- `request.md` or `stories.md` is not approved and the user did not explicitly request draft-only design.
- SOT documents referenced by the spec are stale or missing and the user has not accepted stale-evidence risk.
- A critical implementation path has only graph candidates and no confirmed edge or bounded source read.
- The affected code path or local conventions cannot be read and the user has not
  accepted a draft with explicit risks.
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
| "The nearby code is only an example." | Treat observed local conventions as the default unless a justified deviation is documented. |
| "A diagram makes the design clearer." | Add one only when it explains a real multi-component relationship, lifecycle, or complex branch. |
