---
name: platty-mcp-memory
description: Use when a user explicitly asks to read, record, correct, update, or delete Platty memories or glossary aliases through configured Platty MCP tools.
---

# Platty MCP Memory

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Manage Platty memory overlays through configured MCP tools only. Memory covers
why, corrections, constraints, context, and human-confirmed glossary aliases.
It does not edit generated SOT, specs, documents, source code, or local files.

## Architecture Boundary

`using-platty-mcp` owns transport, capability, and project routing.
`platty-mcp-retrieval` owns read-only evidence gathering. This skill owns
explicit memory lifecycle actions through `memory_list`, `memory_get`,
`memory_add`, `memory_update`, and `memory_delete`. This skill also owns the
EPIC-scoped glossary alias lifecycle through `glossary_alias_list`,
`glossary_alias_add`, and `glossary_alias_remove`.

Use local `platty:platty-memory` instead when the user is operating the local
Platty CLI workflow. Do not run local Platty CLI commands from this MCP route.

## When To Use

Use only when the user explicitly asks to remember, record, correct, update,
delete, remove, or inspect Platty memory, including a glossary alias, synonym,
domain name, or vocabulary mapping.

Use `platty-mcp-retrieval` when memory is only evidence for an answer. Retrieval
may read memory overlays, but it must not write them.

## Write Trigger

Write memory only after a clear memory intent such as "remember this",
"record this", "add this to memory", "correct this memory", "update this
memory", "delete this memory", or Korean equivalents such as "기억해줘",
"명시적으로 기억해줘", "메모리에 추가해줘", "메모리 수정해줘",
"용어집 alias로 기억해줘", or "이 표현을 이 용어의 별칭으로 추가해줘".

If a user provides new durable context without a clear write intent, do not
mutate. Finish the current answer, then ask one concise question such as
"메모리에 추가할까요?" and wait for confirmation.

## Operating Flow

1. Run `using-platty-mcp` capability gate.
2. Select the lifecycle and confirm only its required tools:
   - normal memory -> `memory_list/get/add/update/delete` as needed;
   - glossary alias -> `glossary_alias_list/add/remove` plus
     `glossary_translate` for verification.
3. Resolve project context. If no project is selected, use `project_list`.
4. For normal memory add/update/delete, use **Anchor Discovery** to identify the
   narrowest anchor with read-only MCP evidence before mutating:
   - project-wide background -> project overview document memory;
   - domain policy or why -> epic memory;
   - document correction/constraint -> document memory;
   - specific item correction -> document item memory.
5. For project-wide background, call `project_overview_get`, use
   `overview.id` as `documentId`, and treat `project_overview_get.overview`
   as the attached read surface. There is no project-only memory anchor in the
   MCP write contract. If `project_overview_get.overview` is null, stop and
   ask for an epic/document/item anchor or report that project-wide memory
   cannot be written from MCP.
6. For normal memory, run `memory_list` on the selected anchor before
   add/update/delete. For an item anchor, list by its parent `documentId` and
   select returned memories whose anchor matches the exact `itemType` and
   `itemKey`; `memory_list` has no item filter inputs.
7. Choose the normal-memory action:
   - new knowledge -> `memory_add`;
   - same topic already exists -> `memory_update`;
   - memory is wrong or obsolete -> `memory_delete`.
8. For a glossary alias request, follow **Glossary Alias Lifecycle** below. Do
   not encode an alias with generic `memory_add`.
9. Verify normal memory with `memory_get` or `memory_list`; verify aliases with
   both `glossary_alias_list` and `glossary_translate`.
10. Report the memory id, anchor, kind, revision, and any returned SOT projection
   or export metadata.

Completion criterion: the final answer names the action taken, the exact memory
id, the anchor used, the verification read, and any remaining user decision.
For aliases it also names the raw term, canonical term, EPIC, and translation
verification result.

## Anchor Discovery

Locate the subject before writing; do not use the first search hit. Retrieval
finds the anchor, while the user's explicit statement supplies the memory
knowledge. Absence from generated SOT or source does not invalidate that human
knowledge, but a conflict must be reported rather than silently resolved.

| User knowledge | Preferred anchor | Discovery route |
| --- | --- | --- |
| Capability-wide product reason or policy background | EPIC | `epic_list/get`; use document retrieval only to disambiguate the feature |
| One business rule, use case, or design flow | Exact BR/UCL/DESIGN item when present; otherwise its document | `epic_get.documentRefs` -> `document_get` -> `document_item_get`; use `document_search` only when the ID is unknown |
| Table or field meaning, history, deprecation, or constraint | Exact `data_dictionary` `dd_field` item; otherwise the matching DD document | `document_list(documentType=data_dictionary)` plus `document_search` -> exact item reads |
| API implementation knowledge, retirement, or usage constraint | Exact `api_spec` | `spec_search` -> select `specKind=api_spec` -> `spec_get`; use `spec_document_resolve` only to recover business context |
| Screen, event, or schedule implementation knowledge | Exact matching Spec | `spec_search` -> select the matching `specKind` -> `spec_get`; use `spec_document_resolve` only to recover business context |
| Project-wide background with no narrower owner | Project overview document | `project_overview_get`; use `overview.id` as `documentId` |

For a table or field memory, first resolve one exact parent `data_dictionary`
document. Use an item anchor only when one exact `dd_field` is confirmed. If no
field item exists or multiple field items remain plausible inside that one
parent, do not block and do not guess: attach the memory to the parent DD
document without `itemType` or `itemKey`. Ask only when the parent DD document
itself remains ambiguous. Keep the exact table/field name in the memory content
so the broader fallback remains searchable and reviewable.

Source-near specs are persisted documents: pass the selected `spec.id` as
`documentId` to `memory_list` and `memory_add`. For an item anchor, copy the
exact returned parent `documentId`, `itemType`, and stable key (`itemKey` in the
memory tool). Never invent item types or keys from titles.

To inspect existing item memories, call
`memory_list(projectId, documentId, memoryMode=summary|full)` and filter the
returned memory anchors by that exact `itemType` and `itemKey`. Do not pass
unsupported item filters to `memory_list`. Use `memory_get` for exact bodies.

When multiple live parent documents, specs, EPICs, or unrelated targets remain,
name them and ask one question. The DD field fallback above is the exception:
multiple plausible field items under one exact DD parent use the parent document
anchor. When one exact anchor remains, inspect existing memories before adding
or updating.

Choose the kind from the user's intent:

- `why`: historical or current rationale for a capability, rule, or design;
- `correction`: generated/current understanding is wrong, including a
  user-confirmed “no longer used” statement;
- `constraint`: new work or operation must not use a surface even if it still
  exists;
- `context`: useful background that is neither a correction nor a constraint.

Preserve the user's scope. For “이제 안 써”, record the exact named API or field
and the user's wording; do not silently strengthen it into “deleted”, “no
callers”, or “safe to remove”. Include the recorded date when time sensitivity
matters. Ask only when the target or intended scope remains materially
ambiguous.

## Read Visibility Contract

Memory writes are useful only if retrieval consumes them. On every selected
overview, EPIC, document, item, or spec surface, inspect attached memory summary
cards before discarding the surface or answering. Call `memory_get` for every
relevant card before the final answer.

For any table or field route, always read the parent `data_dictionary` document
and inspect its document-level memories before item-level conclusions. If
`document_get` does not return attached memory cards, call
`memory_list(projectId, documentId)` and then `memory_get` for relevant ids.
This rule applies even when the later query resolves one exact `dd_field`, so a
parent fallback such as “this field is no longer used” cannot be skipped.

This is scoped enforcement, not a global memory dump: read memories attached to
the selected evidence surfaces, not every memory in the project.

## Glossary Alias Lifecycle

Glossary aliases are confirmed memory overlays for vocabulary routing. They are
EPIC-scoped and appear separately from generated aliases as `memoryAliases`.
They normalize search language; they do not prove product behavior.

For add:

1. Require explicit write intent plus exact `projectId`, `epicId`, raw `term`,
   and `canonicalTerm`. Resolve EPIC candidates with retrieval evidence; never
   guess when more than one remains.
2. Use `glossary_translate` or `glossary_list` to discover existing vocabulary
   and conflicts. An exact user-supplied `canonicalTerm` may remain a
   memory-only canonical term when generated glossary has no match; a blank
   lookup is not permission to invent a different term or reject the explicit
   mapping. Ask only when the canonical term was not supplied or conflicts.
3. Call `glossary_alias_list(projectId, epicId)` and avoid duplicate active
   mappings. A raw term mapped to another canonical term requires clarification.
4. Call `glossary_alias_add(projectId, epicId, term, canonicalTerm, actor?)`.
5. Verify one active mapping through `glossary_alias_list`, then call
   `glossary_translate(projectId, text=term)` and confirm it routes to the
   intended canonical term.

For remove, list the exact EPIC alias first, require a reason, call
`glossary_alias_remove(projectId, epicId, term, reason, actor?)`, then verify it
is absent from the active list. For a mapping correction, remove the exact old
alias with a reason and add the confirmed replacement; do not use
`memory_update`, because it does not update glossary-alias provenance.

## Tool Contract

| Intent | Tool | Required inputs |
| --- | --- | --- |
| List memory overlays | `memory_list` | `projectId`; optional `epicId`, `documentId`, `level`, `includeDeleted`, `memoryMode=summary|full` |
| Read one memory | `memory_get` | `projectId`, `memoryId` |
| Add memory | `memory_add` | `projectId`, `content`; optional `epicId`, `documentId`, `itemType`, `itemKey`, `memoryKind`, `actor`, `confidence` |
| Update memory | `memory_update` | `projectId`, `memoryId`, `content`, `reason`; optional `actor` |
| Delete memory | `memory_delete` | `projectId`, `memoryId`, `reason`; optional `actor` |
| List glossary aliases | `glossary_alias_list` | `projectId`; optional `epicId`, `includeDeleted` |
| Add glossary alias | `glossary_alias_add` | `projectId`, `epicId`, `term`, `canonicalTerm`; optional `actor` |
| Remove glossary alias | `glossary_alias_remove` | `projectId`, `epicId`, `term`, `reason`; optional `actor` |

`memoryKind` is `context`, `correction`, `constraint`, or `why`.
`memory_list` defaults to summary cards; use `memory_get` or
`memoryMode=full` only when exact memory bodies are required.

## Mutation Gate

Before calling `memory_add`, `memory_update`, or `memory_delete`, confirm:

- the user explicitly requested a memory write, correction, update, or removal;
- the project is resolved;
- the intended anchor is known;
- project-wide memory, when requested, has been resolved to the project overview
  document id;
- update/delete has a specific `memoryId`;
- update/delete has a reason suitable for audit history.

If any condition is missing, ask one concise question with the recommended
default. Do not guess anchors or memory ids.

Before `glossary_alias_add/remove`, confirm explicit alias mutation intent, the
exact EPIC, raw term, canonical term for add, reason for remove, and the current
alias list. An alias cannot use a project-only, document, or item anchor.

## Evidence Rules

- Memory is not generated SOT and not source proof.
- Memory may override answer confidence as a correction, constraint, why, or
  context overlay.
- Exact product or implementation claims still require retrieval/spec/source
  evidence from `platty-mcp-retrieval`.
- A memory write records user/agent knowledge; it does not regenerate documents.
- A glossary alias is a confirmed vocabulary-routing overlay, not canonical
  generated glossary content or evidence that the mapped behavior exists.
- Keep generated aliases and `memoryAliases` distinct in reads and reports.

## Answer Contract

For reads:

```text
Memory read
- Project:
- Filter:
- Memories found:
- Relevant memory ids:
- Boundary:
```

For glossary aliases:

```text
Glossary alias updated
- Action:
- Project / EPIC:
- Raw term -> canonical term:
- Memory id:
- Verified by: glossary_alias_list + glossary_translate
- Projection/export metadata:
- Remaining decision:
```

For mutations:

```text
Memory updated
- Action:
- Memory id:
- Anchor:
- Kind:
- Revision:
- Verified by:
- Projection/export metadata:
- Remaining decision:
```

## Stop Conditions

- MCP tools are not configured.
- Required memory tools are missing.
- The requested glossary alias lifecycle tool is missing.
- The user asks this MCP route to run local CLI, read local files, sync,
  generate docs, export files manually, or edit generated SOT.
- The requested mutation lacks a project, anchor, memory id, or reason and the
  missing value cannot be inferred from MCP evidence.
- The anchor is ambiguous across multiple epics/documents/items.
- The alias EPIC, raw term, canonical term, duplicate/conflict decision, or
  removal reason is unresolved.
- The content contains secrets, credentials, tokens, or PII.

## Common Mistakes

| Mistake | Required behavior |
| --- | --- |
| Writing memory during a normal retrieval answer | Use `platty-mcp-retrieval` and report that writeback needs explicit user intent. |
| Saving a useful new fact without permission | Ask "메모리에 추가할까요?" and wait for confirmation. |
| Treating memory as source proof | Separate memory overlay from SOT/spec/source evidence. |
| Updating by topic without reading existing memories | Run `memory_list`, then update the matching `memoryId` or ask. |
| Deleting and adding to "update" | Use `memory_update` so revision history survives. |
| Guessing an anchor | Ask one question, except project-wide memory must use `project_overview_get.overview.id`. |
| Passing only `projectId` to `memory_add` for global context | Use `project_overview_get`, then pass `documentId: overview.id`. |
| Saving a glossary alias with `memory_add` | Use `glossary_alias_list/add/remove`; specialized provenance drives vocabulary routing. |
| Treating a memory alias as generated glossary truth | Report it as a confirmed human vocabulary overlay and keep `memoryAliases` separate. |
| Adding an alias without an EPIC | Stop and resolve one exact EPIC; glossary aliases are not project-wide. |
| Correcting an alias with `memory_update` | Remove the exact old mapping with a reason, then add and verify the replacement. |

## Verification

Use `references/pressure-scenarios.md` when testing this skill.
