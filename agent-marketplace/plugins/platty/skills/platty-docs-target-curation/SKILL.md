---
name: platty-docs-target-curation
description: Use when listing, filtering, including, deprecating, or reviewing Platty technical documentation targets before docs generation.
---

# Platty Docs Target Curation

Use this before technical document generation when the user wants to inspect or narrow API, screen, event, or job targets.

## Commands

```bash
platty docs targets list --project <project> --json
platty docs targets list --project <project> --kind api --json
platty docs targets list --project <project> --kind screen --search "<term>" --json
platty docs targets deprecate --project <project> --ids <id1,id2> --note "<reason>" --json
platty docs targets include --project <project> --ids <id1,id2> --json
```

Use `--kind`, `--repo`, `--method`, `--search`, `--limit`, and `--offset` to narrow large target sets.

## Shared Segments

```bash
platty docs shared-segments rebuild --project <project> --json
platty docs shared-segments list --project <project> --json
```

## Next Step

Switch to `platty-docs-generation` after target scope is accepted.
