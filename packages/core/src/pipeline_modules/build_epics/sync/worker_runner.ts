import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { outputLanguageInstruction, type OutputLanguage } from '@/pipeline_modules/shared/output_language.js'
import type { BuildEpicsSyncRuntime } from './runtime.js'

export type BuildEpicsSyncRunnerProvider = 'codex_cli' | 'claude_code'
export type BuildEpicsSyncRunnerEffort = 'low' | 'medium' | 'high'
export type BuildEpicsSyncTaskType = 'epic_sync_assignment' | 'epic_sync_restructure' | 'epic_sync_cross_links'

export interface BuildEpicsSyncRunnerModel {
  provider: BuildEpicsSyncRunnerProvider
  model: string
  effort?: BuildEpicsSyncRunnerEffort
}

export interface BuildEpicsSyncTaskInvokerInput {
  taskId: string
  targetKey: string
  content: Record<string, any>
  model: BuildEpicsSyncRunnerModel
  prompt: string
  schema: Record<string, unknown>
  workDir: string
  timeoutMs: number
}

export type BuildEpicsSyncTaskInvoker = (input: BuildEpicsSyncTaskInvokerInput) => Promise<unknown>

export interface RunBuildEpicsSyncWorkerQueueInput {
  runtime: BuildEpicsSyncRuntime
  projectId: string
  docSyncPlanId: string
  runId?: string
  provider?: BuildEpicsSyncRunnerProvider
  workers?: number
  requestedBy?: string
  workDir: string
  taskInvoker?: BuildEpicsSyncTaskInvoker
}

export interface BuildEpicsSyncAgentWorkPacket {
  type: 'task'
  task: {
    taskId: string
    leaseToken: string
    taskType: BuildEpicsSyncTaskType
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

export function buildBuildEpicsSyncAgentWorkPacket(input: {
  task: { taskId: string; taskType: string; targetKey?: string; leaseToken: string; leaseExpiresAt?: string }
  context: Record<string, unknown>
}): BuildEpicsSyncAgentWorkPacket {
  const context = contextPayload(input.context)
  const taskType = syncTaskType(input.task.taskType || String(context.taskType ?? ''))
  return {
    type: 'task',
    task: {
      taskId: input.task.taskId,
      leaseToken: input.task.leaseToken,
      taskType,
      targetKey: input.task.targetKey ?? 'sync:assignment:1',
      ...(input.task.leaseExpiresAt ? { leaseExpiresAt: input.task.leaseExpiresAt } : {}),
    },
    agentInput: {
      modelHint: { provider: 'claude_code', model: 'haiku', effort: 'low' },
      prompt: promptForTaskContext(taskType, context),
      outputSchema: outputSchemaForTask(taskType, context),
      context,
      rules: rulesForTask(taskType),
      forbiddenFields: forbiddenFieldsForTask(taskType),
    },
    submit: {
      command: [
        'platty',
        'epics',
        'sync',
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

export async function runBuildEpicsSyncWorkerQueue(input: RunBuildEpicsSyncWorkerQueueInput) {
  const provider = input.provider ?? 'codex_cli'
  const maxWorkers = Math.max(1, Math.floor(input.workers ?? 20))
  const model = modelForProvider(provider)
  const taskInvoker = input.taskInvoker ?? createBuildEpicsSyncTaskInvoker(provider)
  const startedAt = Date.now()
  const resumed = input.runId
    ? null
    : await input.runtime.resumeLatestInterruptedRun({ projectId: input.projectId, docSyncPlanId: input.docSyncPlanId })
  const start = input.runId
    ? { runId: input.runId, status: 'running' as const }
    : resumed ?? await input.runtime.start({
      projectId: input.projectId,
      docSyncPlanId: input.docSyncPlanId,
      requestedBy: input.requestedBy ?? 'user',
      policy: { maxWorkerCount: maxWorkers },
    })
  const runDir = path.join(input.workDir, safeName(start.runId))
  await mkdir(path.join(runDir, 'tasks'), { recursive: true })

  const taskStats = { completed: 0, repairRequested: 0, failed: 0, invocationErrors: 0 }
  let stopping = start.status !== 'running'
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

  const processTask = async (workerId: string, task: { taskId: string; targetKey: string; leaseToken: string; taskType?: string }) => {
    const context = await input.runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
    const content = context.content as Record<string, any>
    const taskType = syncTaskType(task.taskType || String(content.taskType ?? ''))
    let result: unknown
    try {
      result = await taskInvoker({
        taskId: task.taskId,
        targetKey: task.targetKey,
        content,
        model,
        prompt: promptForTaskContext(taskType, content),
        schema: outputSchemaForTask(taskType, content),
        workDir: path.join(runDir, 'tasks'),
        timeoutMs: 3 * 60_000,
      })
    } catch {
      taskStats.invocationErrors += 1
      const failed = await input.runtime.failTask({
        taskId: task.taskId,
        leaseToken: task.leaseToken,
        reason: 'build_epics sync worker invocation failed',
      })
      if (failed.status === 'failed') taskStats.failed += 1
      return
    }

    const submit = await input.runtime.submitTask({ taskId: task.taskId, leaseToken: task.leaseToken, result })
    if (submit.status === 'completed') taskStats.completed += 1
    else if (submit.status === 'repair_requested') taskStats.repairRequested += 1
    else if (submit.status === 'failed') taskStats.failed += 1
  }

  const workerLoop = async (workerNumber: number) => {
    const workerId = `worker:epics-sync:${safeName(start.runId)}:${workerNumber}`
    while (!stopping) {
      const lease = await leaseForWorker(workerId)
      const task = lease.leasedTasks[0]
      if (!task) {
        const status = await statusForRun()
        if (status.runStatus !== 'running') {
          stopping = true
          return
        }
        await sleep(1_000)
        continue
      }
      await processTask(workerId, task)
    }
  }

  await Promise.all(Array.from({ length: maxWorkers }, (_, index) => workerLoop(index + 1)))
  const status = await statusForRun()
  const draft = await input.runtime.showDraft({ runId: start.runId })
  return {
    runId: start.runId,
    elapsedMs: Date.now() - startedAt,
    runStatus: status.runStatus,
    draftStatus: status.draftStatus,
    taskCountsByStatus: status.taskCountsByStatus,
    taskStats,
    draft: summarizeDraft(draft?.plan),
    model,
  }
}

export function assignmentOutputSchema(content?: Record<string, any>) {
  const impactedCards = Array.isArray(content?.impactedCards) ? content.impactedCards : []
  const existingEpicKeys = stableKeys(content?.existingEpics)
  const itemSchema = impactedCards.length > 0
    ? {
        anyOf: impactedCards.map((card: any) => assignmentItemSchema({
          documentIds: [String(card.documentId)],
          documentTypes: [String(card.type)],
          roles: rolesForDocumentType(String(card.type)),
          existingEpicKeys,
        })),
      }
    : assignmentItemSchema({
        documentIds: null,
        documentTypes: ['api_spec', 'screen_spec', 'event_spec', 'schedule_spec'],
        roles: ['owner', 'primary', 'supporting', 'event_owner', 'job_owner'],
        existingEpicKeys,
      })
  return {
    type: 'object',
    additionalProperties: false,
    required: ['assignments'],
    properties: {
      assignments: {
        type: 'array',
        items: itemSchema,
      },
    },
  }
}

export function crossOutputSchema(content?: Record<string, any>) {
  const affectedCards = Array.isArray(content?.affectedCards) ? content.affectedCards : Array.isArray(content?.impactedCards) ? content.impactedCards : []
  const sourceDocumentIds = affectedCards.map((card: any) => String(card.documentId)).filter(Boolean)
  const targetEpicKeys = stableKeys(content?.existingEpics)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['links'],
    properties: {
      links: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sourceDocumentId', 'targetEpicStableKey', 'kind', 'role', 'confidence', 'reason'],
          properties: {
            sourceDocumentId: sourceDocumentIds.length > 0 ? { enum: sourceDocumentIds } : { type: 'string' },
            targetEpicStableKey: targetEpicKeys.length > 0 ? { enum: targetEpicKeys } : { type: 'string' },
            kind: {
              enum: [
                'cross_domain_policy',
                'reward_or_coupon_effect',
                'state_change',
                'event_flow',
                'shared_user_journey',
                'operational_dependency',
              ],
            },
            role: { enum: ['impact', 'supporting', 'reference'] },
            confidence: { enum: ['high', 'medium', 'low'] },
            reason: { type: 'string' },
          },
        },
      },
    },
  }
}

function assignmentItemSchema(input: {
  documentIds: string[] | null
  documentTypes: string[]
  roles: string[]
  existingEpicKeys: string[]
}) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['documentId', 'documentType', 'action', 'epicStableKey', 'role', 'confidence', 'reason', 'newEpic'],
    properties: {
      documentId: input.documentIds && input.documentIds.length > 0 ? { enum: input.documentIds } : { type: 'string' },
      documentType: { enum: input.documentTypes },
      action: { enum: ['assign_existing', 'create_epic', 'keep_unassigned'] },
      epicStableKey: input.existingEpicKeys.length > 0
        ? { anyOf: [{ enum: input.existingEpicKeys }, { type: 'null' }] }
        : { type: ['string', 'null'] },
      role: { enum: input.roles },
      confidence: { enum: ['high', 'medium', 'low'] },
      reason: { type: 'string' },
      newEpic: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['stableKey', 'name', 'abbr', 'summary'],
            properties: {
              stableKey: { type: 'string' },
              name: { type: 'string' },
              abbr: { type: 'string' },
              summary: { type: 'string' },
            },
          },
          { type: 'null' },
        ],
      },
    },
  }
}

function rolesForDocumentType(documentType: string): string[] {
  if (documentType === 'api_spec') return ['owner']
  if (documentType === 'screen_spec') return ['owner', 'primary', 'supporting']
  if (documentType === 'event_spec') return ['owner', 'event_owner']
  if (documentType === 'schedule_spec') return ['owner', 'job_owner']
  return ['owner', 'primary', 'supporting', 'event_owner', 'job_owner']
}

function stableKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asRecord(item).stableKey)
    .filter((stableKey): stableKey is string => typeof stableKey === 'string' && stableKey.length > 0)
}

function modelForProvider(provider: BuildEpicsSyncRunnerProvider): BuildEpicsSyncRunnerModel {
  if (provider === 'claude_code') return { provider, model: 'claude-haiku-4-5', effort: 'low' }
  return { provider, model: 'gpt-5.4-mini', effort: 'low' }
}

function createBuildEpicsSyncTaskInvoker(provider: BuildEpicsSyncRunnerProvider): BuildEpicsSyncTaskInvoker {
  if (provider !== 'codex_cli') throw new Error('CLAUDE_CODE_HEADLESS_UNSUPPORTED')
  return async (input) => {
    await mkdir(input.workDir, { recursive: true })
    const base = safeName(`${input.targetKey}-${input.taskId}`)
    const schemaPath = path.join(input.workDir, `${base}.schema.json`)
    const resultPath = path.join(input.workDir, `${base}.result.json`)
    const logPath = path.join(input.workDir, `${base}.log`)
    await writeJson(schemaPath, input.schema)
    const output = await runCodexCli({ ...input, schemaPath, resultPath, logPath })
    await writeJson(resultPath, output)
    return output
  }
}

function promptForTaskContext(taskType: BuildEpicsSyncTaskType, content: Record<string, any>): string {
  if (taskType === 'epic_sync_cross_links') return promptForCrossContext(content)
  if (taskType === 'epic_sync_restructure') return promptForRestructureContext(content)
  return promptForAssignmentContext(content)
}

function outputSchemaForTask(taskType: BuildEpicsSyncTaskType, content?: Record<string, any>) {
  if (taskType === 'epic_sync_cross_links') return crossOutputSchema(content)
  if (taskType === 'epic_sync_restructure') return restructureOutputSchema(content)
  return assignmentOutputSchema(content)
}

function rulesForTask(taskType: BuildEpicsSyncTaskType): string[] {
  if (taskType === 'epic_sync_restructure') {
    return [
      'Use only the provided context. Do not inspect files or call tools.',
      'Do not auto-confirm the final EPIC plan; return only reviewable restructure actions.',
      'Use split_epic, merge_epics, move_document, or no_change only when the supplied reasons and cards support it.',
      'Do not invent document ids, EPIC stable keys, dependencies, or code behavior.',
    ]
  }
  if (taskType === 'epic_sync_cross_links') {
    return [
      'Use only the provided context. Do not inspect files or call tools.',
      'Only return cross-EPIC links whose sourceDocumentId is one of the affected cards.',
      'Return an empty links array when no cross-EPIC relationship is supported by the context.',
      'Do not invent document ids, EPIC stable keys, dependencies, or code behavior.',
    ]
  }
  return [
    'Use only the provided context. Do not inspect files or call tools.',
    'Every impacted card must either be assigned to an existing EPIC, assigned to a newly proposed EPIC, or marked keep_unassigned.',
    'Do not invent document ids. Do not claim code behavior that is not present in the impacted card summary.',
  ]
}

function forbiddenFieldsForTask(taskType: BuildEpicsSyncTaskType): string[] {
  if (taskType === 'epic_sync_restructure') return ['domains', 'epics', 'assignments', 'links', 'dependencies']
  return taskType === 'epic_sync_cross_links'
    ? ['domains', 'epics', 'assignments', 'dependencies']
    : ['domains', 'epics', 'links', 'dependencies']
}

export function restructureOutputSchema(content?: Record<string, any>) {
  const impactedCards = Array.isArray(content?.impactedCards) ? content.impactedCards : []
  const existingEpics = Array.isArray(content?.existingEpics) ? content.existingEpics : []
  const documentIds = uniqueStrings([
    ...impactedCards.map((card: any) => String(card.documentId)).filter(Boolean),
    ...existingEpics.flatMap((epic: any) => [
      ...(Array.isArray(epic.apiDocIds) ? epic.apiDocIds : []),
      ...(Array.isArray(epic.screenDocIds) ? epic.screenDocIds : []),
      ...(Array.isArray(epic.eventDocIds) ? epic.eventDocIds : []),
      ...(Array.isArray(epic.scheduleDocIds) ? epic.scheduleDocIds : []),
    ].map((documentId) => String(documentId)).filter(Boolean)),
  ])
  const documentTypes = Array.from(new Set(impactedCards.map((card: any) => String(card.type)).filter(Boolean)))
  const epicKeys = stableKeys(content?.existingEpics)
  const newEpicSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['stableKey', 'name', 'abbr', 'summary'],
    properties: {
      stableKey: { type: 'string' },
      name: { type: 'string' },
      abbr: { type: 'string' },
      summary: { type: 'string' },
    },
  }
  const moveSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['documentId', 'documentType', 'fromEpicStableKey', 'toEpicStableKey', 'role', 'reason'],
    properties: {
      documentId: documentIds.length > 0 ? { enum: documentIds } : { type: 'string' },
      documentType: documentTypes.length > 0 ? { enum: documentTypes } : { enum: ['api_spec', 'screen_spec', 'event_spec', 'schedule_spec'] },
      fromEpicStableKey: epicKeys.length > 0 ? { anyOf: [{ enum: epicKeys }, { type: 'null' }] } : { type: ['string', 'null'] },
      toEpicStableKey: { type: 'string' },
      role: { enum: ['owner', 'primary', 'supporting', 'event_owner', 'job_owner'] },
      reason: { type: 'string' },
    },
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['actions'],
    properties: {
      actions: {
        type: 'array',
        items: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'reason'],
              properties: {
                type: { enum: ['no_change'] },
                reason: { type: 'string' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'sourceEpicStableKey', 'newEpics', 'moves', 'reason'],
              properties: {
                type: { enum: ['split_epic'] },
                sourceEpicStableKey: epicKeys.length > 0 ? { enum: epicKeys } : { type: 'string' },
                newEpics: { type: 'array', items: newEpicSchema },
                moves: { type: 'array', items: moveSchema },
                reason: { type: 'string' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'sourceEpicStableKeys', 'targetEpic', 'moves', 'reason'],
              properties: {
                type: { enum: ['merge_epics'] },
                sourceEpicStableKeys: { type: 'array', items: epicKeys.length > 0 ? { enum: epicKeys } : { type: 'string' } },
                targetEpic: newEpicSchema,
                moves: { type: 'array', items: moveSchema },
                reason: { type: 'string' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['type', ...moveSchema.required],
              properties: {
                type: { enum: ['move_document'] },
                ...moveSchema.properties,
              },
            },
          ],
        },
      },
    },
  }
}

async function runCodexCli(input: BuildEpicsSyncTaskInvokerInput & { schemaPath: string; resultPath: string; logPath: string }) {
  const args = [
    'exec',
    '-m', input.model.model,
    '-c', `model_reasoning_effort=${input.model.effort ?? 'low'}`,
    '--skip-git-repo-check',
    '--ephemeral',
    '-C', input.workDir,
    '--output-schema', input.schemaPath,
    '-o', input.resultPath,
  ]
  const result = await spawnCapture('codex', args, { input: input.prompt, timeoutMs: input.timeoutMs })
  await writeFile(input.logPath, result.stdout + result.stderr, 'utf8')
  if (result.code !== 0) throw new Error(`codex exited ${result.code}: ${(result.stderr || result.stdout).slice(-500)}`)
  return JSON.parse(await readFile(input.resultPath, 'utf8')) as unknown
}

function promptForAssignmentContext(content: Record<string, any>): string {
  return [
    'You are updating Platty build_epics assignments from an incremental docs sync.',
    outputLanguageInstruction(outputLanguageForContent(content)),
    'Use only the provided JSON context. Do not call tools or inspect files.',
    'For each impactedCards item, choose one action:',
    '- assign_existing when an existing EPIC clearly owns the document.',
    '- create_epic when no existing EPIC fits and the document represents a durable business capability.',
    '- keep_unassigned when the evidence is insufficient.',
    'Never invent document ids or code behavior. Reasons must be concrete and grounded in the card summary and existing EPIC summaries.',
    '\nContext JSON:',
    JSON.stringify(compactAssignmentContext(content), null, 2),
  ].join('\n')
}

function promptForCrossContext(content: Record<string, any>): string {
  return [
    'You are updating Platty build_epics cross-EPIC links after an incremental docs sync.',
    outputLanguageInstruction(outputLanguageForContent(content)),
    'Use only the provided JSON context. Do not call tools or inspect files.',
    'For each affectedCards item, decide whether it has a supported cross-EPIC relationship to an existing EPIC.',
    'Only emit links when the affected document summary or relation hints show a concrete relationship to another EPIC.',
    'Do not emit self-links. Do not emit dependencies; the runtime derives dependencies from links.',
    'Return an empty links array when there is no supported cross-EPIC link.',
    'Never invent document ids, EPIC stable keys, or code behavior. Reasons must be concrete and grounded in the card summary, relation hints, and existing EPIC summaries.',
    '\nContext JSON:',
    JSON.stringify(compactCrossContext(content), null, 2),
  ].join('\n')
}

function promptForRestructureContext(content: Record<string, any>): string {
  return [
    'You are reviewing whether incremental build_epics assignments need a split, merge, or document move.',
    outputLanguageInstruction(outputLanguageForContent(content)),
    'Use only the provided JSON context. Do not call tools or inspect files.',
    'Return no_change when the supplied reasons do not prove a split, merge, or move is needed.',
    'Do not auto-confirm the EPIC plan. The runtime will keep your result as a reviewable draft.',
    'Never invent document ids, EPIC stable keys, or code behavior. Reasons must be concrete and grounded in the restructure reasons, cards, and existing EPIC summaries.',
    '\nContext JSON:',
    JSON.stringify(compactRestructureContext(content), null, 2),
  ].join('\n')
}

function outputLanguageForContent(content: Record<string, any>): OutputLanguage {
  return content.outputLanguage === 'ko' ? 'ko' : 'en'
}

function compactAssignmentContext(content: Record<string, any>) {
  return {
    taskType: content.taskType,
    impactedCards: (content.impactedCards ?? []).map((card: any) => ({
      documentId: card.documentId,
      type: card.type,
      title: truncate(card.title, 200),
      summary: truncate(card.summary, 500),
      method: card.method,
      path: card.path,
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
    })),
    existingEpics: (content.existingEpics ?? []).map((epic: any) => ({
      stableKey: epic.stableKey,
      name: truncate(epic.name, 120),
      abbr: truncate(epic.abbr, 20),
      summary: truncate(epic.summary, 400),
      apiDocIds: takeStrings(epic.apiDocIds, 20, 120),
      screenDocIds: takeStrings(epic.screenDocIds, 20, 120),
      eventDocIds: takeStrings(epic.eventDocIds, 20, 120),
      scheduleDocIds: takeStrings(epic.scheduleDocIds, 20, 120),
    })),
    repair: content.repair,
  }
}

function compactCrossContext(content: Record<string, any>) {
  const affectedCards = content.affectedCards ?? content.impactedCards ?? []
  return {
    taskType: content.taskType,
    affectedCards: affectedCards.map((card: any) => ({
      documentId: card.documentId,
      type: card.type,
      title: truncate(card.title, 200),
      summary: truncate(card.summary, 500),
      method: card.method,
      path: card.path,
      routePath: card.routePath,
      eventKey: card.eventKey,
      jobName: card.jobName,
      relationHints: (card.relationHints ?? []).slice(0, 16).map((hint: any) => ({
        kind: hint.kind,
        target: truncate(hint.target, 120),
        operation: truncate(hint.operation, 80),
      })),
    })),
    existingEpics: (content.existingEpics ?? []).map((epic: any) => ({
      stableKey: epic.stableKey,
      name: truncate(epic.name, 120),
      abbr: truncate(epic.abbr, 20),
      summary: truncate(epic.summary, 400),
      apiDocIds: takeStrings(epic.apiDocIds, 20, 120),
      screenDocIds: takeStrings(epic.screenDocIds, 20, 120),
      eventDocIds: takeStrings(epic.eventDocIds, 20, 120),
      scheduleDocIds: takeStrings(epic.scheduleDocIds, 20, 120),
      crossLinks: Array.isArray(epic.crossLinks) ? epic.crossLinks.slice(0, 20) : [],
    })),
    repair: content.repair,
  }
}

function compactRestructureContext(content: Record<string, any>) {
  const impactedCards = content.impactedCards ?? content.affectedCards ?? []
  return {
    taskType: content.taskType,
    restructureReasons: content.restructureReasons ?? [],
    topologyLinks: Array.isArray(content.topologyLinks)
      ? content.topologyLinks.slice(0, 60).map((link: any) => ({
          sourceDocumentId: link.sourceDocumentId,
          targetDocumentId: link.targetDocumentId,
          kind: link.kind,
          clusterHints: takeStrings(link.clusterHints, 8, 80),
        }))
      : [],
    impactedCards: impactedCards.map((card: any) => ({
      documentId: card.documentId,
      type: card.type,
      title: truncate(card.title, 200),
      summary: truncate(card.summary, 500),
      method: card.method,
      path: card.path,
      routePath: card.routePath,
      domainHints: takeStrings(card.domainHints, 12, 80),
      relationHints: (card.relationHints ?? []).slice(0, 16).map((hint: any) => ({
        kind: hint.kind,
        target: truncate(hint.target, 120),
        operation: truncate(hint.operation, 80),
      })),
    })),
    existingEpics: (content.existingEpics ?? []).map((epic: any) => ({
      stableKey: epic.stableKey,
      name: truncate(epic.name, 120),
      abbr: truncate(epic.abbr, 20),
      summary: truncate(epic.summary, 400),
      apiDocIds: takeStrings(epic.apiDocIds, 30, 120),
      screenDocIds: takeStrings(epic.screenDocIds, 30, 120),
      eventDocIds: takeStrings(epic.eventDocIds, 20, 120),
      scheduleDocIds: takeStrings(epic.scheduleDocIds, 20, 120),
    })),
    repair: content.repair,
  }
}

function syncTaskType(taskType: string): BuildEpicsSyncTaskType {
  if (taskType === 'epic_sync_cross_links') return 'epic_sync_cross_links'
  if (taskType === 'epic_sync_restructure') return 'epic_sync_restructure'
  return 'epic_sync_assignment'
}

function contextPayload(context: Record<string, unknown>): Record<string, unknown> {
  const nestedContent = asRecord(context.content)
  return Object.keys(nestedContent).length > 0 ? nestedContent : context
}

function summarizeDraft(plan: unknown) {
  const value = asRecord(plan)
  const epics = Array.isArray(value.epics) ? value.epics : []
  return {
    epicCount: epics.length,
    syncMetadata: value.syncMetadata,
  }
}

function spawnCapture(command: string, args: string[], options: { input: string; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 2_000).unref()
      reject(new Error(`${command} timed out after ${options.timeoutMs}ms`))
    }, options.timeoutMs)
    timer.unref()
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    proc.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    proc.stdin.end(options.input)
  })
}

function asRecord(value: unknown): Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...(value as Record<string, any>) } : {}
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, '_')
}

function truncate(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value)
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

function takeStrings(values: unknown, limit: number, maxLength: number): string[] {
  return Array.isArray(values) ? values.slice(0, limit).map((value) => truncate(value, maxLength) ?? '') : []
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
