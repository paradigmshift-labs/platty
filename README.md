# Platty

**English** · [한국어](README.ko.md)

## Vibe coding — now in brownfield, too.

**Even on hundreds of thousands of lines of existing code, your ideas turn into shipped services — automatically.**

Vibe coding promises a service the moment you describe it. So why doesn't it work
inside a company? In a brownfield environment — hundreds of thousands of lines of
existing code tangled with complex legacy — vibe coding is close to useless. You
tell the AI to read the whole codebase and work on it, but it hallucinates
constantly, and fixing the result often takes longer than doing it by hand.
Meanwhile, your tokens melt away.

**Try Platty, the Spec-Driven Development OS.** Ideas become spec documents, and
spec documents become code — automatically. The spec is written so that it never
conflicts with your existing services while staying logically complete. So is the
code.

Platty automatically builds an encyclopedia that understands your company the way
a CTO and a CPO would. Your planning and development AI agents work from that
encyclopedia. The result: spec documents and code that are logically complete and
never conflict with your existing services.

> Platty is proprietary software of Paradigm Shift Labs, Inc.

> **Static analysis coverage**
>
> **Real-world validated:** TypeScript/JavaScript, including monorepos · Java,
> including multi-module repositories
>
> **Preview:** Kotlin · Python · Dart/Flutter
>
> [View the detailed support and validation matrix →](guide/en/support-matrix.md)
>
> [Report an issue or request support](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml)

## Try Platty

### 1. Install Platty

```bash
npm install -g @paradigmshift/platty  # Install the CLI
platty install                        # Register the agent skills
```

Rerun `platty install` whenever you want to update an existing Platty plugin to
the latest published skills. After installation or refresh, start a new Codex
or Claude Code session.

### 2. Start onboarding

Platty will register the current repository, run static analysis, review the
documentation scope, and guide you through generating the source of truth.

#### Claude Code

```text
/platty:platty-onboarding .
```

#### Codex

```text
$platty:platty-onboarding .
```

`.` means the repository in your AI assistant's current working directory.

Onboarding uses your current conversation language. To choose a language
explicitly, append the instruction to the invocation. If the conversation
language is unclear, onboarding defaults to Korean.

```text
$platty:platty-onboarding . 한국어로 진행해줘
$platty:platty-onboarding . Continue in English.
```

You can also ask in plain language:

```text
Onboard this repository with Platty.
```

> **Generating documentation for large projects:** Projects with a large
> codebase or many documentation targets may reach the AI provider's usage
> limit. Subscription-based providers such as Claude Code may temporarily stop
> generation when the plan's usage limit is reached. Completed documents are
> preserved, so running the workflow again resumes from the remaining work
> instead of starting over.

- Detailed installation: [GETTING_STARTED.md](GETTING_STARTED.md)
- Usage guide — English: [guide/en/usage-guide.md](guide/en/usage-guide.md) · 한국어: [guide/ko/usage-guide.md](guide/ko/usage-guide.md)

## From idea to deploy — 10× faster

Have something you want to build? Just throw the idea in. Platty's planning agent
understands your service better than a CPO and writes the spec document for you,
automatically.

AI coding with Platty is on another level. Compared to just feeding the codebase
to the model, errors drop by more than half and token usage drops to less than
one-tenth. Automated coding is a given — and QA time shrinks dramatically.

## It builds an encyclopedia that understands your service — automatically

- **Multi-repo static analysis builds a code graph** — Platty automatically draws a code graph that connects every repository across your whole service. Because it analyzes code with Platty's static-analysis technology, accuracy is far higher than LLM analysis. It understands your company's code precisely, the way a CTO does.
- **The code graph is summarized into a service encyclopedia** — Platty analyzes the code graph to produce a natural-language document that lets you understand the whole service systematically. Like an encyclopedia, it has a table of contents and a summary per entry. It lets AI understand your service the way a CPO would.
- **Planning and development agents work from the encyclopedia** — results that don't conflict with your existing legacy come out right away. In the end, vibe coding becomes possible inside the company, too.

When your code is updated, the encyclopedia updates automatically. For the
concepts, see [guide/en/how-platty-works.md](guide/en/how-platty-works.md).

## The first analysis can take time

During onboarding, Platty analyzes the full codebase and builds the service
encyclopedia, or SOT. That first run can take time and use a meaningful amount
of AI provider tokens during documentation generation. It is still worth doing.

- **The system needs one full read first** — Platty connects hundreds of
  thousands of lines of code across one or more repositories into a code graph,
  then summarizes that graph into a natural-language encyclopedia. It is the
  work a new CTO or CPO would do to understand the whole company, done once up
  front.
- **Once built, it keeps paying back** — planning and development agents no
  longer need to reread the entire codebase for every task. They work from the
  encyclopedia, which is why errors can drop by more than half and token usage
  can fall below one-tenth compared with feeding the raw codebase directly.
- **After that, updates are lighter** — when code changes, Platty updates the
  encyclopedia from the changed parts instead of rebuilding everything from
  scratch. The heavy pass is the first one.

Think of the first onboarding run as paying once to save repeatedly. If a usage
limit pauses generation midway, completed documents are preserved, so rerunning
the workflow resumes from the remaining work instead of starting over.

> [!TIP]
> **Analyzing a large project?**
>
> For large company or institutional projects, contact the Platty team. We can
> provide a separate API path so you can run the analysis at no cost.

---

## Install

```bash
npm install -g @paradigmshift/platty  # Install the CLI
platty install                        # Register the agent skills
```

`platty install` detects Codex and Claude Code on your `PATH` and installs the
ordinary `platty@platty` plugin into every detected runtime. To target one
runtime explicitly, use `platty install --runtime codex` or
`platty install --runtime claude`.

Rerun `platty install` whenever you want to refresh an existing Platty plugin
to the latest published skills. After installation or refresh, start a new
Codex or Claude Code session.

Manual fallback for Codex:

```bash
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

Manual fallback for Claude Code:

```bash
claude plugin marketplace add paradigmshift-labs/platty --scope user
claude plugin install platty@platty --scope user
```

`platty install` never installs the separate `platty-mcp` plugin.

### Use the CLI directly

If you prefer a CLI-guided setup, run `platty setup` from the repository you
want to analyze.

For direct HTTP MCP setup, split the responsibility by role:

```text
Server operator:
  install/use full platty plugin -> platty:platty-mcp-server-setup

MCP consumer:
  install platty-mcp plugin -> platty-mcp:platty-mcp-client-setup
```

Supported MCP URL profiles:

```text
local  -> http://127.0.0.1:3027/api/mcp
LAN    -> http://<host-ip>:3027/api/mcp
remote -> https://<context-backend-domain>/api/mcp
```

For remote read-only retrieval against an already configured Platty MCP server,
install the MCP-only `platty-mcp` plugin:

```bash
codex plugin add platty-mcp@platty
```

```text
/plugin install platty-mcp@platty
```

## This repository

This repository is the public distribution surface for the Platty agent plugin —
the skills that teach Codex and Claude Code how to drive the Platty CLI. It does
not contain the Platty engine, CLI implementation, or backend (proprietary to
Paradigm Shift Labs, Inc.).

Included full `platty` skills: `platty:using-platty`,
`platty:platty-cli-router`, `platty:platty-onboarding`, `platty:platty-setup`,
`platty:platty-mcp-server-setup`, `platty:platty-static-analysis`,
`platty:platty-docs-target-curation`, `platty:platty-generated-docs`,
`platty:platty-sync`, `platty:platty-sdd-spec`, `platty:platty-sdd-design`,
`platty:platty-memory`.

For remote MCP retrieval, impact analysis, memory, and SDD handoffs against an already configured Platty MCP server,
install `platty-mcp`, which includes `platty-mcp:using-platty-mcp`,
`platty-mcp:platty-mcp-client-setup`, `platty-mcp:platty-mcp-retrieval`,
`platty-mcp:platty-mcp-impact-analysis`, `platty-mcp:platty-mcp-memory`,
`platty-mcp:platty-mcp-sdd-spec`, and `platty-mcp:platty-mcp-sdd-design`.
Impact analysis converges selected specs, graph classes, cross-EPIC traversal,
repository scope, and bounded source evidence into one dossier and owns only
the final §9 appendix of the selected `prd.md`. The SDD request flow writes
`prd.md` and `user_stories.md`; the design flow writes
`system_design.md` first for review, requires explicit approval, and only then
generates readiness-classified `tasks.md` from that approved design.
The `platty-mcp` plugin remains skills-only and does not ship `.mcp.json` or
`mcpServers`, because server URLs differ by deployment.

## Requirements

- Node.js 20–24 (Node 25 is not supported yet).
- macOS or Linux (Windows: official support planned).
- Your own AI provider credentials for the documentation step. No login or account is required to run Platty.

## License & support

Platty is proprietary software of Paradigm Shift Labs, Inc.; installation and use
are governed by [LICENSE.md](LICENSE.md). For licensing, billing, or feature
questions, use the official Platty support channel.
