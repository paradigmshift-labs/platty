---
name: platty-docs-target-curation
description: Use when listing, filtering, including, deprecating, or reviewing Platty technical documentation targets before docs generation.
---

# Platty Docs Target Curation

Use this before technical document generation when the user wants to inspect or narrow API, screen, event, or job targets.

## Flow

Run curation as ordered steps, not ad-hoc commands:

1. List and narrow the candidate targets:

```bash
platty docs targets list --project <project> --json
platty docs targets list --project <project> --kind api --method POST --search "<term>" --json
```

Use `--kind`, `--repo`, `--method`, `--search`, `--limit`, and `--offset` to narrow large target sets.

2. Exclude bad or out-of-scope targets:

```bash
platty docs targets deprecate --project <project> --ids <bad-id1,bad-id2> --note "<reason>" --json
```

3. Lock the accepted scope by explicitly including the accepted target ids. `include` is not only an undo for `deprecate` — it records the accepted curation decision:

```bash
platty docs targets include --project <project> --ids <accepted-id1,accepted-id2> --json
```

4. Re-list with the same filters and confirm only the accepted targets remain active.

5. Rebuild and review shared segments before generation so cross-target shared code is grouped:

```bash
platty docs shared-segments rebuild --project <project> --json
platty docs shared-segments list --project <project> --json
```

## Stop Conditions

- `deprecate` / `include` fails with `TARGET_NOT_FOUND` or `TARGET_SELECTOR_AMBIGUOUS`: stop mutating scope — re-run `docs targets list` and use exact ids from the fresh listing. If an id from the fresh listing still fails, report it instead of guessing.
- `docs targets list` returns zero targets while `platty status` reports `build_docs`: stop curation — static analysis has not produced targets for this project; go back to `platty-static-analysis` and report.
- The step-4 re-list does not reflect a mutation you just made (a deprecated id is still active, or an included id is missing): stop and report — do not re-issue the same `deprecate`/`include` in a loop.

## Next Step

Switch to `platty-docs-generation` after target scope is accepted.
