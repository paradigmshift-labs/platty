---
name: platty-mcp-client-setup
description: Use when registering, validating, or troubleshooting a Platty MCP endpoint from an MCP-capable runtime such as Codex or Claude Code.
---

# Platty MCP Client Setup

Use this skill for consumer-side setup when a Platty MCP server already exposes
direct HTTP JSON-RPC at `/api/mcp`. Tool names and schemas come from the host
`tools/list`; `context_status` lists only `missing` / `unavailable` tools.

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
2. Check the concrete tools the selected skill needs, not an unrelated tier:
   `platty-mcp-search` — `context_status`, `domain_list/get`, `epic_list/get`,
   the typed family tools (`business_rule_* / use_case_* / design_* /
   data_dictionary_*` list, get, item_get, search, and each family's
   `*_spec_resolve`), `spec_list /
   spec_get / spec_search / spec_business_resolve / spec_impact_resolve`,
   `glossary_term_search / glossary_translate`, `code_search_guide_get`,
   `workspace_repo_list`, `route_resolve / route_relations / route_code /
   code_routes / route_text_links / route_impact_candidates`,
   `readonly_workspace_shell`,
   `workspace_search`, `code_search`, `graph_trace`; `platty-mcp-memory` —
   `memory_list / memory_get / memory_request`, `glossary_alias_*`. A missing
   tool is a named capability gap for that skill only.
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
5. Route project questions (impact questions included) through
   `platty-mcp-search`; memory and alias requests through `platty-mcp-memory`.
   Registration / listing alone is not successful execution of every tool.
6. Plugin update check (setup task, never part of answering): run
   `bin/platty-update-check platty-mcp` from the host once per session unless
   `PLATTY_PLUGIN_UPDATE_CHECK=0`; on `UPGRADE_AVAILABLE` say so in one line.

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
