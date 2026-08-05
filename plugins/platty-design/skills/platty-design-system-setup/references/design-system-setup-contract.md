# Design System setup contract

This contract is the v0.1 boundary for the public `platty-design` setup skill.
It connects Platty to an existing local Design System repository; it does not
transport, publish, or transform that repository.

## Input and registration

The operation consumes one JSON object with:

| Field | Required | Rule |
| --- | --- | --- |
| `projectId` | yes | 1–128 characters, beginning with a letter or number; only letters, numbers, `.`, `_`, and `-` |
| `repositoryPath` | register only | absolute, existing, non-symlink Git top-level directory |
| `plattyHome` | no | absolute state root; otherwise `PLATTY_HOME` or `~/.platty` |

The repository root must contain a tracked `platty-design-system.json` whose
schema is exactly `platty-design-system-html-contract.v1`. It must name tracked
files/directories for design principles, token source, token generator,
component map, and HTML prototype root, plus non-empty validation, test, and
browser-verification commands. Every referenced path must stay inside the
repository and must not be a symbolic link.

The persisted registration is exactly:

```json
{
  "projectId": "demo-project",
  "repositoryPath": "/canonical/absolute/repository/root"
}
```

It is written with restrictive permissions through an atomic sibling temporary
file. Repeating registration against the same canonical root is `idempotent`.
No source link, remote VCS locator, revision, archive path, design-file link, or
other metadata is stored in the registration payload; the current Git revision and contract
evidence are returned only in the operation result.

## Resolution states

| Status | Meaning | Next action |
| --- | --- | --- |
| `absent` | No registration exists for the current project | Ask for an explicit local setup request and a canonical repository path |
| `ready` | Registration and current contract validate | Use the resolved Design System evidence |
| `unavailable` | Registration exists but cannot be validated | Show `availabilityGap.code`, message, details, and recovery owner; do not invent tokens or brand styling |

## Stable errors and recovery

| Code | Recovery |
| --- | --- |
| `DESIGN_SYSTEM_PROJECT_ID_INVALID` | Resolve the current project ID and use the allowed format |
| `DESIGN_SYSTEM_PATH_ABSOLUTE_REQUIRED` | Provide an absolute local path |
| `DESIGN_SYSTEM_REPOSITORY_SYMLINK` | Provide the real repository root, not a symlink |
| `DESIGN_SYSTEM_REPOSITORY_NOT_GIT` | Open the Design System repository or add the required Git metadata |
| `DESIGN_SYSTEM_GIT_TOPLEVEL_REQUIRED` | Replace a nested package path with the canonical Git top-level |
| `DESIGN_SYSTEM_CONTRACT_NOT_FOUND` | Add and commit `platty-design-system.json` |
| `DESIGN_SYSTEM_CONTRACT_UNTRACKED` | Add `platty-design-system.json` to Git before registration |
| `DESIGN_SYSTEM_CONTRACT_SCHEMA_UNSUPPORTED` | Migrate the contract to `platty-design-system-html-contract.v1` |
| `DESIGN_SYSTEM_CONTRACT_INVALID` / `DESIGN_SYSTEM_CONTRACT_FIELD_REQUIRED` | Correct the JSON contract and required evidence |
| `DESIGN_SYSTEM_CONTRACT_PATH_INVALID` / `..._MISSING` / `..._SYMLINK` / `..._TYPE_INVALID` / `..._UNTRACKED` | Track a repository-local path with the expected type |
| `DESIGN_SYSTEM_REGISTRATION_INVALID` | Remove extra keys and restore exactly `projectId` and `repositoryPath` |

The recovery owner is the Design System maintainer for repository evidence and
the Platty project owner for project identity/state. A deadline does not relax
these checks.

## Red flags

These requests are intentionally rejected or narrowed:

| Pressure or shortcut | Reality and counter |
| --- | --- |
| “The demo is urgent” | Deadline pressure does not make unverified input safe; stop at the first missing contract fact. |
| “Register the nested folder” | Registration must point to the canonical Git top-level so future resolution cannot drift. |
| “Include `sourceUrl` or a revision” | The existing two-field registration is the compatibility contract; return revision evidence without persisting new keys. |
| “Accept an archive, remote repository, or design-file link” | v0.1 accepts only an existing absolute local Git repository; transport and design-file workflows are separate. |
| “Continue without the contract” | Missing or unsupported schema is an unavailable Design System, not permission to invent styling. |
