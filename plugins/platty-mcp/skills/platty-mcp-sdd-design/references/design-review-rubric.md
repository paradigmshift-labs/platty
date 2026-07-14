# MCP SDD Design Review Rubric

This rubric is the single owner of implementation-readiness review for
`system_design.md`. Review the persisted design, revise it, then review it again:

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

The full result is the review working record and is summarized in Appendix A.
`system_design.md` frontmatter keeps only `review.verdict` and
`review.readiness`; it must not become a reader-facing diagnostic dump.

- `ready`: all mandatory audits pass; any implicated unknown has a separately
  confirmed `DEC-NN` risk-acceptance decision with owner, rationale, affected ids,
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

- Every request rule, acceptance criterion, confirmed decision, assumption,
  open question, success hypothesis, story, and stable story scenario maps to a
  TO-BE decision and `CHG-*`/`VER-*` disposition, or is named as out of scope
  with rationale.
- Product `D-*` and `O-*` retain their PRD ids and ownership. A product question
  is never silently renumbered or closed by `DEC-*`; a product-changing answer
  returns to the product revision and approval flow.
- Scope, non-goals, assumptions, and accepted risks do not contradict inputs.

### Product Input Audit

- `requestRevision` and `storiesRevision` match fresh hashes of the selected
  persisted product inputs, and both current statuses are `approved`.
- `productInputFingerprint` matches canonical JSON of both revisions and
  statuses. A draft-only design is not approval-eligible; after the product
  inputs are approved, generate a new design revision.
- Approval and every task preflight reread `prd.md` and `user_stories.md` rather
  than trusting stored fields.

### Impact Assessment Audit

- Audit all eight surfaces—API/contract, DB/data, business logic/state, UI/UX,
  jobs/events, external integrations, security/permissions, and
  observability/release—against `prd.md §9` and the `CHG-*` map. Persist the
  compact verdict/readiness in frontmatter and the audit detail in Appendix A,
  not before the meeting-facing design sections.
- Every surface is exactly `yes`, `no`, or `unknown`, with reason, impact
  evidence, and `CHG-*` or N/A. A blank blocks readiness.
- Every `no` passes the negative-claim gate. Empty, missing, omitted,
  candidate-only, or truncated evidence is not proof of no impact.
- An implicated `unknown` blocks ready unless a separately confirmed `DEC-NN`
  decision records the affected ids and revisit condition in a new design
  revision. Generic design approval is insufficient.

### Change Coverage

- The Canonical Change Map is the only delta list.
- Every affected screen, API, event/job, data/DB boundary, external integration,
  and protected legacy flow is classified exactly once as `NEW`, `MODIFY`,
  `REUSE`, `NO-CHANGE`, `DEPRECATE`, `DELETE`, or `UNKNOWN` and maps to the
  applicable stable `CHG-*` outcome.
- Every row names AS-IS, TO-BE, affected consumers/data, detailed contract
  location, rationale, compatibility, and requirement/story mapping.
- `DEPRECATE` and `DELETE` require confirmed consumers, replacement, observation
  period, removal ordering, and rollback. Missing consumer convergence stays
  `DEPRECATE` or `UNKNOWN`, never confirmed `DELETE`.
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
- Every hard implementation claim and exact change location has a matching
  `confirmed-path` code-path coverage row: entry/caller, orchestration,
  persistence or external boundary, consumers, and adjacent tests,
  configuration, and migrations when present were read. An unread known
  boundary is `partial-path`, never a confirmed claim.
- Impact status, context status, source parity, source commits, traversal
  status, and coverage limits match `prd.md §9`.
- Candidate-only evidence remains candidate; unsupported claims are assumptions,
  risks, or omitted.
- The design footer references `prd.md §9` evidence without copying the dossier.

### Delivery Safety

- Applicable DB/data changes cover old/new reader-writer compatibility,
  deployment/backfill/validation/switch/contract ordering, and rollback/restore
  or roll-forward-only behavior.
- Every change has a release signal and a safe rollback or roll-forward plan.

### System Design Quality

- The title immediately leads to a meeting goal, scope/non-goals, and a decision
  agenda. A developer can understand the intended outcome before reading
  evidence, identifiers, or code paths.
- The body follows product understanding → confirmed AS-IS → decided TO-BE →
  Canonical Change Map → detailed contracts → vertical implementation packets →
  release and verification. A developer never has to infer the current system
  from a target-only inventory or read Appendix A before understanding the flow.
- Applicable designs inventory screens, APIs, events/jobs, data/DB boundaries,
  external integrations, and retirement work before implementation packets.
  Non-applicable sections say why they are N/A.
- Every applicable screen, synchronous API, asynchronous event/job trigger, and
  data/state boundary has exactly one owning `SCREEN-*`, `API-*`, `EVENT-*`, or
  `DATA-*` row. Rules, slices, Appendix A, and tasks reuse those ids instead of
  relying on matching free-text names.
- `D-*`/`O-*` remain product-owned, while `DEC-*` owns only confirmed technical
  decisions or bounded risk acceptance and `TQ-*` owns new technical questions.
  Meeting agenda rows cite `O-*` or `TQ-*`; they do not preassign `DEC-*` to an
  undecided item.
- AS-IS names the affected current boundary and critical call flow using only
  confirmed facts. TO-BE uses the same boundary and stable ids so the delta is
  visually and semantically comparable. Candidate edges are visibly candidate
  and never rendered as confirmed flow.
- The design names system boundaries, component responsibilities, data
  ownership, and existing-flow reuse before listing implementation changes.
  Target structure distinguishes synchronous contracts, asynchronous events,
  and external integrations and records alternatives for material decisions.
- Mermaid appears only where it makes a role flow, component boundary, or
  critical failure path easier to understand than a table. It must not repeat
  the adjacent table or imply an unconfirmed edge.
- Critical flows cover consistency, idempotency, timeout/retry/compensation or
  an explicit N/A rationale. Non-functional responsibilities include applicable
  permissions/privacy, performance, and observability.
- Each changed screen covers applicable loading, success, empty, forbidden,
  error, and partial-failure states. Each changed API separates AS-IS and TO-BE
  request, response, errors, permissions, consumers, compatibility, field
  semantics, and business branches. Events/jobs cover producer, payload,
  consumers, ordering, duplication, retry, PII, and observation.
- Applicable DB changes cover schema/index, readers/writers, migration,
  backfill, old/new compatibility, deployment ordering, production validation,
  and rollback or explicit roll-forward-only behavior. A no-schema change states
  that schema and writes are unchanged.
- Impact evidence, source parity, source commits, code symbols, graph traces,
  detailed `CHG-*`/`VER-*` mappings, and review diagnostics are after the
  meeting-facing sections in Appendix A or in `prd.md` §9. The frontmatter
  contains only the minimum identity, input/revision, approval, fingerprint,
  and compact verdict/readiness values.
- Meeting-facing §1–§11 contains no MCP document/spec/repository ids, retrieval
  tool instructions, candidate files/symbols, or source-confidence narration.
  Agenda and `TQ-*` rows reference the relevant Appendix A gap instead of
  embedding investigation transcripts.
- When screens or APIs are affected, Appendix A contains the available exact
  implementation handoff: routes/entry points, components/files/symbols,
  roles, displayed state, actions/navigation, method/path, handler, service,
  data/external boundary, contract/error, permission/consumer, and evidence
  state. Unknown values remain named gaps and are never filled from inference.
- Design §8 defines outcome-oriented `SLICE-*` packets. Every `CHG-*` belongs
  to one primary slice; each packet connects product ids, AS-IS gap, TO-BE
  change, screens/contracts/data, edit/protected/candidate targets,
  implementation order, exceptions, verification, dependencies, parallelism,
  release, and rollback so tasks can inherit it without adding design.
- Design §10 defines the complete verification contract and development
  completion conditions. Tasks may expand §8–§10 into cards but do not invent
  contracts, decisions, code locations, commands, or dependencies.
- Every `edit-target` has repo, full source commit, file, symbol, advisory line
  range, change intent, and bounded-read evidence. `candidate-target` rows use
  `CAND-*`, explicitly name missing locator fields and the next bounded read,
  and never authorize implementation. `NOEDIT-*` identifies protected code or
  product-scope boundaries without implying those lines were source-confirmed.

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
- After task generation only, read back `tasks.md` and audit every slice as
  `handoff summary -> task index -> code edit map -> detailed task cards`, with
  one matching index row per task. Only applicable task categories receive
  cards; non-applicable categories are one `N/A` entry with a reason. This
  post-task audit is not part of the earlier design-readiness verdict.

## Finding Severity

Put missing canonical change rows, blank impact surfaces, invalid negative
claims, unaccepted implicated unknowns, missing `VER-*` mappings, stale required
impact, and approval/revision mismatches in `blockingFindings`. Put non-blocking
clarity or operational improvements in `warnings`. Revise every blocking
finding and rerun the complete rubric before claiming ready.
