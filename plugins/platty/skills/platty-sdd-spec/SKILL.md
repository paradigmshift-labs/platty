---
name: platty-sdd-spec
description: Use when turning a rough product idea, feature request, PRD need, or requirements discussion into SDD request and user-story documents grounded in Platty SOT evidence.
---

# Platty SDD Spec

Use this skill to create the product half of an SDD workflow: planner-facing
`request.md` and `stories.md`, plus the supporting `impact.md` evidence dossier.

This skill is allowed to author files only inside the selected SDD output directory. It must never edit regenerated SOT markdown under `~/.platty/sot/<projectId>/`.

## Outputs

Default location:

```text
~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/
├── request.md
├── stories.md
└── impact.md
```

Do not write SDD documents to repository-local paths such as `docs/sdd/` or
`.platty/sdd/`. The Platty web dashboard treats the global Platty home as the
managed SDD source.

When this skill authors SDD product documents, write both `request.md` and
`stories.md` in the same SDD directory, and create or refresh `impact.md` there
as the SSOT and code-search dossier. Do not leave `stories.md` as a chat-only
gate or handoff note. If decisions are unresolved, keep both planning documents
in draft state and make those assumptions visible in `request.md` §7 and in
`stories.md`.

Reader boundary:

- `request.md` and `stories.md` are Korean-first, skimmable planning documents
  for planners, PMs, designers, and QA.
- `impact.md` owns detailed SOT paths, source commits, search terms, exact
  reads, candidate hits, coverage gaps, route audits, and next reads.
- Do not discard evidence when moving it out of `request.md`; preserve it in
  `impact.md` and keep a short status pointer in the request.

## Required Gates

1. Resolve a Platty project before project-scoped commands.
2. Locate `~/.platty/sot/<projectId>/`.
3. Read SOT `README.md` and `catalog/epics.md`; use `sot glossary search` for raw terms, aliases, or translated concepts before product claims.
4. Declare the evidence boundary: `business-docs`, `static-only`, `mixed`, or `stale`.
5. Ask SOT-informed questions before finalizing `request.md`.
6. Generate `stories.md` with `request.md` as a draft even when open questions remain. Approval gates control `approved` status and design readiness, not whether the stories file exists.
7. Set the output language before authoring. Use the language the user requested for the spec; if no language is explicitly requested, infer it from the user's latest idea/request and confirm only when mixed-language intent is ambiguous.
8. Create or refresh `impact.md` after investigation and before finalizing the
   planning documents.
9. Run the Self Review gate after all three drafts exist; persist detailed
   review evidence in `impact.md` and a concise status in `request.md`.

Use the Platty CLI convention from `using-platty`. Inside this repository, `AGENTS.md` overrides public plugin examples: run the local build with `node packages/cli/dist/main.js <command> --json`.

## Evidence Flow

1. Project and SOT state:
   - project list/use
   - repo list
   - SOT `README.md` freshness: `lastExportAt`, `sourceCommit`
2. Term bridge:
   - run `sot glossary search --project <project> --query "<raw term>" --json`
   - if a match has `codeTerm`, resolve it with `code search` before any graph trace
3. Product area:
   - read `catalog/epics.md`
   - read 1-3 relevant epic docs: `br.md`, `usecases/ucl.md`, `usecases/ucs.md` when present, `data_dictionary.md`, `design.md`
   - for `usecases/ucl.md`, read the Use Case Index first and then only the relevant use-case sections
4. Implementation hints only when needed:
   - catalog API/screen/table rows
   - graph trace for confirmed relationships
   - `code search` for source addresses when file/symbol identity is incomplete
   - bounded `readonly_workspace_shell` reads for exact source evidence

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
When unresolved items affect stories, write the stories from clearly named
recommended defaults or assumptions and include an assumptions/impact section in
`stories.md` so later edits know what must change.

## Output Language

Write user-facing `request.md`, `stories.md`, and `impact.md` content in the
requested language.

- If the user asks in Korean or requests Korean output, write titles, section prose, questions, rules, stories, scenarios, and validation notes in Korean.
- If the SOT is English but the requested language is Korean, translate product explanations while preserving source identifiers, API paths, model names, field names, statuses, and quoted evidence exactly.
- If the user requests English, write the documents in English even when the idea or glossary query includes Korean terms.
- Use the same language for SOT-informed questions, recommended defaults, open
  questions, assumptions, and all three SDD files.
- Record the chosen language in frontmatter as `outputLanguage`.

## Chat Response Contract

When you author or update `request.md`, `stories.md`, or `impact.md` during a
chat turn, the final chat response must show the planner-facing document content,
not only the file paths.

Do not answer with only file paths, a handoff summary, or "작성 완료" plus a
location. Include enough content for the user to review without opening the file.

Minimum final response when files are written:

- `request.md`: status, path, outputLanguage, evidence boundary, confirmed
  decisions, open questions, main request rules, and validation/release notes.
- `stories.md`: status, path, outputLanguage, user stories, acceptance
  scenarios, unresolved assumptions, and Self Review verdict.
- `impact.md`: path, investigation status, freshness, evidence boundary,
  coverage limits, and Self Review verdict. Do not paste its full dossier unless
  the user asks for the detailed evidence.

If a document is too long for chat, include its main sections and say which
sections were abbreviated. Always include all open questions and assumptions.

## Authoring

Read reference templates only when writing the files:

- `references/request-template.md`
- `references/stories-template.md`
- `references/impact-template.md`
- `references/spec-review-rubric.md`
- `references/pressure-scenarios.md` when testing or changing this skill

Authoring order:

1. Gather the required SOT and source evidence, then create or update
   `impact.md` with detailed evidence, freshness, limits, and next reads.
2. Create or update `request.md` with the planner-facing §0–§8 structure and a
   compact `impact.md` pointer after §8.
3. Create or update `stories.md` in the same directory from `request.md` §1 and
   §5.
4. When unresolved open questions remain, keep both planning documents as draft.
5. Keep `request.md` as `draft-with-open-questions` and `stories.md` as `draft`
   when unresolved open questions or assumptions remain.
6. Include all unresolved assumptions that affect story splitting in
   `stories.md`; do not silently close them.
7. Run `review -> revise -> review` against `references/spec-review-rubric.md`.
8. Compare the drafts with every user-supplied requirement source, not only the
   rules created in `request.md`.
9. Record requirement coverage, search-route audit, freshness, source evidence,
   and coverage limits in `impact.md`; keep only the outcome in the planning
   documents.
10. If blocking findings remain, set the Self Review verdict to `NEEDS_WORK`,
    keep both planning documents in draft state, and expose the findings to the user.
11. Persist and verify `request.md`, `stories.md`, and `impact.md` together.

## Self Review Gate

Self Review is an authoring quality gate, not an approval. It must not set either
planning document to `approved`; only explicit user approval may do that.

The review must check:

- every user-supplied input document, pasted requirement, and confirmed answer
  is represented or named as a coverage gap;
- SOT facts, user-requested changes, inferences, and recommended defaults are
  labeled separately;
- statuses, enums, thresholds, metrics, scope, and terminology agree across the
  input sources, `request.md`, and `stories.md`;
- rule-to-scenario coverage is not presented as total input-requirement
  coverage;
- `impact.md` records map-first evidence, exact reads, unread surfaces,
  freshness, coverage limits, and any retrieval audit failure.

Any missing required input, unresolved evidence conflict, unsupported numeric
target, or cross-document contradiction is blocking. Revise once and review the
revised pair; if it still fails, return `NEEDS_WORK` instead of claiming the
documents are ready.

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
| "I know the domain term." | Run `sot glossary search` first. |
| "The user wants speed, skip questions." | Draft with named assumptions and use `draft-with-open-questions`. |
| "Stories need approval first." | Approval controls `approved` status. Still create `stories.md` as `draft` beside `request.md` and preserve assumptions. |
| "Business docs are missing, so invent product intent from code." | Use static evidence only and state the boundary. |
| "A code term can go directly to graph trace." | Resolve code term with `code search` first when the file/symbol address is incomplete, then verify exact source with a bounded `readonly_workspace_shell` read. |
| "Fix the generated SOT markdown." | Never edit SOT projection; suggest memory or regeneration. |
| "The SOT is English, so the spec should be English." | Follow the requested language; keep only identifiers and evidence labels unchanged. |
