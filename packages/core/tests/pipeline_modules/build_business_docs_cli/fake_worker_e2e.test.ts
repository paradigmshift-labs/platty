import { and, count, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPlattyCommand } from '../../../../cli/src/main.js'
import { documents } from '../../../src/db/schema/build_docs.js'
import { epicDocumentLinks } from '../../../src/db/schema/build_epics.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  businessDocGenerationTasks,
} from '../../../src/db/schema/build_business_docs_generation.js'
import { epics } from '../../../src/db/schema/core.js'
import type {
  BusinessDocsGenerationTaskStatus,
  BusinessDocsStoredDocumentType,
  BusinessDocsSubmittedDocument,
  BusinessDocsSubmittedDocumentItem,
  BusinessDocsTaskType,
} from '../../../src/pipeline_modules/build_business_docs_cli/types.js'
import { createTestPlattyDb, type TestPlattyDb } from '../../../src/db/testing.js'
import type { DB } from '../../../src/db/client.js'

let rootDir: string
let db: DB
let client: TestPlattyDb

const now = '2026-06-04T00:00:00.000Z'

interface FakeWorkerOptions {
  project: string
  runId: string
  workerId: string
  invalidFirstSubmitFor?: BusinessDocsTaskType
}

interface FakeWorkerResult {
  finalStatus: Record<string, unknown>
  submittedTaskIds: string[]
  contextHandles: string[]
  repairEvents: Array<{
    taskId: string
    validationPageToken: string
    retried: boolean
  }>
}

interface LeasedTask {
  id: string
  taskType: BusinessDocsTaskType
  documentType: BusinessDocsStoredDocumentType
  scope: 'epic' | 'project' | 'use_case'
  scopeId: string
  attemptNo: number
  leaseToken: string
  contextHandle: string
}

interface LeaseData {
  tasks: LeasedTask[]
  nextAction: {
    type: string
  }
}

interface ContextBundleData {
  pages: Array<{
    pageToken: string
    evidenceIds: string[]
  }>
}

interface ContextPageData {
  page: {
    pageToken: string
    evidenceIds: string[]
    content: Record<string, unknown>
  }
}

interface SubmitData {
  task: {
    id: string
    status: 'saved' | 'proposal_created' | 'repair_requested' | 'failed'
  }
  repair: {
    validationPageToken: 'validation_errors' | null
  }
}

interface StatusData {
  run: {
    id: string
    status: string
  }
  nextAction: {
    type: string
  }
}

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'platty-business-docs-fake-worker-'))
  vi.stubEnv('PLATTY_HOME', join(rootDir, '.platty'))
  client = createTestPlattyDb()
  db = client.db
  await runPlattyCommand(['init', '--json'], { cwd: rootDir, db })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await client.cleanup()
  rmSync(rootDir, { recursive: true, force: true })
})

describe('business docs CLI fake worker smoke', () => {
  it('completes a one-epic run through CLI context only', async () => {
    await createRunnableProject('Commerce')
    const started = await startBusinessDocsRun('Commerce')
    const runId = String(started.result.data?.run.id)

    const worker = await runFakeWorkerUntilDone({
      project: 'Commerce',
      runId,
      workerId: 'fake-codex-1',
    })

    expect(worker.finalStatus).toMatchObject({
      ok: true,
      data: {
        run: {
          id: runId,
          status: 'completed',
        },
        nextAction: {
          type: 'done',
        },
      },
    })
    expect(worker.submittedTaskIds.length).toBeGreaterThanOrEqual(8)
    expect(worker.contextHandles.length).toBeGreaterThanOrEqual(8)
    expect(countBusinessDocs()).toBeGreaterThanOrEqual(7)
    expect(countContextBundles(runId)).toBe(0)
    expect(countContextPagesByHandles(worker.contextHandles)).toBe(0)
  })

  it('repairs an invalid submit through status, retry, re-lease, and valid submit', async () => {
    await createRunnableProject('Commerce')
    const started = await startBusinessDocsRun('Commerce')
    const runId = String(started.result.data?.run.id)

    const worker = await runFakeWorkerUntilDone({
      project: 'Commerce',
      runId,
      workerId: 'fake-codex-repair',
      invalidFirstSubmitFor: 'business_rules',
    })

    expect(worker.finalStatus).toMatchObject({
      ok: true,
      data: {
        run: {
          id: runId,
          status: 'completed',
        },
      },
    })
    expect(worker.repairEvents).toContainEqual({
      taskId: expect.any(String),
      validationPageToken: 'validation_errors',
      retried: true,
    })
    expect(taskCount(runId, 'repair_requested')).toBe(0)
    expect(taskCount(runId, 'failed')).toBe(0)
    expect(countContextBundles(runId)).toBe(0)
    expect(countContextPagesByHandles(worker.contextHandles)).toBe(0)
  })
})

async function runFakeWorkerUntilDone(_options: FakeWorkerOptions): Promise<FakeWorkerResult> {
  const submittedTaskIds: string[] = []
  const contextHandles = new Set<string>()
  const repairEvents: FakeWorkerResult['repairEvents'] = []
  let invalidSubmitUsed = false

  for (let cycle = 0; cycle < 40; cycle += 1) {
    const leased = await runCli<LeaseData>([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      _options.project,
      '--run',
      _options.runId,
      '--worker',
      _options.workerId,
      '--limit',
      '1',
      '--json',
    ])

    if (leased.tasks.length === 0) {
      const status = await statusResult(_options)
      if (isCompleted(status)) {
        return completeRun(_options, submittedTaskIds, contextHandles, repairEvents)
      }
      throw new Error(`Fake worker found no ready tasks while status is ${JSON.stringify(status.data)}`)
    }

    for (const task of leased.tasks) {
      contextHandles.add(task.contextHandle)
      const bundle = await runCli<ContextBundleData>([
        'business-docs',
        'context',
        'get',
        '--context',
        task.contextHandle,
        '--lease-token',
        task.leaseToken,
        '--json',
      ])
      const pages = []
      for (const page of bundle.pages) {
        pages.push(await runCli<ContextPageData>([
          'business-docs',
          'context',
          'page',
          '--context',
          task.contextHandle,
          '--page',
          page.pageToken,
          '--lease-token',
          task.leaseToken,
          '--json',
        ]))
      }

      const shouldSubmitInvalid =
        _options.invalidFirstSubmitFor === task.taskType && !invalidSubmitUsed
      const document = buildDocumentFromContext(task, pages, shouldSubmitInvalid)
      if (shouldSubmitInvalid) invalidSubmitUsed = true

      const submitted = await runCli<SubmitData>([
        'business-docs',
        'tasks',
        'submit',
        '--project',
        _options.project,
        '--task',
        task.id,
        '--lease-token',
        task.leaseToken,
        '--attempt',
        String(task.attemptNo),
        '--document-json',
        JSON.stringify(document),
        '--json',
      ])

      if (submitted.task.status === 'repair_requested') {
        const repairEvent = {
          taskId: task.id,
          validationPageToken: submitted.repair.validationPageToken ?? 'validation_errors',
          retried: false,
        }
        repairEvents.push(repairEvent)
        const status = await statusResult(_options)
        expect(status.data).toMatchObject({
          run: {
            status: 'repair_requested',
          },
          nextAction: {
            type: 'repair_task',
          },
        })
        await runCli([
          'business-docs',
          'tasks',
          'retry',
          '--project',
          _options.project,
          '--task',
          task.id,
          '--json',
        ])
        repairEvent.retried = true
        continue
      }

      if (submitted.task.status === 'failed') {
        throw new Error(`Fake worker task failed: ${task.id}`)
      }
      submittedTaskIds.push(task.id)
    }

    const status = await statusResult(_options)
    if (isCompleted(status)) {
      return completeRun(_options, submittedTaskIds, contextHandles, repairEvents)
    }
  }

  throw new Error('Fake worker exceeded max cycles')
}

async function createRunnableProject(projectName: string): Promise<string> {
  const project = await runPlattyCommand(['project', 'create', projectName, '--json'], { cwd: rootDir, db })
  expect(project.exitCode).toBe(0)
  const projectId = String(project.result.data?.id)
  seedBusinessDocsPreview(projectId)
  return projectId
}

async function startBusinessDocsRun(projectName: string) {
  const started = await runPlattyCommand(['business-docs', 'start', '--project', projectName, '--json'], {
    cwd: rootDir,
    db,
  })
  expect(started.exitCode).toBe(0)
  return started
}

function seedBusinessDocsPreview(projectId: string): void {
  db.insert(epics).values({
    id: 'epic:orders',
    projectId,
    name: 'Orders',
    abbr: 'ORD',
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: now,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()

  db.insert(documents).values({
    id: 'doc:orders-api',
    projectId,
    type: 'api_spec',
    track: 'technical',
    scope: 'api_spec',
    scopeId: 'doc:orders-api',
    status: 'active',
    validity: 'fresh',
    summary: 'Orders API',
    content: { id: 'doc:orders-api', title: 'Orders API' },
    rawLlmOutput: '',
    updatedBy: 'system',
    updatedAt: now,
  }).run()

  db.insert(epicDocumentLinks).values({
    epicId: 'epic:orders',
    documentId: 'doc:orders-api',
    documentType: 'api_spec',
    role: 'primary',
    reason: 'test link',
    confidence: 'high',
    createdAt: now,
  }).run()
}

function countBusinessDocs(): number {
  return Number(db.select({ value: count() }).from(documents)
    .where(and(
      eq(documents.track, 'business'),
      eq(documents.status, 'active'),
    ))
    .get()?.value ?? 0)
}

function taskCount(runId: string, status: BusinessDocsGenerationTaskStatus): number {
  return Number(db.select({ value: count() }).from(businessDocGenerationTasks)
    .where(and(
      eq(businessDocGenerationTasks.runId, runId),
      eq(businessDocGenerationTasks.status, status),
    ))
    .get()?.value ?? 0)
}

function countContextBundles(runId: string): number {
  return Number(db.select({ value: count() }).from(businessDocContextBundles)
    .where(eq(businessDocContextBundles.runId, runId))
    .get()?.value ?? 0)
}

function countContextPagesByHandles(contextHandles: string[]): number {
  return contextHandles.reduce((total, contextHandle) => total + Number(db.select({ value: count() }).from(businessDocContextPages)
    .where(eq(businessDocContextPages.contextHandle, contextHandle))
    .get()?.value ?? 0), 0)
}

async function runCli<T>(argv: string[]): Promise<T> {
  const command = await runPlattyCommand(argv, { cwd: rootDir, db })
  expect(command.exitCode).toBe(0)
  expect(command.result.ok).toBe(true)
  return command.result.data as T
}

async function statusResult(options: FakeWorkerOptions) {
  const command = await runPlattyCommand([
    'business-docs',
    'status',
    '--project',
    options.project,
    '--run',
    options.runId,
    '--json',
  ], { cwd: rootDir, db })
  expect(command.exitCode).toBe(0)
  expect(command.result.ok).toBe(true)
  return command.result as { ok: true; data: StatusData }
}

async function completeRun(
  options: FakeWorkerOptions,
  submittedTaskIds: string[],
  contextHandles: Set<string>,
  repairEvents: FakeWorkerResult['repairEvents'],
): Promise<FakeWorkerResult> {
  await runCli([
    'business-docs',
    'cleanup',
    '--project',
    options.project,
    '--run',
    options.runId,
    '--json',
  ])
  const finalStatus = await statusResult(options)
  return {
    finalStatus: finalStatus as unknown as Record<string, unknown>,
    submittedTaskIds,
    contextHandles: Array.from(contextHandles),
    repairEvents,
  }
}

function isCompleted(status: { data: StatusData }): boolean {
  return status.data.run.status === 'completed' || status.data.nextAction.type === 'done'
}

function buildDocumentFromContext(
  task: LeasedTask,
  pages: ContextPageData[],
  invalidEvidence: boolean,
): BusinessDocsSubmittedDocument {
  const expected = readRecord(readRecord(pageContent(pages, 'schema')?.expectedJson))
  const documentType = readDocumentType(expected?.type) ?? task.documentType
  const scope = readScope(expected?.scope) ?? task.scope
  const scopeId = readString(expected?.scopeId) ?? task.scopeId
  const evidenceIds = uniqueStrings(pages.flatMap((page) => page.page.evidenceIds))
  const allowedEvidenceIds = evidenceIds.slice(0, 1)
  const submittedEvidenceIds = invalidEvidence ? ['invented:evidence'] : allowedEvidenceIds
  const sourceRefs = sourceRefsFromPages(pages)
  const sourceMapping = [{
    sourceRef: sourceRefs[0] ?? 'source_document_1',
    role: 'primary',
    reason: `${task.taskType} source evidence`,
  }]
  const document: BusinessDocsSubmittedDocument = {
    schemaVersion: 'business-doc.v1',
    documentType,
    scope,
    scopeId,
    title: `${task.taskType} title`,
    summary: `${task.taskType} summary`,
    content: {
      taskType: task.taskType,
      target: pageContent(pages, 'target'),
      pageTokens: pages.map((page) => page.page.pageToken),
      // Smoke-test placeholders carry no real source bodies; declaring the gap
      // keeps the document valid under deterministic v3 validation.
      evidence_gaps: ['smoke-test fixture provides no source content'],
    },
    evidenceIds: submittedEvidenceIds,
  }

  if (task.taskType === 'system_design') {
    document.items = [
      {
        itemType: 'design_component',
        stableKey: 'design:orders-flow',
        ordinal: 1,
        title: 'Orders flow',
        summary: 'Orders implementation flow.',
        content: {
          component: 'Orders flow',
          responsibility: 'Coordinate order submission and persistence evidence.',
          flow: ['Receive order request', 'Validate source evidence', 'Persist outcome'],
          integration_points: sourceRefs,
          source_mapping: sourceMapping,
          relationConfidence: 'direct_call_proven',
        },
        evidenceIds: submittedEvidenceIds,
      },
    ]
  }

  if (task.taskType === 'data_dictionary') {
    document.items = [
      {
        itemType: 'data_gap',
        stableKey: 'dd:missing-model-evidence',
        ordinal: 1,
        title: 'Missing model evidence',
        summary: 'No model evidence was provided to the fake worker.',
        content: {
          gapType: 'missing_model_evidence',
          message: 'No model/table evidence was reachable from this fake-worker context.',
          source_mapping: sourceRefs,
        },
        evidenceIds: submittedEvidenceIds,
      },
    ]
  }

  if (task.taskType === 'business_rules') {
    document.items = [
      {
        itemType: 'business_rule',
        stableKey: 'br:orders-submit',
        ordinal: 1,
        title: 'Orders submission rule',
        summary: 'Order submission is validated before persistence.',
        content: {
          earsPattern: 'event_driven',
          condition: 'When an order submission is received',
          rule: 'the system shall validate source-backed order requirements before accepting the request',
          outcome: 'valid orders continue and invalid orders are rejected consistently',
          ownership: 'owned_by_epic',
          source_mapping: sourceMapping,
        },
        evidenceIds: submittedEvidenceIds,
      },
    ]
  }

  if (task.taskType === 'use_case_list' || task.taskType === 'use_case_list_refine') {
    const clusterIds = sourceClusterIds(pages)
    document.items = (clusterIds.length > 0 ? clusterIds : ['orders-submit']).map((clusterId, index) => {
      const stableSuffix = clusterId.replace(/^cluster:/, '') || `source-${index + 1}`
      const clusterSourceRefs = sourceRefsForCluster(pages, clusterId)
      return {
        itemType: 'use_case',
        stableKey: `uc-${stableSuffix}`,
        ordinal: index + 1,
        title: `Use ${stableSuffix}`,
        summary: `Use case covering ${stableSuffix}.`,
        content: {
          actor: 'customer',
          goal: `${stableSuffix} goal`,
          trigger: `${stableSuffix} starts`,
          outcome: `${stableSuffix} handled`,
          sourceClusterIds: [clusterId],
          coverageRelation: 'owned_by_epic',
          ownedByEpic: true,
          primarySourceRefs: clusterSourceRefs.length > 0 ? clusterSourceRefs : sourceRefs,
          supportingSourceRefs: [],
          crossEpicSourceRefs: [],
          relationEvidenceRefs: [],
          uncertainty: [],
        },
        evidenceIds: submittedEvidenceIds,
      } satisfies BusinessDocsSubmittedDocumentItem
    })
  }

  if (task.taskType === 'use_case_spec') {
    document.items = [
      {
        itemType: 'use_case_spec',
        stableKey: task.scopeId,
        ordinal: 1,
        title: `${task.scopeId} specification`,
        summary: `${task.scopeId} answer-ready flow.`,
        content: {
          actor: 'customer',
          trigger: `${task.scopeId} starts`,
          preconditions: ['target use case exists in final UCL'],
          main_success_flow: ['open the relevant surface', 'submit the request', 'system validates and records the result'],
          alternatives: ['user cancels before submit'],
          exceptions: ['source evidence is missing or invalid'],
          business_rules: ['br:orders-submit'],
          source_mapping: sourceMapping,
          uncertainty: [],
        },
        evidenceIds: submittedEvidenceIds,
      },
    ]
  }

  if (task.taskType === 'epic_glossary' || task.taskType === 'project_glossary') {
    document.items = [
      {
        itemType: 'glossary_term',
        stableKey: 'term:orders',
        ordinal: 1,
        title: 'Orders',
        summary: 'Orders business term.',
        content: {
          term: 'Orders',
          canonical_term: 'Orders',
          definition: 'A business process for submitting and tracking a commerce order.',
          termType: 'domain',
          aliases: ['order'],
          synonyms: [],
          candidate_aliases: [],
          antonyms: [],
          contrast_terms: [],
          related_terms: [],
          signals: ['order'],
          source_mapping: sourceMapping,
          ambiguity: { status: 'none', candidates: [] },
        },
        evidenceIds: submittedEvidenceIds,
      },
    ]
  }

  return document
}

function pageContent(pages: ContextPageData[], pageToken: string): Record<string, unknown> | null {
  return pages.find((page) => page.page.pageToken === pageToken)?.page.content ?? null
}

function sourceClusterIds(pages: ContextPageData[]): string[] {
  const outline = readRecord(pageContent(pages, 'source_graph_projection')?.coverageOutline)
  const clusters = outline?.clusters
  if (!Array.isArray(clusters)) return []
  return clusters.flatMap((cluster) => {
    const clusterRecord = readRecord(cluster)
    const clusterId = readString(clusterRecord?.clusterId)
    return clusterId ? [clusterId] : []
  })
}

function sourceRefsFromPages(pages: ContextPageData[]): string[] {
  const sourceCards = readRecord(pageContent(pages, 'source_document_cards'))?.cards
  if (Array.isArray(sourceCards)) {
    return uniqueStrings(sourceCards.flatMap((card) => {
      const sourceRef = readString(readRecord(card)?.sourceRef)
      return sourceRef ? [sourceRef] : []
    }))
  }
  const outline = readRecord(pageContent(pages, 'source_graph_projection')?.coverageOutline)
  const clusters = outline?.clusters
  if (!Array.isArray(clusters)) return []
  return uniqueStrings(clusters.flatMap((cluster) => {
    const refs = readRecord(cluster)?.sourceRefs
    return Array.isArray(refs) ? refs.filter((value): value is string => typeof value === 'string') : []
  }))
}

function sourceRefsForCluster(pages: ContextPageData[], clusterId: string): string[] {
  const outline = readRecord(pageContent(pages, 'source_graph_projection')?.coverageOutline)
  const clusters = outline?.clusters
  if (!Array.isArray(clusters)) return []
  for (const cluster of clusters) {
    const record = readRecord(cluster)
    if (readString(record?.clusterId) !== clusterId) continue
    const refs = record?.sourceRefs
    return Array.isArray(refs) ? refs.filter((value): value is string => typeof value === 'string') : []
  }
  return []
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readDocumentType(value: unknown): BusinessDocsStoredDocumentType | null {
  const stringValue = readString(value)
  if (
    stringValue === 'design' ||
    stringValue === 'data_dictionary' ||
    stringValue === 'br' ||
    stringValue === 'ucl' ||
    stringValue === 'ucs' ||
    stringValue === 'glossary'
  ) {
    return stringValue
  }
  return null
}

function readScope(value: unknown): 'epic' | 'project' | 'use_case' | null {
  const stringValue = readString(value)
  if (stringValue === 'epic' || stringValue === 'project' || stringValue === 'use_case') return stringValue
  return null
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim())))
}
