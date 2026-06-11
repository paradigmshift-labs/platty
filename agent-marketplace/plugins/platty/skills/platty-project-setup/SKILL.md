---
name: platty-project-setup
description: Use when initializing a Platty workspace, creating or selecting a Platty project, or adding and managing repositories for analysis.
---

# Platty Project Setup

Use this for setup before analysis. Platty stores CLI state in the user-global
Platty home by default (`~/.platty` on macOS/Linux, `%APPDATA%\Platty` on
Windows). `PLATTY_HOME` overrides that location. The CLI config field named
`projectRoot` refers to this Platty home/workspace root, not to a repository
being analyzed.

## Flow

1. Initialize the global Platty home:

```bash
platty init --json
```

2. Create or select a project:

```bash
platty project list --json
platty project create "<name>" --description "<description>" --json
platty project use <project-id-or-name> --json
```

## Invariants

```text
1. A repository path is NEVER a project selector. Resolve <project> only from
   the JSON output of project list / project create / project use.
2. On an existing project, run repo list BEFORE repo add. repo add does not
   warn about duplicate names or dead repoPath entries — you must check.
3. Do not infer state location from cwd or the repository path. Run `platty init`
   once to create the global Platty home, then register repositories explicitly.
```

## Project Scoping

- Inspect JSON output from `project list`, `project create`, or `project use` to determine the resolved project selector.
- For existing-project setup, select the existing project before `repo add`.
- Use the resolved project id/name consistently as `<project>` for `repo add`, `repo list`, and `status`.

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

## Stop Conditions

- `project use` or any `--project` command fails with `PROJECT_AMBIGUOUS`: stop and ask the user which project to use — never pick one of the matches yourself.
- `repo add` fails with `NOT_A_GIT_REPO`, `NOT_A_DIRECTORY`, or a nonexistent path: stop and report the path — do not retry with guessed path variants.
- `repo update` / `repo remove` fails with `REPO_AMBIGUOUS` or `REPO_NOT_FOUND` after you already re-checked `repo list`: stop and ask the user which registration to change.

## Next Step

Run:

```bash
platty status --project <project> --json
```

## Handoff

End setup with the `Platty handoff` card. The `State` line must include the
selected project and registered repository count from JSON. The `Recommended
next` line should normally be:

```text
Recommended next: platty status --project <project> --json, then route to platty-static-analysis
```
