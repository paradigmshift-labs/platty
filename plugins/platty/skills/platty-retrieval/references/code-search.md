# Code Search Guide

Use for concrete files, symbols, snippets, implementation locations, handlers, DTOs, models, constants, or source absence.

## First Hops

1. If the user gives business language, run glossary search, `catalog/epics.md`, and the relevant epic context first to find code terms.
2. If the user gives a source-near term, use `code search --symbol` or targeted worktree grep, then map the result back to its catalog/EPIC context when available.
3. For a `codeTerm` from glossary, run `code search` first; do not pass it directly to `graph trace`.
4. Use `code snippet` or direct source read for the exact lines.

## Required Coverage

- Repo, file path, symbol, and line range.
- Why this symbol/file matches the question.
- Similar names or false positives distinguished.
- Absence scope when not found: exact repos/paths searched and terms used.

## Stop Rule

Do not answer code-location questions from SOT titles alone when source access is allowed. Do not claim absence from sibling repos or one grep term.
