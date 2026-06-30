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

## Try Platty

- Install the free CLI from [GETTING_STARTED.md](GETTING_STARTED.md).
- Read the usage guide — English: [guide/en/usage-guide.md](guide/en/usage-guide.md) · 한국어: [guide/ko/usage-guide.md](guide/ko/usage-guide.md)

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

---

## Install

```bash
npm install -g @paradigmshift/platty
platty version
```

Install the agent plugin for your runtime:

```bash
# Codex
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

```text
# Claude Code
/plugin marketplace add paradigmshift-labs/platty
/plugin install platty@platty
```

After installing the plugin, start a new agent session, then run `platty setup`
from the repository you want to analyze.

## This repository

This repository is the public distribution surface for the Platty agent plugin —
the skills that teach Codex and Claude Code how to drive the Platty CLI. It does
not contain the Platty engine, CLI implementation, or backend (proprietary to
Paradigm Shift Labs, Inc.).

Included skills: `platty:using-platty`, `platty:platty-cli-router`,
`platty:platty-setup`, `platty:platty-static-analysis`,
`platty:platty-docs-target-curation`, `platty:platty-generated-docs`,
`platty:platty-sync`, `platty:platty-retrieval`, `platty:platty-sdd-spec`,
`platty:platty-sdd-design`, `platty:platty-memory`.

## Requirements

- Node.js 20–24 (Node 25 is not supported yet).
- macOS or Linux (Windows: official support planned).
- Your own AI provider credentials for the documentation step. No login or account is required to run Platty.

## License & support

Platty is proprietary software of Paradigm Shift Labs, Inc.; installation and use
are governed by [LICENSE.md](LICENSE.md). For licensing, billing, or feature
questions, use the official Platty support channel.
