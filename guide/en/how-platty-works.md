<div align="right">

🇬🇧 English · [🇰🇷 한국어](../ko/how-platty-works.md)

</div>

# How Platty Works

> Read this first if you want to understand *what Platty is and why you can
> trust it* before running any commands.
> Ready to install? Jump to the [Usage Guide](usage-guide.md).

---

## What Platty is

Platty is a **codebase reverse-engineering and source-of-truth (SOT) extraction
engine**. It reads a real repository and produces a source-grounded map of what
the software actually does — its routes, data models, database access, API
calls, events, jobs, and external services — then turns that map into technical
and business documentation you can search and trust.

The core idea: instead of asking people to hand-write documentation (which goes
stale the moment code changes), Platty derives the documentation **from the
source itself**.

---

## The two phases

Platty works in two phases. You don't need to understand the internals — just
these two ideas:

```
   ┌─────────────────────┐        ┌─────────────────────┐
   │  1. Static analysis │   →    │   2. LLM analysis   │
   │  (reads your code)  │        │  (writes the docs)  │
   └─────────────────────┘        └─────────────────────┘
        runs on your              uses the AI provider
        own machine               you choose
```

**1. Static analysis.**
Platty reads your source code — it never runs it — and builds a source-grounded
map of what the code does. This is pure analysis: parsing files, following
imports and calls, and recording concrete evidence (which tables a route reads,
which APIs it calls, which queues it publishes to, which vendors it touches).

**2. LLM analysis.**
Platty hands that map to an AI model, which writes the technical and business
documentation. Because every sentence is grounded in the static map, each claim
traces back to real source code rather than a guess.

Day to day, this is just two commands — `platty analyze` (static analysis) and
`platty generate-docs run` (LLM documentation). See the
[Usage Guide](usage-guide.md).

---

## The guiding principle: never invent meaning

Platty's most important rule is **conservative honesty**: it never invents a
connection the source can't support.

When Platty cannot prove that two pieces of code are connected, it does **not**
fabricate a link. Instead it preserves the unresolved evidence together with the
reason it stayed unresolved — so the gap is visible in your documentation rather
than papered over with a confident-sounding guess.

This is why Platty's output is trustworthy: a missing edge is recorded as a
missing edge, not hidden.

---

## Local-first: why you can trust it

**Your code and your analysis stay on your machine.**

- **Static analysis runs fully locally.** Your source is never uploaded, and
  Platty **never executes** your code.
- **Your data lives in a local database.** The extracted map / Source of Truth
  is stored in a local SQLite database under `~/.platty` — not in any cloud.
- **You control the AI step.** Only the LLM documentation phase talks to an AI
  model, and it uses the **provider and credentials you choose**. You decide
  what is sent and where.

Platty is proprietary software, not open source — but it is built so you can run
it with your code staying under your control.

---

## The memory layer

Code is only part of the truth. The *why* behind a decision, a correction to a
wrong assumption, a constraint that lives in no file, the history of how
something came to be — this tacit knowledge usually sits in people's heads, not
the repo.

Platty lets you capture it. With `platty memory` you attach free-form notes —
**why / correction / constraint / context** — to a specific document, EPIC, or
item in the source-of-truth. Notes are versioned (append-only history) and carry
provenance (who recorded it, confidence, and whether it's confirmed or just
proposed).

The payoff is that this knowledge **comes back when it's relevant**: when you
retrieve the document or EPIC it's anchored to, the memory is shown right beside
it — and when Platty regenerates the business documentation, your recorded
memory is fed back into the model as context. So your team's knowledge persists
across regenerations instead of being lost, and actively shapes the output.

> **What's live today:** memory resurfaces through its **anchor** — open or
> regenerate the doc/EPIC it's pinned to and the memory comes with it. Free-text
> search currently flags that memory exists (a count) next to a result; ranking a
> search directly by memory content is on the roadmap.

---

## Where to go next

- **[Usage Guide](usage-guide.md)** — install, set up your AI provider, and run
  your first analysis end to end.
- **[Support Matrix](support-matrix.md)** — the languages, frameworks, ORMs,
  HTTP clients, and SaaS vendors Platty understands.
