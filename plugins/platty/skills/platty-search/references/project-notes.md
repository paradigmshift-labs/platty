# MEKO project reference

Observed November 2, 2026 (Asia/Seoul). These facts are a starting map; live MCP
results take precedence. This reference describes one deployment, not a rule
for other Platty customers.

## Connection identity

| Field | Delivery setting or observed server value |
| --- | --- |
| Required MCP connection name | `platty` |
| Endpoint | `https://meko-poc.platty-ai.com/mcp` |
| Default project | `petshop-full` |
| Project ID returned by the server | `ajeqqH-f0CEGR7wBJXLQC` |
| Source analysis date | October 30, 2026 |

Omit `projectId` initially and verify the returned default. The ID above is an
observation, not a substitute for current authorization. Never use another MCP
connection to fill a missing MEKO capability.

## Repositories

All ten registered worktrees were available. Resolve their current IDs with
`workspace_repo_list`; do not copy IDs from another environment.

| Repository | Reported sourceRoot, when set |
| --- | --- |
| `pts-mo-web` | Not set |
| `pts-ptnr-web` | Not set |
| `pts-bat-svc-app` | Not set |
| `pts-ptnr-fnd` | `pts-ptnr-fnd-app` |
| `pts-bat-svc` | Not set |
| `pts-adm-web` | Not set |
| `pts-bat` | Not set |
| `pts-fnd` | `pts-fnd-app` |
| `pts-bat-core` | Not set |
| `pts-env` | `pts-env-app` |

These are registered names. A name alone does not prove which application,
channel, scheduler, or business domain it owns. Establish that from source.

### Paths are relative to the repository root

`sourceRoot` is analysis metadata, not the shell working directory. The source
tools accept repository-relative paths, including a module prefix when present.
Do not remove or automatically prepend that prefix. A tested source read was:

```text
repository: pts-env
command: sed -n '28,52p' pts-env-app/src/main/java/com/pts/env/ctrt/tnnt/controller/CtrtTnnt001Controller.java
```

Using only `src/main/java/...` for this file returned `INVALID_INPUT` because
that path did not exist. `workspace_search` returned the full module-prefixed
path and the subsequent read succeeded. Paths in sibling modules may also be
returned; do not limit reads to `sourceRoot`.

## Capability branches

The server reported 56 available tools and these three gaps:

| Tool | Observed reason | Retrieval behavior |
| --- | --- | --- |
| `code_search_guide_get` | `guide_file_missing` | `guide.available=false` was confirmed. Use the repository inventory, bounded source search, and exact source reads to establish navigation facts. Record that the guide is unavailable. |
| `menu_lookup` | `authorized_context_missing` | Locate screens using source, route, and term evidence. Report screen identifiers when proven; do not invent menu paths or visibility. |
| `job_dependency_trace` | `scheduler_not_imported` | Inspect job definitions and SQL in source. Scheduler dependency order, operational schedules, and last-run status remain unverified. |

A deterministic missing capability is a valid `Unavailable` state, not a reason
to repeat the same failed call twice. If the server later supplies it, use its
live schema and response. A transport/authentication failure is a separate
connection problem: stop retrieval on that connection and report it.

`workspace_search` and `readonly_workspace_shell` succeeded. The current search
schema supports `multiline`; the shell supports quoted regular expressions.
Use live schemas instead of old workarounds. Check `complete`, `truncated`,
`countKind`, repository statuses, and continuation cursors before claiming a
complete inventory or absence.

## Verified starting examples

- `pts-adm-web/SHOP/SHOP0103.xfdl`, lines 130-155: the save function checks
  for dataset changes, validates the grid, and asks for confirmation before a
  transaction call. This verifies that function body; button activation,
  server validation, and stored rows require further reads.
- `pts-env/pts-env-app/src/main/java/com/pts/env/ctrt/tnnt/controller/CtrtTnnt001Controller.java`,
  lines 28-52: the save handler delegates to a service and adds its returned
  count as `rsltCnt`. This alone does not prove all service or SQL behavior.
- The saved API document is titled
  `POST /on/ctrt/tnnt/saveCtrtTnntList`. Search fragments and read registration
  code to verify route composition when tracing an actual request.

The document inventory included 445 API specifications, 205 screen
specifications, 134 schedule specifications, and 252 business-rule documents.
These are document counts, not production row counts. Some specifications need
review and some document coverage is incomplete. Read each result's validity,
status, and quality gaps rather than treating every generated statement as fact.

No production database connector is included in this delivery. Analyzed SQL can
show where values are stored; it cannot establish today's stored values.
