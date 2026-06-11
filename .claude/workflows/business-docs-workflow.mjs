export const meta = {
  name: 'business-docs-workflow',
  description: 'Drive a Platty business-docs run under Claude Code: round-based lease -> generate -> submit worker queue mirroring the Codex codex_cli queue (DAG gate, stop-on-failed, in-worker repair).',
  whenToUse: 'When generating Platty business documents under Claude Code instead of `business-docs run --provider codex_cli`. Pass { project, run?, cli?, workerModel?, leaseLimit? } as args.',
  phases: [
    { title: 'Plan' },
    { title: 'Generate' },
  ],
}

// --- args (all optional except project) ---
// { project: string, run?: string, cli?: string, workerModel?: string, leaseLimit?: number }
// Note: the runtime may deliver args as a JSON string, so parse defensively.
function parseArgs(raw) {
  if (typeof raw === 'undefined' || raw === null) return {}
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {} }
    catch { return {} }
  }
  return (typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
}
const a = parseArgs(typeof args !== 'undefined' ? args : undefined)
const PROJECT = a.project
if (!PROJECT) throw new Error('business-docs-workflow requires args.project (project id, name, or slug)')
// Use the installed binary by default; pass cli: "node packages/cli/dist/main.js" to use a local build.
const CLI = a.cli || 'platty'
// Generation quality: Sonnet clears the v3 quality gate reliably; Haiku frequently
// fails data_dictionary / use_case_list_refine. Default to sonnet for workers.
const WORKER_MODEL = a.workerModel || 'sonnet'
// Lease in waves well inside approvedActiveLeases (20) and workflow concurrency (16).
const LEASE_LIMIT = Number.isInteger(a.leaseLimit) && a.leaseLimit > 0 ? Math.min(a.leaseLimit, 6) : 6

const LEASE_SUMMARY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['runId', 'leasedTasks', 'granted', 'activeLeases', 'runStatus', 'failedCount', 'pendingCount'],
  properties: {
    runId: { type: 'string' },
    leasedTasks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['taskId', 'taskType', 'documentType', 'scope', 'scopeId', 'leaseToken', 'attemptNo', 'contextHandle'],
        properties: {
          taskId: { type: 'string' }, taskType: { type: 'string' }, documentType: { type: 'string' },
          scope: { type: 'string' }, scopeId: { type: 'string' }, leaseToken: { type: 'string' },
          attemptNo: { type: 'number' }, contextHandle: { type: 'string' },
        },
      },
    },
    granted: { type: 'number' },
    activeLeases: { type: 'number' },
    runStatus: { type: 'string' },
    failedCount: { type: 'number' },
    pendingCount: { type: 'number' },
  },
}

const WORKER_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['taskId', 'finalStatus'],
  properties: {
    taskId: { type: 'string' },
    finalStatus: { type: 'string' },
    submittedDocumentType: { type: 'string' },
    attemptsUsed: { type: 'number' },
    note: { type: 'string' },
  },
}

// Step 0 — resolve the run id. Reuse args.run, else start (resumes the newest
// resumable run automatically, or creates one).
phase('Plan')
let RUN = a.run
let startBlocker = null
if (!RUN) {
  const startAgent = await agent(
    [
      `Working dir is the repo root. Start (or resume) a Platty business-docs run and report its id.`,
      `Run: ${CLI} business-docs start --project ${PROJECT} --json`,
      `If it returns ok:false with blockers, report runId "" and put the blocker code in note. Otherwise return data.run.id as runId.`,
    ].join('\n'),
    { label: 'start-run', phase: 'Plan', model: 'haiku',
      schema: { type: 'object', additionalProperties: true, required: ['runId'], properties: { runId: { type: 'string' }, note: { type: 'string' } } } },
  )
  RUN = startAgent?.runId
  if (!RUN) {
    startBlocker = startAgent?.note || 'unknown blocker'
    log(`could not start a run: ${startBlocker}`)
  } else {
    log(`run: ${RUN}`)
  }
}

let round = 0
const allResults = []
let consecutiveEmpty = 0

while (RUN && round < 12) {
  round += 1
  phase('Plan')

  const leaseAgent = await agent(
    [
      `You coordinate a Platty business-docs run. Working dir is the repo root.`,
      `STEP 1 — Run: ${CLI} business-docs status --project ${PROJECT} --run "${RUN}" --json`,
      `Return data.tasks.counts.failed as failedCount, data.tasks.counts.pending as pendingCount, data.tasks.activeLeases as activeLeases, data.run.status as runStatus, and the run id "${RUN}" as runId.`,
      `STEP 2 — If runStatus is "failed" OR failedCount > 0, DO NOT lease. Return leasedTasks: [] and granted: 0.`,
      `Otherwise run: ${CLI} business-docs tasks lease --project ${PROJECT} --run "${RUN}" --worker wf-${round} --limit ${LEASE_LIMIT} --json`,
      `From data.tasks (may be empty) return each leased task's id, taskType, documentType, scope, scopeId, leaseToken, attemptNo, contextHandle. Return data.lease.granted as granted.`,
      `Do not generate documents. Only status + (conditionally) lease.`,
    ].join('\n'),
    { label: `lease:round-${round}`, phase: 'Plan', schema: LEASE_SUMMARY_SCHEMA, model: 'haiku' },
  )

  const leased = (leaseAgent?.leasedTasks ?? [])
  const failedCount = leaseAgent?.failedCount ?? 0
  log(`round ${round}: runStatus=${leaseAgent?.runStatus} failed=${failedCount} pending=${leaseAgent?.pendingCount} activeLeases=${leaseAgent?.activeLeases} leased=${leased.length}`)

  // Codex parity: stop the queue once a task has terminally failed and nothing is in flight.
  if (failedCount > 0 && (leaseAgent?.activeLeases ?? 0) === 0) {
    log(`round ${round}: failed task(s) and no active leases -> stopping (codex parity)`)
    break
  }

  if (leased.length === 0) {
    consecutiveEmpty += 1
    if ((leaseAgent?.activeLeases ?? 0) === 0) { log(`round ${round}: nothing leasable and no active leases -> stopping`); break }
    if (consecutiveEmpty >= 3) { log('too many empty rounds -> stopping'); break }
    continue
  }
  consecutiveEmpty = 0

  // Fan out one worker per leased task. The CLI's DAG/lease/idempotency/quality gates
  // make this safe to run fully in parallel.
  phase('Generate')
  const waveResults = await parallel(leased.map((task) => {
    const tmp = `/tmp/wf-${task.taskId.replace(/[^a-zA-Z0-9]/g, '_')}.json`
    return () => agent(
      [
        `You are a Platty business-docs worker. Working dir is the repo root. Generate ONE high-quality business document for a leased task and submit it. Output language is Korean (ko).`,
        ``,
        `Task: id=${task.taskId} taskType=${task.taskType} documentType=${task.documentType} scope=${task.scope} scopeId=${task.scopeId}`,
        `Lease: token=${task.leaseToken} attemptNo=${task.attemptNo} contextHandle=${task.contextHandle}`,
        ``,
        `STEP 1 — Read ALL context pages. First:`,
        `  ${CLI} business-docs context get --context "${task.contextHandle}" --lease-token "${task.leaseToken}" --json`,
        `Then read EACH page (target, schema, source_document_cards, source_graph_projection, and any relation_evidence / model_evidence / upstream_business_docs / existing_canonical) with:`,
        `  ${CLI} business-docs context page --context "${task.contextHandle}" --page <pageToken> --lease-token "${task.leaseToken}" --json`,
        `CRITICAL: the 'schema' page's expectedJson.expectedItemContent lists the EXACT fields each items[].content must contain for documentType ${task.documentType}. The 'source_document_cards' page lists sourceRef labels (e.g. source_document_1).`,
        ``,
        `STEP 2 — Build a JSON document object with EXACTLY these top-level fields:`,
        `  schemaVersion: "business-doc.v1", documentType: "${task.documentType}", scope: "${task.scope}", scopeId: "${task.scopeId}",`,
        `  title (Korean string), summary (Korean string), content (object), evidenceIds: [], items (array).`,
        ``,
        `ITEMS ARE MANDATORY AND MUST BE FULLY POPULATED. Every items[] entry MUST have:`,
        `  - itemType: a non-empty string (data_dictionary -> "entity", ucl -> "use_case", design -> "component", glossary -> "glossary_term", br -> "business_rule", ucs -> "use_case_spec")`,
        `  - stableKey: a non-empty unique slug string (e.g. "entity-order", "uc-create-order")`,
        `  - content: a non-empty JSON object containing the fields named in the schema page's expectedItemContent`,
        `  - evidenceIds: []`,
        `NEVER emit empty item objects like {}. Mirror the same concrete business entries in BOTH content's canonical arrays AND items[]. content.evidence_gaps must be human-readable Korean sentences (or []).`,
        `For use_case_list_refine, carry the upstream use cases from the upstream_business_docs page into BOTH content.use_cases AND items[] (never leave use_cases empty).`,
        `For data_dictionary: FIRST check the model_evidence page. If it is ABSENT or has no models (e.g. a frontend-only EPIC with only screen_spec sources), DO NOT invent entities from screens. Instead emit EXACTLY ONE gap item and one gap entity: items[0] = { itemType: "entity", stableKey: "dd-gap-<epic>", content: { gapType: "missing_model_evidence", message: "<Korean explanation>", source_mapping: [{ sourceRef: "source_document_1", role: "primary", reason: "..." }] } }, and content.entities = [ that same gap object ]. Only when real model_evidence exists, describe each model/table entity with fields[] that each carry source_mapping.`,
        `Use ONLY facts present in the context pages; do NOT read local files. Put each item's source linkage in content.source_mapping = [{ sourceRef, role, reason }] using the source_document_N labels.`,
        ``,
        `STEP 3 — Submit (write JSON to ${tmp} first to avoid shell escaping):`,
        `  ${CLI} business-docs tasks submit --project ${PROJECT} --task ${task.taskId} --lease-token "${task.leaseToken}" --attempt ${task.attemptNo} --document-json "$(cat ${tmp})" --json`,
        ``,
        `STEP 4 — Read the submit JSON response (data.task.status).`,
        `  - "saved" / "proposal_created": done. Return it as finalStatus.`,
        `  - "repair_requested": read the response's validation errors and data.nextRepairAttemptNo. FIX the JSON to resolve EVERY error, then re-submit ONCE with --attempt <nextRepairAttemptNo>. Read that status and return it. (maxRepairAttempts is 1; a second failure becomes "failed". Stay inside the 15-minute lease.)`,
        `  - "failed": return finalStatus "failed".`,
        `Return taskId, finalStatus, documentType as submittedDocumentType, attemptsUsed (1 or 2). If a command hard-errors, return finalStatus "error" with the error text in note.`,
      ].join('\n'),
      { label: `gen:${task.taskType}:${task.taskId.slice(-6)}`, phase: 'Generate', schema: WORKER_RESULT_SCHEMA, model: WORKER_MODEL },
    )
  }))

  for (const r of waveResults.filter(Boolean)) {
    allResults.push(r)
    log(`  ${r.taskId.slice(-8)} ${r.submittedDocumentType ?? ''} -> ${r.finalStatus} (attempts=${r.attemptsUsed ?? '?'})${r.note ? ' :: ' + r.note.slice(0, 90) : ''}`)
  }
}

let finalAgent = null
if (RUN) {
  phase('Plan')
  finalAgent = await agent(
    `Run: ${CLI} business-docs status --project ${PROJECT} --run "${RUN}" --json  and return parsed data.tasks.counts as counts and data.run.status as runStatus.`,
    { label: 'final-status', phase: 'Plan', model: 'haiku',
      schema: { type: 'object', additionalProperties: true, required: ['runStatus', 'counts'], properties: { runStatus: { type: 'string' }, counts: { type: 'object', additionalProperties: true } } } },
  )
}

return {
  runId: RUN ?? null,
  startBlocker,
  rounds: round,
  workerResults: allResults,
  finalRunStatus: finalAgent?.runStatus,
  finalCounts: finalAgent?.counts,
}
