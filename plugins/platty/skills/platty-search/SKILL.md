---
name: platty-search
description: Use when developers ask about screens, APIs, services, SQL, tables, columns, batch jobs, or the impact of changing code or data in a project connected through Platty.
---

# Platty Search

Answer from the authorized project's source evidence. Accuracy takes priority
over a quick answer. Read [project notes](references/project-notes.md) first.

## Connection and preparation

Use only the configured `platty` MCP connection for project retrieval. Verify
its project identity; the connection name alone does not prove which server
it serves. Inspect live tool schemas; runtime prefixes can vary. Do not run the
Platty CLI, read local
application files, change data, or invoke the application APIs being studied.

Once per session, call `context_status`, `workspace_repo_list`, and
`code_search_guide_get` on this connection. Omit `projectId` to use its default;
check the echoed project against the expected `petshop-full` (use `project_get`
with `view: summary` for its name if status returns only its ID). If it differs,
report the mismatch and clarify the intended project before reading its content.
Map repository names to the returned `repoId` values.

If a tool is missing or a guide is unavailable, follow the explicit capability
branches in the project notes. Continue supported retrieval; record what cannot
be verified. Retry neither an absent capability nor an unavailable import as if
it were a transient failure. Use repository-relative paths exactly as returned.

## Retrieval workflow

1. Resolve the question's anchor using [clarification](references/clarify.md).
   Different business actions require an explicit target selection.
2. Read the anchor and direct execution path using
   [exploration](references/explore.md): caller, complete root service method,
   subordinate calls, and complete relevant SQL. Keep a call inventory.
3. For every written table, enumerate other writers and the callers, guards,
   alternatives, and downstream effects. Keep a status and source range for
   every candidate. Revisit searches when new tables or identifiers appear.
4. For a proposed change, use the [impact flow](references/impact-flow.md) and
   [impact rules](references/impact.md). Do not implement the change.
5. Compose the two-layer [answer](references/answer-format.md), then apply
   [review](references/review.md). Use [design](references/design.md) only when
   the user explicitly requests an implementation design.

## Evidence and language

Answer in English by default, or in the language explicitly requested.
Preserve repository names, paths, identifiers, code values, and original UI
labels exactly. Label any English rendering of a Korean label as a translation.
Do not infer business meaning from an abbreviation.

`Confirmed` requires a direct source read supporting the exact claim and a
`repository/path:start-end` citation. Generated documents and search hits locate
evidence; they do not replace a source read. Separate document-only statements,
inferences, unread candidates, and information unavailable from code.

Empty or truncated results do not establish absence. Follow cursors, inspect
repository completion, and bound every negative claim to the scope searched.
Production values, permissions, scheduler state, and actual execution outcomes
need their own authorized evidence. Never present this source snapshot as live
production data. Keep credentials out of prompts, examples, and answers.
