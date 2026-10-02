---
name: platty-connection-bindings
description: Use when source-proven environment variables, service aliases, or absolute hosts must be mapped to already scoped repositories before Platty analysis.
---

# Platty Connection Bindings

Bind only an unambiguous, source-proven application reference to an already scoped target repository. A binding makes evidence reviewable; it is never permission to guess an internal edge.

1. Select exactly one configuration variant (`base`, `dev`, or `stg`); never combine variants.
2. Capture configuration-file path, line, and content hash as evidence. Do not put raw configuration, credentials, DSNs, or private hosts in the bindings JSON.
3. Add a binding only when source repository, reference, target repository, base path, and evidence agree.
4. Resolve the project and validate without writing:

```bash
platty connections import --file <bindings-json> --project <project> --dry-run --json
```

5. Apply the same command without `--dry-run` only after the preview succeeds and the reviewer approves its target list.

## Stop Conditions

- Commented rule, dynamic destination, ambiguous rewrite, missing app-side reference, or out-of-scope target: leave it unresolved and report the reason.
- Dry run returns validation or repository errors: do not apply, edit the reviewed JSON, or create a manual edge to work around it.

Never edit the database directly or run analysis from this skill. Use `platty-static-analysis` after an approved import.
