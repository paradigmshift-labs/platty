# Platty Enterprise MCP Tool Mapping

Use the live `tools/list` schema for the configured server. This reference describes
this repository's 54-tool typed Enterprise contract; it does not establish deployment.
Resolve returned IDs and replay selected `next.tool` with its complete `next.arguments`.
For semantic discovery, apply the retrieval skill's Discovery Packet Override:
only `project_get`, `epic_get` and `business_rule_get` receive `view:"summary"`,
and only the BR discovery get receives `itemLimit:20`. A selected packet with
explicit `view:"full"` is replayed unchanged; direct known-document/item reads
keep their exact route. IDs, scopes, cursors and all other arguments are preserved.
`<family>` below is a notation: select one concrete prefix from the table, never
send a tool named `<family>_*`.

## Route-specific capability gate

Confirm configured tools and read `context_status` before freshness-sensitive
claims. When the user did not name a project, omit `projectId`: the server
uses its default project. Do not call `project_list` first; call
`project_list` only when a call returns `INVALID_INPUT` naming `projectId` (no
default is set; the operator can set one with `platty project use <id>`), when
the user names a project without its opaque ID, or when the user asks which
projects exist. Check
only the selected route's required tools. A known BR document needs
`business_rule_get`; a known Spec needs `spec_get`; a Memory request needs
`memory_request`. Neither needs an unrelated glossary inventory or generic tool.
For semantic discovery require `project_get`, `domain_list/get`, `epic_list/get`
and the relevant typed maps. Missing a required branch yields a named capability
gap and partial coverage; available direct branches remain usable.

| Route | Concrete tools |
| --- | --- |
| Project/domain/EPIC map | `project_list`, `project_get`, `context_status`, `domain_list`, `domain_get`, `epic_list`, `epic_get` |
| Business SOT | family list/get/search/item_list/item_get below |
| Business to Spec | `business_rule_spec_resolve`, `use_case_spec_resolve`, `design_spec_resolve`, `data_dictionary_spec_resolve` |
| Spec | `spec_list`, `spec_get`, `spec_search`, `spec_business_resolve`, `spec_impact_resolve` |
| Vocabulary | `glossary_document_list/get/search`, `glossary_term_list/get/search`, `glossary_translate`, `glossary_alias_list` |
| Alias writes (ADMIN/SUPER_ADMIN) | `glossary_alias_add`, `glossary_alias_update`, `glossary_alias_remove` |
| Memory | `memory_list`, `memory_get`, `memory_request` |
| Source/graph | `code_search_guide_get`, `workspace_repo_list`, `workspace_search`, `readonly_workspace_shell`, `code_search`, `graph_trace` |
| Static-analysis routes | `route_resolve`, `route_relations`, `route_code`, `code_routes`, `route_text_links` (no generated documents required) |
| Managed Git | `workspace_git_history`, `workspace_sync_status` plus repo selection |
| Markdown projection | `sot_render` |

## Typed business maps

| Returned business type | Concrete prefix | Exact document read | Exact item read | Spec bridge |
| --- | --- | --- | --- | --- |
| `br` | `business_rule` | `business_rule_get` | `business_rule_item_get` | `business_rule_spec_resolve` |
| `ucl` | `use_case` | `use_case_get` | `use_case_item_get` | `use_case_spec_resolve` |
| `design` | `design` | `design_get` | `design_item_get` | `design_spec_resolve` |
| `data_dictionary` | `data_dictionary` | `data_dictionary_get` | `data_dictionary_item_get` | `data_dictionary_spec_resolve` |
| `glossary` | `glossary_document` | `glossary_document_get` | `glossary_term_get` | none |

The first four prefixes expose list/get/search/item_list/item_get. Glossary
exposes document list/get/search and term list/get/search. All business document
families are business-track; the five Specs are technical-track. Open
full `project_get`/`epic_get.documentRefs` with their returned concrete continuations.
Summary maps instead expose `documentAvailability` and typed-list continuations.
Select positive counts for the needed families; EPIC
`supportingDocumentAvailability` may require its returned `epic_get(view:"full")`
to recover supporting refs outside direct EPIC lists. Select that full packet
only when the question needs those links; an empty direct list does not remove
supporting links.
Use returned item IDs, not ordinal numbers, titles, or guessed field keys.

| Operation | Arguments |
| --- | --- |
| Family list | `projectId`; optional `epicId`, `limit`, `cursor` |
| Family get | `projectId`, `documentId`; optional `itemLimit`; only `business_rule_get` accepts optional `view=summary\|full`, and in view full `coverageLimit`/`coverageCursor` |
| Family search | `projectId`, `query`; optional `epicId`, `matchMode`, `limit`, `cursor` |
| Family item list | `projectId`, `documentId`; optional `limit`, `cursor` |
| Family item get | `projectId`, `itemIds` (1–5 unique IDs); optional `evidenceLimit` (default 20, max 500), `evidenceCursor` (one item only); exact bodies |
| Family Spec resolve | `projectId` and exactly one of `documentId` or `itemId`; optional `limit`, `cursor` |
| Term list / alias list | `projectId`; optional `epicId`, `limit`, `cursor` |
| Term get / search | `projectId`, `termId` / `query`; search optionally `epicId`, `limit`, `cursor` |
| `glossary_alias_add` | `projectId`, `epicId`, `canonicalTerm`, `alias`, `reason` |
| `glossary_alias_update` | `projectId`, `aliasId`, `alias`, `reason`; optional `expectedRevision` |
| `glossary_alias_remove` | `projectId`, `aliasId`, `reason` |

Exact item reads return one page of at most `evidenceLimit` evidence claims per
item. `evidenceCount` is the visible total and `evidenceOmitted` counts the claims
not on this page. An item with more claims carries `evidencePage`; its returned
continuation re-reads that one item with `evidenceCursor` (the page's
`nextCursor`) and ends when `hasNextPage` is false. An omitted claim is unread,
not absent.

DD maps data objects and their columns. Read the exact parent and its approved
Memory before field conclusions. Use DD's Spec resolver for persisted usage
connections when asked; relationships are evidence of links, not execution proof.
Item pagination is needed only for completeness or a missing selected item.

## Project and Spec inputs

`project_list` takes optional `limit/cursor` and marks the server default with
`isDefault`; `project_get` and `context_status` take `projectId` (optional when
the server publishes it as defaulting to the current project); `project_get` also takes optional `view=summary\|full`.
`domain_list` optionally takes `query/limit/cursor`,
`domain_get` requires `domainId`; `epic_list` optionally takes
`domainId/status/limit/cursor`, and `epic_get` requires `epicId` and accepts
optional `view=summary\|full`.

`view` is accepted only by `project_get`, `epic_get`, `business_rule_get` and `spec_get`;
no other get, list, exact item, resolver or Memory tool accepts it. For the first
three, omitted `view` or `view:"full"` retains the existing full response. Both BR
views default `itemLimit` to 50 (range 1–200); discovery explicitly uses 20.
Summary retains `responseSchemaVersion=enterprise-mcp-sot.v1`, approved Memory
cards/continuations and read diagnostics. BR summary exposes `header`,
`coverageSummary`, item cards with `evidenceCount`, and `itemPage`, rather than full
sections/evidence. In BR view full the `br_coverage` section pages its rows:
`coverageLimit` (default 50, max 1000) and `coverageCursor`; the section carries
`totalRows` and `rowPage`, and the returned `business_rule_get` continuation reads
the next page. Exact reads remain the proof gates.

| Tool | Arguments after `projectId` |
| --- | --- |
| `spec_list` | optional `epicId`, `specKind`, `limit`, `cursor` |
| `spec_search` | `query`; optional `epicId`, `specKind`, `matchMode`, `limit`, `cursor` |
| `spec_get` | `documentId`; optional `view`, `claimLimit`, `claimCursor`, `claimPath` |
| `spec_business_resolve` | `specDocumentIds` (1–5 unique); optional `limit`, `cursor` |
| `spec_impact_resolve` | `specDocumentIds` (1–5 unique); optional `direction=incoming\|outgoing\|both`, `limit`, `cursor` |

`spec_get` defaults to `view:"summary"`: `header`, `identity`, `summary`,
`relations`, `input`/`response`, `screen`, `db`, `quality` and `memories` in full,
plus one page of claims. Claims are ordered nearest the route handler first (route
bundle depth) and carry `claimId`, `text`, `kind`, `origin`, `values`, `locations`
and `state`; the spec id, title and `semanticTargetId` are stated once at the top.
`claimLimit` (default 20, max 200) sizes the page, `claimPage`/`totalClaims` say what
is left, and the returned `claimCursor` continuation reads the next page. A cursor
is bound to the claim order it was issued for; when that order changes (the route
bundle became readable or unreadable, or the spec changed) it answers
`INVALID_CURSOR`: restart from the first page.
`claimFiles[{repositoryId,path,claimCount,depth}]` indexes every claim location
(`path:null` counts claims without a readable location); pass one `path` as
`claimPath` to read that file's claims. `view:"full"` returns every claim in the
full evidence shape (large specs reach hundreds of KB) and accepts no claim
arguments. Read the claims you cite; an unread page is not absence.

`specKind` is `api_spec`, `screen_spec`, `event_spec`, `schedule_spec`, or
`db_logic_spec`. Omission covers all five. Complete inventory follows every
`pageInfo.nextCursor` until `hasNextPage=false`; relevance search is discovery.
Lists default 50/max 200; search defaults 20/max 200. Search match modes are
`smart/all/any/phrase`. Exact IDs bypass search.

## Memory inputs and safe continuation

| Tool | Arguments after `projectId` |
| --- | --- |
| `memory_list` | optional `scope=own_requests\|approved` (default `own_requests`), `requestStatus=pending\|approved\|rejected` only with own scope, `epicId`, `documentId`, `limit`, `cursor` |
| `memory_get` | `memoryId`; optional scope (default `own_requests`) |
| `memory_request` | `content` (trimmed 1–4000 chars), `memoryKind=context\|correction\|constraint\|why`, `anchor` |

Request anchors are exactly `{kind:"project"}`, `{kind:"epic",epicId}`,
`{kind:"document",documentId}`, or `{kind:"document_item",itemId}`.
Actor, source, approval status and parent hydration are server-owned. Persisted
list/get `anchor` may be null for incomplete/orphaned facts; preserve a valid
stored anchor without inventing its parent. Request receipts have a non-null
anchor and pending approval; they do not prove acceptance or lifecycle activation.
For attached approved summaries replay the returned `memory_get` continuation
including `scope:"approved"`; default own scope is for inspecting the caller's
requests. Approved scope never widens `READ_OWN/READ_ALL` or reveals another
actor's pending/rejected proposals. Glossary-level Memory is hidden.
Only an explicit request routes to `platty-mcp-memory`. Alias writes return the
audited alias record or `FORBIDDEN`/`CONFLICT`; Memory update/delete and
approve/reject are administrator surfaces outside this MCP catalog.

## Graph, source and Git inputs

`code_search_guide_get(projectId, cursor?)` returns the operator-provided guide
stored at `<SOT root>/_guides/<projectId>/code-search-guide.md`: `guide.available`,
`content` (Markdown), `updatedAt`, `sha256`, `totalChars`, and `pageInfo`. Long
guides page at 60,000 characters; replay `nextCursor`. `available: false` means
no guide is registered and is not an error. It scopes source search; it is not
behavior evidence.

`graph_trace` requires `projectId`, `seeds:[{kind:"code"|"service_map",nodeId}]`
(1–5 unique IDs of ONE namespace), optional `direction=incoming|outgoing|both`,
`depth` (default 1, max 5), `kinds`, `limit/cursor`. Use `depth:1` for one-hop
provenance and agent-owned frontier walking; replay returned typed seeds.
A seed `nodeId` is the `id` of a returned graph node (`spec_impact_resolve` or
`graph_trace` `nodes`/`frontier`) with that node's `namespace` as `kind`.
Track visited `(kind,nodeId)` pairs and keep confirmed/candidate/omission/
truncation distinctions. An empty trace is no proof of no impact.
`code_search(projectId,query,repoId?,limit?,cursor?)` searches indexed name/path/
signature metadata, not file contents or execution.

`workspace_repo_list(projectId,limit?,cursor?)` selects a registered repository.
`readonly_workspace_shell(projectId,repoId,command,cwd?,timeoutMs?,maxBytes?)`
uses the backend's bounded read-only allowlist and root jail. `maxBytes` caps
stdout at default 64000 bytes, max 1000000; a cut-off read returns
`truncated: true` with a `truncationNotice` saying where output stopped and that
the rest was not read. Narrow the command (sed ranges, `rg -m`, a path) before
raising `maxBytes`; never treat a truncated read as the whole file. Project-read plus
registered repository/sourceRoot/managed-worktree authorization allows unindexed
files inside that root; exact source-node/file restrictions still govern graph
and derived SOT evidence. Preserve safe availability, exit, truncation, and
pipeline results. Missing worktree/Git metadata is an observation, not readiness.
No host-local fallback or project execution. `sed -n` takes up to 10 print
ranges as `'10,20p;40,50p'` or repeated `-e 10,20p`; `INVALID_INPUT` messages
name the rejected token or the command allowlist.

`workspace_search(projectId,pattern,repoIds?,globs?,ignoreCase?,fixedStrings?,limit?,perRepoLimit?,timeoutMs?)`
runs one ripgrep pattern across several authorized repositories (all of them
when `repoIds` is omitted) under the same root jail and secret deny rules as
the shell. It returns matches grouped by file,
`files[{repoId,path,lines[{line,text}]}]` (paths relative to the repository
sourceRoot, a matched line cut at 400 characters with `…`), the total `matchCount`,
per-repository `repositories[{repoId,name,status,matchCount,truncated}]`,
and an overall `truncated` flag. Limit default 100/max 1000; per-repository
timeout default 10s/max 15s under one 60s deadline. Only `status: complete` is
full coverage. Files larger than 16MB are skipped (rg `--max-filesize 16M`), so
a generated bundle or data dump can hold an unreported match; read it with a
bounded shell command when it matters. Matches are candidates; confirm with a
bounded `readonly_workspace_shell` read (the `next` continuation reads the first hit).

`route_resolve(projectId,query?,httpMethod?,repoIds?,kinds?,includeDeprecated?,limit?,cursor?)`
looks up static-analysis entry points (`kinds`: `api|page|job|event`) by a
case-insensitive literal substring of the path, full path, source identity
(for example a screen id), or handler id/name/file. Exact and suffix matches
rank first. It returns every candidate, including the same route mirrored in
several repositories (never auto-picked): `items[{entryPointId,repoId,kind,
framework,httpMethod,path,fullPath,sourceIdentity,handler{nodeId,filePath,name,
lineStart,lineEnd}|null,confidence,deprecated,deprecation{reason,note,decidedAt}|null,
relationCount}]`. `includeDeprecated` defaults to true; `deprecated` means the
route was curated out of documentation scope, not removed from code. Limit
default 20 with a query and 10 without a `query` (an inventory browse), max 100.
`next` opens `route_relations` for the first 20 items; open the others with their
`entryPointId`.

`route_relations(projectId,entryPointId,kinds?,limit?,cursor?)` reads the
route's code-bundle relations ordered by bundle depth: `relations[{relationId,
repoId,kind,operation,target,canonicalTarget,sourceNodeId,depth,details,
evidence[{nodeId|null,repoId,filePath,lineStart,lineEnd}],confidence,
unresolvedReason,connection,via{path[{name,edge}],complete}}]` plus `entryPoint`
and `bundle{nodeCount,repoIds,maxDepth}`. `via` is the bundle path from the handler
to the relation's source (at most 6 hops; `complete:false` when it stops short). `kinds` are relation kinds (`db_access`, `api_call`, `navigation`,
`external_service`, `event_publish`, ...). `details` is a closed scalar subset
(for example `tableName`, `namespace`, `statementId`, `queryId`, `sqlSessionName`,
`method`, `url`); evidence with `nodeId: null` is a mapper/resource file without
a graph node. Limit default 100/max 500. `next` reads the first evidence lines
with `readonly_workspace_shell` and opens resolved cross-repository target
routes. Relations are static-analysis candidates: an `unresolvedReason` or an
empty list is a lead to search, never proof of absence.

`route_code(projectId,entryPointId,includeAllNodes?,limit?,cursor?)` lists the
authorized code a route reaches (its code bundle) by depth, then file and line:
`nodes[{nodeId,repoId,type,name,filePath,lineStart,lineEnd,depth,via,
relationCount,hasRelations,dataAccessCandidate}]` plus `entryPoint` and
`summary{nodeCount,repoIds,maxDepth,shownCount,hidden[{reason,count}]}`. By
default only code worth reading is listed: functions, methods, classes (and
mixins/extensions), the handler, and any node with relations. Properties,
variables, interfaces, types, enums, namespaces, files, and idle functions
inside a constant initializer (`constant_member`: no call, render, or dependency
of their own, e.g. object-literal key factories) are counted in
`summary.hidden`; a contained function that calls anything, and every
`dataAccessCandidate`, stays listed. Pass `includeAllNodes:true` to list all.
`filePath` is sourceRoot-relative, ready for `readonly_workspace_shell` and
`code_routes`. `dataAccessCandidate` marks a node without relations that makes
the same call (receiver chain + method) as an extracted db_access call site:
likely data-access code whose link was not extracted. Use it when
`route_relations` lacks the expected DB/API facts. Limit default 200/max 1000.
`next` opens `route_relations` and reads up to three unlinked nodes, data-access
candidates first.

`code_routes(projectId,target,kinds?,includeDeprecated?,limit?,cursor?)` is the
reverse lookup for impact: `target` is `{nodeId}` or
`{repoId,filePath,line?,innermostOnly?}` (sourceRoot-relative or stored path).
With `line`, only the innermost node spanning it is a target (the method, not
its enclosing class; on equal spans the owned child); `innermostOnly:false` adds
the enclosing nodes. It returns
`targets[{...,routeCount}]` (`routeCount` is the visible routes reaching that
node; a container target lists at most 20 targets, busiest first, ranked over
every target of the file or class; `targetCount` is the true total and
`targetsTruncated` is true when some are not listed) and every visible route whose bundle
contains a target, shallowest first; `items[].target.nodeId` names which target
the route reached:
`items[...route_resolve fields, relationCount, target{nodeId,depth,via}]`. Same
`kinds`/`includeDeprecated` semantics as `route_resolve`; limit default 20/max
200; `next` opens `route_relations` for the first 20 items. A route list is static-analysis
reach, not runtime proof; an empty list is not proof that no caller exists.
Under auxiliary graph roots a `filePath` is read as shown by these tools
(sourceRoot-relative) first and as a stored path second. A route, node, or file
outside your authorized source scope answers `NOT_FOUND`, exactly like a missing
one, for `route_relations`, `route_code`, and `code_routes`.

`route_text_links(projectId,direction,from,targetRepoIds?,includeTests?,includeDocs?,limit?,cursor?)`
finds screen-to-API links that static analysis missed by matching the
authorized API route inventory (the authority) against source text with
identifier-boundary literal matching; it has no framework rules. `from` is
`{entryPointId}` (the route's handler file) or `{repoId,filePath}` (stored or
sourceRoot-relative path, resolved like `code_routes`); every `filePath` it
returns is sourceRoot-relative, ready for `readonly_workspace_shell`.
`direction: outgoing` reads that one file through the shell's jail and deny
rules (16MB cap) and returns API candidates
`items[{entryPointId,repoId,httpMethod,fullPath,handler{nodeId,name,filePath,lineStart},
matchLevel,matchedText,lines[{line,text}],ambiguity,alreadyLinked,deprecated,sourceFilePath}]`;
routes declared in a scanned file itself are omitted. When `from` is an
`entryPointId` whose file mentions no route (a thin page that only renders a
component), the files its code bundle reaches in the same repository at depth
1-4 (nearest first, at most 20) are scanned too; `sourceFilePath` names the
file each candidate's `lines` come from. `direction: incoming` takes an API
route and returns the source files that mention it,
`items[{repoId,filePath,matchLevel,matchedText,ambiguity,lines,entryPointCount,entryPoints[{entryPointId,
kind,httpMethod,path,fullPath,deprecated,alreadyLinked}]}]`, each file resolved to
the routes it declares (empty when it declares none; at most 20 listed). Test
paths are excluded unless `includeTests`, and documentation/API-description
files (`*.md`, `*.mdx`, `*.rst`, `*.adoc`, `*.http`, `swagger*`/`openapi*`
JSON/YAML) unless `includeDocs`. `matchLevel` ranks `full_path` (a path of two
or more segments, with or without the leading slash or a known base prefix) >
`path_suffix` (last two segments) > `templated_prefix` (a templated route
`/feed/:id`, `/feed/{id}` matched by its literal prefix followed by a run-time
part such as `${id}`, `$id`, `' + id`, then every literal segment between its
parameters in order, all within the same string expression (a string that just
ends after the prefix, `'/feed/'`, is the literal path, not the template);
`matchedText` reads `feed/{*}` or `orders/{*}/items/{*}`) > `method_name` (last segment,
6+ characters, common verbs excluded; a one-segment path like `/admin` ranks
here at most). A mention that the text continues as a longer path
(`/api/feed/recommended`, `/api/feed/${id}`) does not match the shorter route,
and a longer inventory path owns the text it covers. Items are ordered by level,
then `ambiguity` (inventory routes sharing the matched text). `alreadyLinked`
is true when a stored service-map `calls_api` edge, an active operator
override, or a resolved connection already links the two routes, and null when
the scanned file declares no route. `subject{repoId,filePath,entryPointIds}`
names what was requested. `coverage{filesScanned,skippedFiles,truncated,
truncatedReasons,timedOutRepos,unavailableRepos,inventoryRoutes}`: `truncated`
is true exactly when `truncatedReasons` is non-empty (`inventory_bound`,
`file_cap` (500 files / 128MB), `deadline`, `search_incomplete`,
`oversized_files` (over 16MB, counted in `skippedFiles`),
`size_check_incomplete`, `unreadable_files`, `unavailable_repos`,
`timed_out_repos`, `anchor_fanout`, `bundle_file_cap`); then a missing
candidate is not evidence of no link. A truncated scan cannot be resumed by
cursor: narrow `targetRepoIds`, or run `workspace_search` on the route's path,
which decides. `pageInfo.nextCursor` pages the items of a scan. Limit default
50/max 500 (lines up to 5, up to 2 above limit 100). Candidates are text
evidence, not proven calls: confirm the line with `readonly_workspace_shell`
(the `next` continuation reads it) before recording a link.

`workspace_git_history(projectId,repoId,path?,limit?,cursor?)` defaults 20/max 50.
`workspace_sync_status(projectId,repoId)` distinguishes analyzed revision,
worktree HEAD, cached branch commit and comparison. Timestamps may be unavailable;
cached sync SHA is not analysis evidence. Their closed evidence says
`source=managed_analysis_worktree`, `networkChecked=false`,
`productionDeploymentObserved=false`. No fetch or deployment inference.

## Projection and result handling

`sot_render(projectId,documentId,itemLimit?,itemCursor?)` returns DB-rendered
Markdown from the canonical authorized view. It is a projection, not a stored
original file download; name this distinction for original-file requests.
Results arrive twice: `structuredContent` is the typed result and the text block
is a compact rendering of it, not a JSON copy (record lists as tables, empty fields
dropped, columns equal in every row listed once, values over 1000 characters cut
with `…[+N chars]`; ids, cursors and `next` arguments are never cut). Hosts that
show only one of them show the model the same facts. Operators can restore a JSON
text copy with `PLATTY_MCP_TEXT_CONTENT=json`.
Published output schemas are closed success-or-error unions. Success uses
`responseSchemaVersion=enterprise-mcp-sot.v1`, `projectId`, and `next` plus the
named tool payload. SDK execution errors use `isError` and safe structured
`code/message/retryable`; a schema-valid error is not evidence of success.
`INVALID_INPUT` from argument validation names the argument and the allowed
values or range (for example `limit: must be an integer from 1 to 200.`).
The ten public codes are `INVALID_INPUT`, `INVALID_CURSOR`, `SOT_TYPE_MISMATCH`,
`NOT_FOUND`, `FORBIDDEN`, `MAPPING_MISSING`, `REGENERATION_REQUIRED`,
`CONTEXT_UNAVAILABLE`, `GLOSSARY_SEARCH_UNAVAILABLE`, `RESULT_LIMIT_EXCEEDED`.
On invalid cursor restart scoped discovery; preserve regeneration-required and
missing-provider states instead of treating them as empty current evidence.
`context_status` per-tool `status/reason` is an observed local authorized
snapshot, not proof of network search, remote freshness, or deployment.

## Codex multi-agent dispatch

Used by `platty-mcp-hybrid-qa` when the Codex session offers multi-agent
support. The same job split and collector JSON contract apply as on Claude
Code; only the dispatch tools differ. Native mode requires all three tools
below (`spawn_agent`, `wait_agent`, `close_agent`); if any is missing, run the
jobs sequentially in-session.

| Action | Codex tool |
| --- | --- |
| Dispatch one collector job (one worker per Job Card) | `spawn_agent` with `fork_turns: "none"`, explicit `model` and `reasoning_effort`, and a self-contained prompt: Job Card, Guide Brief, JSON contract, ladder reference, and the read-only rule |
| Collect a worker result | `wait_agent` |
| Free a finished worker slot | `close_agent` |

Model routing (labels are role preferences; check availability and record
substitutions in the run notes; a user-requested model needs approval before
it is substituted):

| Role | Model class |
| --- | --- |
| Mechanical evidence collection (collector jobs) | Luna-class, `xhigh` effort |
| Judgment (verify conflicts, write answers) | SOL-class worker, or the main session when it is already SOL/Astra class |

The Codex default `fork_turns: "all"`
rejects model and effort overrides and exposes the whole session (full guide,
opposite-track results) to the worker, so always pass `fork_turns: "none"`
and put everything the worker needs in its prompt; the SOL-class synthesis
worker likewise receives the collector JSON, Session Card, and audience list
explicitly.

Run up to 6 workers at once with rolling dispatch. The Claude Code read-only
hook does not apply in Codex: the spawn prompt must say workers never write
files or call mutation tools. An external model CLI is never an automatic
fallback.
