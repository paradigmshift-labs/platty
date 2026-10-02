# Enterprise MCP retrieval architecture

The implemented 54-tool Enterprise boundary reads canonical Core PostgreSQL
feature modules over the caller-owned authorization snapshot. Enterprise owns
tool schemas, dispatch, Principal/RBAC, safe projections and atomic public audit.
It has no shared Context MCP runtime fallback. This describes repository behavior,
not an observation that a deployment has this contract.

Use `tool-mapping.md` for concrete names and inputs; `<family>` is notation.
Semantic discovery follows project metadata -> vocabulary when needed -> domain
map -> EPIC map -> returned business document refs -> exact items -> persisted
Spec links -> exact Specs -> bounded source when the claim needs implementation
truth. Known document/item/Spec/code anchors take the direct path and avoid
rediscovery. Search routes unknown IDs and never proves behavior or absence.

| Bridge | Input | Evidence |
| --- | --- | --- |
| BR/UCL/DESIGN/DD to Spec | concrete family Spec resolver, exactly one itemId or documentId | persisted source/usage connections |
| Spec to business | spec_business_resolve, specDocumentIds | exact linked business context |
| Spec to technical | spec_impact_resolve, specDocumentIds, direction | typed service-map impact |

Read returned concrete continuations for target detail. All five technical kinds
(api_spec/screen_spec/event_spec/schedule_spec/db_logic_spec) use spec_get with
documentId. Business glossary document comparison/coverage and individual term
inventory have distinct routes; alias inventory preserves provenance.

Graph identity is `(kind,nodeId)` with code/service_map namespaces. Replay typed
seeds, one namespace per call; choose depth 1 for one-hop provenance and bounded
frontier walking. Preserve confirmed edges, candidates, omissions, truncation
and visited/frontier state. Empty graph evidence proves only its limited result.

Code search finds registered metadata. Repository selection and bounded exact
source reads establish implementation evidence. Registered sourceRoot/worktree
jails permit unindexed files inside the authorized root; graph and derived SOT
still obey exact authorized nodes. Git reads observe managed worktree/cache only:
no network or production deployment inference. Backend absence and unavailable
timestamps remain explicit; catalog/adapter presence is not readiness.

Memory is separate approved context, correction, constraint or rationale.
Relevant attached summaries require exact memory_get bodies with the returned
approved scope. Explicit own request inspection uses own_requests; explicit
memory_request submits a pending review receipt, not approval. Existing RBAC
still applies. Original overview-attached Memory projects onto project_get;
orphan/incomplete anchors may be null without invented parents.

sot_render returns database_rendered Markdown from the same authorized view as
structured reads. It supplies a canonical projection, not original path/file
access. Closed published success-or-error output schemas work with the actual
SDK; errors remain failures and the server validates successful results against
the success branch only. Missing capabilities/providers/readState gaps weaken
claims; no host-local file or CLI fallback.
