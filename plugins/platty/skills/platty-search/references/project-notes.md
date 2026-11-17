# Platty project reference

Observed November 16, 2026 (Asia/Seoul); tool availability and the term
registry were rechecked November 17, 2026. These facts are a starting map; live MCP
results take precedence. This reference describes one deployment, not a rule
for other Platty customers.

## Connection identity

| Field | Delivery setting or observed server value |
| --- | --- |
| Required MCP connection name | `platty` |
| Endpoint | `https://meko-poc.platty-ai.com/mcp` |
| Default project | `yugabyted-ui` |
| Project ID returned by the server | `GFJFxAeR3ukQlw0-IynSq` |
| Source analysis date | November 14, 2026 |
| Analyzed revisions | `yugabyted-ui` `9801e9d104f6`, `yugabyted-apiserver` `494421ee11ec` |

Omit `projectId` initially and verify the returned default. The ID above is an
observation, not a substitute for current authorization. Never use another MCP
connection to fill a missing Platty capability.

## Repositories

Two repositories are registered. Resolve their current IDs with
`workspace_repo_list`; do not copy IDs from another environment.

| Repository | Role | Language / framework | Reported sourceRoot |
| --- | --- | --- | --- |
| `yugabyted-ui` | Web UI: React + Vite, react-router-dom 5.3.3, i18n strings in `src/translations/en.json`, generated API client in `src/api/src/apis/` | TypeScript / React | Not set |
| `yugabyted-apiserver` | Backend: Go Echo server, routes in `cmd/server/main.go`, handlers in `cmd/server/handlers/`, upstream calls in `cmd/server/helpers/` | Go / Echo | Not set |

These roles were observed in source. Confirm ownership of a specific screen or
endpoint from source before relying on it.

### Paths are relative to the repository root

The source tools accept repository-relative paths. Tested source reads were:

```text
repository: yugabyted-apiserver
path: cmd/server/handlers/api_cluster_info.go

repository: yugabyted-ui
path: src/components/YBBadge/YBBadge.tsx
```

The UI client calls `/<path>` with base `/api` (`src/helpers/api.ts`,
`src/config.json`), so UI `GET /slow_queries` is server
`GET /api/slow_queries`. Match the UI call to the server route with that prefix.

## Capability branches

The server listed 59 tools on November 17, 2026; 56 were available and these
three were reported missing by `context_status.toolAvailability`:

| Tool | Observed reason | Retrieval behavior |
| --- | --- | --- |
| `code_search_guide_get` | `guide_file_missing` | Use the repository inventory, bounded source search, and exact source reads to establish navigation facts. Record that the guide is unavailable. |
| `job_dependency_trace` | `scheduler_not_imported` | This project has no batch jobs. Report scheduler dependency order and run status as not applicable rather than inferring them. |
| `menu_lookup` | `authorized_context_missing` | Returns `availability: "not_imported"` with zero results. Locate screens using source and route evidence; do not invent menu paths or visibility. |

`term_alias_add` and `term_alias_remove` are listed as available, but they are
write tools. This delivery is read-only: do not call them.

### Screen-term glossary (`term_lookup`)

`term_lookup` is available. Use it first when a question names a screen label or
a YugabyteDB term (for example Leader Tablets, PITR, xCluster, Started On).

- 35 concept cards cover the terms used on the UI screens. Each has a short
  definition and the screen labels that mean it as aliases.
- 12 Migrations screen labels are also names on column cards of
  `ybvoyager_visualizer.ybvoyager_visualizer_metadata` (for example Started On
  is `invocation_timestamp`). The screen label Complexity is not that table's
  `complexity` column: the list shows the assessment report value instead.
- Definitions are drafts written from the source, not confirmed by the
  customer. Treat a card as a lead and confirm the value path in source.
- Cards have no screen or API locations yet (`totalLocations: 0`). Find the
  screen, API and handler with source reads.

A deterministic missing capability is a valid `Unavailable` state, not a reason
to repeat the same failed call twice. If the server later supplies it, use its
live schema and response. A transport/authentication failure is a separate
connection problem: stop retrieval on that connection and report it.

Data dictionary documents exist but hold 0 items. The only DB catalog is the two
Voyager tables, visible through `term_lookup` column cards. Other answers about
data come from source reads with `workspace_search` and
`readonly_workspace_shell`. Use live schemas instead of old workarounds. Check
`complete`, `truncated`, `countKind`, repository statuses, and continuation
cursors before claiming a complete inventory or absence.

## Verified starting examples

- Slow Queries: `yugabyted-ui`
  `src/features/clusters/details/performance/SlowQueries.tsx`, lines 127-140,
  calls `GET /api/slow_queries`. `yugabyted-apiserver` `cmd/server/main.go`,
  lines 231-232, routes it to `GetSlowQueries`. The SQL joins
  `pg_stat_statements` with `pg_database` and `pg_authid` at
  `cmd/server/handlers/api_cluster_info.go`, lines 24-28.
- Bootstrapping node: the predicate is in `yugabyted-ui`
  `src/features/clusters/details/nodes/NodeHooks.ts`, lines 26-44: the node is
  up, uptime is under 60 seconds, the load balancer is not idle, and it has
  zero tablets.
- Alert configuration toggles are saved in the browser localStorage key
  `alert-configurations` (`src/features/clusters/details/alerts/alerts.ts`,
  line 15; `AlertConfigurations.tsx`, line 40). There is no server API for them.
- Fault Tolerance is computed in `yugabyted-apiserver`
  `cmd/server/handlers/api_cluster.go`, lines 163-177, from tablet-server,
  zone, and region counts.

The document inventory included 77 documents: 32 API specifications, 11 screen
specifications, 8 design documents, 8 UCL documents, 7 business-rule documents,
7 glossary documents, and 4 data dictionary documents, with 8 EPICs. These are
document counts, not production row counts. Open glossary documents with
`sot_render`; `spec_get` returns `SOT_TYPE_MISMATCH` for them. Read each
result's validity, status, and quality gaps rather than treating every
generated statement as fact.

No production database connector is included in this delivery, and the project
has no business database. The backend reads PostgreSQL system views
(`pg_stat_statements`, `pg_authid`, `pg_database`, `pg_stat_all_indexes`,
`pg_stat_progress_create_index`), YCQL `system.metrics`, the Voyager tables
`ybvoyager_visualizer.ybvoyager_visualizer_metadata` and
`ybvoyager_visualizer.ybvoyager_visualizer_table_metrics`, Master/Tserver HTTP
APIs, and `yb-admin` output. Analyzed source can show which of these a value
comes from; it cannot establish today's values.
