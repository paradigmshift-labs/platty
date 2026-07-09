---
name: using-platty-mcp
description: Use when a task should use configured Platty MCP tools for remote project context, tool capability checks, client setup routing, Platty MCP retrieval, memory lifecycle routing, or MCP-grounded SDD file creation.
---

# Using Platty MCP

Platty MCP is remote context transport. It is not a local Platty CLI runtime and
it is not an analysis, sync, server-side document generation, cache, or
generated-SOT editing surface. Most MCP routes are read-only. Explicit memory
lifecycle requests route to `platty-mcp-memory`. MCP skills may author
evidence-backed drafts. The SDD exceptions are `platty-mcp-sdd-spec` and
`platty-mcp-sdd-design`, which may read or write SDD files under
`~/.platty/specs/<projectId>/...`.

## Boundary

Use only configured MCP tools. Do not run local Platty CLI commands, mutate
projects, refresh caches, run server-side document generation, or write memory
except through `platty-mcp-memory` after explicit user intent.
SOT files may be read only through configured MCP artifact tools. Local file
access is allowed only for selected SDD draft files under
`~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/`.

If a requested answer needs a missing MCP surface, report the capability gap.
Do not silently switch to local files or local CLI.

## Setup Routing

Keep the setup split thin and explicit:

1. If Platty MCP tools are visible, run the capability gate and then route:
   - read-only project questions to `platty-mcp-retrieval`;
   - explicit memory read/write/update/delete requests to `platty-mcp-memory`;
   - MCP-grounded SDD request/story file creation to `platty-mcp-sdd-spec`;
   - MCP-grounded SDD design/task file creation to `platty-mcp-sdd-design`.
2. If MCP tools are missing but the user already has a `/api/mcp` URL, route to
   `platty-mcp-client-setup`.
3. If there is no URL or server and the user is the operator, route to
   `platty:platty-mcp-server-setup`.
4. If there is no URL or server and the user is only a consumer, ask for the
   Platty MCP `/api/mcp` URL.

## Capability Gate

Before relying on MCP evidence:

1. Confirm Platty MCP tools are configured.
2. Call the runtime's tool listing mechanism.
3. Classify available tools by tier:
   - minimum retrieval;
   - memory overlay reads;
   - memory lifecycle;
   - search assist;
   - source parity;
   - artifact access.
4. Call `project_list` when no project is already selected.
5. Call `context_status` for the selected project before freshness-sensitive
   answers.

For exact tool names and required inputs, read
`references/tool-mapping.md`.

For the MCP DB/read-model structure, document/spec link relationships, retrieval
order, and SOT projection boundary, read
`references/retrieval-architecture.md`.

For SOT file roots and stored file content behavior, read
`references/artifact-access.md`.

## Retrieval Routing

For user questions about Platty project context, domain terms, epics, business
documents, specs, impact, code locations, or source confirmation, use
`platty-mcp-retrieval` after the capability gate.

Routing is complete only after `platty-mcp-retrieval` has been loaded and its
Search Clarification Gate has been resolved. Do not answer from project
overview, glossary, search, spec, graph, or code evidence while still only
running this transport skill.

For broad, domain-term, business-rule, data-field, design, capability, journey,
or impact questions, the retrieval route must follow the full-cycle ladder in
`platty-mcp-retrieval`: project map, epic map, BR/DD/DESIGN/UCL document map,
exact item reads, connected specs, and source evidence when required. Search
assist tools may narrow candidates, but they do not replace the ladder.

Keep MCP usage and retrieval judgment separate:

```text
using-platty-mcp       -> transport boundary, capability gate, tool mapping
platty-mcp-retrieval   -> question route, map-first ladder, evidence gates
platty-mcp-memory      -> explicit memory read/write/update/delete lifecycle
```

## SDD File Routing

For MCP-grounded SDD request/story authoring from a product idea, feature
request, policy change, PRD need, or requirements discussion, use
`platty-mcp-sdd-spec` after the capability gate.

That skill must use `platty-mcp-retrieval` for evidence. It writes
`request.md` and `stories.md` directly to
`~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/` and verifies both files.

For MCP-grounded SDD technical design from existing request/story inputs, use
`platty-mcp-sdd-design` after the capability gate. It may read only
`request.md` and `stories.md` from the selected SDD directory, writes
`design.md`, and writes `tasks.md` only when the design is approved or the user
explicitly asks for draft tasks.

## Memory Lifecycle Routing

For explicit memory read, record, correct, update, or delete requests, use
`platty-mcp-memory` after the capability gate.

That skill may use memory mutation tools only for explicit user intent. Normal
retrieval answers remain read-only and keep memory overlays separate from
generated SOT, specs, and source evidence.

## Stop Conditions

- MCP tools are not configured.
- Minimum retrieval tools are missing.
- The task asks for setup, analysis, sync, server-side document generation,
  project mutation, local cache changes, local CLI, or memory writes outside
  `platty-mcp-memory`.
- The task asks for local file access outside the `platty-mcp-sdd-spec` or
  `platty-mcp-sdd-design`
  `~/.platty/specs/<projectId>/...` SDD read/write exception.
- A retrieval branch needs a missing search-assist or source-parity tool.
- The user asks for an SOT artifact and no artifact access tier is configured.
