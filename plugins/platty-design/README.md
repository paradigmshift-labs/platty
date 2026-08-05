# Platty Design Agent Plugin

`platty-design` is the public experimental plugin for three explicit workflows:

- `platty-design:platty-design-system-setup` validates and registers an existing
  absolute local Design System Git top-level using the canonical two-field
  project registration.
- `platty-design:platty-design-rapid-prototype` builds and audits a standalone
  HTML Rapid Prototype from the current PRD and User Stories.
- `platty-design:platty-design-capture` captures every source-required page and
  state, shows the compact IA and screenshots in the conversation, and persists
  explicit review-memo saves before PRD/Figma authorization.

## Boundary

This plugin is intentionally separate from the operator and MCP plugins. It
does not ship HDS source, customer PRD/User Stories, generated prototypes,
review tokens, credentials, `.mcp.json`, or MCP server configuration. It accepts
only a local Design System repository already present on disk; it does not clone
remotes, unpack source archives, or import design-file URLs. The Rapid Prototype
is exploratory and must pass its deterministic HTML audit before delivery; it is
not an approval artifact. Capture artifacts stay beside the source specification
and are never packaged into this public plugin.

## Prerequisite

Rapid Prototype and Capture product evidence require the separately installed and configured
`platty-mcp` plugin. Install it before `platty-design`:

```bash
codex plugin add platty-mcp@platty --json
```

```bash
claude plugin install platty-mcp@platty --scope user
```

Then run `platty-mcp:platty-mcp-client-setup` to configure and verify the MCP
endpoint. If `platty-mcp` or its endpoint is unavailable, Rapid Prototype and
Capture stop before generating evidence. Design System setup remains local and
does not require product-document retrieval.

## Install

Add the public marketplace and install the plugin explicitly:

```bash
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty-design@platty --json
```

For Claude Code:

```bash
claude plugin marketplace add paradigmshift-labs/platty --scope user
claude plugin install platty-design@platty --scope user
```

The ordinary `platty` installer does not install this optional plugin.

## Use

Invoke a skill only for an explicit request:

```text
$platty-design:platty-design-system-setup
$platty-design:platty-design-rapid-prototype
$platty-design:platty-design-capture
```

The setup workflow requires the current project identity and a canonical local
Git repository containing a tracked `platty-design-system.json`. The prototype
workflow retrieves current product evidence, resolves Design System availability,
uses a neutral low-fidelity fallback when evidence is unavailable, and writes
`index.html` plus `prototype_handoff.json` under the feature prototype directory.
The Capture workflow writes a revisioned capture package, displays every state
capture in the conversation, and stores explicit `메모 저장` actions in
`review_handoff.json`; it does not add review UI to product HTML.

See `LICENSE.md` for the source-available license. This public plugin does not
include HDS implementation sources or customer project documents.
