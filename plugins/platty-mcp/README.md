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

When a project has no business documents (`br`, `ucl`, `design`,
`data_dictionary` all 0) or the user asks for a code-only answer,
`platty-mcp:platty-mcp-code-qa` answers business questions from source code
through the read-only route, workspace search, and workspace shell tools, in
plain Korean with collapsed `file:line` evidence.

For one or many non-developer business questions (for example a QA list),
`platty-mcp:platty-mcp-hybrid-qa` splits each question into a docs job and a
code job, runs the evidence collectors in parallel, verifies every docs-vs-code
conflict with targeted MCP reads, and answers with a docs-vs-code evidence
table. On Claude Code it dispatches the plugin agents below; on Codex with
multi-agent support it dispatches each collector job with `spawn_agent` on a
Luna-class model (up to 6 concurrent, `wait_agent` / `close_agent`) and runs
verification in a SOL-class worker or main session, recording the exact model
and effort per job; on runtimes without model-selectable subagents (Codex
without multi-agent) it runs the same jobs sequentially in-session with the
same evidence schema.

Stored SOT content is read through the typed MCP tools. `sot_render` returns a
DB-rendered Markdown projection, not the original stored file. Use the full
`platty` plugin for operator workflows outside those SDD-file exceptions.

## Included Skills

- `platty-mcp:using-platty-mcp`
- `platty-mcp:platty-mcp-client-setup`
- `platty-mcp:platty-mcp-retrieval`
- `platty-mcp:platty-mcp-code-qa`
- `platty-mcp:platty-mcp-hybrid-qa`
- `platty-mcp:platty-mcp-impact-analysis`
- `platty-mcp:platty-mcp-memory`
- `platty-mcp:platty-mcp-figma-design-sync`
- `platty-mcp:platty-mcp-sdd-spec-from-figma`
- `platty-mcp:platty-mcp-sdd-design-with-figma`
- `platty-mcp:platty-mcp-sdd-spec`
- `platty-mcp:platty-mcp-sdd-design`

## Included Agents (Claude Code)

Claude Code discovers these from `agents/`; Codex ignores the directory. With
multi-agent support the hybrid QA skill dispatches `spawn_agent` workers
instead; without it, it falls back to sequential in-session jobs.

- `platty-mcp:platty-evidence-collector-docs` — Sonnet, low effort; docs-track
  collector on the `platty-mcp-retrieval` ladder, returns collector JSON only.
- `platty-mcp:platty-evidence-collector-code` — Sonnet, low effort; code-track
  collector on the `platty-mcp-code-qa` ladder, returns collector JSON only.
- `platty-mcp:platty-qa-synthesizer` — Opus, high effort; verify-and-answer
  step for sessions whose main model is not a strong model.

The agents deny host shell, file write, file edit, and subagent-spawn tools;
they reach project evidence only through the configured Platty MCP tools.

Read-only MCP enforcement: the MCP server name differs per deployment (for
example a custom registration name or a connector ID), and Claude Code agent
`tools` / `disallowedTools` patterns accept MCP wildcards only as
`mcp__<server>__*` or `mcp__*` — a server-name wildcard such as
`mcp__*__memory_request` is not supported, and plugin agents ignore a `hooks`
frontmatter field. The plugin therefore ships a plugin-level `PreToolUse` hook,
`hooks/hybrid-qa-agent-guard.sh` (registered in `hooks/hooks.json`). It acts
only when the calling agent is one of the three agents above and blocks every
MCP call whose tool name is not a read-only Platty tool (memory and
glossary-alias writes, and tools of other MCP servers). The main session and
other agents are not affected, so `platty-mcp-memory` keeps working.

The guard reads the top-level `agent_type` and `tool_name` of the hook input
with `node`, or `python3` when node is absent, so keys nested inside a tool's
arguments never activate or bypass it. When neither parser is available, or the
input is not a JSON object, it falls back to a conservative text scan: any
guarded `agent_type` (even a nested one) applies the guard, every `tool_name`
value present must be a read-only Platty tool, and a guarded call with no
readable tool name is blocked. Input with no guarded `agent_type` is always
allowed.

Remaining limitations: the guard needs a POSIX `sh` (macOS and Linux); it
identifies Platty tools by name after the server segment, so a different MCP
server that exposes a same-named read tool is not distinguished; and it fails
closed, so a new read-only Platty tool must be added to its list (a repository
test keeps the list equal to the MCP catalogs minus write tools). Codex does not
load the hook; in Codex the sequential in-session mode and the `spawn_agent`
workers follow the skills' read-only rules, which the spawn prompt states
explicitly.

## Registering a code environment guide

The code QA and hybrid QA skills read an operator-written code environment
guide through `code_search_guide_get`. It is optional but strongly
recommended: without it, agents infer repository roles from repository names.

- Location: one Markdown file per project at
  `<PLATTY_SOT_ROOT>/_guides/<projectId>/code-search-guide.md` on the API host
  (`<projectId>` is the opaque project ID). On the PoC host this is
  `/opt/platty/sot-operating/_guides/<projectId>/code-search-guide.md`.
- Content: a single file with appendices — repository map and ownership,
  routing rules, layer conventions, search recipes, noise and credential paths
  to exclude, mirror or duplicate systems, and appendices such as status or
  message-code dictionaries and menu → screen → API → SQL tables. Keep it
  generic to the project; never put credentials in it.
- Size and paging: the tool returns pages of about 60,000 characters with a
  `nextCursor`; the file may be up to 2 MB. Agents read every page once per
  session and hand each job only the relevant sections.
- Updates: the file is read on every request, so no API restart is needed after
  adding or editing it. Editing it while an agent is paging makes that agent
  restart from the first page.
- Permissions: the file and its folders must be readable by the API process
  user (UID 10001 in the enterprise PoC compose deployment), for example
  `chown -R 10001:10001 <PLATTY_SOT_ROOT>/_guides/<projectId>` with mode `0644`
  for the file. A symlink must resolve inside the project's `_guides` folder.
- Missing guide: `code_search_guide_get` returns `available: false`; the skills
  continue from repository names and recommend registering a guide.
