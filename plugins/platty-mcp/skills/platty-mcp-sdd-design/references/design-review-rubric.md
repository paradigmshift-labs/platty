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
implementationReadinessScore: 0-100
criticalFindings: []
blockingFindings: []
warnings: []
requirementCoverage: {}
productInputAudit: {}
technicalDecisionAudit: {}
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
- `partial`: the design can be reviewed when it has no blocking findings and all
  remaining gaps are bounded Evidence-Resolution items, but it is not final
  approval-eligible and never creates or overwrites `tasks.md`. Preserve each
  gap and next read in `system_design.md` §11, resolve it, and create a new design
  revision.
- `blocked`: a required input/refresh is unavailable, a critical contradiction
  exists, or an unaccepted implicated unknown prevents safe implementation. It
  requires `NEEDS_WORK` and is not approval-eligible.
- `PASS` permits `readiness: ready` or `partial` only when there are no
  blocking findings, but only `PASS / ready` opens the task gate. `NEEDS_WORK` blocks approval and is required for
  `readiness: blocked` or any blocking finding.
- `ready` additionally requires `implementationReadinessScore >= 95` and zero
  `criticalFindings`. A weighted score never cancels a critical failure.

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
- Every incoming PRD `DH-*` preserves its invariant user result and maps exactly
  once to a source-grounded `DEC-*`, a bounded Evidence-Resolution row, or an
  owner-qualified `TQ-*`.
- Every promised `WHEN`, universal quantifier, rate, and `H-*` denominator is
  reconciled with all source eligibility gates and intentional suppression/skip
  paths. Any difference between the promised trigger set and the source eligible
  set either maps to an approved exclusion or returns to product revision; it is
  never hidden behind a `NO-CHANGE` implementation boundary.

### Product Input Audit

- `requestRevision` and `storiesRevision` match fresh hashes of the selected
  persisted product inputs, and both current statuses are `approved`.
- `productInputFingerprint` matches canonical JSON of both revisions and
  statuses. A draft-only design is not approval-eligible; after the product
  inputs are approved, generate a new design revision.
- Approval and every task preflight reread `prd.md` and `user_stories.md` rather
  than trusting stored fields.

### Technical Decision Audit

- Product Boundary Recheck covers every `DH-*`, `TQ-*`, and proposed decision.
  If an answer changes whether a user qualifies or earns, eligibility, reward,
  surface continuity, detail navigation, money, permission, notification, or a
  visible result, return it to SDD spec as a new product revision in draft. The
  revised product pair must be explicitly re-approved; until then block ready
  and do not create or overwrite `tasks.md`.
- A `technicalKickoffPacket` is built before broad or deep source descent and
  classifies every incoming `DH-*` exactly once as an auto-decision,
  evidence-resolution item, or exception-qualified technical-owner question.
- Any technical-owner questions are presented in one consolidated kickoff
  decision sheet. Their answers are recorded before deep design; a newly found
  exception stops the revision for a new kickoff instead of creating a mid-design
  drip of questions.
- Kickoff answers never count as final design approval. Final approval is a
  separate later interaction after the persisted design revision is presented.
- Reversible API, DTO, DB, index, query, ordering implementation, tie-breaker,
  cache, component, file, test, deployment, and rollback choices that preserve
  the approved user result are resolved from bounded source evidence as
  `DEC-*`; they are not questions for the product approver.
- Every `TQ-*` names the technical owner and exactly one allowed human-decision
  reason: material cost/operational responsibility, security/privacy, data
  loss, or irreversible migration. A source fact gap is Evidence-Resolution,
  not a request for a human guess.
- If the answer changes visible result, scope, rule, AC, or success judgment,
  the design emits product feasibility feedback instead of closing it as
  `DEC-*` or `TQ-*`.
- Behavioral Analogue and Reuse Assessment is complete before any new timer,
  session, reward, activity-detector, or dedup architecture. Every candidate is
  classified `REUSE`, `EXTEND`, `NEW`, or `NOT_APPLICABLE` with evidence and
  boundary rationale. A design missing the reuse assessment is `partial` or
  `NEEDS_WORK`, not ready and not task-eligible.

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
- Appendix A-10 records every implementation repository's exact evidence tree,
  implementation baseline, read proof, and `MATCHED`. A different standalone
  snapshot cannot prove parity; execution preflight separately checks checkout
  HEAD against that baseline.

### Implementation Evidence Ledger Audit

- Start with one macro coverage verdict: actors/outcomes, end-to-end flows,
  ownership, security/PII, failure isolation, dependencies, release,
  observability, and rollback. File/constant reads may follow only when they
  resolve a named P0/P1/P2 implementation blocker; resolved evidence is not
  repeatedly reread.

- Every changed API has field-level request, response, and error rows. Each row
  records type/nullability, consumer, and a `stored`, `derived`, or `constant`
  value origin with exact source or formula. `unavailable` blocks readiness.
- Actor, cause, policy eligibility, scheduled time, and correlation claims need
  explicit source capability. A boolean, timestamp, URL fragment, or job target
  date alone does not prove attribution.
- Every user-visible reason, label, status copy, and notification value has an
  exact safe mapping, constant, sanitization rule, or formula. Names such as
  `errorMessage`, `reason`, `description`, and `label` are not semantic proof of
  user language, stability, privacy safety, or source-state coverage. Audit every
  control-flow branch: a safe null fallback does not authorize a non-null branch
  to expose a raw/provider/exception/original message directly.
- Every implicated enum/status symbol lists all discovered values. Each appears
  exactly once as mapped or excluded, with count/invariant treatment. Every
  mapped source value names one exact declared response/UI disposition, and the
  map may not point to an undeclared target. A complete partition without these
  target assignments, partial examples, and catch-all prose all block readiness.
- Every changed screen records exact route, server entry, client component, API
  hook/client, type, test target, and bounded evidence. A page file alone is not
  complete topology for an interactive App Router screen.
- Every paginated API declares strategy, deterministic total order, unique
  tie-breaker, page/cursor semantics, and exact `hasNext` derivation. Offset or
  cursor pagination with unspecified ordering blocks readiness.
- Every `CHG-*` is Primary in exactly one slice, every `VER-*` belongs to at
  least one slice, and a slice with predecessors is not labeled independent.
- Every exact command has cwd, command, observed timestamp, exit/result, and
  evidence. `PASS` requires exit 0; `EXPECTED_RED` requires the
  runner to start and an intended missing behavior, assertion, or approved-new
  test target to explain the nonzero exit. Runtime, package-manager, dependency,
  permission, network, workspace, and module-resolution failures block readiness.
  In a contractually read-only MCP source session, `SOURCE_CONFIRMED` requires
  exact wrapper, module, runner config/plugin, selector, adjacent test, matched
  source commit, `exit: N/A`, and `executionDeferred=task-preflight`. The task
  checklist must copy its id and exact command into a before-edit actual execution
  step; incomplete source proof or deferred execution transfer blocks readiness.
- Run `scripts/readiness-validator.mjs` on the persisted artifacts. Its score is
  the implementation readiness score; any critical finding blocks ready. The
  validator also checks revision/fingerprint binding, placeholders, v4 module
  table/checklists, exact file actions, API request/response/error contracts,
  DB migration/write behavior, RED/GREEN/regression commands, pagination
  contracts, slice ownership/dependencies, and `CHG-*`/`VER-*` coverage. It recomputes the
  canonical product-input fingerprint and design revision from persisted
  content; equal stale strings are not sufficient.

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
- Every screen and API inventory row includes its stable ID, human-readable name,
  exact screen route or method/path, and decision status. Use `Proposed · Approved`
  for decided TO-BE contracts and `Existing · Confirmed` for bounded-read AS-IS
  contracts; `Candidate` blocks task generation.
- Every applicable screen, synchronous API, asynchronous event/job trigger, and
  data/state boundary has exactly one owning `SCREEN-*`, `API-*`, `EVENT-*`, or
  `DATA-*` row. Rules, slices, Appendix A, and tasks reuse those ids instead of
  relying on matching free-text names.
- `D-*`/`O-*` remain product-owned, while `DEC-*` owns only confirmed technical
  decisions or bounded risk acceptance and `TQ-*` owns new technical questions.
  Meeting agenda rows cite `O-*` or `TQ-*`; they do not preassign `DEC-*` to an
  undecided item.
- `DH-*` remains the PRD-owned design handoff id. Each handoff is visible in the
  Technical Decision Packet and has exactly one disposition. Reversible
  implementation alternatives that preserve the approved result do not remain
  as meeting questions.
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
  completion conditions. Tasks may expand §8–§10 into module checklists but do not invent
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
- `tasks.md` is written only after the current design is explicitly approved and
  Self Review is exactly `PASS / ready`. Prospective, blanket, or same-request
  approval does not count. `partial`, `blocked`, or `NEEDS_WORK` never creates or
  overwrites `tasks.md`; Evidence-Resolution stays in design §11.
- Prospective, blanket, or same-request approval is invalid for the task gate.
- Technical kickoff answers are decision inputs, not approval of a design that
  has not yet been persisted and presented.
- The task gate remains closed while any candidate-only edit target, result-changing
  open `O-*`/`TQ-*`, implicated `UNKNOWN`, missing exact API/screen route, or missing
  test file/symbol/command remains.
- After task generation only, read back `tasks.md` and audit the §0 module table
  against every numbered section. Every changed module needs checked exact file
  actions, symbol/signature, standalone boundary schema and state behavior, and
  exact Test/RED/GREEN/Regression commands. Non-applicable categories are one
  `N/A` entry with a reason. This post-task audit is not part of the earlier
  design-readiness verdict.

## Finding Severity

Put missing or duplicated `DH-*` dispositions, an implementation-only question
aimed at the product approver, a `TQ-*` without an allowed reason/technical
owner, missing canonical change rows, blank impact surfaces, invalid negative
claims, unaccepted implicated unknowns, missing `VER-*` mappings, stale required
impact, incomplete Appendix A-10 ledgers, unavailable fields, incomplete state
coverage, unproven commands, checkout mismatch, frontend topology gaps, and
approval/revision mismatches in `blockingFindings` and `criticalFindings`. Put non-blocking
clarity or operational improvements in `warnings`. Revise every blocking
finding and rerun the complete rubric before claiming ready.
