# MCP SDD Design Review Rubric

This rubric is the single owner of implementation-readiness review for
`design.md`. Review the persisted design, revise it, then review it again:

```text
review -> revise -> review
```

Do not report a post-revision verdict from the earlier review. Persist and read
back the revised design before the final review.

## Result Contract

```yaml
verdict: PASS | NEEDS_WORK
readiness: ready | partial | blocked
blockingFindings: []
warnings: []
requirementCoverage: {}
productInputAudit: {}
impactAssessmentAudit: {}
changeCoverage: {}
verificationCoverage: {}
sourceParityAudit: {}
taskGate: "<open | gated, with reason>"
```

- `ready`: all mandatory audits pass; any implicated unknown has a separately
  confirmed `D-NN` risk-acceptance decision with owner, rationale, affected ids,
  bounded scope, and revisit condition in a new design revision. Generic design
  approval does not accept the risk and must not remove the blocker. The design
  is approval-eligible when it has no blocking findings.
- `partial`: the design is approval-eligible only when it has no blocking
  findings and all remaining gaps are task-level evidence-resolution gaps. The
  approved task artifact must set `executionReadiness: partial`, preserve each
  gap and next read, and omit unsupported implementation detail.
- `blocked`: a required input/refresh is unavailable, a critical contradiction
  exists, or an unaccepted implicated unknown prevents safe implementation. It
  requires `NEEDS_WORK` and is not approval-eligible.
- `PASS` permits `readiness: ready` or `partial` only when there are no
  blocking findings. `NEEDS_WORK` blocks approval and is required for
  `readiness: blocked` or any blocking finding.

## Review Gates

### Requirement Coverage

- Every request rule and stable story scenario maps to a TO-BE decision and a
  `CHG-*` row, or is named as out of scope with rationale.
- Scope, non-goals, assumptions, and accepted risks do not contradict inputs.

### Product Input Audit

- `requestRevision` and `storiesRevision` match fresh hashes of the selected
  persisted product inputs, and both current statuses are `approved`.
- `productInputFingerprint` matches canonical JSON of both revisions and
  statuses. A draft-only design is not approval-eligible; after the product
  inputs are approved, generate a new design revision.
- Approval and every task preflight reread `request.md` and `stories.md` rather
  than trusting stored fields.

### Impact Assessment Audit

- Audit all eight surfaces—API/contract, DB/data, business logic/state, UI/UX,
  jobs/events, external integrations, security/permissions, and
  observability/release—against `impact.md` and the `CHG-*` map. Persist this
  audit in `design.md` frontmatter `review`, not as a reader-facing design section.
- Every surface is exactly `yes`, `no`, or `unknown`, with reason, impact
  evidence, and `CHG-*` or N/A. A blank blocks readiness.
- Every `no` passes the negative-claim gate. Empty, missing, omitted,
  candidate-only, or truncated evidence is not proof of no impact.
- An implicated `unknown` blocks ready unless a separately confirmed `D-NN`
  decision records the affected ids and revisit condition in a new design
  revision. Generic design approval is insufficient.

### Change Coverage

- The Canonical Change Map is the only delta list.
- Every applicable impact surface and every material AS-IS to TO-BE delta has a
  stable `CHG-*` row.
- Every row has rationale, owner/repo, compatibility, impact evidence, and a
  requirement/story mapping.
- Conditional detailed modules expand applicable change ids only.
- DB/data assessment is always present. Applicable DB/data changes cover
  migration, backfill, compatibility, lock/load, recovery, privacy, and
  production validation concerns from the document contract.

### Verification Coverage

- Every `CHG-*` row maps to at least one `VER-*` row or a named task-level
  evidence-resolution outcome.
- Every request rule and stable scenario maps to a `VER-*` row or a named
  evidence gap.
- Each verification row names the test level, expected evidence, and an exact
  command or explicit evidence gap.
- Self Review cannot be `PASS` while a change lacks verification and a named
  task-level evidence-resolution outcome.

### Source Parity Audit

- AS-IS facts and hard implementation claims cite relevant dossier/source
  evidence at recorded commits.
- Impact status, context status, source parity, source commits, traversal
  status, and coverage limits match `impact.md`.
- Candidate-only evidence remains candidate; unsupported claims are assumptions,
  risks, or omitted.
- The design footer references `impact.md` evidence without copying the dossier.

### Delivery Safety

- Applicable DB/data changes cover old/new reader-writer compatibility,
  deployment/backfill/validation/switch/contract ordering, and rollback/restore
  or roll-forward-only behavior.
- Every change has a release signal and a safe rollback or roll-forward plan.

### Revision, Approval, And Task Gate

- `designRevision`, `productInputFingerprint`, and `evidenceFingerprint` follow
  the canonical hashing rules and match freshly read inputs.
- A new or changed design is draft with empty approval fields.
- Approved metadata is valid only when `approvedRevision = designRevision` and
  the approval transition was persisted and read back.
- `tasks.md` is written only after the current design is explicitly approved.
  Prospective, blanket, or same-request approval does not count. A `partial`
  approval may create only a task plan with `executionReadiness: partial`; a
  `ready` approval may create a task plan with `executionReadiness: ready`.
  `blocked` or `NEEDS_WORK` is never approval-eligible and never creates or
  overwrites `tasks.md`.

## Finding Severity

Put missing canonical change rows, blank impact surfaces, invalid negative
claims, unaccepted implicated unknowns, missing `VER-*` mappings, stale required
impact, and approval/revision mismatches in `blockingFindings`. Put non-blocking
clarity or operational improvements in `warnings`. Revise every blocking
finding and rerun the complete rubric before claiming ready.
