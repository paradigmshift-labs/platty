---
name: platty-design-system-setup
description: Use when the user explicitly asks Platty Design to connect, register, or validate an existing local Design System Git repository.
---

# Platty Design System setup

Use this skill only when the user explicitly asks Platty Design to set up,
connect, register, or validate a Design System. Resolve the current Platty
project identity first, then accept the exact input packet below:

```json
{
  "projectId": "<current-project-id>",
  "repositoryPath": "/absolute/path/to/design-system-repository",
  "plattyHome": "/optional/absolute/platty-state-root"
}
```

For registration, run `scripts/design-system-registration.mjs register --input
<absolute-input.json>`. For a read-only check, run it with `resolve`. Stop on
every structured error and report the error code, the missing evidence, and the
smallest recovery action. A successful registration contains exactly `projectId` and canonical `repositoryPath` in its persisted payload; do not add
metadata fields.

The input must be an existing absolute local Git top-level with a tracked
`platty-design-system.json` contract. This v0.1 workflow does not accept or
unpack a source ZIP, clone a Git URL, follow a nested repository path, import a
Figma URL, or continue when the contract is absent or unsupported. Read the
[setup contract](references/design-system-setup-contract.md) for validation
rules, statuses, stable errors, and recovery ownership.
