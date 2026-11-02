# Resolve the question's target

Retrieve facts the tools can answer before asking the user. Use available
`term_lookup`, route/spec lookup, and source search to build candidates.
Use menu and scheduler tools only when available; their absence does not mean
the corresponding screen or job does not exist.

| Clue | Starting evidence |
| --- | --- |
| Exact API or handler | Route/spec lookup; controller registration and caller |
| Screen identifier or file | Source file; transaction and handler registration |
| Business word or abbreviation | Term registry, data dictionary, then matching source |
| Table or column | Data dictionary and all matching read/write paths |
| Job name | Job definition and callers; scheduler data only when available |

Keep identifiers exact. Use `term_lookup` with `view: summary` and a bounded
limit for initial discovery, then read the selected card. Confirm fuzzy-only
matches with the user before relying on them. State when business meaning is
unverified. An English prompt may refer to a Korean label: resolve it through
the dictionary or actual screen evidence, not a guessed abbreviation.

Record a short candidate table:

| Candidate | Repository and entry point | Action or data target | Evidence | Same functional group? |
| --- | --- | --- | --- | --- |

For action questions, callers of the same save/send service entry belong to
one functional group. Different processing entry points remain separate even
when they write the same table. For location or data-origin questions, group
by the relevant read target. Retain unresolved candidates; names alone do not
justify excluding one. Distinguish similarly named screens in different
repositories. Do not combine different menu paths or screen titles without
evidence that they identify the same function.

- One exact candidate: state the selected interpretation and proceed.
- Two or more functional groups: ask which target the user means, using the
  discovered candidates and their distinguishing action/data targets.
- No candidate: try another observed term or identifier fragment, then ask
  for the screen, API, or file the user saw.

Ask about one ambiguity at a time. Do not ask the user to supply a fact already
available through the tools. After a selection, retain the agreed target and
scope for this conversation; revise the affected investigation if corrected.

For noninteractive question lists or tests, do not wait for a reply. Prefer an
exact identifier/action match, otherwise state the chosen interpretation,
retain other candidates, and flag the unresolved ambiguity. Do not present the
unselected candidates' behavior as verified.
