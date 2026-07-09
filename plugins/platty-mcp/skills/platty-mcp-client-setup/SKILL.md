---
name: platty-mcp-client-setup
description: Use when registering, validating, or troubleshooting a Platty MCP endpoint from an MCP-capable runtime such as Codex or Claude Code.
---

# Platty MCP Client Setup

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

1. Confirm Platty MCP tools are visible in the runtime.
2. Verify `tools/list` includes the minimum retrieval tier from
   `references/tool-mapping.md`:
   `project_list`, `context_status`, `project_overview_get`,
   `glossary_translate`, `epic_list`, `epic_get`, `document_list`,
   `document_get`, `document_item_list`, `document_item_get`,
   `document_resolve`, and `spec_get`.
3. If `ssot_search`, `ssot_get`, `ssot_resolve`, `document_search`,
   `spec_list`, `spec_search`, or `spec_resolve` are also visible, note that
   the search-assist tier is available.
4. If `graph_trace`, `code_search`, or `code_snippet` are also visible, note
   that the source-parity tier is available.
5. If `sot_file_get` is also visible, note that the artifact-access tier is
   available for stored SOT file content requests. Download and bundle metadata
   tools are not part of this MCP profile.
6. Call `project_list`.
7. If one project is available, use that `projectId`.
8. If multiple projects are plausible, ask which project to use.
9. Route retrieval questions to `using-platty-mcp`.

## Missing Server

If no URL exists and the user is a server operator, route to
`platty:platty-mcp-server-setup`. If the user is only a consumer, ask for a
Platty MCP `/api/mcp` URL.

## Completion

Complete when the runtime exposes Platty MCP tools and `project_list` returns
projects, or when you can report the exact client/server configuration gap.
