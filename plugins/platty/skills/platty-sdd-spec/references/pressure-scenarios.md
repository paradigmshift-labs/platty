# SDD Spec Pressure Scenarios

Use these scenarios when changing `platty-sdd-spec`.

## Scenario 1: Input Fidelity Beats Internal Coverage

The user supplies detailed requirement documents whose statuses, thresholds,
scope, and metrics differ from the current SOT.

Expected behavior:

```text
draft request.md and stories.md
-> compare every input requirement with SOT and both drafts
-> distinguish existing behavior from requested behavior
-> revise contradictions
-> record Requirement Coverage and Self Review
-> return NEEDS_WORK while required input is unread or conflicting
```

Failure to prevent:

- reporting 100% coverage because every self-authored rule has a story;
- replacing requested statuses or thresholds with current implementation values;
- moving a confirmed user decision into open questions.

## Scenario 2: Search Route Is Incomplete

The draft used search evidence but skipped a required map, exact read, memory or
human-knowledge overlay, or final route audit.

Expected behavior:

```text
record the missing rung in Search Route Audit
-> complete the read when possible
-> otherwise preserve the coverage gap
-> Self Review verdict = NEEDS_WORK for a required missing rung
```
