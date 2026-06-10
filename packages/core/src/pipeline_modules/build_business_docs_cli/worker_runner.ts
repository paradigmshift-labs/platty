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
    let submitted: ReturnType<typeof submitBusinessDocsTask>
    try {
      submitted = submitBusinessDocsTask(input.db, {
        projectId: input.projectId,
        taskId: task.id,
        leaseToken: task.leaseToken,
        attemptNo: task.attemptNo,
        document,
      })
    } catch {
      taskStats.codexErrors += 1
      taskStats.byType[taskType]!.codexErrors += 1
      submitted = submitBusinessDocsTask(input.db, {
        projectId: input.projectId,
        taskId: task.id,
        leaseToken: task.leaseToken,
        attemptNo: task.attemptNo,
        document: failedDocumentFor(task),
      })
    }
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
    try {
      heartbeatBusinessDocsTask(db, {
        projectId,
        taskId: task.id,
        leaseToken: task.leaseToken,
      })
    } catch {
      clearInterval(interval)
    }
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
  const promptContextPages = contextPagesForPrompt(task, contextPages)
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
    ...(task.documentType === 'data_dictionary'
      ? [
        'For data_dictionary tasks, use model_evidence when present and preserve exact backend storage identity in content.entities[] and items[].content.',
        'Do not translate model/table/column identifiers. User-facing entity and field names may be natural language, but storage.model_id, storage.model_name, storage.table_name, fields[].model_id, and fields[].column_name must keep exact source identifiers.',
        'When a logical entity has backend model evidence, set storage.kind="model" and fill storage.model_id, storage.model_name, and storage.table_name from model_evidence.',
        'When no backend model evidence exists, keep the logical DD entity and set storage.kind to dto_only, external, derived, or unknown instead of inventing a table.',
      ]
      : []),
    `Each items[].content must include: ${contract.itemContentHint}.`,
    'Avoid raw technical identifiers such as API paths, class names, DTO names, decorators, SQL, class/usecase/service/repository names, or DTO identifiers in narrative business fields, glossary terms, glossary signals, and evidence_gaps.',
    'Do not return empty content. Do not put the canonical body only in items[].content.',
    '',
    'Context bundle JSON:',
    JSON.stringify(contextBundle, null, 2),
    '',
    'Context pages JSON:',
    JSON.stringify(promptContextPages, null, 2),
  ].join('\n')
}

function contextPagesForPrompt(
  task: BusinessDocsLeasedTask,
  contextPages: BusinessDocsContextPageResult[],
): BusinessDocsContextPageResult[] {
  if (task.taskType !== 'project_glossary') return contextPages
  const allowedPageTokens = new Set([
    'target',
    'schema',
    'upstream_business_docs',
    'validation_errors',
    'existing_canonical',
  ])
  return contextPages
    .filter((page) => allowedPageTokens.has(page.page.pageToken))
    .map((page) => ({
      ...page,
      page: {
        ...page.page,
        content: page.page.pageToken === 'upstream_business_docs'
          ? compactProjectGlossaryUpstreamContent(page.page.content) as Record<string, unknown>
          : page.page.content,
      },
    }))
}

function compactProjectGlossaryUpstreamContent(content: unknown): unknown {
  if (!isRecord(content)) return content
  const dependencies = Array.isArray(content.dependencies) ? content.dependencies : []
  const compactDependencies = dependencies.map(compactProjectGlossaryDependency)
  return {
    ...compactRecordShallow(content, ['dependencies']),
    dependencies: compactDependencies,
    termRelationshipHints: buildProjectGlossaryTermRelationshipHints(compactDependencies),
    omittedForPrompt: {
      reason: 'project_glossary receives upstream epic glossary term registries only; raw source cards, source graph, relation evidence, and full document prose are intentionally excluded',
      dependencyCount: dependencies.length,
      includedInputs: ['epic glossary terms', 'epic scope ids', 'saved document ids', 'term source_mapping refs', 'term relationship hints'],
      excludedInputs: ['source_document_cards', 'source_graph_projection', 'relation_evidence', 'model_evidence', 'full upstream document prose'],
    },
  }
}

function compactProjectGlossaryDependency(value: unknown): unknown {
  if (!isRecord(value)) return compactJsonValue(value, { maxStringLength: 300, maxArrayItems: 20, maxDepth: 3 })
  const document = isRecord(value.document) ? value.document : null
  return {
    taskId: value.taskId,
    taskType: value.taskType,
    documentType: value.documentType,
    status: value.status,
    savedDocumentId: value.savedDocumentId,
    summary: truncateText(value.summary, 500),
    document: document ? compactBusinessDocumentForProjectGlossary(document) : null,
  }
}

function compactBusinessDocumentForProjectGlossary(document: Record<string, unknown>): Record<string, unknown> {
  const content = isRecord(document.content) ? document.content : {}
  const terms = Array.isArray(content.terms) ? content.terms : []
  const items = Array.isArray(document.items) ? document.items : []
  return {
    schemaVersion: document.schemaVersion,
    documentType: document.documentType,
    scope: document.scope,
    scopeId: document.scopeId,
    title: truncateText(document.title, 200),
    summary: truncateText(document.summary, 800),
    content: {
      evidence_gaps: compactStringArray(content.evidence_gaps, 5, 300),
      terms: terms.map(compactGlossaryTerm),
    },
    omittedForPrompt: {
      originalTermCount: terms.length,
      originalItemCount: items.length,
      omittedFields: ['items searchable copy', 'full document prose beyond glossary term registry fields'],
    },
  }
}

function compactGlossaryTerm(value: unknown): unknown {
  if (!isRecord(value)) return compactJsonValue(value, { maxStringLength: 300, maxArrayItems: 10, maxDepth: 3 })
  return {
    term: truncateText(value.term, 120),
    canonical_term: truncateText(value.canonical_term, 120),
    definition: truncateText(value.definition, 600),
    termType: value.termType,
    source_mapping: compactSourceMapping(value.source_mapping),
    aliases: compactStringArray(value.aliases, 8, 120),
    synonyms: compactStringArray(value.synonyms, 8, 120),
    candidate_aliases: compactStringArray(value.candidate_aliases, 8, 120),
    antonyms: compactStringArray(value.antonyms, 8, 120),
    contrast_terms: compactStringArray(value.contrast_terms, 8, 120),
    related_terms: compactStringArray(value.related_terms, 12, 120),
    signals: compactStringArray(value.signals, 12, 120),
    ambiguity: compactJsonValue(value.ambiguity, { maxStringLength: 160, maxArrayItems: 8, maxDepth: 3 }),
  }
}

function compactSourceMapping(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 5).map((item) => {
    if (!isRecord(item)) return compactJsonValue(item, { maxStringLength: 160, maxArrayItems: 5, maxDepth: 2 })
    return {
      sourceRef: truncateText(item.sourceRef, 120),
      role: truncateText(item.role, 80),
      reason: truncateText(item.reason, 260),
    }
  })
}

function buildProjectGlossaryTermRelationshipHints(dependencies: unknown[]): Record<string, unknown> {
  const byCanonical = new Map<string, ProjectGlossaryTermHintBucket>()
  const aliasToCanonical = new Map<string, Set<string>>()
  for (const dependency of dependencies) {
    if (!isRecord(dependency) || !isRecord(dependency.document)) continue
    const document = dependency.document
    const scopeId = typeof document.scopeId === 'string' ? document.scopeId : null
    const savedDocumentId = typeof dependency.savedDocumentId === 'string' ? dependency.savedDocumentId : null
    const terms = readCompactGlossaryTerms(document)
    for (const term of terms) {
      const canonical = stringValue(term.canonical_term) || stringValue(term.term)
      if (!canonical) continue
      const canonicalKey = normalizeTermKey(canonical)
      if (!canonicalKey) continue
      const bucket = byCanonical.get(canonicalKey) ?? {
        canonicalTerm: canonical,
        sourceScopeIds: new Set<string>(),
        savedDocumentIds: new Set<string>(),
        sourceRefs: new Set<string>(),
        aliases: new Set<string>(),
        relatedTerms: new Set<string>(),
        termTypes: new Set<string>(),
      }
      if (scopeId) bucket.sourceScopeIds.add(scopeId)
      if (savedDocumentId) bucket.savedDocumentIds.add(savedDocumentId)
      for (const sourceRef of readSourceRefs(term.source_mapping)) bucket.sourceRefs.add(sourceRef)
      for (const alias of readTermStrings(term)) {
        bucket.aliases.add(alias)
        const aliasKey = normalizeTermKey(alias)
        if (!aliasKey) continue
        const aliases = aliasToCanonical.get(aliasKey) ?? new Set<string>()
        aliases.add(canonical)
        aliasToCanonical.set(aliasKey, aliases)
      }
      for (const related of compactStringArray(term.related_terms, 12, 120)) bucket.relatedTerms.add(related)
      const termType = stringValue(term.termType)
      if (termType) bucket.termTypes.add(termType)
      byCanonical.set(canonicalKey, bucket)
    }
  }

  const repeatedCanonicalTerms = [...byCanonical.values()]
    .filter((bucket) => bucket.sourceScopeIds.size > 1 || bucket.savedDocumentIds.size > 1)
    .slice(0, 80)
    .map((bucket) => ({
      canonicalTerm: bucket.canonicalTerm,
      sourceScopeIds: [...bucket.sourceScopeIds].slice(0, 12),
      savedDocumentIds: [...bucket.savedDocumentIds].slice(0, 12),
      sourceRefs: [...bucket.sourceRefs].slice(0, 12),
      aliases: [...bucket.aliases].slice(0, 12),
      relatedTerms: [...bucket.relatedTerms].slice(0, 12),
      termTypes: [...bucket.termTypes].slice(0, 6),
    }))

  const ambiguousAliases = [...aliasToCanonical.entries()]
    .filter(([, canonicalTerms]) => canonicalTerms.size > 1)
    .slice(0, 80)
    .map(([surface, canonicalTerms]) => ({
      surface,
      canonicalTermCandidates: [...canonicalTerms].slice(0, 12),
    }))

  return {
    repeatedCanonicalTerms,
    ambiguousAliases,
    note: 'Use these hints only to merge clearly identical terms or keep ambiguous terms separate. They are derived from upstream epic glossary registries, not raw source graph edges.',
  }
}

interface ProjectGlossaryTermHintBucket {
  canonicalTerm: string
  sourceScopeIds: Set<string>
  savedDocumentIds: Set<string>
  sourceRefs: Set<string>
  aliases: Set<string>
  relatedTerms: Set<string>
  termTypes: Set<string>
}

function readCompactGlossaryTerms(document: Record<string, unknown>): Record<string, unknown>[] {
  const contentTerms = isRecord(document.content) && Array.isArray(document.content.terms)
    ? document.content.terms
    : []
  const itemTerms = Array.isArray(document.items)
    ? document.items
      .map((item) => isRecord(item) && isRecord(item.content) ? item.content : null)
      .filter((item): item is Record<string, unknown> => item !== null)
    : []
  return [...contentTerms, ...itemTerms].filter(isRecord)
}

function readTermStrings(term: Record<string, unknown>): string[] {
  return [
    stringValue(term.term),
    stringValue(term.canonical_term),
    ...compactStringArray(term.aliases, 8, 120),
    ...compactStringArray(term.synonyms, 8, 120),
    ...compactStringArray(term.candidate_aliases, 8, 120),
  ].filter((value): value is string => Boolean(value))
}

function readSourceRefs(sourceMapping: unknown): string[] {
  if (!Array.isArray(sourceMapping)) return []
  return sourceMapping
    .map((item) => isRecord(item) ? stringValue(item.sourceRef) : null)
    .filter((value): value is string => Boolean(value))
}

function normalizeTermKey(value: string | null): string {
  return (value ?? '').trim().toLocaleLowerCase()
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function compactJsonValue(
  value: unknown,
  limits: { maxStringLength: number; maxArrayItems: number; maxDepth: number },
  depth = 0,
): unknown {
  if (typeof value === 'string') return truncateText(value, limits.maxStringLength)
  if (Array.isArray(value)) {
    const items = value.slice(0, limits.maxArrayItems).map((item) => compactJsonValue(item, limits, depth + 1))
    if (value.length > limits.maxArrayItems) {
      items.push({ omittedForPrompt: value.length - limits.maxArrayItems })
    }
    return items
  }
  if (!isRecord(value)) return value
  if (depth >= limits.maxDepth) return { omittedForPrompt: 'maxDepth' }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, compactJsonValue(item, limits, depth + 1)]),
  )
}

function compactRecordShallow(record: Record<string, unknown>, omittedKeys: string[]): Record<string, unknown> {
  const omitted = new Set(omittedKeys)
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !omitted.has(key))
      .map(([key, value]) => [key, typeof value === 'string' ? truncateText(value, 500) : value]),
  )
}

function compactStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => truncateText(item, maxLength) as string)
}

function truncateText(value: unknown, maxLength: number): unknown {
  if (typeof value !== 'string') return value
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`
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
      itemContentHint: 'entity with storage.kind/storage.model_id/storage.model_name/storage.table_name and fields[].source_mapping/fields[].model_id/fields[].column_name, or gapType=missing_model_evidence with message and source_mapping',
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
          storage: {
            type: 'object',
            additionalProperties: true,
            required: ['kind'],
            properties: {
              kind: { type: 'string', enum: ['model', 'dto_only', 'external', 'derived', 'unknown'] },
              model_id: { type: ['string', 'null'] },
              model_name: { type: ['string', 'null'] },
              table_name: { type: ['string', 'null'] },
            },
          },
          fields: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['name', 'meaning', 'source_mapping'],
              properties: {
                name: { type: 'string' },
                meaning: { type: 'string' },
                source_mapping: stringArraySchema(1),
                model_id: { type: ['string', 'null'] },
                column_name: { type: ['string', 'null'] },
              },
            },
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
