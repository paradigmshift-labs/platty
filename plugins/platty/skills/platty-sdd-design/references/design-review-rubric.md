# SDD Design Review Rubric

Return `PASS` only when the draft is implementation-ready or clearly marked as a draft with accepted assumptions.

## Implementation Sufficiency

- The first section identifies changed boundaries, implementation starting point,
  primary risk, and affected repositories/areas.
- As-is files and ownership boundaries are named.
- Proposed architecture is concrete enough to implement.
- API, screen, data, and job/event changes are explicit when relevant.
- Error handling and edge cases are present.
- Area change summary identifies affected areas and files.

## Technical Feasibility

- Graph trace is used as a bounded structural map for relevant screen/API/domain/DB or event/job paths; confirmed edges, candidates, and unresolved hops are distinguished.
- Claims about implementation-sensitive behavior are grounded in bounded `readonly_workspace_shell` source reads after graph trace or `code search` address resolution.
- Missing graph evidence is not treated as no impact.
- Existing patterns in registered repositories are followed.
- Stale SOT is declared and accepted before use.
- `impact.md` is read when present; its detailed matrix is referenced rather than
  copied into `design.md`.
- Every implementation-sensitive claim is marked as confirmed, assumption, or
  risk and has the appropriate evidence boundary.

## Convention Alignment

- Applicable repository instructions and neighboring implementation/test patterns
  were read before design claims.
- Module placement, names/types, validation/errors, transactions/external calls,
  tests, and formatting/migration conventions are recorded when relevant.
- Any deviation from observed conventions has a reason and a reviewable risk.

## Diagram Usefulness

- A diagram is present only when a multi-component flow, cross-boundary sequence,
  lifecycle, or branch-heavy behavior needs visual review.
- Every diagram agrees with contracts, data, error handling, and tasks.

## Scenario Coverage

- Every request rule has a design path or explicit non-goal.
- Every user-story scenario has implementation or validation coverage.
- Permission, concurrency, partial failure, stale data, and rollback are considered when relevant.

## Task Quality

- Tasks are file-specific where evidence supports file paths.
- Tests map to rules, stories, and edge cases.
- Manual checks are limited to non-automatable behavior.
- Tasks cite a design decision, rule/story scenario, and evidence reference or a
  bounded evidence-resolution task.
