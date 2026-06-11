# Platty Agent Skills Architecture

Platty agent skills follow the Superpowers pattern: one shared skill catalog, with thin runtime-specific integration layers for Codex and Claude Code.

## Layout

```text
platty/
  .codex-plugin/
  .claude-plugin/
  hooks/
  skills -> agent-marketplace/plugins/platty/skills
  .codex/skills -> ../skills
  agent-marketplace/
    .agents/plugins/marketplace.json
    .claude-plugin/marketplace.json
    plugins/platty/
      skills/
        using-platty/
        platty-cli-router/
        platty-project-setup/
        platty-static-analysis/
        platty-docs-target-curation/
        platty-docs-generation/
        platty-retrieval/
        platty-epics-generation/
        platty-business-docs-generation/
        platty-corpus-quality/
```

## Source Of Truth

`agent-marketplace/plugins/platty/skills/` is the shared source of truth and the public plugin skill catalog. Skill bodies should be written in harness-agnostic language: "read a file", "run a command", "track steps", "submit a draft", and "inspect JSON output".

Runtime-specific tool names belong in `agent-marketplace/plugins/platty/skills/using-platty/references/`.

`skills` is a repo-local symlink to `agent-marketplace/plugins/platty/skills`, and `.codex/skills` is a repo-local symlink to `../skills` for the current Codex workflow. Do not hand-edit through either symlink; change `agent-marketplace/plugins/platty/skills/` first, then run:

```bash
npm run sync:agent-skills
```

`agent-marketplace/` is the repo-local distribution package. Its `plugins/platty/skills` directory is the real canonical skill tree, while `.codex-plugin`, `.claude-plugin`, `hooks`, and marketplace manifests are synchronized into that plugin root. Change the root plugin metadata or hooks first, then run:

```bash
npm run package:agent-marketplace
```

## Runtime Integration

Codex plugin wiring:

- `.codex-plugin/plugin.json` points at `./skills/`.
- Codex hook bootstrap lives in `hooks/hooks-codex.json` and is validated/smoked separately because the current Codex plugin manifest validator rejects a top-level `hooks` field.
- `hooks/session-start-codex` injects `skills/using-platty/SKILL.md` into session context.

Claude Code plugin wiring:

- `.claude-plugin/plugin.json` provides marketplace/plugin metadata.
- `hooks/hooks.json` registers a session-start hook.
- `hooks/session-start` injects `skills/using-platty/SKILL.md` into session context.

## Installation And Registration

Codex installs plugins from marketplace snapshots. `codex plugin add` does not accept an arbitrary plugin directory; it expects either `PLUGIN@MARKETPLACE` or `PLUGIN --marketplace MARKETPLACE`.

This repo now carries a local marketplace package that can be lifted into a separate public or private distribution repository later:

```text
agent-marketplace/
  .agents/plugins/marketplace.json
  .claude-plugin/marketplace.json
  plugins/platty/
```

The repo-local marketplace identifier is `platty` for both Codex and Claude Code. Codex displays this source as `Platty Marketplace` through `interface.displayName`.

Register it locally for Codex testing with:

```bash
npm run package:agent-marketplace
codex plugin marketplace add /Users/uchangmin/Development/platty/agent-marketplace
codex plugin add platty@platty
```

Register it locally for Claude Code testing from inside Claude Code with:

```text
/plugin marketplace add /Users/uchangmin/Development/platty/agent-marketplace
/plugin install platty@platty
```

Start a new Codex or Claude Code session after installing so the refreshed skill catalog is loaded. When this marketplace is moved to its own Git repository, users can register the Git source instead:

```bash
codex plugin marketplace add paradigmshift-labs/platty-agent-marketplace --ref main
codex plugin add platty@platty
```

```text
/plugin marketplace add paradigmshift-labs/platty-agent-marketplace
/plugin install platty@platty
```

For local development, use the personal marketplace layout expected by Codex:

```text
~/.agents/plugins/marketplace.json
~/plugins/platty/
```

The marketplace entry should point at `./plugins/platty` relative to the marketplace root:

```json
{
  "name": "personal",
  "interface": {
    "displayName": "Personal"
  },
  "plugins": [
    {
      "name": "platty",
      "source": {
        "source": "local",
        "path": "./plugins/platty"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
```

Initial Codex registration flow:

```bash
python3 /Users/uchangmin/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py \
  platty \
  --with-marketplace \
  --category "Developer Tools"

rsync -a --delete \
  --exclude .git \
  /Users/uchangmin/Development/platty/.worktrees/cross-runtime-platty-skills/ \
  ~/plugins/platty/

python3 /Users/uchangmin/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py \
  ~/plugins/platty

codex plugin add platty@personal
```

Run the scaffold command only for the first registration. It creates the default personal marketplace file and entry. The `rsync` step then replaces the scaffolded plugin body with the real Platty plugin root.

The default personal marketplace at `~/.agents/plugins/marketplace.json` is discovered implicitly by Codex. Do not run `codex plugin marketplace add` for that default path. Use `codex plugin marketplace add <marketplace-root>` only for an explicit repo/team marketplace outside the default personal path.

Update/reinstall flow after changing the local plugin:

```bash
rsync -a --delete \
  --exclude .git \
  /Users/uchangmin/Development/platty/.worktrees/cross-runtime-platty-skills/ \
  ~/plugins/platty/

python3 /Users/uchangmin/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py \
  ~/plugins/platty

codex plugin add platty@personal
```

Start a new Codex thread after reinstalling so the refreshed skill catalog is loaded.

For the repo-local marketplace package, update/reinstall with:

```bash
npm run package:agent-marketplace
codex plugin add platty@platty
```

Claude Code compatibility is packaged in the same plugin root through `.claude-plugin/plugin.json`, `skills/`, and `hooks/hooks.json`. The current repository validates the Claude hook payload with a local smoke test, but a real Claude Code local-plugin or marketplace install still needs to be run before claiming full Claude distribution support.

Codex hook status is intentionally separate from plugin installation. The Codex manifest validator currently rejects a top-level `hooks` field, so `hooks/hooks-codex.json` is kept as a runnable hook configuration artifact rather than a proven auto-registered Codex plugin field.

## Skill Boundaries

- `using-platty`: bootstrap and skill-selection rules.
- `platty-cli-router`: choose the correct root command or skill.
- `platty-project-setup`: initialize workspaces, projects, and repositories.
- `platty-static-analysis`: run and inspect static pipeline progress.
- `platty-docs-target-curation`: curate technical documentation targets.
- `platty-docs-generation`: author technical docs from worker packets.
- `platty-retrieval`: answer questions from existing generated docs.
- `platty-epics-generation`: generate and confirm epics.
- `platty-business-docs-generation`: generate, validate, review, and sync business docs.
- `platty-corpus-quality`: run fixture corpus and self-improvement quality workflows.

## Handoff And Status Model

Use `using-platty` as the entrypoint. It loads runtime-specific tool mappings and hands broad CLI decisions to `platty-cli-router`.

`platty-cli-router` follows this default lifecycle:

```text
init -> project -> repo -> status -> run -> confirm -> status -> docs or epics or business-docs
```

If CLI JSON includes `nextAction.command`, prefer that command as the next step unless the user requested a narrower operation.

Document extraction is status-managed by the CLI. The technical docs authoring loop is:

```text
targets list -> docs start -> docs preview -> docs approve -> worker next -> tasks submit -> docs status
```

The `platty-docs-generation` skill handles these worker states explicitly:

- `not_approved`: approve the run before leasing.
- `no_task_available`: inspect `platty docs status`.
- `saved`: continue leasing or inspect status.
- `repair_requested`: rewrite the draft from the same packet context and resubmit.
- `failed`: stop and report the CLI error.

The final answer after document extraction must report completed, pending, repair, and failed counts from `platty docs status --run-id <run-id> --json`.

## Validation

Run these before changing or publishing skills:

```bash
npm run check:agent-skills
npm run check:agent-marketplace
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
node --test tests/architecture/*.test.mjs
git diff --check
```

## Claude Packaging Assumption

This repository follows the Superpowers Claude Code plugin shape: `.claude-plugin/plugin.json` carries plugin metadata, while the installable plugin root carries `hooks/hooks.json` and `skills/`. The local smoke test verifies that `hooks/session-start` emits the expected Claude `hookSpecificOutput.additionalContext` payload. A marketplace or local Claude plugin installation smoke test is required before claiming the Claude package is distributable.
