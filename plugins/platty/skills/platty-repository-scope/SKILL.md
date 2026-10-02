---
name: platty-repository-scope
description: Use when defining or reviewing a repository-analysis scope YAML for a customer ZIP, Gitless source directory, monorepo, or multi-repository analysis.
---

# Platty Repository Scope

Define the approved source boundary before registering repositories. Scope is evidence: it names what was inspected, not every dependency the application might contact.

1. Record the source package checksum, selected revision or delivery date, and chosen environment variant.
2. Inventory Git roots, separately delivered directories, and independently analyzable modules. A module inside a Git root uses that root with `sourceRoot`; do not invent nested repositories.
3. Write one reviewed `repository-analysis-scope.v2.yaml` outside customer source. Include only approved directories and distinct names for modules. For a Gitless ZIP extraction, each entry must explicitly use `sourceKind: directory`; otherwise Platty attempts Git discovery. A single extraction root may be shared by entries that have distinct `sourceRoot` values.
   When a JVM build declares modules and dependencies, retain that topology with
   `buildModules` and per-module `dependsOn`; do not flatten proven module
   dependencies into unrelated roots.
4. Resolve the Platty project, then import it:

```bash
platty repo scope import <scope-yaml> --project <project> --json
```

Record accepted repository ids, paths, branches, and import output. A changed scope makes analysis stale; rerun static analysis after approval.

## Stop Conditions

- Source ownership, branch, module boundary, or environment is ambiguous: stop and ask for the approved boundary.
- The archive contains traversal paths, absolute paths, or escaping symlinks: stop source intake; do not register it.
- Scope import fails: correct the YAML and retry; do not replace it with a loop of `repo add` commands.

Do not put credentials, private hosts, raw configuration values, or customer source excerpts in the scope YAML. Use `platty-connection-bindings` only for a source-proven cross-repository reference.
