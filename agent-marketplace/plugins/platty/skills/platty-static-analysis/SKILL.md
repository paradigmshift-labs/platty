---
name: platty-static-analysis
description: Use when running Platty static analysis, inspecting pipeline state, approving analysis gates, or managing analysis runs.
---

# Platty Static Analysis

Use this after a project has at least one registered repository.

## Flow

1. Inspect next action:

```bash
platty status --project <project> --json
```

2. Advance analysis one safe step:

```bash
platty run --step-only --project <project> --json
```

3. If an analysis gate is waiting for confirmation:

```bash
platty confirm --project <project> --json
platty run --step-only --project <project> --json
```

4. Inspect run history when debugging:

```bash
platty runs list --project <project> --json
platty runs show --run-id <run-id> --project <project> --json
platty runs cancel --run-id <run-id> --project <project> --reason "<reason>" --json
```

## Rule

Keep calling `platty status --project <project> --json` between phases. When status reports `build_docs`, switch to `platty-docs-target-curation` or `platty-docs-generation`.
