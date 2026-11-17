# Demo delivery verification

Prepared November 2, 2026 (Asia/Seoul), version `0.0.10-demo.1`.

The `feat/demo` branch is based on the retained single-skill commit
`401f91c7ebbdc2d1815b8d4b2b6117d6455e218a`. Only `platty` and its
`platty-search` skill are registered. Installation is through the Git
marketplace pinned to `feat/demo`. Installation archives and their packager
have been removed. Application source, production rows and access credentials
are not distributed with the plugin.

## Project target change

On 2026-11-16 the expected project changed from `petshop-full` to
`yugabyted-ui` in version `0.0.10-demo.2`, because `petshop-full` was
deactivated on the server. The project notes, guides and example questions
now use yugabyted-ui facts observed that day. The Claude Code first-question
screenshot showed the retired question and was removed, so the manual now
embeds nine screenshots. The results below this section were recorded for
`0.0.10-demo.1`. `python3 verify-package.py .` passed **22/22 checks** after
the change.

Live check of `0.0.10-demo.2` on 2026-11-16 with Codex CLI 0.160.0 on Linux,
plugin installed from this branch in a clean Codex home with only the `platty`
MCP entry:

- The step 3 verification prompt identified `yugabyted-ui`
  (`GFJFxAeR3ukQlw0-IynSq`), listed the two repositories, read one source file,
  and reported the six unavailable tools.
- The first question returned `GET /api/slow_queries`, `GetSlowQueries`, and
  the `pg_stat_statements` join with `pg_database` and `pg_authid`, with
  repository, file, and line evidence.

## Term lookup update (0.0.10-demo.3)

On 2026-11-17 the server gained a screen-term glossary: 35 concept cards with
their screen labels, and 12 Migrations labels on Voyager column cards.
`context_status` now reports 56 of 59 tools available; only
`code_search_guide_get`, `job_dependency_trace` and `menu_lookup` are missing.
The project notes and user guide were updated to match, and the version was
raised to `0.0.10-demo.3`. `python3 verify-package.py .` passed **22/22 checks**
and `claude plugin validate .` passed.

Live check on 2026-11-17 with Claude Code 2.1.294 on Linux, using this plugin
directory and only the `platty` MCP entry, from an empty folder:

- The step 3 verification prompt identified `yugabyted-ui`, listed both
  repositories, read a source file, and reported the three missing tools.
- Natural questions without a tool hint ("What does Leader Tablets mean on the
  Nodes table…", "what does the Complexity column show…") called
  `term_lookup` first, then confirmed the value path in source:
  `GET /api/nodes` and `user_tablets_leaders + system_tablets_leaders`, and the
  assessment report value that overwrites the `complexity` column.

## Verified

- `python3 verify-package.py .`: **22/22 checks passed**.
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
  **`platty: connected (59 tools)`**; a fresh `project_get` confirmed the
  expected project of that time. The real credential was supplied privately and is absent
  from the repository and screenshots. See
  [MCP connection](guide/en/verification/codex-mcp.png).
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

## Unified tabbed walkthrough

`guide/en/platty-demo.html` is one offline HTML manual with **Codex / Claude
Code** tabs inside the skill-installation step. Switching a tab replaces all
five steps locally: Git commands, token configuration, connection checks,
skill selection, question examples and screenshots. No page navigation or
network request is used for switching. The previous Claude Code entry contains
the same manual with Claude Code selected initially.

Both entry files passed browser checks at **320, 768 and 1280 px**, with both
client tabs tested at every width. The checks verified keyboard tab switching
(Left/Right, Home/End), selected-tab and panel labels, correct client commands
and token examples, all copy/selection buttons, all original-size image viewers,
Close/Escape and focus restoration, section navigation, unique live element
IDs, and no horizontal overflow. There were no external requests or JavaScript
errors. All ten embedded PNGs match the original files byte-for-byte.

## Codex screenshot capture

Codex, Git and AI-client sign-in are already complete. The five-step guide
covers Git installation, Platty token input, connection verification, skill
recognition and the first question. All six original Codex screenshots were
recaptured through Computer Use for `0.0.10-demo.1`: Git installation,
installed/enabled plugin, skill list, selected skill, token example and live
connection. The example shows only a placeholder. No generated answer is
pictured. The six Codex PNGs are embedded in the unified manual, with
captions, alternative text and an original-size viewer.

The file was opened directly from disk with networking disabled at 320, 768 and
1280 px. All images decoded; viewers opened, closed with Close or Escape, and
restored focus. Copy/selection and section navigation passed, with no outer
horizontal overflow, external requests or JavaScript errors.

## Claude Code screenshot capture

The Claude Code tab assumes Claude Code, Git and
account sign-in are already complete. It covers Git installation, direct
Platty Bearer token input in project `.mcp.json`, project MCP approval and
connection checks, `/platty:platty-search` autocomplete, and an English screen
question.

An isolated Claude Code **2.1.311** environment installed `platty@platty`
**0.0.10-demo.1** from Git branch `feat/demo`. Actual terminal UI interaction
verified the enabled plugin, the connected `platty` project MCP with 59 tools,
the qualified skill suggestion and Tab completion, and the drafted first
question. Four unmodified PNGs capture these steps and are embedded
byte-for-byte in the unified manual. The question was not
submitted; no generated Claude answer or application API execution is claimed.

The Claude Code guide passed offline browser checks at **320, 768 and 1280 px**:
all four original screenshots decoded; all viewers opened, closed using Close
or Escape, and restored keyboard focus; all command-copy/selection buttons and
section links worked; the JSON example parsed with the exact placeholder
header. There was no outer horizontal overflow, external request or JavaScript
error. Light and dark appearances were also rendered and inspected.

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
`https://meko-poc.platty-ai.com/mcp` and the expected project is `yugabyted-ui`.
Missing menu context, scheduler imports and search-guide content remain explicit
evidence gaps as described in the manual.
