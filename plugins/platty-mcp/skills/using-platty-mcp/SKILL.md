---
name: using-platty-mcp
description: Use when a task should use configured Platty MCP tools for remote project context, tool capability checks, Figma-backed product-plan or 기획서 authoring, Figma evidence routing, client setup routing, Platty MCP retrieval, memory or glossary-alias lifecycle routing, or MCP-grounded SDD file creation.
---

# Using Platty MCP

Platty MCP is remote context transport. It is not a local Platty CLI runtime and
it is not an analysis, sync, server-side document generation, cache, or
generated-SOT editing surface. Most MCP routes are read-only. Explicit memory
lifecycle requests route to `platty-mcp-memory`. MCP skills may author
evidence-backed drafts. The SDD exceptions are `platty-mcp-sdd-spec`,
`platty-mcp-sdd-design`, and `platty-mcp-impact-analysis`, which may read or
write their owned SDD files under
`~/.platty/specs/<projectId>/...`. The separate
`platty-mcp-sdd-spec-from-figma` exception may write only the optional
`figma_handoff.json` sidecar in the selected SPEC directory. The separate
`platty-mcp-figma-design-sync` exception may write only validated Figma evidence
reports under `~/.platty/design-sync/<projectId>/...`.

## Update Preamble

Run this before MCP capability checks and routing:

1. Resolve `../../bin/platty-update-check` relative to this `SKILL.md`.
2. Run `bash <resolved-checker-path> platty-mcp`.
3. If it prints nothing or only `JUST_UPGRADED <old> <new>`, continue normally.
4. If any output line is `UPGRADE_AVAILABLE <old> <new>`, update the already installed
   `platty-mcp@platty` plugin through the active runtime:
   - Codex: run `codex plugin marketplace upgrade platty`, then verify
     `platty-mcp@platty` is installed at `<new>` with
     `codex plugin list --json`.
   - Claude Code: run `claude plugin marketplace update platty`, then
     `claude plugin update platty-mcp@platty --scope user`, and verify `<new>`
     with `claude plugin list --json`.
   Version verification compares the installed base version before any `+` build metadata
   with `<new>`.
5. Never install a missing plugin from this preamble. If the marketplace is
   local, the runtime command fails, or the installed version remains unchanged,
   report the failed refresh briefly and continue with the currently loaded
   skill. Do not run direct `git pull`, `reset`, `stash`, or `checkout`.
6. After a verified update, run
   `bash <resolved-checker-path> platty-mcp --mark-upgraded <old>`, tell the user
   to start a new agent session, and stop before the capability gate.

The check is enabled by default and uses the same quiet, cached preamble pattern
as gstack. `PLATTY_PLUGIN_UPDATE_CHECK=0` disables it for local development.
This plugin-manager preflight is the only update exception to the MCP boundary:
it may write its operational cache under `PLATTY_HOME/plugin-updates`, but it
must not invoke the Platty CLI, mutate MCP project state, or install the
ordinary `platty@platty` plugin.

## Boundary

Use only configured MCP tools after the bounded update preamble. Do not run
local Platty CLI commands, mutate projects, refresh MCP project caches, run
server-side document generation, or write memory except through
`platty-mcp-memory` after explicit user intent.
SOT files may be read only through configured MCP artifact tools. Local file
access is allowed only for selected SDD draft files, including impact analysis's
owned `prd.md §9` and the optional Figma sidecar, under
`~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/`, plus the bounded Figma
evidence report exception owned by `platty-mcp-figma-design-sync` under
`~/.platty/design-sync/<projectId>/<targetId>/reports/<reportId>/`.

The Figma route may use configured Figma MCP for read-only design evidence. It
must not run local Platty CLI, mutate generated-SOT, refresh analysis or caches,
write SDD files, edit Figma, or treat visual layout as approved product intent.

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
   - a Figma URL, page, section, or frame needing reusable evidence to
     `platty-mcp-figma-design-sync` when configured Figma MCP reads are visible;
      - a product plan, planning document, feature brief, PRD, user-story,
        `기획서 정리/작성/생성/보강`, `요구사항`, or `기능 기획` request with a Figma URL to
        `platty-mcp-sdd-spec-from-figma`, which internally resolves the evidence
        bundle and auto-selects CREATE or AUGMENT;
      - a separate technical-design request for approved `prd.md` and
        `user_stories.md` with a Figma URL, current-session evidence handoff, or
        validated sidecar to
        `platty-mcp-sdd-design-with-figma`, which internally resolves current
        Figma evidence before canonical technical design;
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

For SDD question ownership, safe product recommendations, non-developer review
language, and technical-decision handoff, read
`references/sdd-question-ownership.md` before retrieval for an SDD authoring
route, product Self Review, impact approval review, or technical design.

For SOT file roots and stored file content behavior, read
`references/artifact-access.md`.

For the revisioned Figma evidence shape, page coverage, drift, and report reuse
rules, read `references/figma-evidence-contract.md`.

For cross-session Figma lineage, sidecar validation, automatic design routing,
and backward-compatible no-sidecar behavior, read
`references/figma-handoff-contract.md`.

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

A Figma-only sync, inventory, or evidence-report request routes to
`platty-mcp-figma-design-sync`. That skill creates no canonical SDD files. A
natural-language product-authoring request with a Figma URL, including
`기획서를 정리해줘`, routes to
`platty-mcp-sdd-spec-from-figma`; an existing PRD means AUGMENT and no PRD means
CREATE, including Figma-only product input. A separate system-design or
technical-design request for approved `prd.md` and `user_stories.md` routes
first to the canonical design owner. It checks optional `figma_handoff.json` in
the selected SPEC directory: valid/current means automatic internal routing to
`platty-mcp-sdd-design-with-figma`; absent means the existing standard design
flow; corrupt/invalid, mismatched, or stale means `BLOCKED` and stop. An
explicit Figma URL or current-session evidence handoff also routes to the Figma
alignment gate. Each orchestrator internally creates, reuses, or refreshes the
exact current packet rather than making the user manage it.

The product orchestrator delegates canonical `prd.md` and `user_stories.md` to
`platty-mcp-sdd-spec`. The design orchestrator accepts connected or independently
authored product/Figma inputs, delegates canonical `system_design.md` and
approval-gated `tasks.md` to `platty-mcp-sdd-design`, and never modifies the
product pair. A `PRODUCT_CONFLICT` returns a revision packet to
`platty-mcp-sdd-spec` and stops before technical-design writes.

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

## Contextual Continuation Routing

Resolve the persisted SDD state once with
`scripts/sdd-workflow-state.mjs` before interpreting a short continuation such
as `다음가자`, `진행`, or `추천대로`. The current pending gate owns the meaning;
do not restart discovery or reload every skill to infer intent again.

| Current state | Pending gate | Short continuation route |
| --- | --- | --- |
| `PRODUCT_DRAFT` | product decision | `추천대로` accepts the recommendation only; it is not approval. Persist the answer and continue the remaining product questions. |
| `PRODUCT_DRAFT` | exact product approval | `다음가자` or `진행` approves the current eligible product revisions, then counts as the separate technical-design request and proceeds to design. |
| `PRODUCT_APPROVED` | none | `다음가자` or `진행` starts technical design; a current Figma handoff selects the Figma route, otherwise use plain design. |
| `DESIGN_DRAFT` | exact ready `designRevision` approval | `다음가자` or `진행` approves that revision and proceeds to `tasks.md`; a design decision or kickoff recommendation is not final approval. |
| `DESIGN_APPROVED` | none | Generate and validate `tasks.md`. |
| `TASKS_READY` | none | Report implementation readiness without rerunning design discovery. |
| `TASKS_STALE`, `BLOCKED`, or `NEEDS_WORK` | recovery | Route to recovery; no short continuation bypasses the failed gate. |

The approval transitions above apply only when the exact approval question was
the immediately pending gate and the relevant revision remains unchanged. A new
question, changed artifact, or stale evidence cancels that interpretation.

## SDD Run Budget

Maintain a `LoadedContractSet` for the current run. Load each skill, reference,
or helper script once and reuse it unless its path or content revision changes.
Plan independent evidence reads first, then batch independent reads from MCP and
source tools when the runtime supports batching. Reuse exact receipts by project,
source commit, Figma sourceRevision, and query identity instead of repeating a
successful read.

- At 5 minutes or 30 tool calls, whichever comes first, report completed gates,
  current evidence gaps, and the bounded remaining work. Treat this as an
  operational wall-clock deadline: check it before and after every tool call or
  batch, stop launching broad discovery, and cancel or stop waiting for an
  oversized batch when the runtime permits. A product-authoring route persists
  a bounded `NEEDS_WORK` draft when its owning skill allows draft persistence.
- 50 tool calls is the maximum hard budget for one product-to-design or
  design-to-tasks transition. Before exceeding it, stop broad discovery and
  return a bounded gap/recovery report unless the user explicitly expands scope.
- Compose each canonical artifact fully before persistence. Use a single write
  followed by one read back; do not accumulate dozens of partial patches. The
  design owner's explicit Design Draft Persistence Gate may write one complete-
  shaped bounded draft and one final atomic replacement.
- Do not reread `sdd-artifacts.mjs`, templates, or unchanged SDD files merely to
  refresh model context. Recompute through the already loaded helper.

## Figma-Grounded Two-Stage SDD Routing

The user-facing workflow is two-stage. Preserve this boundary even when one
conversation contains both product and Figma context.

### Stage 1: Product Documents

When a product plan, planning document, feature brief, PRD, user-story, or
natural-language `기획서 정리/작성/생성/보강` request includes a Figma URL, route to
`platty-mcp-sdd-spec-from-figma`. The orchestrator resolves Figma evidence
internally and delegates only `prd.md` and `user_stories.md`:

- existing PRD or product documents -> `AUGMENT`;
- no PRD, including Figma-only input -> `CREATE`.

The user does not choose the mode and does not provide packet paths, report IDs,
or source revisions. Stage 1 must not automatically invoke or route to system
design or technical design. It ends with the product pair and its approval
status. It also persists a validated, revision-bound `figma_handoff.json`
beside the pair so a later session can recover Figma lineage without embedding
the full evidence bundle in `prd.md`.

This canonical authoring intent takes precedence over generic Figma inspection
or summarization even when the user does not say PRD or SDD. The route must use
`platty-mcp-retrieval` for current service evidence and save `prd.md` and
`user_stories.md`; an inline chat draft alone is not complete.

### Stage 2: Technical Design

Only a separate system-design or technical-design request routes to
`platty-mcp-sdd-design`. It requires the approved product pair and automatically
checks its optional sidecar. A valid/current sidecar routes internally to
`platty-mcp-sdd-design-with-figma`, which resolves the same/current Figma
evidence and delegates `system_design.md` back to the existing design owner. In
a new session the user does not repeat the URL when `figma_handoff.json` is
present and valid. When it is absent, an explicit Figma design request asks only
for the node-specific Figma URL; a normal no-Figma design request preserves the
existing flow. `tasks.md` remains behind exact design-revision approval.

A separate system design request or technical design request is therefore the
only user action that starts `platty-mcp-sdd-design-with-figma`.

Both canonical outputs preserve the chain:

```text
Figma node -> R/AC -> US/scenario -> design decision -> task
```

If the user asks only to create or improve the PRD, transport must not
automatically begin technical design, even if the design request seems like an
obvious next step.

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

When that authoring request includes a Figma URL, route through
`platty-mcp-sdd-spec-from-figma`. It accepts a Figma-only request, optional raw
idea, or copied existing PRD, auto-selects CREATE or AUGMENT, resolves current
evidence internally, classifies FACT/PRODUCT/DESIGN evidence, and delegates the
canonical pair to the same spec owner.

That skill must use `platty-mcp-retrieval` for evidence and invoke
`platty-mcp-impact-analysis` for the final §9 Engineering Discovery appendix.
It classifies unresolved items through the shared SDD question-ownership
contract: retrieval owns source-confirmable facts, spec owns user-visible
product decisions, and design owns implementation choices that preserve the
approved result. Technical alternatives do not block the product drafts or
become non-developer questions.
It writes `prd.md` and `user_stories.md` directly to
`~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/`, then verifies both files,
including the final PRD §9 section. Impact binds §9 to the finalized product and
story revisions. A later explicit product approval rereads both files and moves
their statuses together before technical design begins.

For MCP-grounded SDD technical design from existing approved `prd.md` (including
§9) and `user_stories.md`, use `platty-mcp-sdd-design` after the capability gate.
It may read both inputs and fixed optional `figma_handoff.json` from the selected
SDD directory,
writes `system_design.md`, and writes `tasks.md` only after explicit approval of the
current design. It delegates Impact Dossier creation
or refresh to `platty-mcp-impact-analysis`, which alone updates PRD §9 in this
route. Design consumes the shared technical-decision handoff, resolves
source-grounded reversible choices itself, and returns any product-result
change to the product revision flow instead of silently deciding it.

When a later, separate user request asks for technical design from approved
product inputs, the design owner automatically routes through
`platty-mcp-sdd-design-with-figma` when a validated sidecar, Figma URL, or
current-session handoff exists. The gate internally resolves current evidence
and performs semantic alignment for both connected and independent PRD/Figma
inputs. It never edits `prd.md` or `user_stories.md`; it delegates only a
non-conflicting, current alignment packet to the existing design owner.

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
- The task asks for setup, analysis, non-Figma sync, server-side document generation,
  project mutation, local cache changes, local CLI, or memory writes outside
  `platty-mcp-memory`.
- The task asks for local file access outside the `platty-mcp-sdd-spec`,
  `platty-mcp-sdd-design`, `platty-mcp-impact-analysis`, or bounded
  `platty-mcp-sdd-spec-from-figma` sidecar
  `~/.platty/specs/<projectId>/...` SDD read/write exception and the
  `platty-mcp-figma-design-sync`
  `~/.platty/design-sync/<projectId>/<targetId>/reports/<reportId>/` report
  exception.
- A discovered `figma_handoff.json` is corrupt/invalid, project/spec mismatched,
  or stale against the selected product revisions. Stop as `BLOCKED`; do not
  silently continue through the standard design route.
- A Figma evidence route lacks exact target identity, configured Figma MCP, or
  a capability required to make the requested completeness claim.
- A retrieval branch needs a missing search-assist or source-parity tool.
- A Git-history or worktree-freshness branch needs its missing
  `workspace_git_history` or `workspace_sync_status` capability.
- The user asks for an SOT artifact and no artifact access tier is configured.
