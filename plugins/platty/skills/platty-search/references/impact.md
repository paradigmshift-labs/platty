# Evaluate a proposed change

## Change target

| Target identifier and business name | Proposed operation | Table.column / code group | Source evidence or open question |
| --- | --- | --- | --- |

Separate core decision data from companion/history/integration data. Present
up to five core items and ten companion items for readability; if more are
material, retain them with reasons rather than silently excluding them from
write coverage. The search covers every discovered written table.

Core items store the changed value, are read by a relevant guard, or are
written by the affected statement. Each requires a source range and a role
(read, compare, insert, update, delete). A table name alone is not evidence.

## Search and inspect

| Search | What it establishes after a source read |
| --- | --- |
| All table writers, graph candidates plus W1/W1b | Other API, screen, batch, and integration paths touching the data |
| SQL/field/getter spellings of the target column | Reads and guards, including screen validation |
| Literal comparisons and assignments | Allowed sets, excluded values, and origins of new values |
| Code-group/reference-column lookups | Behavior dependent on stored configuration |
| Caller and callee registration | Whether the operation is reachable on the selected path |

Do not search only the proposed new literal. A validator comparing the column
against a different single value can reject it. Trace every such guard to the
root service method, including rechecks following an earlier allowed set.

For each comparison record:

```text
Literal comparison: operator and full allowed set; proposed value included/excluded;
branch outcome; source range; later recheck confirmed/unverified.
Reference lookup: table.reference_column; required stored row/value;
production value unverified; source range of the lookup and consuming branch.
```

Read both SET and WHERE for updates/deletes. A changed column outside the
question's decision data is not automatically an alternative. Grouping many
similar candidates is a presentation choice: list their members, identify
which were actually read, and bound any representative-based inference.

## Report

Separate screens/online actions, automated jobs, and external integrations.
For each, state the change required, the behavior affected and its condition,
the source that supports it, and remaining uncertainty.

- `Must change`: an inspected code location whose logic needs adaptation.
- `Affected`: an inspected condition shows how the proposed change changes behavior.
- `Unaffected within inspected scope`: the relevant statement/guard was read
  and does not depend on the changed data; give its scope.
- `Impact unverified`: a candidate is unread, source is unavailable, or the
  deciding runtime value is unknown.

Distinguish pre-existing inconsistencies from effects of the proposed change.
Production permissions, scheduler configuration, code-table contents, and
external-system behavior remain separate verification tasks. The code search
connection does not grant permission to edit the production data.
