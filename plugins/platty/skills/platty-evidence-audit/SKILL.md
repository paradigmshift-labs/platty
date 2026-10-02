---
name: platty-evidence-audit
description: Use when comparing expected routes or relations with observed Platty static-analysis evidence, including unresolved candidates and missing coverage.
---

# Platty Evidence Audit

Audit the evidence boundary, not product intent. A missing safe edge is a gap to report, never a reason to manufacture one.

1. Freeze expected evidence in a reviewed list outside customer source: each route/relation has a stable label, source repository/path, expected kind, and source reference. Keep expected routes and expected relations separate.
2. Resolve the project and collect observed static state without rerunning or patching it:

```bash
platty status --project <project> --json
platty runs list --project <project> --json
platty runs show --run-id <run-id> --project <project> --json
```

3. For each known graph node, collect source-grounded relation evidence and candidates:

```bash
platty graph trace --from <node-id> --project <project> --detail full --verbose-candidates --json
```

4. Produce one audit table with `expected`, `observed`, `status` (`matched`, `missing`, `extra`, or `unresolved`), evidence reference, and reason. State the checked repository/run/node scope and whether candidate output was truncated.

Do not call `graph edge add`, interpret absent evidence as proof that behavior does not exist, or collapse unresolved candidates into confirmed relations. Escalate failed/stalled evidence collection to `platty-analysis-triage`. When the user asks to correct a source-proven gap, hand it to `platty-analysis-corrections`.
