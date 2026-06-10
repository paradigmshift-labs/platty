import path from 'node:path'
import type { DB } from '@/db/client.js'
import {
  getBusinessDocsContextBundle,
  getBusinessDocsContextPage,
  heartbeatBusinessDocsTask,
  leaseBusinessDocsTasks,
} from './lease.js'
import { getBusinessDocsStatus } from './lifecycle.js'
import { startBusinessDocsGeneration } from './start.js'
import { submitBusinessDocsTask } from './submit.js'
import type {
  BusinessDocsContextBundleResult,
  BusinessDocsContextPageResult,
  BusinessDocsLeasedTask,
  BusinessDocsTaskStatusCounts,
  BusinessDocsTaskType,
} from './types.js'
import { invokeCodexCliJson, safeName, type CodexCliEffort } from '@/pipeline_modules/cli_agent_runner/codex_cli.js'
import { outputLanguageInstruction, type OutputLanguage } from '@/pipeline_modules/shared/output_language.js'

export type BusinessDocsRunnerProvider = 'codex_cli' | 'claude_code'
export type BusinessDocsRunnerPreset = 'final-mixed' | 'balanced'
export type BusinessDocsRunnerEffort = CodexCliEffort

export interface BusinessDocsRunnerModel {
  provider: BusinessDocsRunnerProvider
  model: string
  effort?: BusinessDocsRunnerEffort
}

export type BusinessDocsRunnerModelPolicy = Record<BusinessDocsTaskType, BusinessDocsRunnerModel>

export interface BusinessDocsTaskInvokerInput {
  task: BusinessDocsLeasedTask
  contextBundle: BusinessDocsContextBundleResult
  contextPages: BusinessDocsContextPageResult[]
  model: BusinessDocsRunnerModel
  prompt: string
  schema: Record<string, unknown>
  workDir: string
  timeoutMs: number
}

export type BusinessDocsTaskInvoker = (input: BusinessDocsTaskInvokerInput) => Promise<unknown>

export interface RunBusinessDocsWorkerQueueInput {
  db: DB
  projectId: string
  runId?: string
  provider?: BusinessDocsRunnerProvider
  preset?: BusinessDocsRunnerPreset
  workers?: number
  newRun?: boolean
  forceRegenerate?: boolean
  outputLanguage?: 'ko' | 'en'
  workDir: string
  taskInvoker?: BusinessDocsTaskInvoker
}

const businessDocsTaskTypes: BusinessDocsTaskType[] = [
  'system_design',
  'data_dictionary',
  'business_rules',
  'use_case_list',
  'use_case_list_refine',
  'use_case_spec',
  'epic_glossary',
  'project_glossary',
]

export async function runBusinessDocsWorkerQueue(input: RunBusinessDocsWorkerQueueInput) {
  const provider = input.provider ?? 'codex_cli'
  const modelPolicy = resolveBusinessDocsRunnerModelPolicy({ provider, preset: input.preset })
  const maxWorkers = Math.max(1, Math.floor(input.workers ?? 20))
  const taskInvoker = input.taskInvoker ?? createBusinessDocsTaskInvoker(provider)
  const startedAt = Date.now()
  const runId = input.runId ?? startRun(input)
  const runDir = path.join(input.workDir, safeName(runId), 'tasks')
  const taskStats = {
    saved: 0,
    proposalCreated: 0,
    repairRequested: 0,
    failed: 0,
    codexErrors: 0,
    byType: {} as Record<string, { saved: number; proposalCreated: number; repairRequested: number; failed: number; codexErrors: number; totalMs: number }>,
  }

  let stopping = false
  let statusPollPromise: Promise<BusinessDocsStatusSnapshot> | null = null
  let leasePollPromise: Promise<BusinessDocsLeasedTask[]> | null = null

  const statusForRun = async () => {
    while (statusPollPromise) await statusPollPromise.catch(() => {})
    const current = Promise.resolve(readStatus(input.db, input.projectId, runId))
    statusPollPromise = current
    try {
      return await current
    } finally {
      if (statusPollPromise === current) statusPollPromise = null
    }
  }

  const leaseForWorker = async (workerId: string) => {
    while (leasePollPromise) await leasePollPromise.catch(() => {})
    const current = Promise.resolve(leaseOne(input.db, {
      projectId: input.projectId,
      runId,
      workerId,
    }))
    leasePollPromise = current
    try {
      return await current
    } finally {
      if (leasePollPromise === current) leasePollPromise = null
    }
  }

  const processTask = async (task: BusinessDocsLeasedTask) => {
    const taskStartedAt = Date.now()
    const contextBundle = readContextBundle(input.db, task)
    const contextPages = readContextPages(input.db, task)
    const taskType = task.taskType
    taskStats.byType[taskType] ??= { saved: 0, proposalCreated: 0, repairRequested: 0, failed: 0, codexErrors: 0, totalMs: 0 }

    let result: unknown
    const heartbeat = startHeartbeat(input.db, input.projectId, task)
    try {
      result = await taskInvoker({
        task,
        contextBundle,
        contextPages,
        model: modelPolicy[taskType],
        prompt: promptForTask(task, contextBundle, contextPages),
        schema: schemaForTask(task),
        workDir: runDir,
        timeoutMs: timeoutForTask(taskType),
      })
    } catch {
      taskStats.codexErrors += 1
      taskStats.byType[taskType]!.codexErrors += 1
      result = failedDocumentFor(task)
    } finally {
      heartbeat.stop()
    }

    const document = isRecord(result) ? result : failedDocumentFor(task)
    const submitted = submitBusinessDocsTask(input.db, {
      projectId: input.projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
    })
    if (!submitted.ok) throw new Error(`${submitted.code} for ${task.id}/${task.taskType}/attempt:${task.attemptNo}: ${submitted.message}`)

    const elapsedMs = Date.now() - taskStartedAt
    taskStats.byType[taskType]!.totalMs += elapsedMs
    if (submitted.data.task.status === 'saved') {
      taskStats.saved += 1
      taskStats.byType[taskType]!.saved += 1
    } else if (submitted.data.task.status === 'proposal_created') {
      taskStats.proposalCreated += 1
      taskStats.byType[taskType]!.proposalCreated += 1
    } else if (submitted.data.task.status === 'repair_requested') {
      taskStats.repairRequested += 1
      taskStats.byType[taskType]!.repairRequested += 1
    } else if (submitted.data.task.status === 'failed') {
      taskStats.failed += 1
      taskStats.byType[taskType]!.failed += 1
    }
  }

  const workerLoop = async (workerNumber: number) => {
    const workerId = `worker:business-docs:${safeName(runId)}:${workerNumber}`
    let idlePolls = 0
    while (!stopping) {
      const tasks = await leaseForWorker(workerId)
      const task = tasks[0]
      if (!task) {
        const status = await statusForRun()
        if (status.runStatus !== 'running' && status.runStatus !== 'repair_requested') {
          stopping = true
          return
        }
        const pending = Number(status.taskCountsByStatus.pending ?? 0)
          + Number(status.taskCountsByStatus.repair_requested ?? 0)
          + Number(status.taskCountsByStatus.expired ?? 0)
        const failed = Number(status.taskCountsByStatus.failed ?? 0)
        if (status.activeLeases > 0) {
          idlePolls = 0
          await sleep(250)
          continue
        }
        if (failed > 0 && status.activeLeases === 0) {
          stopping = true
          return
        }
        idlePolls += 1
        if (pending === 0 && status.activeLeases === 0 && idlePolls > 5) {
          stopping = true
          return
        }
        if (shouldThrowBusinessDocsNoProgress({
          idlePolls,
          pending,
          activeLeases: status.activeLeases,
          failed,
        })) {
          throw new Error(`business-docs run made no progress for run ${runId}`)
        }
        await sleep(50)
        continue
      }

      idlePolls = 0
      await processTask(task)
    }
  }

  await Promise.all(Array.from({ length: maxWorkers }, (_, index) => workerLoop(index + 1)))

  const status = await statusForRun()
  return {
    runId,
    elapsedMs: Date.now() - startedAt,
    runStatus: status.runStatus,
    taskCountsByStatus: status.taskCountsByStatus,
    documents: status.documents,
    contexts: status.contexts,
    nextAction: status.nextAction,
    taskStats,
    modelPolicy,
  }
}

export function shouldThrowBusinessDocsNoProgress(input: {
  idlePolls: number
  pending: number
  activeLeases: number
  failed?: number
}): boolean {
  return input.idlePolls > 100 &&
    input.pending > 0 &&
    input.activeLeases === 0 &&
    Number(input.failed ?? 0) === 0
}

function startRun(input: RunBusinessDocsWorkerQueueInput): string {
  const started = startBusinessDocsGeneration(input.db, {
    projectId: input.projectId,
    newRun: input.newRun,
    forceRegenerate: input.forceRegenerate,
    outputLanguage: input.outputLanguage,
  })
  if (!started.ok) throw new Error(`${started.code}: ${started.message}`)
  return started.data.run.id
}

export function resolveBusinessDocsRunnerModelPolicy(input: {
  provider: BusinessDocsRunnerProvider
  preset?: BusinessDocsRunnerPreset
}): BusinessDocsRunnerModelPolicy {
  const preset = input.preset ?? (input.provider === 'codex_cli' ? 'final-mixed' : 'balanced')
  if (input.provider === 'codex_cli' && (preset === 'final-mixed' || preset === 'balanced')) {
    return {
      system_design: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'medium' },
      data_dictionary: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'medium' },
      business_rules: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'medium' },
      use_case_list: { provider: 'codex_cli', model: 'gpt-5.4-mini', effort: 'low' },
      use_case_list_refine: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'medium' },
      use_case_spec: { provider: 'codex_cli', model: 'gpt-5.4-mini', effort: 'low' },
      epic_glossary: { provider: 'codex_cli', model: 'gpt-5.4-mini', effort: 'low' },
      project_glossary: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'medium' },
    }
  }
  if (input.provider === 'claude_code' && preset === 'balanced') {
    return Object.fromEntries(businessDocsTaskTypes.map((taskType) => [
      taskType,
      { provider: 'claude_code', model: 'claude-haiku-4-5', effort: 'low' },
    ])) as BusinessDocsRunnerModelPolicy
  }
  throw new Error(`Unsupported build_business_docs runner preset: ${input.provider}/${preset}`)
}

function createBusinessDocsTaskInvoker(provider: BusinessDocsRunnerProvider): BusinessDocsTaskInvoker {
  if (provider !== 'codex_cli') throw new Error('CLAUDE_CODE_HEADLESS_UNSUPPORTED')
  return async (input) => {
    if (input.model.provider !== 'codex_cli') throw new Error(`Unsupported Codex CLI model provider: ${input.model.provider}`)
    return await invokeCodexCliJson({
      model: { provider: 'codex_cli', model: input.model.model, effort: input.model.effort },
      prompt: input.prompt,
      schema: input.schema,
      workDir: input.workDir,
      baseName: `${input.task.taskType}-${input.task.id}`,
      timeoutMs: input.timeoutMs,
    })
  }
}

interface BusinessDocsStatusSnapshot {
  runStatus: string
  taskCountsByStatus: Partial<BusinessDocsTaskStatusCounts>
  activeLeases: number
  documents: { saved: number; proposals: number; failed: number }
  contexts: { bundles: number; pages: number; cleaned: boolean }
  nextAction: unknown
}

function readStatus(db: DB, projectId: string, runId: string): BusinessDocsStatusSnapshot {
  const status = getBusinessDocsStatus(db, { projectId, runId })
  if (!status.ok) throw new Error(`${status.code}: ${status.message}`)
  return {
    runStatus: status.data.run.status,
    taskCountsByStatus: status.data.tasks.counts,
    activeLeases: status.data.tasks.activeLeases,
    documents: status.data.documents,
    contexts: status.data.contexts,
    nextAction: status.data.nextAction,
  }
}

function leaseOne(db: DB, input: { projectId: string; runId: string; workerId: string }): BusinessDocsLeasedTask[] {
  const leased = leaseBusinessDocsTasks(db, {
    projectId: input.projectId,
    runId: input.runId,
    workerId: input.workerId,
    limit: 1,
  })
  if (!leased.ok) {
    if (leased.code === 'BUSINESS_DOCS_RUN_NOT_LEASEABLE') return []
    throw new Error(`${leased.code}: ${leased.message}`)
  }
  return leased.data.tasks
}

function startHeartbeat(db: DB, projectId: string, task: BusinessDocsLeasedTask): { stop: () => void } {
  const interval = setInterval(() => {
    heartbeatBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
    })
  }, 60_000)
  interval.unref()
  return {
    stop: () => clearInterval(interval),
  }
}

function readContextBundle(db: DB, task: BusinessDocsLeasedTask): BusinessDocsContextBundleResult {
  const bundle = getBusinessDocsContextBundle(db, {
    contextHandle: task.contextHandle,
    leaseToken: task.leaseToken,
  })
  if (!bundle.ok) throw new Error(`${bundle.code}: ${bundle.message}`)
  return bundle.data
}

function readContextPages(db: DB, task: BusinessDocsLeasedTask): BusinessDocsContextPageResult[] {
  return task.contextPageTokens.map((pageToken) => {
    const page = getBusinessDocsContextPage(db, {
      contextHandle: task.contextHandle,
      pageToken,
      leaseToken: task.leaseToken,
    })
    if (!page.ok) throw new Error(`${page.code}: ${page.message}`)
    return page.data
  })
}

export function buildBusinessDocsPromptForTask(
  task: BusinessDocsLeasedTask,
  contextBundle: BusinessDocsContextBundleResult,
  contextPages: BusinessDocsContextPageResult[],
): string {
  const contract = outputContractForTask(task)
  return [
    `Generate one Platty business document draft for ${task.taskType}.`,
    outputLanguageInstruction(outputLanguageForBusinessDocsContext(contextPages)),
    'Use only the provided JSON context. Do not inspect local files, databases, or other artifacts.',
    'Return exactly one JSON object matching the output schema.',
    'The JSON must use schemaVersion "business-doc.v1" and must preserve documentType, scope, and scopeId from the task.',
    'Set document evidenceIds and every items[].evidenceIds to []. Use source_mapping/sourceRef labels such as source_document_1 for traceability.',
    'Do not reconstruct, abbreviate, or alter evidence ids. Put uncertainty in content.evidence_gaps when evidence is incomplete.',
    'Every content.evidence_gaps entry must be a human-readable uncertainty sentence. Never put JSON fragments, field names, partial arrays, or schema snippets in evidence_gaps.',
    `Populate ${contract.contentFields.map((field) => `content.${field}`).join(', ')} for the canonical business document body.`,
    'Also populate items[] with searchable SOT items and source_mapping/sourceRef fields so each item links back to lower source documents.',
    'Do not use empty objects in canonical content arrays. Mirror the same concrete business entries in both content arrays and items[] when they represent the same concepts.',
    'For UCL tasks, cover every business-docs-source-coverage.v1 clusters[].clusterId in at least one items[].content.sourceClusterIds entry and the matching content.use_cases entry; merge related clusters only when the source-backed user goal is the same.',
    `Each items[].content must include: ${contract.itemContentHint}.`,
    'Avoid raw technical identifiers such as API paths, class names, DTO names, decorators, or SQL in narrative business fields and evidence_gaps.',
    'Do not return empty content. Do not put the canonical body only in items[].content.',
    '',
    'Context bundle JSON:',
    JSON.stringify(contextBundle, null, 2),
    '',
    'Context pages JSON:',
    JSON.stringify(contextPages, null, 2),
  ].join('\n')
}

function outputLanguageForBusinessDocsContext(contextPages: BusinessDocsContextPageResult[]): OutputLanguage {
  for (const page of contextPages) {
    const content = page.page.content
    if (isRecord(content) && content.outputLanguage === 'ko') return 'ko'
  }
  return 'en'
}

export function buildBusinessDocsSchemaForTask(task: BusinessDocsLeasedTask): Record<string, unknown> {
  const contract = outputContractForTask(task)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'documentType', 'scope', 'scopeId', 'title', 'summary', 'content', 'evidenceIds', 'items'],
    properties: {
      schemaVersion: { type: 'string', enum: ['business-doc.v1'] },
      documentType: { type: 'string', enum: [task.documentType] },
      scope: { type: 'string', enum: [task.scope] },
      scopeId: { type: 'string', enum: [task.scopeId] },
      title: { type: 'string' },
      summary: { type: 'string' },
      content: contentSchemaForContract(contract),
      evidenceIds: { type: 'array', maxItems: 0, items: { type: 'string' } },
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['itemType', 'stableKey', 'content'],
          properties: {
            itemType: { type: 'string' },
            stableKey: { type: 'string' },
            ordinal: { type: 'number' },
            title: { type: 'string' },
            summary: { type: 'string' },
            content: itemContentSchemaForTask(task),
            evidenceIds: { type: 'array', maxItems: 0, items: { type: 'string' } },
          },
        },
      },
    },
  }
}

function promptForTask(
  task: BusinessDocsLeasedTask,
  contextBundle: BusinessDocsContextBundleResult,
  contextPages: BusinessDocsContextPageResult[],
): string {
  return buildBusinessDocsPromptForTask(task, contextBundle, contextPages)
}

function schemaForTask(task: BusinessDocsLeasedTask): Record<string, unknown> {
  return buildBusinessDocsSchemaForTask(task)
}

function outputContractForTask(task: BusinessDocsLeasedTask): { contentFields: string[]; minItemsByField: Record<string, number>; itemContentHint: string } {
  if (task.documentType === 'br') {
    return {
      contentFields: ['evidence_gaps', 'rules'],
      minItemsByField: { rules: 1 },
      itemContentHint: 'earsPattern, condition, rule, outcome, ownership, source_mapping',
    }
  }
  if (task.documentType === 'ucl') {
    return {
      contentFields: ['evidence_gaps', 'use_cases'],
      minItemsByField: { use_cases: 1 },
      itemContentHint: 'sourceClusterIds, coverageRelation, ownedByEpic, primarySourceRefs, supportingSourceRefs, crossEpicSourceRefs',
    }
  }
  if (task.documentType === 'data_dictionary') {
    return {
      contentFields: ['evidence_gaps', 'entities'],
      minItemsByField: { entities: 0 },
      itemContentHint: 'entity with fields[].source_mapping, or gapType=missing_model_evidence with message and source_mapping',
    }
  }
  if (task.documentType === 'glossary') {
    return {
      contentFields: ['evidence_gaps', 'terms'],
      minItemsByField: { terms: 1 },
      itemContentHint: 'term, canonical_term, definition, termType, source_mapping, registry arrays, ambiguity',
    }
  }
  if (task.documentType === 'design') {
    return {
      contentFields: ['evidence_gaps', 'sequence_diagrams'],
      minItemsByField: { sequence_diagrams: 1 },
      itemContentHint: 'component, responsibility, flow, integration_points, source_mapping, relationConfidence',
    }
  }
  return {
    contentFields: ['evidence_gaps'],
    minItemsByField: {},
    itemContentHint: 'actor, trigger, preconditions, main_success_flow, alternatives, exceptions, business_rules, source_mapping',
  }
}

function contentSchemaForContract(contract: { contentFields: string[]; minItemsByField: Record<string, number> }): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    evidence_gaps: { type: 'array', items: { type: 'string' } },
  }
  for (const field of contract.contentFields) {
    if (field === 'evidence_gaps') continue
    properties[field] = {
      type: 'array',
      minItems: contract.minItemsByField[field] ?? 0,
      items: { type: 'object', additionalProperties: true },
    }
  }
  return {
    type: 'object',
    additionalProperties: true,
    required: contract.contentFields,
    properties,
  }
}

function itemContentSchemaForTask(task: BusinessDocsLeasedTask): Record<string, unknown> {
  if (task.documentType === 'br') {
    return objectSchema({
      earsPattern: { type: 'string', enum: ['ubiquitous', 'event_driven', 'state_driven', 'optional', 'unwanted'] },
      condition: { type: 'string' },
      rule: { type: 'string' },
      outcome: { type: 'string' },
      ownership: { type: 'string', enum: ['owned_by_epic', 'handoff', 'reference'] },
      source_mapping: sourceMappingSchema(),
    })
  }
  if (task.documentType === 'ucl') {
    return objectSchema({
      sourceClusterIds: stringArraySchema(1),
      coverageRelation: { type: 'string' },
      ownedByEpic: { type: 'boolean' },
      primarySourceRefs: stringArraySchema(1),
      supportingSourceRefs: stringArraySchema(),
      crossEpicSourceRefs: stringArraySchema(),
    })
  }
  if (task.documentType === 'data_dictionary') {
    return {
      anyOf: [
        objectSchema({
          entity: { type: 'string' },
          fields: {
            type: 'array',
            minItems: 1,
            items: objectSchema({
              name: { type: 'string' },
              meaning: { type: 'string' },
              source_mapping: stringArraySchema(1),
            }),
          },
        }),
        objectSchema({
          gapType: { type: 'string', enum: ['missing_model_evidence'] },
          message: { type: 'string' },
          source_mapping: sourceMappingSchema(),
        }),
      ],
    }
  }
  if (task.documentType === 'design') {
    return objectSchema({
      component: { type: 'string' },
      responsibility: { type: 'string' },
      flow: { type: 'array', items: { type: 'string' } },
      integration_points: { type: 'array', items: { type: 'string' } },
      source_mapping: sourceMappingSchema(),
      relationConfidence: { type: 'string', enum: ['direct_call_proven', 'relation_inferred', 'topical_cluster', 'cross_epic'] },
    })
  }
  if (task.documentType === 'glossary') {
    return objectSchema({
      term: { type: 'string' },
      canonical_term: { type: 'string' },
      definition: { type: 'string' },
      termType: { type: 'string', enum: ['domain', 'role', 'process', 'status', 'forbidden', 'ambiguous'] },
      source_mapping: sourceMappingSchema(),
      aliases: stringArraySchema(),
      synonyms: stringArraySchema(),
      candidate_aliases: stringArraySchema(),
      antonyms: stringArraySchema(),
      contrast_terms: stringArraySchema(),
      related_terms: stringArraySchema(),
      signals: stringArraySchema(),
      ambiguity: objectSchema({
        status: { type: 'string', enum: ['none', 'ambiguous', 'user_resolved'] },
        candidates: {
          type: 'array',
          items: objectSchema({
            meaning: { type: 'string' },
            epic_ids: stringArraySchema(),
            source_doc_ids: stringArraySchema(),
          }),
        },
      }),
    })
  }
  return objectSchema({
    actor: { type: 'string' },
    trigger: { type: 'string' },
    preconditions: { type: 'array', items: { type: 'string' } },
    main_success_flow: { type: 'array', minItems: 1, items: { type: 'string' } },
    alternatives: { type: 'array', items: { type: 'string' } },
    exceptions: { type: 'array', items: { type: 'string' } },
    business_rules: { type: 'array', minItems: 1, items: { type: 'string' } },
    source_mapping: sourceMappingSchema(),
  })
}

function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: true,
    required: Object.keys(properties),
    properties,
  }
}

function stringArraySchema(minItems = 0): Record<string, unknown> {
  return {
    type: 'array',
    minItems,
    items: { type: 'string' },
  }
}

function sourceMappingSchema(): Record<string, unknown> {
  return {
    type: 'array',
    minItems: 1,
    items: objectSchema({
      sourceRef: { type: 'string' },
      role: { type: 'string' },
      reason: { type: 'string' },
    }),
  }
}

function failedDocumentFor(task: BusinessDocsLeasedTask): Record<string, unknown> {
  return {
    schemaVersion: 'business-doc.v1',
    documentType: task.documentType,
    scope: task.scope,
    scopeId: task.scopeId,
    title: '',
    summary: '',
    content: {},
    evidenceIds: [],
  }
}

function timeoutForTask(taskType: BusinessDocsTaskType): number {
  if (taskType === 'system_design' || taskType === 'data_dictionary' || taskType === 'business_rules') return 6 * 60_000
  if (taskType === 'project_glossary') return 6 * 60_000
  return 3 * 60_000
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
