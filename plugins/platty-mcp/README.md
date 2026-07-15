# Platty MCP Agent Plugin

`platty-mcp` is the Platty MCP plugin for Codex and Claude Code. It teaches
agents how to use an already configured Platty MCP context server, how to
register an existing MCP URL from the client side, how to answer project
questions through MCP evidence, how to assess read-only technical impact, how
to manage explicit memory lifecycle requests, and how to create approval-gated,
locally saved MCP-grounded SDD handoffs.

## Boundary

This plugin does not perform Platty lifecycle or operator setup. It does not
configure, start, run, sync, mutate, cache, delete, export, or otherwise manage
a Platty MCP server. It intentionally does not ship `.mcp.json`, and its plugin
manifests do not include `mcpServers`.

Use this plugin when your runtime already exposes Platty MCP tools for project
context, glossary terms, epics, business documents, source-near specs, graph or
code evidence, read-only memory overlays, stored SOT artifacts, and context
status, or when you need to register an existing `/api/mcp` URL in the client.

It owns client-side MCP URL registration through
`platty-mcp:platty-mcp-client-setup`. Use that skill to register a remote MCP
endpoint; do not use it for Platty operator setup or any server-side lifecycle
work.

Do not use this plugin for analysis, sync, server-side document generation,
local SOT file reads from the client, local Platty CLI commands, project
mutation, cache refresh, deletion outside memory lifecycle, export execution, or
general local file persistence. Explicit memory lifecycle requests are handled
by `platty-mcp:platty-mcp-memory`. The local SDD exceptions are:

- `platty-mcp:platty-mcp-sdd-spec`, which writes `prd.md` and `user_stories.md`
  with a compact pointer to the selected impact work.
- `platty-mcp:platty-mcp-impact-analysis`, which updates only the final §9 of
  `prd.md` under
  `~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/`.
- `platty-mcp:platty-mcp-sdd-design`, which writes `system_design.md` first. Its design
  records technical AS-IS/TO-BE behavior, a canonical `CHG-*` change map, and a
  mandatory DB/data-impact assessment. `sdd-design.v2` also records field-level
  provenance, exhaustive source-state coverage, source checkout equality,
  frontend topology, and command preflight evidence. It does not create
  `sdd-tasks.v3` until the
  user explicitly approves the reviewed design; post-approval tasks remain
  traceable to that approved design and must pass the bundled readiness validator
  at 95 or higher with zero critical findings.
- `platty-mcp:platty-mcp-impact-analysis` uses its bundled canonical revision
  calculator so reordered evidence sets cannot produce runtime-specific
  `impactRevision` values.

Stored artifact file content access must go through configured MCP tools such
as `sot_file_get`. Use the full `platty` plugin for operator workflows outside
those SDD-file exceptions.

## Included Skills

- `platty-mcp:using-platty-mcp`
- `platty-mcp:platty-mcp-client-setup`
- `platty-mcp:platty-mcp-retrieval`
- `platty-mcp:platty-mcp-impact-analysis`
- `platty-mcp:platty-mcp-memory`
- `platty-mcp:platty-mcp-sdd-spec`
- `platty-mcp:platty-mcp-sdd-design`
