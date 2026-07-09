---
name: using-platty-mcp
description: Use when a task should use configured read-only Platty MCP tools for remote project context, tool capability checks, client setup routing, or routing Platty MCP retrieval.
---

# Using Platty MCP

Platty MCP is read-only remote context transport. It is not a local Platty CLI
runtime and it is not an analysis, sync, generation, mutation, cache, or
memory-write surface.

## Boundary

Use only configured MCP tools. Do not run local Platty CLI commands, mutate
projects, refresh caches, generate documents, or write memory from this route.
SOT files may be read only through configured MCP artifact tools.

If a requested answer needs a missing MCP surface, report the capability gap.
Do not silently switch to local files or local CLI.

## Setup Routing

Keep the setup split thin and explicit:

1. If Platty MCP tools are visible, run the capability gate and then route to
   `platty-mcp-retrieval` for read-only project questions.
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
   - search assist;
   - source parity;
   - artifact access.
4. Call `project_list` when no project is already selected.
5. Call `context_status` for the selected project before freshness-sensitive
   answers.

For exact tool names and required inputs, read
`references/tool-mapping.md`.

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
```

## Stop Conditions

- MCP tools are not configured.
- Minimum retrieval tools are missing.
- The task asks for setup, analysis, sync, generation, mutation, local cache
  changes, local files, local CLI, or memory writes.
- A retrieval branch needs a missing search-assist or source-parity tool.
- The user asks for an SOT artifact and no artifact access tier is configured.
