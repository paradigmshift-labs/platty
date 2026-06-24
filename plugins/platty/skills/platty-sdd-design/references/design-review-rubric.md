# SDD Design Review Rubric

Return `PASS` only when the draft is implementation-ready or clearly marked as a draft with accepted assumptions.

## Implementation Sufficiency

- As-is files and ownership boundaries are named.
- Proposed architecture is concrete enough to implement.
- API, screen, data, and job/event changes are explicit when relevant.
- Error handling and edge cases are present.
- Area change summary identifies affected areas and files.

## Technical Feasibility

- Claims about implementation are grounded in graph trace, code search/snippet, or direct source reads.
- Missing graph evidence is not treated as no impact.
- Existing patterns in registered repositories are followed.
- Stale SOT is declared and accepted before use.

## Scenario Coverage

- Every request rule has a design path or explicit non-goal.
- Every user-story scenario has implementation or validation coverage.
- Permission, concurrency, partial failure, stale data, and rollback are considered when relevant.

## Task Quality

- Tasks are file-specific where evidence supports file paths.
- Tests map to rules, stories, and edge cases.
- Manual checks are limited to non-automatable behavior.
