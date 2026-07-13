# SDD Spec Pressure Scenarios

Use these scenarios when changing `platty-sdd-spec`.

## Scenario 1: Input Fidelity Beats Internal Coverage

The user supplies detailed requirement documents whose statuses, thresholds,
scope, and metrics differ from the current SOT.

Expected behavior:

```text
draft prd.md and user_stories.md
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

## Scenario 3: Korean Planner Needs a Readable Brief

The user asks in Korean for a product spec. SOT and code search produce several
paths, candidates, and an unresolved freshness gap.

Expected behavior:

```text
write prd.md and user_stories.md in Korean-first planner language
-> keep prd.md in the familiar §0–§8 planning flow
-> put detailed paths, search route, source references, and gaps in impact.md
-> keep uncertainty as an open question or named assumption
```

Failure to prevent:

- pasting source paths, raw commands, or an evidence matrix into `prd.md`;
- translating code identifiers or API paths that must remain exact;
- dropping a search gap because the planning document is concise.
