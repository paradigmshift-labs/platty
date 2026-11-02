# Platty Search — MEKO demo

This package connects English-speaking developers to the MEKO Platty MCP
environment. This `feat/demo` branch contains only the `platty` plugin and
the `platty-search` skill.

Start with the [English HTML installation manual](guide/en/platty-demo.html)
(download and open it in a browser) or the [text user guide](USER_GUIDE.md).

## Download

- [Full installable package](https://raw.githubusercontent.com/paradigmshift-labs/platty/refs/heads/feat/demo/downloads/platty-meko-demo.zip)
- [English skill and its eight references](https://raw.githubusercontent.com/paradigmshift-labs/platty/refs/heads/feat/demo/downloads/platty-search-english.zip)
- [Standalone HTML manual](https://raw.githubusercontent.com/paradigmshift-labs/platty/refs/heads/feat/demo/guide/en/platty-demo.html)

## Install in Codex

```bash
codex plugin marketplace add paradigmshift-labs/platty --ref feat/demo
codex plugin add platty@meko-poc
```

Register the separate `platty` MCP connection using the
[authentication instructions](USER_GUIDE.md#5-register-the-meko-connection).
The plugin does not supply your access credential.

| Component | Value |
| --- | --- |
| MCP connection name | `platty` |
| MCP endpoint | `https://meko-poc.platty-ai.com/mcp` |
| Expected default project | `petshop-full` |
| Marketplace | `meko-poc` |
| Plugin | `platty` |
| Skill | `platty-search` |
| Package version | `0.0.9-meko.3` |

The package contains one plugin, one English skill and eight English reference
files. It includes separate [Codex](config/codex.config.toml.example) and
[Claude Code](config/claude.mcp.json.example) connection templates.
The marketplace name distinguishes this delivery from other Platty installations.
Use `platty@meko-poc` when installing it.

The search workflow reads analyzed source code and generated project documents.
It does not require the Platty CLI, a local checkout of the customer application,
or access to the production database. Credentials are supplied separately by the
MEKO PoC administrator. The configuration templates reference `MEKO_POC_TOKEN`;
they contain no token value.

Project observations were checked on November 2, 2026 (Asia/Seoul). Refresh
repository and tool availability from the server when starting a new session.
The currently observed capability gaps are described in the
[project notes](plugins/platty/skills/platty-search/references/project-notes.md).

Install from `feat/demo` explicitly or from its extracted download package.
Registering the repository without a ref selects the default distribution.
No automatic updater changes this demo to another distribution.
The package is for authorized internal use under the included
[license](LICENSE.md) and the applicable customer agreement.

Packagers can optionally run `python3 verify-package.py .` from this folder
with Python 3.11 or later to check manifests, reference links and configuration
templates. This checks package structure; it does not test a recipient's access.
Run `python3 scripts/package-demo.py` to regenerate the two ZIP downloads.

[Report feedback](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml).

[Verification results and limits](VERIFICATION.md).
