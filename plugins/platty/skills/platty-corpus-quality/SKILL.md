---
name: platty-corpus-quality
description: Use when inspecting Platty fixture corpus quality, dry-running fixture stages, comparing expected outputs, or selecting self-improvement candidates.
---

# Platty Corpus Quality

Use this for Platty development and regression checks, not normal project analysis.

## Commands

```bash
platty corpus run-fixture --id <fixture-id> --stage <stage> --json
platty corpus batch-report --framework <framework> --stage <stage> --json
platty corpus compare --id <fixture-id> --stage <stage> --json
platty corpus gate-check --id <fixture-id> --stage <stage> --json
platty corpus next-candidate --json
platty corpus audit-queue --json
platty corpus self-improve-once --id <fixture-id> --stage <stage> --dry-run --json
```

`self-improve-once` requires `--dry-run` from the packaged CLI.

Use the installed global `platty` binary for corpus commands. If `platty corpus ...`
returns `UNKNOWN_COMMAND`, stop and report that the global CLI may be stale or
the command may not exist. Rebuild/reinstall the global CLI before continuing.

## Handoff

Use the `Platty handoff` card. The `State` line should include fixture id,
stage, and pass/fail/missing expected status. The `Recommended next` line should
name the next corpus command, or say `none` when the result is only a report.

## Stop Conditions

- A corpus command fails with `UNKNOWN_CORPUS_COMMAND` or `UNKNOWN_COMMAND`: stop and report; do not invent subcommands or flags.
- `FIXTURE_NOT_FOUND`: stop and confirm the fixture id with the user or a listing — do not guess fixture ids.
- `self-improve-once` fails with `SELF_IMPROVE_EXECUTION_REQUIRES_DRY_RUN`: rerun with `--dry-run`. Real execution is intentionally disabled in the packaged CLI — do not look for a bypass.
- `gate-check` reports `FIXTURE_GATE_FAILED`: report the gate failure as the result — do not loop `self-improve-once` trying to force a pass.
