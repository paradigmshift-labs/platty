# MCP SDD Design Pressure Scenarios

Use these scenarios to test whether `platty-mcp-sdd-design` preserves SDD
approval boundaries, source parity, and local file persistence.

## Scenario 1: Unapproved Product Inputs

User asks for `design.md` from an unapproved request.md.

Expected route:

```text
report unapproved request.md
ask for approval or explicit draft-only design
do not mark technical design as approved
```

## Scenario 2: Source Parity Required

User asks for exact backend files, tables, or response shape.

Expected route:

```text
run platty-mcp-retrieval
use graph_trace, code_search, or code_snippet when available
mark unsupported implementation claims as assumptions or risks
```

## Scenario 3: Local SOT Fallback

Failure to prevent:

```text
reading local SOT fallback files or running local commands when MCP evidence is thin
```

Expected route:

```text
stay inside configured MCP tools
report missing MCP source parity surfaces as coverageLimits
```

## Scenario 4: Ungated Tasks

Failure to prevent:

```text
creating tasks.md from an unapproved design without explicit draft-task intent
```

Expected route:

```text
create design.md
if design is approved or draft tasks were explicitly requested, create tasks.md
otherwise report the tasks.md gate
verify written files are readable
```
