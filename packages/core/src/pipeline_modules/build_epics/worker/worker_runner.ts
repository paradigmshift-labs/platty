import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { invokeCodexCliJson, safeName } from '@/pipeline_modules/cli_agent_runner/codex_cli.js'
import type { BuildEpicsCliRuntime } from '../runtime/runtime.js'
import type { BuildEpicsRuntimePolicyInput, BuildEpicsRuntimeTaskType } from '../runtime/types.js'

export type BuildEpicsRunnerProvider = 'codex_cli' | 'claude_code'
export type BuildEpicsRunnerPreset = 'final-mixed' | 'balanced'
export type BuildEpicsRunnerEffort = 'low' | 'medium' | 'high'

export interface BuildEpicsRunnerModel {
  provider: BuildEpicsRunnerProvider
  model: string
  effort?: BuildEpicsRunnerEffort
}

export type BuildEpicsRunnerModelPolicy = Record<BuildEpicsRuntimeTaskType, BuildEpicsRunnerModel>

export interface BuildEpicsTaskInvokerInput {
  taskId: string
  targetKey: string
  content: Record<string, any>
  model: BuildEpicsRunnerModel
  prompt: string
  schema: Record<string, unknown>
  workDir: string
  timeoutMs: number
}

export type BuildEpicsTaskInvoker = (input: BuildEpicsTaskInvokerInput) => Promise<unknown>

export interface RunBuildEpicsWorkerQueueInput {
  runtime: BuildEpicsCliRuntime
  projectId: string
  runId?: string
  policy?: BuildEpicsRuntimePolicyInput
  provider?: BuildEpicsRunnerProvider
  preset?: BuildEpicsRunnerPreset
  workers?: number
  requestedBy?: string
  workDir: string
  taskInvoker?: BuildEpicsTaskInvoker
}

export interface NormalizationStats {
  apiRoleFixed: number
  duplicateApiOwnerRemoved: number
  selfCrossLinkRemoved: number
  duplicateCrossLinkRemoved: number
}

export interface BuildEpicsAgentWorkPacket {
  type: 'task'
  task: {
    taskId: string
    leaseToken: string
    taskType: BuildEpicsRuntimeTaskType
    targetKey: string
    leaseExpiresAt?: string
  }
  agentInput: {
    modelHint: { provider: 'claude_code'; model: 'haiku'; effort: 'low' }
    prompt: string
    outputSchema: Record<string, unknown>
    context: Record<string, unknown>
    rules: string[]
    forbiddenFields: string[]
  }
  submit: {
    command: string[]
  }
}

export function buildBuildEpicsAgentWorkPacket(input: {
  task: { taskId: string; taskType: string; targetKey: string; leaseToken: string; leaseExpiresAt?: string }
  context: Record<string, unknown>
}): BuildEpicsAgentWorkPacket {
  const content = asRecord(input.context.content)
  const taskType = content.taskType as BuildEpicsRuntimeTaskType
  return {
    type: 'task',
    task: {
      taskId: input.task.taskId,
      leaseToken: input.task.leaseToken,
      taskType,
      targetKey: input.task.targetKey,
      ...(input.task.leaseExpiresAt ? { leaseExpiresAt: input.task.leaseExpiresAt } : {}),
    },
    agentInput: {
      modelHint: { provider: 'claude_code', model: 'haiku', effort: 'low' },
      prompt: promptForContext(content),
      outputSchema: schemaForContext(content),
      context: input.context,
      rules: rulesForTaskType(taskType),
      forbiddenFields: forbiddenFieldsForTaskType(taskType),
    },
    submit: {
      command: [
        'platty',
        'epics',
        'tasks',
        'submit',
        '--task-id',
        input.task.taskId,
        '--lease-token',
        input.task.leaseToken,
        '--input',
        'result.json',
        '--json',
      ],
    },
  }
}

export async function runBuildEpicsWorkerQueue(input: RunBuildEpicsWorkerQueueInput) {
  const provider = input.provider ?? 'codex_cli'
  const modelPolicy = resolveBuildEpicsRunnerModelPolicy({ provider, preset: input.preset })
  const maxWorkers = Math.max(1, Math.floor(input.workers ?? 20))
  const taskInvoker = input.taskInvoker ?? createBuildEpicsTaskInvoker(provider)
  const startedAt = Date.now()
  const resumed = input.runId
    ? null
    : await input.runtime.resumeLatestInterruptedRun({ projectId: input.projectId })
  const start = input.runId
    ? { runId: input.runId, status: 'running' as const, policy: input.policy ?? {} }
    : resumed ?? await startRun(input, maxWorkers)
  const runDir = path.join(input.workDir, safeName(start.runId))
  await mkdir(path.join(runDir, 'tasks'), { recursive: true })

  const taskStats = {
    completed: 0,
    repairRequested: 0,
    failed: 0,
    codexErrors: 0,
    byType: {} as Record<string, { completed: number; repairRequested: number; failed: number; codexErrors: number; totalMs: number }>,
  }
  const normalizationStats: NormalizationStats = {
    apiRoleFixed: 0,
    duplicateApiOwnerRemoved: 0,
    selfCrossLinkRemoved: 0,
    duplicateCrossLinkRemoved: 0,
  }

  let stopping = false
  let statusPollPromise: Promise<any> | null = null
  let leasePollPromise: Promise<any> | null = null

  const statusForRun = async () => {
    while (statusPollPromise) await statusPollPromise.catch(() => {})
    const current = input.runtime.status({ runId: start.runId })
    statusPollPromise = current
    try {
      return await current
    } finally {
      if (statusPollPromise === current) statusPollPromise = null
    }
  }

  const leaseForWorker = async (workerId: string) => {
    while (leasePollPromise) await leasePollPromise.catch(() => {})
    const current = input.runtime.leaseTasks({ runId: start.runId, limit: 1, workerId })
    leasePollPromise = current
    try {
      return await current
    } finally {
      if (leasePollPromise === current) leasePollPromise = null
    }
  }

  const processTask = async (workerId: string, task: { taskId: string; targetKey: string; leaseToken: string }) => {
    const taskStartedAt = Date.now()
    const context = await input.runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
    const content = context.content as Record<string, any>
    const taskType = content.taskType as BuildEpicsRuntimeTaskType
    taskStats.byType[taskType] ??= { completed: 0, repairRequested: 0, failed: 0, codexErrors: 0, totalMs: 0 }

    let result: unknown
    try {
      result = await taskInvoker({
        taskId: task.taskId,
        targetKey: task.targetKey,
        content,
        model: modelPolicy[taskType],
        prompt: promptForContext(content),
        schema: schemaForContext(content),
        workDir: path.join(runDir, 'tasks'),
        timeoutMs: timeoutForTask(taskType),
      })
    } catch {
      taskStats.codexErrors += 1
      taskStats.byType[taskType]!.codexErrors += 1
      result = failedInvocationResultFor(taskType)
    }

    const normalized = normalizeBuildEpicsRunnerResult(result, content)
    addNormalizationStats(normalizationStats, normalized.stats)
    const submit = await input.runtime.submitTask({
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      result: normalized.result,
    })

    const elapsedMs = Date.now() - taskStartedAt
    taskStats.byType[taskType]!.totalMs += elapsedMs
    if (submit.status === 'completed') {
      taskStats.completed += 1
      taskStats.byType[taskType]!.completed += 1
    } else if (submit.status === 'repair_requested') {
      taskStats.repairRequested += 1
      taskStats.byType[taskType]!.repairRequested += 1
    } else if (submit.status === 'failed') {
      taskStats.failed += 1
      taskStats.byType[taskType]!.failed += 1
    }
  }

  const workerLoop = async (workerNumber: number) => {
    const workerId = `worker:epics:${safeName(start.runId)}:${workerNumber}`
    let idlePolls = 0
    while (!stopping) {
      const lease = await leaseForWorker(workerId)
      const task = lease.leasedTasks[0]
      if (!task) {
        const status = await statusForRun()
        if (status.runStatus !== 'running') {
          stopping = true
          return
        }
        const counts = status.taskCountsByStatus ?? {}
        const pending = Number(counts.pending ?? 0) + Number(counts.repair_requested ?? 0) + Number(counts.expired ?? 0)
        const leased = Number(counts.leased ?? 0)
        idlePolls += 1
        if (pending === 0 && leased === 0 && idlePolls > 5) await sleep(2_000)
        else await sleep(1_000)
        continue
      }

      idlePolls = 0
      await processTask(workerId, task)
    }
  }

  await Promise.all(Array.from({ length: maxWorkers }, (_, index) => workerLoop(index + 1)))

  const status = await statusForRun()
  const draft = await input.runtime.showDraft({ runId: start.runId })
  const validation = await input.runtime.validate({ runId: start.runId })
  const validationResult = asRecord(validation)
  const plan = asRecord(draft?.plan)
  const domains = Array.isArray(plan.domains) ? plan.domains : []
  const epics = Array.isArray(plan.epics) ? plan.epics : []
  const reviewBuckets = asRecord(plan.reviewBuckets)

  return {
    runId: start.runId,
    elapsedMs: Date.now() - startedAt,
    runStatus: status.runStatus,
    draftStatus: status.draftStatus,
    taskCountsByStatus: status.taskCountsByStatus,
    taskStats,
    validation: {
      fatal: Array.isArray(validationResult.fatal) ? validationResult.fatal.length : 0,
      warnings: Array.isArray(validationResult.warnings) ? validationResult.warnings.length : 0,
    },
    draft: {
      domainCount: domains.length,
      epicCount: epics.length,
      linkCounts: epics.reduce((counts: Record<string, number>, epic: any) => {
        counts.api += epic.apiLinks?.length ?? 0
        counts.screen += epic.screenLinks?.length ?? 0
        counts.event += epic.eventLinks?.length ?? 0
        counts.schedule += epic.scheduleLinks?.length ?? 0
        counts.cross += epic.crossLinks?.length ?? 0
        counts.dependencies += epic.dependencies?.length ?? 0
        return counts
      }, { api: 0, screen: 0, event: 0, schedule: 0, cross: 0, dependencies: 0 }),
      unassignedApiDocs: reviewBuckets.unassigned_api?.length ?? 0,
      unassignedScreenDocs: reviewBuckets.unassigned_screen?.length ?? 0,
      unassignedEventDocs: reviewBuckets.unassigned_event?.length ?? 0,
      unassignedScheduleDocs: reviewBuckets.unassigned_schedule?.length ?? 0,
    },
    modelPolicy,
    normalizationStats,
  }
}

async function startRun(input: RunBuildEpicsWorkerQueueInput, maxWorkers: number) {
  const preview = await input.runtime.preview({ projectId: input.projectId, policy: input.policy })
  const policy = {
    ...preview.recommendedPolicy,
    ...input.policy,
    maxWorkerCount: maxWorkers,
    taskMultiplier: input.policy?.taskMultiplier ?? 1,
    maxCrossLinksPerDocument: input.policy?.maxCrossLinksPerDocument ?? 8,
    outputLanguage: input.policy?.outputLanguage ?? 'ko',
  }
  return await input.runtime.start({
    projectId: input.projectId,
    policy,
    requestedBy: input.requestedBy ?? 'user',
  })
}

export function resolveBuildEpicsRunnerModelPolicy(input: {
  provider: BuildEpicsRunnerProvider
  preset?: BuildEpicsRunnerPreset
}): BuildEpicsRunnerModelPolicy {
  const preset = input.preset ?? (input.provider === 'codex_cli' ? 'final-mixed' : 'balanced')
  if (input.provider === 'codex_cli' && preset === 'final-mixed') {
    return {
      taxonomy_candidate: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'low' },
      taxonomy_consolidation: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'medium' },
      document_assignment: { provider: 'codex_cli', model: 'gpt-5.4-mini', effort: 'low' },
      cross_domain_link: { provider: 'codex_cli', model: 'gpt-5.4-mini', effort: 'low' },
    }
  }
  if (input.provider === 'claude_code' && preset === 'balanced') {
    return {
      taxonomy_candidate: { provider: 'claude_code', model: 'claude-sonnet-4-6' },
      taxonomy_consolidation: { provider: 'claude_code', model: 'claude-sonnet-4-6' },
      document_assignment: { provider: 'claude_code', model: 'claude-haiku-4-5' },
      cross_domain_link: { provider: 'claude_code', model: 'claude-haiku-4-5' },
    }
  }
  throw new Error(`Unsupported build_epics runner preset: ${input.provider}/${preset}`)
}

export function normalizeBuildEpicsRunnerResult(result: unknown, content: Record<string, any>): { result: any; stats: NormalizationStats } {
  const stats: NormalizationStats = {
    apiRoleFixed: 0,
    duplicateApiOwnerRemoved: 0,
    selfCrossLinkRemoved: 0,
    duplicateCrossLinkRemoved: 0,
  }

  if (content.taskType === 'document_assignment') return normalizeAssignmentResult(result, content, stats)
  if (content.taskType === 'cross_domain_link') return normalizeCrossDomainResult(result, content, stats)
  return { result, stats }
}

function normalizeAssignmentResult(result: unknown, content: Record<string, any>, stats: NormalizationStats) {
  const value = asRecord(result)
  const cardsById = new Map((content.cards ?? []).map((card: any) => [card.documentId, card]))
  const seenApiOwners = new Set<string>()
  const normalizedAssignments = []

  for (const assignment of Array.isArray(value.assignments) ? value.assignments : []) {
    const nextAssignment = asRecord(assignment)
    const documentId = typeof nextAssignment.documentId === 'string' ? nextAssignment.documentId : ''
    const card = cardsById.get(documentId) as any
    if (card?.type !== 'api_spec') {
      normalizedAssignments.push(assignment)
      continue
    }
    if (seenApiOwners.has(documentId)) {
      stats.duplicateApiOwnerRemoved += 1
      continue
    }
    if (nextAssignment.role !== 'owner') {
      nextAssignment.role = 'owner'
      stats.apiRoleFixed += 1
    }
    seenApiOwners.add(documentId)
    normalizedAssignments.push(nextAssignment)
  }

  return { result: { ...value, assignments: normalizedAssignments }, stats }
}

function normalizeCrossDomainResult(result: unknown, content: Record<string, any>, stats: NormalizationStats) {
  const value = asRecord(result)
  const ownerByDocumentId = new Map(Object.entries(content.owners ?? {}))
  const seen = new Set<string>()
  const normalizedLinks = []

  for (const link of Array.isArray(value.links) ? value.links : []) {
    const nextLink = asRecord(link)
    const sourceDocumentId = String(nextLink.sourceDocumentId ?? '')
    const targetTempEpicId = String(nextLink.targetTempEpicId ?? '')
    if (ownerByDocumentId.get(sourceDocumentId) === targetTempEpicId) {
      stats.selfCrossLinkRemoved += 1
      continue
    }
    const key = `${sourceDocumentId}:${targetTempEpicId}:${nextLink.kind}:${nextLink.role}`
    if (seen.has(key)) {
      stats.duplicateCrossLinkRemoved += 1
      continue
    }
    seen.add(key)
    normalizedLinks.push(nextLink)
  }

  return { result: { ...value, links: normalizedLinks }, stats }
}

function createBuildEpicsTaskInvoker(provider: BuildEpicsRunnerProvider): BuildEpicsTaskInvoker {
  if (provider !== 'codex_cli') {
    throw new Error('CLAUDE_CODE_HEADLESS_UNSUPPORTED')
  }
  return async (input) => {
    if (input.model.provider !== 'codex_cli') throw new Error(`Unsupported Codex CLI model provider: ${input.model.provider}`)
    return await invokeCodexCliJson({
      model: { provider: 'codex_cli', model: input.model.model, effort: input.model.effort },
      prompt: input.prompt,
      schema: input.schema,
      workDir: input.workDir,
      baseName: `${input.targetKey}-${input.taskId}`,
      timeoutMs: input.timeoutMs,
    })
  }
}

function schemaForContext(content: Record<string, any>): Record<string, unknown> {
  const taskType = content.taskType
  if (taskType === 'taxonomy_candidate') {
    return objectSchema(['domains', 'epics'], {
      domains: arrayOf(objectSchema(['domainId', 'stableKey', 'name', 'summary'], {
        domainId: { type: 'string' },
        stableKey: { type: 'string' },
        name: { type: 'string' },
        summary: { type: 'string' },
      })),
      epics: arrayOf(taxonomyEpicSchema()),
    })
  }
  if (taskType === 'taxonomy_consolidation') {
    return objectSchema(['domains', 'epics', 'aliases', 'boundaryNotes'], {
      domains: arrayOf(objectSchema(['domainId', 'stableKey', 'name', 'summary', 'epicIds'], {
        domainId: { type: 'string' },
        stableKey: { type: 'string' },
        name: { type: 'string' },
        summary: { type: 'string' },
        epicIds: arrayOf({ type: 'string' }),
      })),
      epics: arrayOf(taxonomyEpicSchema()),
      aliases: arrayOf(objectSchema(['fromStableKey', 'toStableKey', 'reason'], {
        fromStableKey: { type: 'string' },
        toStableKey: { type: 'string' },
        reason: { type: 'string' },
      })),
      boundaryNotes: arrayOf(objectSchema(['stableKey', 'includes', 'excludes'], {
        stableKey: { type: 'string' },
        includes: arrayOf({ type: 'string' }),
        excludes: arrayOf({ type: 'string' }),
      })),
    })
  }
  if (taskType === 'document_assignment') {
    return objectSchema(['assignments'], {
      assignments: arrayOf(objectSchema(['documentId', 'epicKey', 'role', 'confidence', 'reason'], {
        documentId: { type: 'string', enum: unique((content.cards ?? []).map((card: any) => card.documentId)) },
        epicKey: { type: 'string', enum: unique((content.epics ?? []).map((epic: any) => epic.stableKey)) },
        role: { type: 'string', enum: ['owner', 'primary', 'supporting', 'review'] },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        reason: { type: 'string' },
      })),
    })
  }
  if (taskType === 'cross_domain_link') {
    return objectSchema(['links'], {
      links: arrayOf(objectSchema(['sourceDocumentId', 'targetTempEpicId', 'kind', 'role', 'confidence', 'reason'], {
        sourceDocumentId: { type: 'string', enum: unique((content.cards ?? []).map((card: any) => card.documentId)) },
        targetTempEpicId: { type: 'string', enum: unique((content.epics ?? []).map((epic: any) => epic.tempEpicId)) },
        kind: {
          type: 'string',
          enum: ['cross_domain_policy', 'reward_or_coupon_effect', 'state_change', 'event_flow', 'shared_user_journey', 'operational_dependency'],
        },
        role: { type: 'string', enum: ['impact', 'supporting', 'reference'] },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        reason: { type: 'string' },
      })),
    })
  }
  return objectSchema([], {})
}

function rulesForTaskType(taskType: BuildEpicsRuntimeTaskType): string[] {
  if (taskType === 'taxonomy_candidate') return ['Return domains and epics only.', 'Do not assign documents.']
  if (taskType === 'taxonomy_consolidation') return ['Return final domains, epics, aliases, and boundaryNotes only.', 'Do not assign documents.']
  if (taskType === 'document_assignment') return ['Return assignments only.', 'API cards must have exactly one owner assignment.']
  return ['Return links only.', 'Do not create EPICs or move ownership.', 'Do not link a document to its owner EPIC.']
}

function forbiddenFieldsForTaskType(taskType: BuildEpicsRuntimeTaskType): string[] {
  if (taskType === 'taxonomy_candidate') return ['assignments', 'links', 'aliases', 'boundaryNotes']
  if (taskType === 'taxonomy_consolidation') return ['assignments', 'links']
  if (taskType === 'document_assignment') return ['domains', 'epics', 'aliases', 'boundaryNotes', 'links']
  return ['domains', 'epics', 'aliases', 'boundaryNotes', 'assignments']
}

function promptForContext(content: Record<string, any>): string {
  const repair = compactRepairForPrompt(content)
  const repairBlock = repair?.validationErrors?.length
    ? `\n\nRepair these validation errors first:\n${JSON.stringify(repair.validationErrors, null, 2)}`
    : ''
  const contextJson = JSON.stringify(compactContentForPrompt(content), null, 2)
  if (content.taskType === 'taxonomy_candidate') {
    return [
      'You are generating Platty build_epics taxonomy candidates.',
      'Use only the provided JSON context. Do not call tools or inspect files.',
      'Return Korean business-facing names and summaries. Keep stableKey as concise lower_snake_case.',
      'Group cards into MECE business EPIC candidates. Do not assign documents.',
      'Prefer durable product/business capabilities over technical folders or HTTP path shapes.',
      'Create domainId/tempEpicId values that are stable and readable, such as domain:commerce and epic:orders.',
      repairBlock,
      '\nContext JSON:',
      contextJson,
    ].join('\n')
  }
  if (content.taskType === 'taxonomy_consolidation') {
    return [
      'You are consolidating Platty build_epics taxonomy candidates into one final MECE taxonomy.',
      'Use only the provided JSON context. Do not call tools or inspect files.',
      'Return Korean business-facing names and summaries. Keep stableKey as concise lower_snake_case.',
      'Target 1-12 domains and 1-60 EPICs. Merge duplicates and near-duplicates across chunks.',
      'aliases must map removed or renamed candidate stableKeys to the final stableKey. boundaryNotes should clarify important include/exclude boundaries.',
      'Do not assign documents here.',
      repairBlock,
      '\nContext JSON:',
      contextJson,
    ].join('\n')
  }
  if (content.taskType === 'document_assignment') {
    return [
      'You are assigning Platty technical documents to existing EPIC stableKeys.',
      'Use only the provided JSON context. Do not call tools or inspect files.',
      'Return one assignment for every card when possible. Never create EPICs. Do not include an epics field.',
      'API cards must use role "owner" exactly once. Screen cards usually use "primary" for the owning EPIC or "supporting" for secondary context.',
      'Event cards use "owner" for the EPIC that owns the business event, or "supporting" if it is only a cross-EPIC signal.',
      'Schedule cards use "owner" for the job-owning EPIC, or "supporting" if it only supports another flow.',
      'Use "review" only when no provided EPIC is defensible. Keep review assignments rare.',
      'Reasons must be concrete and short, based on title, summary, access, actor/domain hints, and relation hints.',
      repairBlock,
      '\nContext JSON:',
      contextJson,
    ].join('\n')
  }
  if (content.taskType === 'cross_domain_link') {
    return [
      'You are adding cross-EPIC links for Platty build_epics.',
      'Use only the provided JSON context. Do not call tools or inspect files.',
      'Only return links where a source document has a meaningful business side effect or dependency on a non-owner EPIC.',
      'Do not link a document to its owner EPIC from owners. Do not add weak path/name-only references.',
      'A document may link to up to 8 non-owner EPICs when side effects are real, such as points, coupons, notifications, orders, payment, admin review, moderation, state change, or shared user journeys.',
      'Use kind reward_or_coupon_effect for points/coupons/benefits; event_flow for publish/listen flows; shared_user_journey for screen/user journey overlap; state_change for cross-domain state changes; operational_dependency for operational or external dependencies.',
      'Return an empty links array when no meaningful cross-EPIC link exists.',
      repairBlock,
      '\nContext JSON:',
      contextJson,
    ].join('\n')
  }
  return `Return an empty JSON object.\n${contextJson}`
}

function compactContentForPrompt(content: Record<string, any>) {
  if (content.taskType === 'taxonomy_consolidation') {
    return {
      taskType: content.taskType,
      instruction: content.instruction,
      taxonomyCandidates: (content.taxonomyCandidates ?? []).map((candidate: any) => ({
        domains: (candidate.domains ?? []).map(compactDomain),
        epics: (candidate.epics ?? []).map(compactEpicSeed),
      })),
      repair: compactRepairForPrompt(content),
    }
  }
  if (content.taskType === 'cross_domain_link') {
    const cardIds = new Set((content.cards ?? []).map((card: any) => card.documentId))
    return {
      taskType: content.taskType,
      cards: (content.cards ?? []).map(compactCard),
      epics: (content.epics ?? []).map(compactEpicSeed),
      owners: Object.fromEntries(Object.entries(content.owners ?? {}).filter(([documentId]) => cardIds.has(documentId))),
      repair: compactRepairForPrompt(content),
    }
  }
  return {
    ...content,
    cards: (content.cards ?? []).map(compactCard),
    epics: (content.epics ?? []).map(compactEpicSeed),
    repair: compactRepairForPrompt(content),
  }
}

function compactRepairForPrompt(content: Record<string, any>) {
  const repair = content.repair
  if (!repair) return undefined
  const validationErrors = (repair.validationErrors ?? [])
    .filter((error: any) => content.taskType !== 'cross_domain_link' || error.code !== 'MISSING_EXPECTED_CROSS_LINK')
    .slice(0, 40)
    .map((error: any) => ({
      severity: error.severity,
      code: error.code,
      message: truncate(error.message, 300),
      documentId: error.documentId,
      tempEpicId: error.tempEpicId,
    }))
  return { ...repair, validationErrors }
}

function compactCard(card: any) {
  return {
    documentId: card.documentId,
    type: card.type,
    title: truncate(card.title, 200),
    summary: truncate(card.summary, 500),
    method: card.method,
    path: card.path,
    access: card.access,
    routePath: card.routePath,
    eventKey: card.eventKey,
    jobName: card.jobName,
    actorHints: takeStrings(card.actorHints, 12, 80),
    domainHints: takeStrings(card.domainHints, 12, 80),
    relationHints: (card.relationHints ?? []).slice(0, 12).map((hint: any) => ({
      kind: hint.kind,
      target: truncate(hint.target, 120),
      operation: truncate(hint.operation, 80),
    })),
  }
}

function compactDomain(domain: any) {
  return {
    domainId: domain.domainId,
    stableKey: domain.stableKey,
    name: truncate(domain.name, 120),
    summary: truncate(domain.summary, 300),
    epicIds: domain.epicIds,
  }
}

function compactEpicSeed(epic: any) {
  return {
    tempEpicId: epic.tempEpicId,
    domainId: epic.domainId,
    stableKey: epic.stableKey,
    name: truncate(epic.name, 120),
    abbr: truncate(epic.abbr, 20),
    summary: truncate(epic.summary, 400),
  }
}

function failedInvocationResultFor(taskType: BuildEpicsRuntimeTaskType) {
  if (taskType === 'taxonomy_candidate' || taskType === 'taxonomy_consolidation') return {}
  if (taskType === 'document_assignment') return { assignments: null }
  if (taskType === 'cross_domain_link') return { links: null }
  return {}
}

function taxonomyEpicSchema() {
  return objectSchema(['tempEpicId', 'domainId', 'stableKey', 'name', 'abbr', 'summary'], {
    tempEpicId: { type: 'string' },
    domainId: { type: 'string' },
    stableKey: { type: 'string' },
    name: { type: 'string' },
    abbr: { type: 'string' },
    summary: { type: 'string' },
  })
}

function objectSchema(required: string[], properties: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, required, properties }
}

function arrayOf(items: unknown) {
  return { type: 'array', items }
}

function timeoutForTask(taskType: BuildEpicsRuntimeTaskType): number {
  if (taskType === 'taxonomy_candidate') return 8 * 60_000
  if (taskType === 'taxonomy_consolidation') return 8 * 60_000
  if (taskType === 'document_assignment') return 3 * 60_000
  if (taskType === 'cross_domain_link') return 3 * 60_000
  return 3 * 60_000
}

function addNormalizationStats(target: NormalizationStats, source: NormalizationStats): void {
  target.apiRoleFixed += source.apiRoleFixed
  target.duplicateApiOwnerRemoved += source.duplicateApiOwnerRemoved
  target.selfCrossLinkRemoved += source.selfCrossLinkRemoved
  target.duplicateCrossLinkRemoved += source.duplicateCrossLinkRemoved
}

function asRecord(value: unknown): Record<string, any> {
  return typeof value === 'object' && value !== null ? { ...(value as Record<string, any>) } : {}
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function truncate(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value)
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

function takeStrings(values: unknown, limit: number, maxLength: number): string[] {
  return Array.isArray(values) ? values.slice(0, limit).map((value) => truncate(value, maxLength) ?? '') : []
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
