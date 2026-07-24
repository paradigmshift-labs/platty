# Platty MCP Agent Plugin

`platty-mcp` is the Platty MCP plugin for Codex and Claude Code. It teaches
agents how to use an already configured Platty MCP context server, how to
register an existing MCP URL from the client side, how to answer project
questions through MCP evidence, how to assess read-only technical impact, how
to manage explicit memory lifecycle requests, how to create reusable read-only
Figma evidence reports, and how to create approval-gated, locally saved
MCP-grounded SDD handoffs.

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
  `sdd-tasks.v4` until the
  user explicitly approves the reviewed design; post-approval tasks remain
  traceable to that approved design and must pass the bundled readiness validator
  at 95 or higher with zero critical findings.
- `platty-mcp:platty-mcp-impact-analysis` uses its bundled canonical revision
  calculator so reordered evidence sets cannot produce runtime-specific
  `impactRevision` values.
- `platty-mcp:platty-mcp-figma-design-sync`, which reads one exact target through
  configured Figma MCP and writes only validated, revisioned evidence under
  `~/.platty/design-sync/<projectId>/<targetId>/reports/<reportId>/`. It does not
  edit Figma, product files, system design, tasks, generated SOT, or code.
- `platty-mcp:platty-mcp-sdd-spec-from-figma`, which accepts a Figma URL bundle
  plus an optional raw idea or existing PRD. It selects CREATE or AUGMENT
  automatically, delegates canonical `prd.md` and `user_stories.md` writes to
  `platty-mcp-sdd-spec`, persists revision-bound `figma_handoff.json`, and stops
  before technical design.
- `platty-mcp:platty-mcp-sdd-design-with-figma`, which aligns connected or
  independent approved product documents with current Figma evidence only after
  a separate system-design request. It delegates `system_design.md` to
  `platty-mcp-sdd-design`; `tasks.md` follows only after exact design-revision
  approval. It does not edit or modify `prd.md` or `user_stories.md`, and product
  conflicts stop before design.

## Figma-Grounded SDD Menu

The user invokes the workflow with normal requests. The product stage resolves
the standalone Figma evidence skill internally.

Natural-language requests such as `이 Figma를 기반으로 기획서를 정리해줘` are
product-authoring requests even when they omit `PRD`, `SDD`, and output
filenames. They route through Platty MCP current-service retrieval and must end
with saved `prd.md` and `user_stories.md` paths, not only an inline summary.

1. Existing PRD plus Figma URL: augment `prd.md` and `user_stories.md`, then stop.
2. Figma URL without PRD: create draft `prd.md` and `user_stories.md`, preserve
   unresolved policy as product questions, then stop.
3. After product approval, a separate system-design request creates
   `system_design.md`; `tasks.md` is created only after the exact design revision
   is approved.

The current session may reuse its internal Figma evidence handoff. A new session
automatically discovers validated `figma_handoff.json` beside the product pair,
so the user does not repeat the URL. A pair without the optional sidecar retains
the existing non-Figma design flow; an invalid or stale sidecar blocks instead
of being silently ignored.

The design and Figma-sensitive tasks preserve:

```text
Figma node -> R/AC -> US/scenario -> design decision -> task
```

Korean companion documents for reviewing the skill contracts:

- [`platty-mcp-figma-design-sync/SKILL.ko.md`](skills/platty-mcp-figma-design-sync/SKILL.ko.md)
- [`platty-mcp-sdd-spec-from-figma/SKILL.ko.md`](skills/platty-mcp-sdd-spec-from-figma/SKILL.ko.md)
- [`platty-mcp-sdd-design-with-figma/SKILL.ko.md`](skills/platty-mcp-sdd-design-with-figma/SKILL.ko.md)

Stored artifact file content access must go through configured MCP tools such
as `sot_file_get`. Use the full `platty` plugin for operator workflows outside
those SDD-file exceptions.

## Included Skills

- `platty-mcp:using-platty-mcp`
- `platty-mcp:platty-mcp-client-setup`
- `platty-mcp:platty-mcp-retrieval`
- `platty-mcp:platty-mcp-impact-analysis`
- `platty-mcp:platty-mcp-memory`
- `platty-mcp:platty-mcp-figma-design-sync`
- `platty-mcp:platty-mcp-sdd-spec-from-figma`
- `platty-mcp:platty-mcp-sdd-design-with-figma`
- `platty-mcp:platty-mcp-sdd-spec`
- `platty-mcp:platty-mcp-sdd-design`
