# SDD Question Ownership (Local)

Use this contract for local, MCP-free SDD retrieval, product specs, and technical
design. Its purpose is to preserve evidence and approval safety without asking a
non-developer to choose implementation details.

Local evidence comes from the exported SOT projection and the local CLI through
`platty-retrieval`: SOT files under `~/.platty/sot/<projectId>/`, `platty sot
resolve/glossary search`, `platty graph trace`, and `platty code search/snippet`.
Wherever this contract needs "existing behavior," that means SOT/source evidence
gathered locally, never a guess.

## Contents

- Core Rule and Classification Test
- FACT Handling and Safe PRODUCT Recommendation
- Adaptive Product Interview
- PRODUCT Question Shape and DESIGN Handoff
- Metrics Boundary, Product Draft And Review Gate, and Red Flags

## Core Rule

Classify every unresolved item before asking the user:

| Class | Meaning | Owner | Default action |
| --- | --- | --- | --- |
| `FACT` | Existing product or implementation behavior that local SOT/source evidence can confirm | retrieval | Read the required SOT/source evidence; never ask the user to guess it |
| `PRODUCT` | A choice that changes the visible user result, target user, policy, scope, money, permission, notification promise, or irreversible outcome | SDD spec | Apply a safe recommendation when one clearly fits; otherwise ask one plain-language product question |
| `DESIGN` | API, DTO, DB, index, migration, cache, query, sort implementation, tie-breaker, component, file, test, deployment, or rollback choice that preserves the approved user result | SDD design | Preserve it in the design handoff; do not ask it during product drafting |

The labels are runtime coordination metadata. Do not add them to persisted
frontmatter or expose them in the first user-facing review by default.

## Classification Test

Apply these questions in order:

1. Can local SOT document, spec, glossary, graph, or bounded `code snippet`
   evidence establish the answer as existing behavior? Classify it as `FACT`.
2. Would different answers change what the user or operator sees, can do, pays,
   receives, is allowed to do, or cannot undo? Classify it as `PRODUCT`.
3. Would different answers preserve the approved visible result and differ only
   in implementation or operation? Classify it as `DESIGN`.
4. If an item spans classes, split it. Do not promote a technical sub-question
   into a product decision merely because it is attached to one.

Examples:

| Item | Class | Reason |
| --- | --- | --- |
| Whether an active Home Banner is already ordered by priority | `FACT` | Existing behavior is source-confirmable from SOT/code |
| Whether the highest-ranked eligible notice appears as the first home banner | `PRODUCT` | It defines the promised visible result |
| Whether notices reuse a table or use a new table | `DESIGN` | Either can preserve that result |
| How equal ranks are broken | `DESIGN` unless users receive a promised ordering guarantee | Normally an implementation contract |
| Whether all users or only a segment see the notice | `PRODUCT` | Target experience changes |
| Which endpoint, DTO, cache, component, or test implements it | `DESIGN` | Implementation detail |

## FACT Handling

- Use local SOT/source evidence before asking the user.
- Complete only the evidence rungs required to establish the relevant fact and
  its boundary. Do not use call volume as proof of completeness.
- If a required SOT surface or source read is unavailable, record the exact
  coverage limit (for example, missing spec, stale export, or no confirmed
  graph edge).
- A missing fact becomes retrieval coverage or a design Evidence-Resolution
  item. It does not become a request for the non-developer to select an API,
  field, enum, query, or source path.
- Never convert a `code search` miss into a negative fact.

## Safe PRODUCT Recommendation

Apply a recommendation to the draft before asking when all are true:

- the user's requested visible result is specific;
- current product evidence supports one existing host flow or policy;
- the recommendation is reversible;
- it does not introduce a materially different money, permission, security,
  privacy, legal, notification, data-loss, or operational promise;
- competing choices are primarily implementation alternatives.

Record an adopted recommendation as the current product decision and close its
matching product question. A future revisit condition does not keep the current
decision open.

Ask before drafting only when two or more `PRODUCT` choices remain genuinely
tied and their user-visible consequences are materially different. Technical
possibility alone is not a tie.

## Adaptive Product Interview

Use one question at a time and no arbitrary question limit. Product discovery
ends because the product result is complete, not because a numeric budget has
expired. A specific request with a safe, reversible existing product flow may
still need zero questions; a complex policy may need five, ten, or more.

Maintain this runtime-only state:

```text
- decisionLedger: every resolved, recommended, or open PRODUCT decision
- productInterviewRounds: ordered question, answer, evidence read, and effect
- remainingProductDecisions: ranked unresolved PRODUCT decisions
- stopReason: zero unresolved PRODUCT decisions | waiting for product answer |
  capability gap
```

Run the loop in this order:

1. Before deep or full-cycle SOT retrieval, ask only when the raw request itself
   has a materially different user-visible interpretation whose answer changes
   the evidence branch. The question must not assert an existing-system fact or
   ask for an implementation choice. A time-based reward with unstated cadence
   is one such case: once-per-visit/window and repeated-threshold earning are
   different economic policies.
2. Narrow the retrieval scope from the answer, read the SOT/source evidence
   needed for that branch, then reclassify every unresolved item as `FACT`,
   `PRODUCT`, or `DESIGN`.
3. Apply safe recommendations and update `decisionLedger`. If
   `remainingProductDecisions` is non-empty, ask its highest-priority item in
   plain language, record the answer, research only the newly affected boundary,
   and reclassify again.
4. Stop interviewing only when there are zero unresolved `PRODUCT` decisions.
   Do not ask a filler question. `FACT` work and `DESIGN` handoff items are not
   reasons to continue the product interview.

The final product approval after the reviewed drafts are saved is a separate
gate. It is not an interview round and cannot retroactively close an unresolved
product decision.

### Question Priority

Rank `remainingProductDecisions` by material user effect:

1. target user, eligibility, product surface, and journey continuity;
2. money, rewards, permissions, privacy, notification, and irreversible state;
3. cadence, duplication, limits, exceptions, and failure behavior;
4. reversible feedback or operator preference.

A safe existing limit or policy may be adopted as a recommendation. It must not
displace an unresolved surface, journey, eligibility, or reward decision merely
because the existing default is easier to confirm.

## PRODUCT Question Shape

Ask exactly one question at a time and use product language:

```text
정해야 할 것: <사용자에게 보이는 선택>
추천: <권장안>
이유: <현재 제품 근거와 사용자 영향>
달라지는 점: <다른 선택의 사용자 관점 차이>
```

Do not put API, DB, field, enum, migration, cache, query, tie-breaker,
component, file, test, source parity, or internal SDD ids in this question.
Explain an unavoidable technical constraint through its user or operational
effect first.

## DESIGN Handoff

Preserve each `DESIGN` item instead of discarding it or turning it into a
product blocker:

```text
Design Decision Handoff
- item:
- approvedProductIds:
- invariantUserResult:
- evidenceKnown:
- evidenceMissing:
- candidateOptions:
- riskClass: reversible | cost | security | privacy | data-loss | irreversible | product-change
- recommendedNextRead:
```

The SDD design phase resolves reversible, source-grounded items itself and
records the selected option as a technical decision. Ask a technical owner only
when the choice materially changes cost or operational responsibility, security
or privacy, data loss, irreversible migration, or the approved product result.

If design evidence changes the approved product result, return a feasibility
feedback packet to SDD spec. Do not close that change as a technical decision.

## Metrics Boundary

- A numeric promise visible to users or required to approve policy is
  `PRODUCT`.
- Baseline collection and a later decision rule are not a product blocker when
  the approved visible result is unchanged; preserve them as design/operations
  work.
- Instrumentation, event schema, data pipeline, dashboard, and query details are
  `DESIGN`.
- Never ask the user to invent an unknown baseline merely to fill a template.

## Product Draft And Review Gate

When no tied `PRODUCT` choice remains:

1. Resolve `FACT` items or record their evidence boundary.
2. Apply safe `PRODUCT` recommendations.
3. Preserve `DESIGN` handoffs.
4. Draft and review the planning documents before the approval request.
5. Present one plain-language review:

```text
이번에 바뀌는 것
- <사용자 관점 변화 3~5개>

제가 적용한 추천안
- <평이한 결정과 이유>

확인이 필요한 충돌
- <없음 또는 진짜 PRODUCT 충돌>

이 방향으로 기획을 승인할까요?
```

Before sending that review, run a wording audit. Rewrite code-field names and
implementation vocabulary into the user's product language even when the saved
draft preserves the exact identifier as evidence. For example, say `가장 우선인
공지` rather than ``priority``. The first review contains no backticked
identifier unless the user explicitly needs that exact public name to make a
product decision. Raw workflow status values remain in the persisted artifacts
and are shown only on request.

Explicit product approval, revision binding, impact coverage, design approval,
and task gates remain unchanged. Fewer questions must not weaken those gates.

## Red Flags

- Asking the user to confirm a source-checkable existing fact.
- Offering "reuse the existing API/table" versus "create a new one" as a
  product choice when the visible result is the same.
- Blocking product drafts on ordering implementation, tie-breakers, cache,
  migrations, file locations, or test commands.
- Hiding a real money, permission, notification, privacy, or irreversible
  product choice inside technical design.
- Dropping technical uncertainty instead of handing it to design.
- Treating a long SOT investigation or many CLI calls as a reason to expose raw
  implementation terminology in the first review.
- Leaving a field name such as ``priority`` in the plain-language approval
  summary when `가장 우선인` conveys the same product result.
