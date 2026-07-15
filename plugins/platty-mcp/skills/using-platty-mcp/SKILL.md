---
name: using-platty-mcp
description: Use when a task should use configured Platty MCP tools for remote project context, tool capability checks, client setup routing, Platty MCP retrieval, memory or glossary-alias lifecycle routing, or MCP-grounded SDD file creation.
---

# Using Platty MCP

Platty MCP is remote context transport. It is not a local Platty CLI runtime and
it is not an analysis, sync, server-side document generation, cache, or
generated-SOT editing surface. Most MCP routes are read-only. Explicit memory
lifecycle requests route to `platty-mcp-memory`. MCP skills may author
evidence-backed drafts. The SDD exceptions are `platty-mcp-sdd-spec`,
`platty-mcp-sdd-design`, and `platty-mcp-impact-analysis`, which may read or
write their owned SDD files under
`~/.platty/specs/<projectId>/...`.

## Boundary

Use only configured MCP tools. Do not run local Platty CLI commands, mutate
projects, refresh caches, run server-side document generation, or write memory
except through `platty-mcp-memory` after explicit user intent.
SOT files may be read only through configured MCP artifact tools. Local file
access is allowed only for selected SDD draft files, including impact analysis's
owned `prd.md §9`, under
`~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/`.

If a requested answer needs a missing MCP surface, report the capability gap.
Do not silently switch to local files or local CLI.

## Setup Routing

Keep the setup split thin and explicit:

1. If Platty MCP tools are visible, run the capability gate and then route:
   - read-only project questions to `platty-mcp-retrieval`;
   - impact, blast-radius, affected-surface, cross-EPIC, or design-change
     questions to `platty-mcp-impact-analysis` after it produces or reuses an
     Impact Seed Packet;
   - explicit memory or glossary-alias read/write/update/delete requests to
     `platty-mcp-memory`;
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
   - vocabulary inventory and ambiguity;
   - memory overlay reads;
   - memory lifecycle;
   - glossary alias lifecycle;
   - search assist;
   - source parity;
   - workspace source parity;
   - workspace Git observability;
   - artifact access.
4. Call `project_list` when no project is already selected.
5. Call `context_status` for the selected project before freshness-sensitive
   answers.

`glossary_list` is a conditional vocabulary inventory/ambiguity capability, not
an unconditional minimum retrieval tool. Its absence does not block an
unrelated exact API/spec route whose required tools are present. It is a stop
condition when the selected route requires complete vocabulary inventory,
comparison, ambiguity resolution, every alias, or candidate discovery after a
blank/conflicting `glossary_translate` result.

For exact tool names and required inputs, read
`references/tool-mapping.md`.

For the MCP DB/read-model structure, document/spec link relationships, retrieval
order, and SOT projection boundary, read
`references/retrieval-architecture.md`.

For SDD revision, approval, evidence fingerprint, and stale-plan calculations,
read `references/sdd-revision-contract.md`.

For SOT file roots and stored file content behavior, read
`references/artifact-access.md`.

## Retrieval Routing

For user questions about Platty project context, domain terms, epics, business
documents, specs, exact code locations, or source confirmation, use
`platty-mcp-retrieval` after the capability gate.

Questions about recent analyzed commits, managed-worktree Git history, the last
successfully analyzed commit, or cached analysis-branch freshness also route to
`platty-mcp-retrieval` when `workspace_git_history` or
`workspace_sync_status` is exposed. These tools do not fetch and do not observe
application deployment.

For observable impact questions such as what changes, what breaks, blast radius,
affected surface, cross-EPIC effects, or design-change impact, use
`platty-mcp-impact-analysis`. It must produce or reuse an Impact Seed Packet
through `platty-mcp-retrieval`; an existing packet is reused rather than rebuilt.
The impact skill owns graph/cross-EPIC/workspace source convergence and is the
only MCP route with the selected SDD-directory local exception to write or
refresh `prd.md §9`.

Explicit SDD file authoring intent takes precedence over generic impact or
design-change wording: request/story creation routes to `platty-mcp-sdd-spec`,
and design/task creation routes to `platty-mcp-sdd-design`. Those owning skills
may invoke impact analysis as a sub-route; transport must not bypass them.

Routing is complete only after `platty-mcp-retrieval` has been loaded and its
Search Clarification Gate has been resolved. Do not answer from project
overview, glossary, search, spec, graph, or code evidence while still only
running this transport skill.

For broad, domain-term, business-rule, data-field, design, capability, or
journey questions, the retrieval route must follow the full-cycle ladder in
`platty-mcp-retrieval`: project map, epic map, BR/DD/DESIGN/UCL document map,
exact item reads, connected specs, and source evidence when required. Search
assist tools may narrow candidates, but they do not replace the ladder.

Keep MCP usage and retrieval judgment separate:

```text
using-platty-mcp       -> transport boundary, capability gate, tool mapping
platty-mcp-retrieval   -> question route, map-first ladder, evidence gates
platty-mcp-impact-analysis -> Impact Seed Packet reuse, graph/cross-EPIC/workspace convergence
platty-mcp-memory      -> explicit memory and glossary-alias lifecycle
```

## SDD File Routing

The canonical SDD artifact names are fixed:

```text
prd.md -> user_stories.md -> system_design.md -> tasks.md
```

Always use those names for newly authored or rewritten artifacts. Treat
non-canonical legacy filenames only as read-only input aliases; never select them
as output filenames or present them as the current SDD contract.

For MCP-grounded SDD PRD/user-story authoring from a product idea, feature
request, policy change, PRD need, or requirements discussion, use
`platty-mcp-sdd-spec` after the capability gate.

That skill must use `platty-mcp-retrieval` for evidence and invoke
`platty-mcp-impact-analysis` for the final §9 Engineering Discovery appendix.
It writes `prd.md` and `user_stories.md` directly to
`~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/`, then verifies both files,
including the final PRD §9 section. Impact binds §9 to the finalized product and
story revisions. A later explicit product approval rereads both files and moves
their statuses together before technical design begins.

For MCP-grounded SDD technical design from existing approved `prd.md` (including
§9) and `user_stories.md`, use `platty-mcp-sdd-design` after the capability gate.
It may read both inputs from the selected SDD directory,
writes `system_design.md`, and writes `tasks.md` only after explicit approval of the
current design. It delegates Impact Dossier creation
or refresh to `platty-mcp-impact-analysis`, which alone updates PRD §9 in this
route.

## Memory Lifecycle Routing

For explicit memory or glossary-alias read, record, correct, update, or delete
requests, use `platty-mcp-memory` after the capability gate.

That skill may use memory mutation tools only for explicit user intent. Normal
retrieval answers remain read-only and keep memory overlays separate from
generated SOT, specs, and source evidence.

Glossary aliases use the dedicated `glossary_alias_list/add/remove` tools, are
EPIC-scoped, and remain distinct from generated glossary aliases. Do not route
them through generic `memory_add/update/delete`.

## Stop Conditions

- MCP tools are not configured.
- Minimum retrieval tools are missing.
- A vocabulary inventory, comparison, ambiguity, every-alias, or
  blank/conflict-fallback route requires `glossary_list` and it is missing.
- A requested glossary alias read/add/remove route lacks its corresponding
  `glossary_alias_*` tool.
- The task asks for setup, analysis, sync, server-side document generation,
  project mutation, local cache changes, local CLI, or memory writes outside
  `platty-mcp-memory`.
- The task asks for local file access outside the `platty-mcp-sdd-spec`,
  `platty-mcp-sdd-design`, or `platty-mcp-impact-analysis`
  `~/.platty/specs/<projectId>/...` SDD read/write exception.
- A retrieval branch needs a missing search-assist or source-parity tool.
- A Git-history or worktree-freshness branch needs its missing
  `workspace_git_history` or `workspace_sync_status` capability.
- The user asks for an SOT artifact and no artifact access tier is configured.
