# Explore source and account for every candidate

## 1. Direct path

Read from the selected anchor to the operation it performs:

- Screen: event/button registration, save function, pre-save validation,
  defaults, constructed URL, controller, service, and SQL.
- API: registration, complete root service method, subordinate calls relevant
  to the question, repository/mapper, and complete SQL statements.
- Batch: job and step registration, tasklet's complete relevant loop,
  skip/retry/rollback conditions, and SQL.
- Integration: invoking service, subordinate client, actual send operation,
  and failure propagation or returned-error handling.

If the anchor is an inner validator/helper, trace its callers to every root
service method directly invoked by a controller, job, listener, or external
entry point. Read the full root method, including calls after the validator.
Inspect how callers consume a returned error value or swallowed exception.
Dynamic dispatch requires its value origin and registration; a function
definition alone does not prove execution.

Keep a root/call inventory:

| Root and entry point | Called service/mapper | Relevant columns or state | Failure handling | Read range or justified exclusion |
| --- | --- | --- | --- | --- |

Log/utilities/getters can be grouped with a reason. Judge relevance from
column/field/getter and literal searches in the actual callee, not its name.
Read each relevant subordinate call similarly. A later validation of the
same state may narrow an earlier allowed set; account for both.

Record all written tables and the read tables, condition columns, values,
and messages that determine the answer:

| Item | Written table / read table / condition column / value / message | Source range |
| --- | --- | --- |

State `Decision columns: ...`. DELETE affects row existence; end date,
enabled flag, and status updates can be alternatives to deletion. A guard
that only reads a decision column is still relevant. A write is unrelated
only after its actual SET/INSERT/DELETE and conditions have been inspected.

## 2. Other writers and callers

For every written table, combine `route_impact_candidates` when available
with all-repository source search. Read live schemas, page results, and
retain deprecated candidates as candidates. A graph link or generated
summary is not source confirmation. Follow callers as graph extraction can
miss an indirect writer through another service.

`W1` is the write search. Include every discovered written table, not just
one representative. A regex starting point for tables `A` and `B` is:

```text
(INTO|UPDATE|DELETE(\s+FROM)?|MERGE\s+INTO)[\s(]+([A-Za-z0-9_]+\.)?(A|B)([^A-Za-z0-9_$]|$)
```

Escape table names as regex literals, including `$`; a word boundary is not
a safe terminator for every identifier. Include INSERT/UPDATE/DELETE/MERGE,
optional schema prefixes, and multiline SQL (`multiline: true` when supported).
Also inspect multi-target DELETE forms. `W1b` accounts for multiline and
alternate write forms not covered by W1: search table names to discover
additional files, then read/search complete statements in those files.
Do not infer a write from a comment or a read-only JOIN.

Search backend source/SQL and relevant screens/JavaScript. Partition by
repository and file type when needed; a narrow SQL glob does not cover
screen guards or dynamically assembled statements. Keep test code and
comments distinguishable from executable callers. Discover actual module
layout rather than assuming all files are below the reported sourceRoot.

Record for each search: pattern, options/globs, repositories, table coverage
`n/N`, match/file counts when exact, repository completion/errors, cursor,
`complete`, `truncated`, and `countKind`. Follow the same query's cursor until
complete; changed query inputs may invalidate it. An incomplete search
cannot establish absence. Do not turn a lower-bound count into an exact total.

Search column spellings (SQL, camelCase, getter), literals and reference-code
lookups, messages, SQL IDs, repository methods, and callers as appropriate.
When reads expose new tables, columns, SQL IDs, or methods, extend the search.
Repeat until no new relevant candidate appears. Record iterations and reconcile
matched files with listed candidate rows.

## 3. Candidate status and reading order

| Repository/path | Entry point and kind | Role | Status | Exact read ranges | Reason/gap |
| --- | --- | --- | --- | --- | --- |

Roles are trigger (causes the event), guard (permits/blocks it), alternative
(changes the same decision data differently), and downstream effect (runs
after it). Entry kinds are online, batch, external, or other. Verify entry
registration from source; do not use a filename as a job or screen identity.

Read the direct path fully, then every trigger, guard, and alternative.
Start related candidates with the surrounding branch/complete relevant SQL;
deepen when it could change the answer. For UPDATE/DELETE read SET and WHERE.
Include calls following a validator and the use of return/error values.
Do not stop because a preset number of candidates has been reached.

Each row has one state:

- `Read`: list exact ranges and reading depth; assert only what those lines show.
- `Listed only`: a downstream effect, a distinct unselected business candidate,
  or a user-excluded entry. State the reason and do not infer its behavior.
- `Excluded`: another business target, an inspected statement unrelated to the
  decision columns, or proven non-executable test/comment/unconnected code.
  Give the actual table, SET/WHERE, source range, or caller search proving it.
- `Unread`: source is absent or an actual source read still fails after one
  appropriate retry. Record attempts. Fix an invalid path/regex instead of
  counting it as proof the source is absent.
- `Unavailable`: a required capability/import is missing according to live
  status. Record its reason and the exact claim left open; no retry is needed.

For a batch candidate, verify its registered job/step and SQL behavior from
code. Query scheduler metadata only when available. Otherwise write
`Scheduler dependencies and operational schedule unverified: scheduler_not_imported`.
A source-defined job does not prove it is enabled, ran, or follows another job.
Keep downstream effects visible even when their bodies remain unread.

## 4. Evidence boundaries

Use `readonly_workspace_shell` with the returned `repoId` and
repository-relative path, e.g. `sed -n '120,170p' module/path/File.java`.
Inspect `truncated` and read remaining ranges. Cite actual line numbers from
search/source mapping; a plain sed window does not itself print line numbers.
Search hits alone do not constitute a complete method or SQL read.

Dynamic table/function/URL strings require their binding origins. For missing
library source, database triggers/views/procedures, runtime values, external
systems, or policy, state the boundary and where it can be verified.

`None`, `only`, `all`, and exact counts require an audit of the relevant
complete search scope, every matched branch, and the counted candidates.
Otherwise use `Within the inspected scope...` and name what remains unverified.

Keep a conversation-local investigation ledger: question/anchor; roots/calls;
written tables and decision columns; W1/W1b coverage and iterations; candidate
statuses; evidence ranges; open gaps; next reads. Update it after the direct
path, enumeration, reading, and pre-answer review. It need not be written to a
local file. Do not write memories or modify project/application data.
