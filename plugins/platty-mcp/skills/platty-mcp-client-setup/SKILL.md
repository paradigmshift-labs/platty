---
name: platty-mcp-client-setup
description: Use when registering, validating, or troubleshooting a Platty MCP endpoint from an MCP-capable runtime such as Codex or Claude Code.
---

# Platty MCP Client Setup

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Use this skill for consumer-side setup when a Platty MCP server already exposes
direct HTTP JSON-RPC at `/api/mcp`.

## Boundary

This belongs to the read-only `platty-mcp` plugin. It registers an existing MCP
URL with the current runtime and validates read-only tools.

Do not run local Platty CLI commands, create `.mcp.json`, add `mcpServers` to
plugin manifests, start context-backend, configure server host/port, mutate
projects, refresh caches, run analysis, run sync, generate documents, or write
memory. If the user asks for SOT files, validate MCP artifact tools instead of
reading local files from the client.

## URL Profiles

```text
local  -> http://127.0.0.1:3027/api/mcp
LAN    -> http://<host-ip>:3027/api/mcp
remote -> https://<context-backend-domain>/api/mcp
```

If the user only has `HOST=0.0.0.0`, ask for the actual machine IP, DNS name, or
reverse proxy domain. Clients do not connect to literal `0.0.0.0`.

## Register

Prefer URL registration, not stdio command registration.

Codex config example:

```toml
[mcp_servers.platty]
url = "https://context.example.com/api/mcp"
```

Codex command example:

```bash
codex mcp add platty --url https://context.example.com/api/mcp
```

For Claude Code or another runtime, use that runtime's URL-based MCP server
registration. Keep the server name `platty` unless the user already has a naming
convention.

Restart or refresh the runtime after registration when tools are not immediately
visible.

## Validate

1. Confirm runtime tools are visible and read live `tools/list` schemas.
2. Read `../using-platty-mcp/references/tool-mapping.md`. Check concrete tools
   for the selected route: typed business maps, five-kind Spec reads, scoped
   Memory, vocabulary, graph/source, Git, or `sot_render`. An exact known-ID
   route checks its own requirements; an unrelated missing tier does not block it.
3. Project: reuse a known opaque ID. When the user did not name a project,
   omit `projectId` on `context_status`; the server uses its default project
   (the Platty CLI's current project, or the only project you can read) and
   echoes the `projectId` it used. Do not call `project_list` first. Call
   `project_list` only when that call returns `INVALID_INPUT` naming
   `projectId` (no default is set; the operator can set one with
   `platty project use <id>`), when the user names a project without its
   opaque ID, or when the user asks which projects exist. Ask only when
   multiple projects remain plausible.
4. Read `context_status` for freshness-sensitive validation. Per-tool observed
   availability is local authorized readiness, not an adapter-presence, network,
   remote freshness, or deployment claim.
5. Route questions through `using-platty-mcp`. Impact needs a produced/reused
   Impact Seed Packet; PRD §9 remains owned by `platty-mcp-impact-analysis`.
   Registration/listing alone is not successful execution of all 54 tools.

## Missing Server

If no URL exists and the user is a server operator, route to
`platty:platty-mcp-server-setup`. If the user is only a consumer, ask for a
Platty MCP `/api/mcp` URL.

## Completion

Complete when runtime tools are visible and an opaque project is known: the
server default project (the `projectId` that `context_status` echoes when
`projectId` was omitted), one selected from `project_list`, or one reused from
known context, with the selected route's observed capability/readiness limits
recorded. Otherwise report the exact client/server
configuration gap. Listing alone does not prove successful tool execution.
