---
name: platty-mcp-sdd-design
description: Use when creating locally saved MCP-grounded SDD technical design and implementation-task drafts from existing request.md and stories.md.
---

# Platty MCP SDD Design

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Create MCP-grounded technical SDD drafts and persist them locally. This skill
uses `using-platty-mcp` for capability checks, `platty-mcp-retrieval` for
evidence, then writes `design.md` and, after the task gate, `tasks.md` under the
same SDD directory as the product spec.

## Required Sub-Skills

1. Use `using-platty-mcp` for MCP capability and project context.
2. Use `platty-mcp-retrieval` for SOT, spec, graph, and source evidence.

## Inputs

- Platty project context.
- SDD directory id or spec slug containing `request.md` and `stories.md`.
- Optional target repo, API, screen, table, event, or job areas.

## Operating Flow

1. Confirm MCP tools, project context, and context freshness.
2. Read the selected local `request.md` and `stories.md` from the SDD directory,
   then re-ground their claims through MCP surfaces.
3. Stop unless request/story inputs are approved, unless the user explicitly
   asks for draft-only technical design.
4. Run `platty-mcp-retrieval` for impacted epics, documents, specs, and source
   parity.
5. Use `graph_trace`, `code_search`, and `code_snippet` before implementation
   claims when those tools are available.
6. Build an SDD design packet with direct evidence, inferred evidence,
   assumptions, risks, coverageLimits, and source parity status.
7. Draft `design.md` from `references/design-shape.md`.
8. Draft `tasks.md` from `references/tasks-shape.md` only after design approval
   or an explicit user request for draft tasks.
9. Persist `design.md`, and persist `tasks.md` only when the task gate is open.
10. Verify written files are readable before final response.

## Local SDD File Access

This is the only local file exception in the MCP SDD design route. Read only the
selected `request.md` and `stories.md`, then write only SDD draft outputs in:

```text
~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/
```

Rules:

- Create the target directory if needed.
- Resolve `~` to the current user's home directory before creating directories
  or writing files; do not pass a literal `~` path to filesystem tools.
- Confirm the directory project id matches the selected MCP project context.
- Do not read local SOT, run local Platty CLI commands, or inspect unrelated
  local files.
- Write `designMarkdown` to `design.md`.
- Write `tasksMarkdown` to `tasks.md` only when design is approved or the user
  explicitly requested draft tasks.
- If the task gate is closed, report that `tasks.md` generation is gated.
- Verify every written file is readable and include paths in the final response.

## Source Parity Gate

Technical design can use business documents and specs for intent, but
implementation details need source parity. Use graph/spec/source MCP evidence
before naming files, APIs, DTOs, tables, events, permissions, writes, or
negative source claims.

Unsupported implementation claims must be marked as assumptions or risks. If
source parity tools are missing, keep `coverageLimits` explicit and avoid
turning candidates into confirmed design.

## SDD Design Packet

```text
SDD Design Packet
- projectId
- projectName
- specId
- requestStatus
- storiesStatus
- outputLanguage
- contextStatus
- evidenceBoundary
- sourceParityStatus
- surfacesRead
- selectedEpics
- selectedSpecs
- sourceConfirmations
- directEvidence
- inferredEvidence
- assumptions
- risks
- coverageLimits
- designMarkdown
- tasksMarkdown
- localPersistenceTarget
```

## Answer Contract

```text
## design.md draft
<full markdown>

## tasks.md draft
<full markdown, only when task gate is open>

## tasks.md gate
<why task generation is gated, when design is not approved and draft tasks were not requested>

## Local persistence
Saved:
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/design.md
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/tasks.md, when written
```

Use "확인됨" only for exact MCP reads. Use "후보", "근거상 보임", or
"추가 확인 필요" for search candidates, partial evidence, inferred behavior, or
missing source parity.

## Stop Conditions

- MCP tools are not configured.
- Request/story inputs are not approved and draft-only design was not requested.
- Required retrieval or source parity tools are missing for a hard
  implementation claim.
- Task generation is requested while design is not approved and the user did
  not explicitly request draft tasks.
- A shared engine contract, persisted schema, public CLI behavior, or common
  resolver semantic change is required without explicit approval.
- The target SDD directory cannot be created or written.

## Common Mistakes

| Mistake | Required behavior |
| --- | --- |
| Treating business intent as implementation proof | Confirm with graph/spec/source MCP evidence before naming implementation details. |
| Producing design only | Draft and persist both `design.md` and `tasks.md`. |
| Hiding source gaps | Put gaps in `coverageLimits`, assumptions, or risks. |
| Writing generic tasks | Map tasks to request rules, user stories, design areas, and tests. |

## Verification

Use `references/pressure-scenarios.md` when testing this skill.
