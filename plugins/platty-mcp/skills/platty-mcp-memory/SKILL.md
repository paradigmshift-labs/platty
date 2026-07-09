---
name: platty-mcp-memory
description: Use when a user explicitly asks to read, record, correct, update, or delete Platty memories through configured Platty MCP tools.
---

# Platty MCP Memory

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Manage Platty memory overlays through configured MCP tools only. Memory is a
human/agent knowledge overlay for why, corrections, constraints, and context; it
does not edit generated SOT, specs, documents, source code, or local files.

## Architecture Boundary

`using-platty-mcp` owns transport, capability, and project routing.
`platty-mcp-retrieval` owns read-only evidence gathering. This skill owns
explicit memory lifecycle actions through `memory_list`, `memory_get`,
`memory_add`, `memory_update`, and `memory_delete`.

Use local `platty:platty-memory` instead when the user is operating the local
Platty CLI workflow. Do not run local Platty CLI commands from this MCP route.

## When To Use

Use only when the user explicitly asks to remember, record, correct, update,
delete, remove, or inspect Platty memory.

Use `platty-mcp-retrieval` when memory is only evidence for an answer. Retrieval
may read memory overlays, but it must not write them.

## Write Trigger

Write memory only after a clear memory intent such as "remember this",
"record this", "add this to memory", "correct this memory", "update this
memory", "delete this memory", or Korean equivalents such as "기억해줘",
"명시적으로 기억해줘", "메모리에 추가해줘", "메모리 수정해줘".

If a user provides new durable context without a clear write intent, do not
mutate. Finish the current answer, then ask one concise question such as
"메모리에 추가할까요?" and wait for confirmation.

## Operating Flow

1. Run `using-platty-mcp` capability gate.
2. Confirm `memory_list` and `memory_get` for reads; confirm mutation tools only
   for explicit add/update/delete requests.
3. Resolve project context. If no project is selected, use `project_list`.
4. For add/update/delete, identify the narrowest anchor with read-only MCP
   evidence before mutating:
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
6. Run `memory_list` on the selected anchor before add/update/delete.
7. Choose the action:
   - new knowledge -> `memory_add`;
   - same topic already exists -> `memory_update`;
   - memory is wrong or obsolete -> `memory_delete`.
8. Verify the result with `memory_get` or `memory_list`.
9. Report the memory id, anchor, kind, revision, and any returned SOT projection
   or export metadata.

Completion criterion: the final answer names the action taken, the exact memory
id, the anchor used, the verification read, and any remaining user decision.

## Tool Contract

| Intent | Tool | Required inputs |
| --- | --- | --- |
| List memory overlays | `memory_list` | `projectId`; optional `epicId`, `documentId`, `level`, `includeDeleted` |
| Read one memory | `memory_get` | `projectId`, `memoryId` |
| Add memory | `memory_add` | `projectId`, `content`; optional `epicId`, `documentId`, `itemType`, `itemKey`, `memoryKind`, `actor`, `confidence` |
| Update memory | `memory_update` | `projectId`, `memoryId`, `content`, `reason`; optional `actor` |
| Delete memory | `memory_delete` | `projectId`, `memoryId`, `reason`; optional `actor` |

`memoryKind` is `context`, `correction`, `constraint`, or `why`.

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

## Evidence Rules

- Memory is not generated SOT and not source proof.
- Memory may override answer confidence as a correction, constraint, why, or
  context overlay.
- Exact product or implementation claims still require retrieval/spec/source
  evidence from `platty-mcp-retrieval`.
- A memory write records user/agent knowledge; it does not regenerate documents.

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
- The user asks this MCP route to run local CLI, read local files, sync,
  generate docs, export files manually, or edit generated SOT.
- The requested mutation lacks a project, anchor, memory id, or reason and the
  missing value cannot be inferred from MCP evidence.
- The anchor is ambiguous across multiple epics/documents/items.
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

## Verification

Use `references/pressure-scenarios.md` when testing this skill.
