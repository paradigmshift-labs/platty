---
name: platty-sdd-spec
description: Use when turning a rough product idea, feature request, PRD need, or requirements discussion into SDD request and user-story documents grounded in Platty SOT evidence.
---

# Platty SDD Spec

Use this skill to create the product half of an SDD workflow: `request.md` and `stories.md`.

This skill is allowed to author files only inside the selected SDD output directory. It must never edit regenerated SOT markdown under `~/.platty/sot/<projectId>/`.

## Outputs

Default location:

```text
docs/sdd/SPEC-<slug>-<YYYY-MM>/
├── request.md
└── stories.md
```

Use a private local draft path only when the user asks:

```text
.platty/sdd/SPEC-<slug>-<YYYY-MM>/
```

## Required Gates

1. Resolve a Platty project before project-scoped commands.
2. Locate `~/.platty/sot/<projectId>/`.
3. Read SOT `README.md`, `catalog/glossary.md`, and `catalog/epics.md` before product claims.
4. Declare the evidence boundary: `business-docs`, `static-only`, `mixed`, or `stale`.
5. Ask SOT-informed questions before finalizing `request.md`.
6. Do not generate `stories.md` until `request.md` is `approved`, unless the user explicitly accepts unresolved assumptions.

Use the Platty CLI convention from `using-platty`. Inside this repository, `AGENTS.md` overrides public plugin examples: run the local build with `node packages/cli/dist/main.js <command> --json`.

## Evidence Flow

1. Project and SOT state:
   - project list/use
   - repo list
   - SOT `README.md` freshness: `lastExportAt`, `sourceCommit`
2. Term bridge:
   - grep/read `catalog/glossary.md`
   - if a glossary row has `code_term`, resolve it with `code search` before any graph trace
3. Product area:
   - read `catalog/epics.md`
   - read 1-3 relevant epic docs: `glossary.md`, `br.md`, `usecases/ucl.md`, `usecases/ucs.md`, `data_dictionary.md`, `design.md`
4. Implementation hints only when needed:
   - catalog API/screen/table rows
   - graph trace for confirmed relationships
   - code search/snippet for source-grounded terms

Do not brute-force all `epics/` or `specs/`. Narrow through catalogs and frontmatter paths.

## Question Loop

Ask at most three questions at a time. Prefer one question if the answer changes later questions.

Every question should include:

- what SOT evidence suggests;
- why the answer matters;
- a recommended default;
- what the default would imply.

Question categories:

- scope: users, entry points, clients, repos;
- policy: eligibility, limits, permissions, approvals;
- journey: normal path, empty states, edge paths, rollback/retry;
- data: source of truth, fields, retention, migration;
- compatibility: existing BR/UC conflicts, deprecated flows;
- success: measurable validation and release criteria.

Confirmed answers go to `§6 Confirmed Decisions`. Unresolved items stay in `§7 Open Questions`.

## Authoring

Read reference templates only when writing the files:

- `references/request-template.md`
- `references/stories-template.md`
- `references/spec-review-rubric.md`

`request.md` status:

- `draft` while being filled;
- `draft-with-open-questions` when assumptions remain;
- `approved` only after explicit user approval.

`stories.md` status:

- `draft` while generated or under review;
- `approved` only after explicit user approval.

## Stop Conditions

- No project can be resolved.
- SOT projection is missing and the user does not want export/regeneration.
- Relevant business docs are stale or orphaned and the user has not accepted stale-evidence risk.
- Two glossary/catalog passes leave multiple candidate product areas tied.
- A requested rule conflicts with existing business rules and the user has not approved an override.
- The user asks to proceed to technical design before approval; route to `platty-sdd-design` only after approval or explicit draft override.

## Red Flags

| Temptation | Required behavior |
| --- | --- |
| "I know the domain term." | Search `catalog/glossary.md` first. |
| "The user wants speed, skip questions." | Draft with named assumptions and use `draft-with-open-questions`. |
| "Business docs are missing, so invent product intent from code." | Use static evidence only and state the boundary. |
| "A code term can go directly to graph trace." | Resolve code term with `code search` first. |
| "Fix the generated SOT markdown." | Never edit SOT projection; suggest memory or regeneration. |
