# Install Platty Search for MEKO

Use the [English HTML manual](guide/en/platty-demo.html) or the
[complete text guide](USER_GUIDE.md). Download the HTML file and open it in a
browser, or share the file with an authorized recipient.

## Codex: install this branch

```bash
codex plugin marketplace add paradigmshift-labs/platty --ref feat/demo
codex plugin add platty@meko-poc
```

Use `feat/demo` explicitly. The default branch contains a different distribution.
The marketplace is `meko-poc`, the plugin is `platty`, and its only skill is
`platty-search`.

## Download instead

[Download the installable ZIP](https://raw.githubusercontent.com/paradigmshift-labs/platty/refs/heads/feat/demo/downloads/platty-meko-demo.zip),
extract it to a permanent folder, open a terminal there, then run:

```bash
codex plugin marketplace add "$PWD"
codex plugin add platty@meko-poc
```

For Claude Code, run `claude plugin marketplace add "$PWD" --scope user` and
`claude plugin install platty@meko-poc --scope user` from the extracted folder.

## Connect and verify

Obtain your MEKO access token from the administrator. Follow the
[client authentication steps](USER_GUIDE.md#4-load-your-access-token), then
register MCP as **`platty`** at `https://meko-poc.platty-ai.com/mcp`.
The expected project is `petshop-full`. Credentials are not included.

Restart your client and verify a real repository or source read. A listed plugin
alone is not a successful connection test.
