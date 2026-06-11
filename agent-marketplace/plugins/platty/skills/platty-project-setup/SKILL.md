---
name: platty-project-setup
description: Use when initializing a Platty workspace, creating or selecting a Platty project, or adding and managing repositories for analysis.
---

# Platty Project Setup

Use this for setup before analysis.

## Flow

1. Initialize workspace:

```bash
platty init --json
```

2. Create or select a project:

```bash
platty project list --json
platty project create "<name>" --description "<description>" --json
platty project use <project-id-or-name> --json
```

## Project Scoping

- Inspect JSON output from `project list`, `project create`, or `project use` to determine the resolved project selector.
- For existing-project setup, select the existing project before `repo add`.
- Use the resolved project id/name consistently as `<project>` for `repo add`, `repo list`, and `status`.
- Do not treat the repository path as the project selector.

3. Add repositories:

```bash
platty repo add <path> --project <project> --json
platty repo list --project <project> --json
```

Use `--source-root` when only a subdirectory should be analyzed. Use `--branch` when analysis should track a specific branch — without it, `repo add` tracks whatever branch the repository currently has checked out.

For an existing project, run `repo list` BEFORE `repo add` and inspect the registered entries:

- Remove or fix registrations whose `repoPath` does not exist on disk (seeded or moved repos) — analysis pointed at them fails.
- Watch for an existing entry with the same name as the repo you are adding; `repo add` does not warn on duplicate names.

```bash
platty repo update <repo-id-or-name> --path <new-path> --project <project> --json
platty repo remove <repo-id-or-name> --project <project> --json
```

## Next Step

Run:

```bash
platty status --project <project> --json
```
