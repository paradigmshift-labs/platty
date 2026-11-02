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

## Claude Code: install the same Git branch

```bash
claude plugin marketplace add https://github.com/paradigmshift-labs/platty.git#feat/demo --scope user
claude plugin install platty@meko-poc --scope user
```

## Connect and verify

Obtain your MEKO access token from the administrator. Follow the
[client authentication steps](USER_GUIDE.md#4-load-your-access-token), then
register MCP as **`platty`** at `https://meko-poc.platty-ai.com/mcp`.
The expected project is `petshop-full`. Credentials are not included.

In a new Codex CLI session, open `/skills` → **List skills** and confirm
**`platty-search (platty)`** appears. Select it by typing `$platty` and pressing
Enter. Then open `/mcp` and verify a real repository or source read. A listed plugin
alone is not a successful connection test.
