# Platty Search

This package connects English-speaking developers to the Platty MCP
environment. This `feat/demo` branch contains only the `platty` plugin and
the `platty-search` skill.

Open the [English setup manual](guide/en/platty-demo.html) and choose the
**Codex** or **Claude Code** tab in the skill-installation step. The entire
walkthrough switches in place, including commands, token configuration,
skill invocation and screenshots. Download that single HTML file to share it
offline, or use the [text user guide](USER_GUIDE.md).

## Install in Codex

```bash
codex plugin marketplace add paradigmshift-labs/platty --ref feat/demo
codex plugin add platty@platty
```

Register the separate `platty` MCP connection using the
[authentication instructions](USER_GUIDE.md#3-paste-your-platty-token-and-connect).
The plugin does not supply your access credential.

| Component | Value |
| --- | --- |
| MCP connection name | `platty` |
| MCP endpoint | `https://meko-poc.platty-ai.com/mcp` |
| Expected default project | `petshop-full` |
| Marketplace | `platty` |
| Plugin | `platty` |
| Skill | `platty-search` |
| Package version | `0.0.10-demo.1` |

The package contains one plugin, one English skill and eight English reference
files. It includes separate [Codex](config/codex.config.toml.example) and
[Claude Code](config/claude.mcp.json.example) connection templates.
Register the Git source with `--ref feat/demo` to select this distribution.
Use `platty@platty` when installing it.

The search workflow reads analyzed source code and generated project documents.
It does not require the Platty CLI, a local checkout of the customer application,
or access to the production database. Credentials are supplied separately by the
Platty administrator. The configuration templates use `YOUR_PLATTY_TOKEN` as a placeholder; replace
it only in your private local configuration.

Project observations were checked on November 2, 2026 (Asia/Seoul). Refresh
repository and tool availability from the server when starting a new session.
The currently observed capability gaps are described in the
[project notes](plugins/platty/skills/platty-search/references/project-notes.md).

Install from Git with `feat/demo` explicitly.
Registering the repository without a ref selects the default distribution.
No automatic updater changes this demo to another distribution.
The package is for authorized internal use under the included
[license](LICENSE.md) and the applicable customer agreement.

Packagers can optionally run `python3 verify-package.py .` from this folder
with Python 3.11 or later to check manifests, reference links and configuration
templates. This checks package structure; it does not test a recipient's access.

[Report feedback](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml).

[Verification results and limits](VERIFICATION.md).
