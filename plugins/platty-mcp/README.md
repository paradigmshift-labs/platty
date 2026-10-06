# Platty MCP Agent Plugin

`platty-mcp` teaches Codex and Claude Code agents how to answer project
questions through an already configured, read-only Platty MCP context
server, for non-developer business teams (현업), in the words they see on
screen. It also routes explicit memory lifecycle requests and registers an
existing MCP endpoint from the client side. The SDD and Figma skills stay
installed, but only for explicit invocation by exact name.

## Boundary

The plugin performs no Platty lifecycle or operator setup: it does not
configure, start, run, sync, mutate, cache, delete, or export anything on a
Platty server, ships no `.mcp.json`, and its manifests carry no `mcpServers`.
All evidence comes from configured Platty MCP tools; agents never use a host
shell, local files, or a local CLI. Use the full `platty` plugin for operator
workflows.

## Search skills (auto-selected for project questions)

| Skill | Role |
| --- | --- |
| `platty-mcp:platty-mcp-search` | Main entry for every project question (business rules, screens, features, limits, states, terms, where something is, impact asked as a business question; one question or a list). Scopes the question to EPICs and route candidates (the only place discovery happens), dispatches the two collectors (impact questions: the docs collector + one impact investigator), audits their claim ledgers, runs the claim audit, answers in the fixed 현업 template. References: `scoping.md`, `job-cards.md`, `answer-template.md`, `impact.md`, `codex.md`. |
| `platty-mcp:platty-mcp-doc-search` | Docs track: from the Job Card's EPIC ids and family map, reads 업무 규칙 / 화면 흐름(유스케이스) / 설계 / 데이터 사전 items and the specs their resolvers return; ≤ 2 searches, only when the map fails. Loaded by the docs collector, not a user entry point. |
| `platty-mcp:platty-mcp-code-search` | Code track: from the Job Card's route candidates, reads spec claims as the map, the full `route_relations` checklist, and only the pointed `file:line`; both-sides, activation-proof, and failure-path rules. Loaded by the code collector (the impact investigator loads its claim, shell-input, and return rules), not a user entry point. |
| `platty-mcp:platty-mcp-memory` | Explicit memory and glossary-alias lifecycle requests. |
| `platty-mcp:platty-mcp-client-setup` | Register / validate an existing MCP endpoint; owns the plugin update check (`bin/platty-update-check`), which never runs while answering. |

Main-session reading per question is `SKILL.md` + `scoping.md` +
`job-cards.md` + `answer-template.md` (≈ 650 lines); `impact.md` and
`codex.md` only for impact questions and the Codex runtime.

## Explicit-only skills (never auto-selected)

These skills carry `disable-model-invocation: true` (Claude Code) and
`policy: { allow_implicit_invocation: false }` in their `agents/openai.yaml`
(Codex), plus an explicit-only description. Neither runtime picks them for a
question; invoke them by exact name (`/platty-mcp:<skill>` or `$<skill>` in
Codex). Their bodies are unchanged and the SDD / Figma workflows still run
through them.

| Skill | Role when invoked by name |
| --- | --- |
| `platty-mcp:using-platty-mcp` | Router and tool mapping for the SDD and Figma skills (`references/tool-mapping.md`, `figma-evidence-contract.md`). Project questions go to `platty-mcp-search` instead. |
| `platty-mcp:platty-mcp-retrieval` | Legacy retrieval ladder and Impact Seed Packet producer used by the SDD skills and `platty-mcp-impact-analysis`. |
| `platty-mcp:platty-mcp-code-qa` | Legacy code-track ladder (code-only mode) kept for the SDD skills. |
| `platty-mcp:platty-mcp-impact-analysis` | Standalone engineering Impact Dossier (Impact Seed Packet, `impactRevision`, cross-EPIC traversal, PRD §9). Business or QA impact questions go to `platty-mcp-search`. |
| `platty-mcp:platty-mcp-sdd-spec` | Writes `prd.md` and `user_stories.md` under `~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/`. |
| `platty-mcp:platty-mcp-sdd-design` | Writes `system_design.md` first (technical AS-IS/TO-BE, `CHG-*` change map, DB/data-impact assessment); `tasks.md` only after the user explicitly approves the reviewed design and the bundled readiness validator passes. |
| `platty-mcp:platty-mcp-figma-design-sync` | Reads one exact Figma target through configured Figma MCP and writes validated, revisioned evidence under `~/.platty/design-sync/<projectId>/<targetId>/reports/<reportId>/`. It does not edit Figma, product files, system design, tasks, generated SOT, or code. |
| `platty-mcp:platty-mcp-sdd-spec-from-figma` | A Figma URL plus an optional raw idea or existing PRD → CREATE or AUGMENT `prd.md` and `user_stories.md` (delegated to `platty-mcp-sdd-spec`), persists a revision-bound `figma_handoff.json`, stops before technical design. |
| `platty-mcp:platty-mcp-sdd-design-with-figma` | After a separate system-design request, aligns connected or independent approved product documents with current Figma evidence and delegates `system_design.md` to `platty-mcp-sdd-design`; `tasks.md` only after exact design-revision approval. It does not edit or modify `prd.md` or `user_stories.md`; product conflicts stop before design. |

Figma-grounded SDD flow, by name: `platty-mcp-sdd-spec-from-figma` (Figma URL
→ `prd.md` + `user_stories.md`, stop) → product approval →
`platty-mcp-sdd-design-with-figma` (independent or connected product pair →
`system_design.md`) → design approval → `tasks.md`. A new session discovers a
validated `figma_handoff.json` beside the product pair; a stale or invalid
sidecar blocks instead of being ignored. Korean companions:
`platty-mcp-figma-design-sync/SKILL.ko.md`,
`platty-mcp-sdd-spec-from-figma/SKILL.ko.md`,
`platty-mcp-sdd-design-with-figma/SKILL.ko.md`.

## Agents (Claude Code)

Discovered from `agents/`; Codex ignores the directory and spawns workers
with the same skill text inline (`platty-mcp-search/references/codex.md`), or
runs the jobs sequentially in-session without multi-agent support.

| Agent | Model | Reads |
| --- | --- | --- |
| `platty-evidence-collector-docs` | Sonnet, low | `platty-mcp-doc-search` + `job-cards.md` (JSON shape) |
| `platty-evidence-collector-code` | Sonnet, low | `platty-mcp-code-search` + `job-cards.md` |
| `platty-impact-investigator` | Opus, high, no call budget | `platty-mcp-code-search` Claim rules, shell input rules, and Return only; replaces the code job on impact questions and runs its own 6-step procedure |
| `platty-claim-auditor` | Sonnet, low, no tools | nothing — text comparison of the draft against the ledger (quotes included), identifier and family-abbreviation rewrite, intra-answer contradiction check, ask-coverage check |
| `platty-search-synthesizer` | Opus, high | `platty-mcp-search` steps 5–6; used only when the main session is not Opus-class |

Agent files hold only role, inputs, budget, tool limits, and output; every
rule lives once in the skill they load. The agents deny host shell, file
write, file edit, and subagent-spawn tools; they reach project evidence only
through the configured Platty MCP tools.

Read-only MCP enforcement: the MCP server name differs per deployment, and
Claude Code agent `tools` / `disallowedTools` patterns accept MCP wildcards
only as `mcp__<server>__*` or `mcp__*` — a server-name wildcard such as
`mcp__*__memory_request` is not supported, and plugin agents ignore a `hooks`
frontmatter field. The plugin therefore ships a plugin-level `PreToolUse`
hook, `hooks/collector-guard.sh` (registered in `hooks/hooks.json`). It acts
only when the calling agent is one of the five agents above and blocks any
MCP call unless its server segment is the configured Platty server
(`PLATTY_MCP_SERVER_NAME`, default `platty`; bare `mcp__platty__*` or
plugin-namespaced `mcp__plugin_<plugin>_platty__*`) and its tool is a
read-only tool of the Enterprise MCP catalog (memory and glossary-alias writes
and tools of other servers are blocked). The main session and other agents are
unaffected, so `platty-mcp-memory` keeps working.

The guard reads the top-level `agent_type` and `tool_name` of the hook input
with `node`, or `python3` when node is absent, so keys nested inside a tool's
arguments never activate or bypass it. When neither parser is available, or
the input is not a JSON object, it falls back to a conservative text scan: any
guarded `agent_type` (even a nested one) applies the guard, every `tool_name`
value present must be a read-only Platty tool, and a guarded call with no
readable tool name is blocked. Input with no guarded `agent_type` is always
allowed (fail-open for the main thread). Verified with mock payloads on the
node / python / scan parser paths; not yet verified against a live subagent
run.

Remaining limitations: the guard needs a POSIX `sh` (macOS and Linux); it
fails closed, so a new read-only Platty tool must be added to its list (a
repository test keeps the list equal to the Enterprise MCP catalog minus write
tools). Codex does not load the hook; in Codex the `spawn_agent` workers and
the sequential in-session mode follow the skills' read-only rules, which the
spawn prompt states explicitly.

## Answer shape

Four parts, fixed order: 결론 → 쉽게 말하면 → 근거 → 확인할 수 없는 부분
(impact questions add 바꾸면 같이 봐야 하는 곳 directly below 쉽게 말하면). One
answer serves two readers: 결론 and 쉽게 말하면 are in the customer's business
terms and screen names (no code identifiers), 근거 carries 확정 / 추론 /
문서상 값(코드 미확인) items with document and code locations. Where documents
and code differ, the answer follows the code. Every fact is 분석된 소스 기준
(the analyzed revision), never a statement about production. Full rules:
`skills/platty-mcp-search/references/answer-template.md`.

## Registering a code environment guide

The search skills read an operator-written code environment guide through
`code_search_guide_get`, once per session, and cut a Guide Brief per job. It
is optional but strongly recommended: without it, agents infer repository
roles from repository names and say so once in the answer.

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
