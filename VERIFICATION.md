# Demo delivery verification

Prepared November 2, 2026 (Asia/Seoul), version `0.0.9-meko.3`.

The `feat/demo` branch is based on the retained single-skill commit
`401f91c7ebbdc2d1815b8d4b2b6117d6455e218a`. Only `platty` and its
`platty-search` skill are registered. Installation is through the Git
marketplace pinned to `feat/demo`. Installation archives and their packager
have been removed. Application source, production rows and access credentials
are not distributed with the plugin.

## Verified

- `python3 verify-package.py .`: **19/19 checks passed**. Before the Git-only
  changes, the new checks failed on installation alternatives and archive
  artifacts (**16/18**), then passed after those were removed.
- `claude plugin validate .`: **Validation passed**. A nonblocking README
  install-listing suggestion remains; it did not prevent installation.
- Codex CLI **0.160.0**, in a disposable Linux container with no host user
  configuration, registered `paradigmshift-labs/platty --ref feat/demo`,
  installed `platty@meko-poc` at `0.0.9-meko.3`, and listed it as enabled.
  `marketplaceSource.sourceType` was `git` with the expected public repository.
- Claude Code **2.1.311**, in the same disposable environment, registered
  `https://github.com/paradigmshift-labs/platty.git#feat/demo` and installed
  `platty@meko-poc` as an enabled user-scoped plugin.
- **Actual UI interaction using Computer Use:** launched Codex CLI in an Xfce
  Terminal, opened `/skills` → **List skills**, observed **platty-search
  (platty)**, filtered with `$platty`, and selected it. The prompt received
  **`$platty:platty-search`**. This tests discovery and insertion, without
  submitting a model prompt. See [skill list](guide/en/verification/codex-skills.png)
  and [selected skill](guide/en/verification/codex-skill-selected.png).
- Registered MCP as **`platty`** using the documented environment-token
  configuration. An existing authorized MEKO credential was privately supplied
  only to the disposable environment. After restart, the actual Codex `/mcp`
  screen showed **`platty: connected (59 tools)`**. See
  [MCP connection](guide/en/verification/codex-mcp.png).
- An authenticated MCP transport test using that `platty` configuration
  confirmed **petshop-full**, listed **10 authorized repositories** with no
  next page, and read **473 characters of real Java source** from the tenant
  controller in `pts-env`. Source text and credentials were not printed or
  added to this repository.
- Browser verification at **320, 768 and 1280 px**: no horizontal overflow;
  shell tabs and keyboard navigation, command copy, section links and details
  all passed. Light/dark rendering succeeded with no JavaScript errors.
- `git diff --check`: exit 0.

The English skill and project-specific behavior were previously checked
against missing-tool, wrong-project and incomplete-search scenarios. This
Git-only revision does not alter skill behavior.

## Screenshot walkthrough revision

Codex, Git and AI-client sign-in are prerequisites already completed by the
recipient. Client installation/login instructions and the sign-in screenshot
have been removed. The six-step walkthrough starts with Platty Git registration.

The English HTML manual now includes seven unedited screenshots: Git
installation, installed/enabled plugin status, skill list, selected skill, hidden token entry, MCP registration and live MCP connection.
Four screenshots of Git installation, plugin status,
hidden token entry and MCP registration were captured in a fresh disposable
container through Computer Use; the three previously verified skill/connection
screenshots are reused unchanged.

The token-entry screenshot uses a nonfunctional placeholder, explicitly marked
in its caption. No generated answer is pictured. The live connection screenshot
remains the earlier authorized MEKO test. All seven original PNGs are embedded byte-for-byte in the HTML for
offline sharing, with captions, alternative text and a keyboard-accessible
original-size viewer. The original PNGs remain in `guide/en/verification/`.

The illustrated file was opened directly from disk with networking disabled at
320, 768 and 1280 px. All seven images decoded, all seven original-size viewers
opened and closed using Close or Escape, and focus returned to the invoking
button. No outer horizontal overflow, external requests or JavaScript errors
were observed. Existing copy, tab and navigation checks also passed.

## Existing failure outside the demo change

`node scripts/check-issue-intake.mjs` fails because the unchanged
`guide/en/support-matrix.md` lacks the unified feedback-form link. The same
command fails at the same assertion on the base single-skill commit. The demo
does not modify those legacy support/CLI guides. The new README files retain
the unified feedback-form link.

## Recipient checks and limits

Each recipient still needs their own AI account, an authorized MEKO server
credential and connectivity from their execution host. The isolated UI test
used a nonfunctional placeholder OpenAI key only to open local menus; no model
request or generated answer was submitted. The MEKO connection used a real,
already authorized server credential. That does not establish a recipient's
permissions.

The Codex desktop app was not installed in this environment: the screen test
covers the **actual Codex CLI UI**, not desktop-app installation or its plugin
directory. Native Windows setup and the PowerShell token example were not
executed in the Linux test. Test credentials and containers are removed after
verification; the host's existing MCP configuration is preserved.

The MCP name is `platty`; the endpoint remains
`https://meko-poc.platty-ai.com/mcp` and the expected project is `petshop-full`.
Missing menu context, scheduler imports and search-guide content remain explicit
evidence gaps as described in the manual.
