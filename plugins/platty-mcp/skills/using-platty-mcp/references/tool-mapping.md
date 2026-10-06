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
| Static-analysis routes | `route_resolve`, `route_relations`, `route_code`, `code_routes`, `route_text_links`, `route_impact_candidates` (no generated documents required) |
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
three, omitted `view` or `view:"full"` retains the existing full response. BR view
full defaults `itemLimit` to 50 and view summary to 20 (range 1–200); discovery
explicitly uses 20.
Summary retains approved Memory cards/continuations and read diagnostics. BR
summary exposes `header`,
`coverageSummary`, item cards with `evidenceCount`, and `itemPage`, rather than full
sections/evidence. In BR view full the `br_coverage` section pages its rows:
`coverageLimit` (default 50, max 1000) and `coverageCursor`; the section carries
`totalRows` and `rowPage`, and the returned `business_rule_get` continuation reads
the next page. `excluded` rows are counted (`rowsByDisposition`,
`excludedRowsOmitted`) and listed only with `includeExcludedCoverage:true`. A
coverage continuation page returns only coverage rows: `items`/`sourceDocuments`
are empty there and named in `omitted` (the first page carried them). A family get
or item list with more items returns a `<family>_item_list` cursor continuation.
Exact reads remain the proof gates.

Results are compact: a field is absent when it is duplicated or derivable. A
family list/search row omits `type` and `track` (they equal the tool; spec rows
keep their kind); `readState` appears only when not `current`; a null `summary`
is omitted; `itemType` is stated once at the top when every row shares it; an
item `title`/`summary` equal to its body text is omitted; a header `scopeId`
equal to `epicId` is omitted. Bookkeeping (`updatedAt`, `track`, schema
versions, `memoryAnchorCounts`) returns with `includeMetadata:true`; a document's
`sourceDocuments` with `includeSourceDocuments:true` (`sourceDocumentCount` is
always there); search `matchedFields` with `includeMatchedFields:true`; DD
`dd_unlinked_accesses` ids with `includeAccessIds:true` (`accessCount` and
`accessesByDisposition` by default). `glossary_document_get` returns the header,
`termCount` and `moreTerms` without term rows unless `includeTerms:true`, and no
item cursor (no tool takes one): its `next` continues with
`glossary_term_list(epicId)`; find terms with `glossary_term_search`.
`glossary_term_list` pages 20 terms by default.
`spec_business_resolve` groups rows by business document (`document` once per
group, `specDocumentId`/`itemType` once at the top when shared); its `next` opens
each item exactly (`<family>_item_get`, ids batched up to 5) and each business
document once (`<family>_get`) for the first 20 rows. A spec summary
states `claimRepositoryId`, `claimOrigin` and `claimState` once when every claim
on the page shares them, and omits `specTitle` when it equals the header title.

Typed search hits carry `documentTitle`, `epicId` and `epicName` (null without an
owning EPIC), `itemId` only for item hits, and `snippet` (authored case, so it can
be quoted) only when it differs from `title`; `next` opens each hit once: item hits with the exact
`<family>_item_get` (ids batched up to 5; glossary terms with
`glossary_term_get`) and each parent document once. Exact item reads add
`spec_get` for the specs their evidence and body sources (`sourceSpecs`,
`technicalSources`, spec-typed `primarySources`/`referenceSources`) cite (up to
5) and `<family>_spec_resolve(itemId)` per item (up to 5); `glossary_term_get`
adds the same `spec_get` continuations for its evidence and `sourceSpecs`.
`glossary_term_search` opens its first 5 hits with `glossary_term_get` and
summarizes each of their EPICs once (`epic_get(view:"summary")`); use the row
`epicId` for the rest. `domain_get` adds `epic_list(domainId)`; `domain_list`
opens `domain_get` for its first 20 rows; `context_status` opens
`project_get(view:"summary")`; `memory_list` opens `memory_get` for its first 20
rows in the scope it was listed with.

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
`entryPointId` names the static-analysis route a route/screen/event/job-scoped spec
documents (null otherwise or when the route is outside your source scope); `next`
then opens `route_relations(entryPointId)` (and `route_code(entryPointId)` when
the spec records no relation), and every spec opens `spec_business_resolve`.
`identity.handlerFilePath` and claim `locations[].path` are sourceRoot-relative,
the form `readonly_workspace_shell` and `code_routes` take, even when the
repository lists an auxiliary graph root.

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
`graph_trace` `nodes`/`frontier`) with that node's `namespace` as `kind`; a
row without `namespace` uses the top-level `namespace` of the response (the
compact result omits a row's `namespace` when it equals the top-level one).
Track visited `(kind,nodeId)` pairs and keep confirmed/candidate/omission/
truncation distinctions. An empty trace is no proof of no impact.
`code_search(projectId,query,repoId?,limit?,cursor?)` searches indexed name/path/
signature metadata, not file contents or execution. Each item's `path` is
sourceRoot-relative (what `readonly_workspace_shell` and `code_routes` take);
`next` seeds `graph_trace` with the first nodes.

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
sourceRoot, a matched line cut at 400 characters with `…`), the listed `matchCount`,
`repositoriesSearched`, per-repository
`repositories[{repoId,name,status,matchCount,truncated}]` listing only a
repository with listed matches, one cut by its own or the overall limit
(`truncated: true`, possibly with `matchCount: 0`), or one that did not complete
(a repository not listed completed with no match), and an overall `truncated`
flag. Limit default 100/max 1000; per-repository timeout default 10s/max 15s
under one 60s deadline. Only `status: complete` with `truncated: false` is
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
relationCount}]`. `handler.filePath` is sourceRoot-relative (what
`readonly_workspace_shell` and `code_routes` take), as in every route tool.
`includeDeprecated` defaults to true; `deprecated` means the
route was curated out of documentation scope, not removed from code. Limit
default 20 with a query and 10 without a `query` (an inventory browse), max 100.
`next` opens `route_relations` for the first 20 items; open the others with their
`entryPointId`. Each item carries `specDocumentIds` (the route's generated specs you
can read; `[]` when none), and `next` opens the first specs with `spec_get`;
`route_relations` and `route_code` carry the same top-level `specDocumentIds`.

`route_relations(projectId,entryPointId,kinds?,includeViaPath?,limit?,cursor?)` reads the
route's code-bundle relations ordered by bundle depth, grouped by source node:
`sources[{sourceNodeId,name,repoId?,depth,parent?,edge?,via?,
relations[{relationId,kind,operation,target,canonicalTarget?,canonicalUnresolved?,details,
evidence[{nodeId?,fileOnly?,repoId?,filePath,lineStart,lineEnd}],confidence?,
unresolvedReason?,connection?}]}]` plus `relationCount`, `relationDefaults?`,
`entryPoint`, `specDocumentIds` and `bundle{nodeCount,repoIds,maxDepth}`.
A source's chain from the handler is stated once, by parent pointer: `parent`
is the index in `sources` of the caller source and `edge` the bundle edge that
reached it; the full chain is the parent's chain plus `{name,edge}`, and its
completeness is the parent's. A source whose caller is not a source on this
page (most depth-1 sources: the handler itself has no relations), or whose
proven chain stops short of the handler, carries `via{path[{name,edge}],complete}`
instead (at most 6 hops; `complete:false` when it stops short). Pass
`includeViaPath:true` to get `via` on every source. `repoId` appears only when it
differs from `entryPoint.repoId`. An evidence row names `nodeId`/`repoId` only
when they differ from its source's, and `fileOnly:true` marks a mapper/resource
file without a graph node (never the source's own line). Defaults are not restated: `canonicalTarget`
is absent when it is `db:<target>:<operation>` (a `null` one the engine did not
resolve is the flag `canonicalUnresolved:true`, never a dropped null),
`confidence` when `high`, `unresolvedReason` and `connection` when `null`; a
detail constant over every relation of the page (`orm`, `adapter`) is stated
once in `relationDefaults.details`. `details.modelName` is model evidence and
stays even when it equals `tableName` (absent means no model evidence). Everything informative stays: `tableVerified:false`,
`adapter:user_supplement`, every evidence line, every `unresolvedReason`, every
resolved `connection.targetEntryPointId`. `kinds` are relation kinds (`db_access`, `api_call`, `navigation`,
`external_service`, `event_publish`, ...). `details` is a closed scalar subset
(for example `tableName`, `namespace`, `statementId`, `queryId`, `sqlSessionName`,
`method`, `url`). Limit default 100/max 500. Every `evidence[].filePath` is
sourceRoot-relative (what `readonly_workspace_shell` and `code_routes` take).
`next` reads the first evidence lines with `readonly_workspace_shell`, opens
resolved cross-repository target routes, and, when the page holds no relation,
opens `route_code(entryPointId)` first (the bundle is where missing DB or API
facts hide). Relations are static-analysis candidates: an `unresolvedReason` or an
empty list is a lead to search, never proof of absence.

`route_code(projectId,entryPointId,includeAllNodes?,maxDepth?,includeNodeIds?,includeViaPath?,limit?,cursor?)` lists the
authorized code a route reaches (its code bundle) by depth, then file and line:
`nodes[{nodeId?,repoId?,type,name,filePath,lineStart,lineEnd,depth,parent?,edge?,via?,
relationCount,dataAccessCandidate?,folded?{callbacks?,locals?}}]` plus `entryPoint` and
`summary{nodeCount,repoIds,maxDepth,shownCount,hidden[{reason,count}],folded?{callbacks,locals}}`.
A node's proven path from the handler is stated by parent pointer: `parent` is
the index in `nodes` of its caller and `edge` the bundle edge that reached it;
walk `parent` to the handler (index of the depth-0 node) to rebuild the chain.
The handler, a node whose caller is not on this page (hidden, filtered by
`maxDepth`, or on another page), and a node whose proven chain stops short of
the handler carry `via{path,complete}` instead; `includeViaPath:true` keeps
`via` on every node. `nodeId` is omitted unless `includeNodeIds:true` (needed
only for `graph_trace` seeds or `code_routes` `{nodeId}`; `readonly_workspace_shell`
and `code_routes` take `repoId`+`filePath`+`line`). A `nodeId` is a scoped
symbol (`Usecase.execute.countQuery`, `:callback:276:15`), not derivable from
`repoId`+`filePath`+`name`, so whenever nodes are listed without ids `next`
re-reads the same page (same shaping and cursor) with `includeNodeIds:true`. `repoId` appears only when it
differs from `entryPoint.repoId`; a node has relations when `relationCount > 0`;
`dataAccessCandidate` appears only when `true`. By
default every named node is listed; the view never hides a function, method
or class. The only reduction is folding: an anonymous callback
(`callback@<line>`) or local variable at depth > 1 with no relations, that is
not a step on the chain of any listed node (a step listed this way protects
the steps of its own chain in turn, so a listed node never loses a row of its
path), and whose caller is uniquely identified on the page folds into that
caller as `folded{callbacks?,locals?}` counts (`summary.folded` totals them);
any other callback or local stays listed. Core itself lists only code worth reading: properties, variables,
interfaces, types, enums, namespaces, files, and idle functions inside a
constant initializer (`constant_member`: no call, render, or dependency of
their own, e.g. object-literal key factories) count in `summary.hidden` by
type over the whole bundle. `shownCount + folded + hidden` is the authorized
bundle (on a paged read the rows of the other pages count as `other_pages`).
Nothing is dropped silently: `next` states `route_code(...,includeAllNodes:true)`
whenever something was folded or hidden, and that call lists every authorized
node of the page exactly as the bundle has it (no fold).
`filePath` is sourceRoot-relative, ready for `readonly_workspace_shell` and
`code_routes`. `dataAccessCandidate` marks a node without relations that makes
the same call (receiver chain + method) as an extracted db_access call site:
likely data-access code whose link was not extracted. Use it when
`route_relations` lacks the expected DB/API facts. Limit default 50/max 1000.
`maxDepth` defaults to 2: deeper nodes stay listed only when they have relations
or are data-access candidates, and the rest count in `summary.hidden` as
`beyond_max_depth`; `includeAllNodes:true` without `maxDepth` lists every node at
every depth. `next` continues the page, opens `route_relations`, reads deeper code
(`maxDepth` = bundle depth) when some was hidden, and reads up to three unlinked
nodes, data-access candidates first.

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

`route_impact_candidates(projectId,entryPointIds|specDocumentIds,values?,excludeGlobs?,includeDeprecated?,tableLimit?,routesPerTableLimit?,eventLimit?,listenersPerEventLimit?,callersPerRouteLimit?,valueHitsPerRepoLimit?)`
returns the impact candidate list of 1-5 changed routes in one deterministic
read: `dataTargets`, `tables[{tableKey,accessors}]`, `events[{listeners}]`,
`callers[{apiEntryPointId,callers}]`, `values` (each value as a fixed string in
every authorized repository; `excludeGlobs` only exclude, ≤ 20), `routes`
(cards by `entryPointId`) and `coverage{complete,partial[{reason,recovery,recoverable}]}`.
Every row has `resolution` (`confirmed` | `unresolved`) and `reason`; a cut is
never complete unless its `recovery` was run. Heavy lane.

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
Published output schemas are closed success-or-error unions. The server
`initialize` instructions state the result schema version
(`enterprise-mcp-sot.v1`) once; a success result carries the named tool payload,
`next` only when non-empty, and `projectId` only from `project_list`,
`project_get` and `context_status`. An absent `next`, `diagnostics`, `warnings`
or `memories` list is empty. SDK execution errors use `isError` and safe structured
`code/message/retryable`; a schema-valid error is not evidence of success.
`INVALID_INPUT` from argument validation names the argument and the allowed
values or range (for example `limit: must be an integer from 1 to 200.`).
The public codes are `INVALID_INPUT`, `INVALID_CURSOR`, `SOT_TYPE_MISMATCH`,
`NOT_FOUND`, `FORBIDDEN`, `MAPPING_MISSING`, `REGENERATION_REQUIRED`,
`CONTEXT_UNAVAILABLE`, `GLOSSARY_SEARCH_UNAVAILABLE`, `RESULT_LIMIT_EXCEEDED`,
`CONFLICT`, `SERVER_BUSY`, `PROJECT_BUSY`. `PROJECT_BUSY` (`retryable: false`)
answers only a write (`memory_request`, `glossary_alias_*`): generate-docs, sync
or a memory import is writing the project, and the write did not happen. Do not
retry at once or route it through another tool; tell the user and retry after
that run finishes. `SERVER_BUSY` (`retryable: true`) means the server's
process-wide tool-call limit is reached and this call waited out the queue or
found it full; nothing ran, so retry the same call after a short pause instead
of fanning out more calls. The limit has two lanes with separate slots and
queues: the workspace tools that run `rg`/`git` over source (`workspace_search`,
`route_text_links`, `readonly_workspace_shell`, `workspace_git_history`,
`workspace_sync_status`, `workspace_repo_list`) share a smaller heavy lane, and
every other tool shares the light lane, so a workspace burst does not delay
document and graph reads. A `SERVER_BUSY` from a workspace tool therefore says
nothing about the light lane; keep reading documents while you pause that one.
On invalid cursor restart scoped discovery; preserve regeneration-required and
missing-provider states instead of treating them as empty current evidence.
`context_status` lists per-tool `status/reason` only for tools that are
`missing` or `unavailable` and counts the rest in `availableToolCount`; it is an
observed local authorized snapshot, not proof of network search, remote
freshness, or deployment. A repository's `cachedSyncedRevision` appears only
when it differs from its `analyzedRevision`.

## Codex multi-agent dispatch

Used by `platty-mcp-search` when the Codex session offers multi-agent
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
