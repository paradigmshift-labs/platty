# Install Platty Search

Use the [English HTML manual](guide/en/platty-demo.html) or the
[complete text guide](USER_GUIDE.md). Download the HTML file and open it in a
browser, or share the file with an authorized recipient.

Codex and Git are already installed, and you are already signed in.
Start by registering the Platty plugin from Git below.

## Codex: install this branch

```bash
codex plugin marketplace add paradigmshift-labs/platty --ref feat/demo
codex plugin add platty@platty
```

Use `feat/demo` explicitly. The default branch contains a different distribution.
The marketplace is `platty`, the plugin is `platty`, and its only skill is
`platty-search`.

## Claude Code: install the same Git branch

```bash
claude plugin marketplace add https://github.com/paradigmshift-labs/platty.git#feat/demo --scope user
claude plugin install platty@platty --scope user
```

## Connect and verify

Obtain your Platty access token from the administrator. Follow the
[Platty token steps](USER_GUIDE.md#3-paste-your-platty-token-and-connect) to
configure MCP as **`platty`** at `https://meko-poc.platty-ai.com/mcp`.
The expected project is `petshop-full`. Credentials are not included.

In a new Codex CLI session, open `/skills` → **List skills** and confirm
**`platty-search (platty)`** appears. Select it by typing `$platty` and pressing
Enter. Then open `/mcp` and verify a real repository or source read. A listed plugin
alone is not a successful connection test.
