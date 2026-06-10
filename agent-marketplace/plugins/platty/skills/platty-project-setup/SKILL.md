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

Use `--source-root` when only a subdirectory should be analyzed. Use `--branch` when analysis should track a specific branch.

## Next Step

Run:

```bash
platty status --project <project> --json
```
