# Demo delivery verification

Prepared November 2, 2026 (Asia/Seoul), version `0.0.10-demo.1`.

The `feat/demo` branch is based on the retained single-skill commit
`401f91c7ebbdc2d1815b8d4b2b6117d6455e218a`. Only `platty` and its
`platty-search` skill are registered. Installation is through the Git
marketplace pinned to `feat/demo`. Installation archives and their packager
have been removed. Application source, production rows and access credentials
are not distributed with the plugin.

## Verified

- `python3 verify-package.py .`: **20/20 checks passed**.
- `claude plugin validate .`: **Validation passed**. A nonblocking README
  install-listing suggestion remains; it did not prevent installation.
- Codex CLI **0.160.0**, in a disposable Linux container with no host user
  configuration, registered `paradigmshift-labs/platty --ref feat/demo`,
  installed `platty@platty` at `0.0.10-demo.1`, and listed it as enabled.
  `marketplaceSource.sourceType` was `git` with the expected public repository.
- Claude Code **2.1.311**, in the same disposable environment, registered
  `https://github.com/paradigmshift-labs/platty.git#feat/demo` and installed
  `platty@platty` as an enabled user-scoped plugin.
- **Actual UI interaction using Computer Use:** launched Codex CLI in an Xfce
  Terminal, opened `/skills` → **List skills**, observed **platty-search
  (platty)**, filtered with `$platty`, and selected it. The prompt received
  **`$platty:platty-search`**. This tests discovery and insertion, without
  submitting a model prompt. See [skill list](guide/en/verification/codex-skills.png)
  and [selected skill](guide/en/verification/codex-skill-selected.png).
- Registered MCP as **`platty`** using direct
  `http_headers = { Authorization = "Bearer …" }` configuration in a disposable
  container, without `bearer_token_env_var`. Codex's actual `/mcp` screen showed
  **`platty: connected (59 tools)`**; a fresh `project_get` confirmed
  **petshop-full**. The real credential was supplied privately and is absent
  from the repository and screenshots. See
  [MCP connection](guide/en/verification/codex-mcp.png).
- Earlier authenticated delivery validation confirmed **petshop-full**, listed **10 authorized repositories** with no
  next page, and read **473 characters of real Java source** from the tenant
  controller in `pts-env`. Source text and credentials were not printed or
  added to this repository.
- Browser verification at **320, 768 and 1280 px**: no horizontal overflow;
  screenshot viewers, keyboard closing/focus restoration, command copy/selection
  and section links all passed with no JavaScript errors.
- `git diff --check`: exit 0.

## Platty naming and skill checks

The marketplace name is `platty`, the plugin display title is **Platty**, the
installable plugin is `platty@platty`, and the skill remains `platty-search`.
Token guidance uses **Platty token** and `YOUR_PLATTY_TOKEN`. The existing server
hostname is preserved exactly; naming changes do not provision another server
or change the expected project.

The naming checks first failed (**16/20**) against the earlier package. A
read-only metadata-discovery control also returned customer-specific names and
a customer-specific token placeholder. After the update, a fresh independent
onboarding check returned Platty throughout. Forward scenarios still stopped
on a wrong default project and continued supported reads after
`guide_file_missing`. `quick_validate.py` reported **Skill is valid!**.
The skill's retrieval/evidence requirements and project checks are preserved.

## Screenshot walkthrough

Codex, Git and AI-client sign-in are already complete. The five-step guide
covers Git installation, skill recognition, Platty token input, connection
verification and the first question. All six original screenshots were
recaptured through Computer Use for `0.0.10-demo.1`: Git installation,
installed/enabled plugin, skill list, selected skill, token example and live
connection. The example shows only a placeholder. No generated answer is
pictured. The six PNGs are embedded byte-for-byte for offline sharing, with
captions, alternative text and an original-size viewer.

The file was opened directly from disk with networking disabled at 320, 768 and
1280 px. All images decoded; viewers opened, closed with Close or Escape, and
restored focus. Copy/selection and section navigation passed, with no outer
horizontal overflow, external requests or JavaScript errors.

## Claude Code screenshot walkthrough

The separate English Claude Code HTML guide assumes Claude Code, Git and
account sign-in are already complete. It covers Git installation, direct
Platty Bearer token input in project `.mcp.json`, project MCP approval and
connection checks, `/platty:platty-search` autocomplete, and an English screen
question.

An isolated Claude Code **2.1.311** environment installed `platty@platty`
**0.0.10-demo.1** from Git branch `feat/demo`. Actual terminal UI interaction
verified the enabled plugin, the connected `platty` project MCP with 59 tools,
the qualified skill suggestion and Tab completion, and the drafted first
question. Four unmodified PNGs capture these steps and are embedded
byte-for-byte in `guide/en/platty-claude-code.html`. The question was not
submitted; no generated Claude answer or application API execution is claimed.

The Claude Code guide passed offline browser checks at **320, 768 and 1280 px**:
all four original screenshots decoded; all viewers opened, closed using Close
or Escape, and restored keyboard focus; all command-copy/selection buttons and
section links worked; the JSON example parsed with the exact placeholder
header. There was no outer horizontal overflow, external request or JavaScript
error. Light and dark appearances were also rendered and inspected. The
existing Codex guide passed its same offline/browser checks after linking the
new Claude Code guide. Package verification remained **20/20**.

The container reused an existing authorized test account and Platty credential;
the guide contains only `YOUR_PLATTY_TOKEN`. The test container, terminal and
temporary window manager were removed afterward. Existing host client and MCP
settings were preserved.

## Existing failure outside the demo change

`node scripts/check-issue-intake.mjs` fails because the unchanged
`guide/en/support-matrix.md` lacks the unified feedback-form link. The same
command fails at the same assertion on the base single-skill commit. The demo
does not modify those legacy support/CLI guides. The new README files retain
the unified feedback-form link.

## Recipient checks and limits

Each recipient still needs their own AI account, an authorized Platty server
credential and connectivity from their execution host. The isolated UI test
used a nonfunctional placeholder OpenAI key only to open local menus; no model
request or generated answer was submitted. The Platty connection used a real,
already authorized server credential. That does not establish a recipient's
permissions.

The Codex desktop app was not installed in this environment: the screen test
covers the **actual Codex CLI UI**, not desktop-app installation or its plugin
directory. Native Windows setup was not executed in the Linux test. Test
credentials and containers are removed after verification; the host's existing MCP configuration is preserved.

The MCP name is `platty`; the endpoint remains
`https://meko-poc.platty-ai.com/mcp` and the expected project is `petshop-full`.
Missing menu context, scheduler imports and search-guide content remain explicit
evidence gaps as described in the manual.
